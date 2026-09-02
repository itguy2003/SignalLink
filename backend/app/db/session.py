"""DB 세션/엔진.

SQLite(개발)와 PostgreSQL(운영) 양쪽에서 동일하게 동작해야 하므로
엔진 옵션을 방언별로 분기한다.
"""

from collections.abc import Generator

from sqlalchemy import create_engine, event
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker

from app.core.config import settings


def _make_engine() -> Engine:
    if settings.is_sqlite:
        engine = create_engine(
            settings.sqlalchemy_url,
            connect_args={"check_same_thread": False},
            future=True,
        )

        @event.listens_for(engine, "connect")
        def _set_sqlite_pragma(dbapi_conn, _record) -> None:  # noqa: ANN001
            # SQLite 는 기본적으로 FK 제약을 강제하지 않는다. 운영 DB(PostgreSQL)와
            # 동작을 맞추기 위해 켜 준다.
            cursor = dbapi_conn.cursor()
            cursor.execute("PRAGMA foreign_keys=ON")
            cursor.close()

        return engine

    return create_engine(
        settings.sqlalchemy_url,
        pool_pre_ping=True,
        pool_size=10,
        max_overflow=20,
        future=True,
    )


engine = _make_engine()
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, future=True)


def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
