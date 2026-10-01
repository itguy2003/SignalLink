"""테스트 픽스처.

각 테스트는 파일 기반 임시 SQLite 를 쓴다. 인메모리(``:memory:``)는
TestClient 가 여러 커넥션을 열 때 서로 다른 DB 를 보게 되므로 쓰지 않는다.
"""

from __future__ import annotations

import os
import tempfile
from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlalchemy.orm import Session, sessionmaker

# 설정 캐시가 만들어지기 전에 환경변수를 세팅해야 한다.
os.environ.setdefault("SECRET_KEY", "test-secret-key")
os.environ.setdefault("DEVICE_MASTER_KEY", "test-device-master-key")
os.environ.setdefault("BOOTSTRAP_ADMIN_ID", "admin")
os.environ.setdefault("BOOTSTRAP_ADMIN_PASSWORD", "admin1234")
# 개발자의 .env 에 흔들리지 않게 강제한다(테스트 밀폐). .env 가 운영
# PostgreSQL 을 가리키고 있어도 테스트는 임시 SQLite 로 돌고, DATABASE_URL
# 에서 파생되는 토글(암호 복잡도 auto 등)도 개발 기본값으로 판정돼야 한다.
os.environ["DATABASE_URL"] = ""
os.environ["PASSWORD_COMPLEXITY"] = "auto"

from app.db.base import Base  # noqa: E402
from app.db.init_db import init_db  # noqa: E402
from app.db.session import get_db  # noqa: E402
from app.main import app  # noqa: E402
from app.models.enums import Role, UserStatus  # noqa: E402
from app.models.user import User, UserRole  # noqa: E402


@pytest.fixture
def db_path() -> Iterator[Path]:
    handle, name = tempfile.mkstemp(suffix=".db")
    os.close(handle)
    path = Path(name)
    yield path
    path.unlink(missing_ok=True)


@pytest.fixture
def session_factory(db_path: Path):  # noqa: ANN201
    engine = create_engine(
        f"sqlite:///{db_path.as_posix()}", connect_args={"check_same_thread": False}
    )

    @event.listens_for(engine, "connect")
    def _fk_on(dbapi_conn, _record):  # noqa: ANN001
        cursor = dbapi_conn.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()

    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, autoflush=False, autocommit=False)
    with factory() as db:
        init_db(db)
    yield factory
    engine.dispose()


@pytest.fixture(autouse=True)
def _reset_ws_hub() -> Iterator[None]:
    """WebSocket 허브는 모듈 전역 싱글턴이라 테스트 사이에 상태가 남는다.

    끊기지 않은 연결이 남으면 다음 테스트의 장치 ``online`` 값이 오염되므로
    매 테스트 전후로 비운다.
    """
    from app.services.ws_hub import hub

    hub._connections.clear()  # noqa: SLF001 - 테스트 격리를 위한 의도적 접근
    yield
    hub._connections.clear()  # noqa: SLF001


@pytest.fixture
def db(session_factory) -> Iterator[Session]:  # noqa: ANN001
    with session_factory() as session:
        yield session


@pytest.fixture
def client(session_factory, monkeypatch) -> Iterator[TestClient]:  # noqa: ANN001
    def _override_get_db() -> Iterator[Session]:
        with session_factory() as session:
            yield session

    app.dependency_overrides[get_db] = _override_get_db

    # WebSocket 핸들러는 요청 스코프 밖에서 동작하므로 의존성 주입 대신
    # SessionLocal 을 직접 쓴다. 테스트 DB 를 보도록 그 참조를 바꿔 준다.
    import app.api.v1.ws as ws_module

    monkeypatch.setattr(ws_module, "SessionLocal", session_factory)

    # TestClient 를 컨텍스트 매니저로 쓰지 않는다. 그러면 lifespan 이 돌면서
    # 실제 설정의 개발용 DB(signallink.db)에 테이블을 만들기 때문이다.
    # 스키마 생성과 부트스트랩은 session_factory 가 이미 끝냈다.
    test_client = TestClient(app)
    yield test_client
    app.dependency_overrides.clear()


@pytest.fixture
def root_org_id(db: Session) -> int:
    from app.services.org_tree import get_root_org

    root = get_root_org(db)
    assert root is not None
    return root.id


def _login(client: TestClient, user_id: str, password: str) -> str:
    response = client.post("/api/v1/auth/login", json={"user_id": user_id, "password": password})
    assert response.status_code == 200, response.text
    return response.json()["access_token"]


def auth_header(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def super_token(client: TestClient) -> str:
    return _login(client, "admin", "admin1234")


@pytest.fixture
def super_headers(super_token: str) -> dict[str, str]:
    return auth_header(super_token)


@pytest.fixture
def make_user(session_factory):  # noqa: ANN001, ANN201
    """승인된 사용자를 직접 만들어 준다. 비밀번호는 항상 ``test1234``."""
    from app.core.security import hash_password

    def _make(user_id: str, org_id: int, roles: list[Role]) -> int:
        with session_factory() as session:
            user = User(
                user_id=user_id,
                password_hash=hash_password("test1234"),
                org_id=org_id,
                name=user_id,
                status=UserStatus.APPROVED,
            )
            names = {str(Role.MEMBER)} | {str(r) for r in roles}
            for role in sorted(names):
                user.roles.append(UserRole(role=role))
            session.add(user)
            session.commit()
            return user.id

    return _make


@pytest.fixture
def login(client: TestClient):  # noqa: ANN001, ANN201
    def _login_as(user_id: str, password: str = "test1234") -> dict[str, str]:
        return auth_header(_login(client, user_id, password))

    return _login_as
