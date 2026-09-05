"""애플리케이션 설정.

개발용은 SQLite, 운영용은 PostgreSQL을 사용한다(요구사항 기술스택).
DATABASE_URL 이 비어 있으면 SQLite 로 폴백한다.
"""

from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=str(BACKEND_DIR / ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    PROJECT_NAME: str = "SignalLink Green"
    API_V1_PREFIX: str = "/api/v1"

    DATABASE_URL: str = ""

    SECRET_KEY: str = "dev-secret-key-change-me"
    DEVICE_MASTER_KEY: str = "dev-device-master-key-change-me"
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 480

    BOOTSTRAP_ADMIN_ID: str = "admin"
    BOOTSTRAP_ADMIN_PASSWORD: str = "admin1234"
    ROOT_ORG_NAME: str = "최상위 기관"

    CORS_ORIGINS: str = "http://localhost:5173,http://127.0.0.1:5173"

    # 하트비트 간격(초). 클라이언트가 접속 시 서버로부터 전달받는다.
    HEARTBEAT_INTERVAL_SEC: int = 30

    # Pixabay 이미지 검색. 콘텐츠 편집기가 서버를 거쳐 검색한다.
    #
    # 키를 프론트엔드에 두면 번들에 그대로 실려 누구나 꺼내 쓸 수 있고,
    # 우리 계정의 호출 한도가 남의 트래픽으로 소모된다. 그래서 서버만 안다.
    # 비어 있으면 검색 기능이 꺼진 것으로 취급한다(오류가 아니다).
    PIXABAY_API_KEY: str = ""
    PIXABAY_TIMEOUT_SEC: float = 10.0

    # 업로드한 이미지·동영상을 두는 곳. 상대 경로면 backend/ 아래로 잡는다.
    #
    # DB 가 아니라 파일 시스템에 두는 이유는 영상 때문이다 — DB 블롭은 한 번
    # 읽을 때마다 그 크기만큼 메모리에 올라온다. 운영에서는 서버를 늘릴 때
    # 공유 스토리지(NFS 등)를 이 경로에 붙이면 된다.
    MEDIA_ROOT: str = "media"
    MAX_IMAGE_BYTES: int = 200 * 1024 * 1024
    #: 동영상 상한 10GB. 이 크기부터는 통째로 메모리에 올리면 서버가 먼저
    #: 쓰러진다 — 업로드는 조각으로 받아 쓴다(``services/assets.store_stream``).
    MAX_VIDEO_BYTES: int = 10 * 1024 * 1024 * 1024

    @property
    def BACKEND_DIR(self) -> str:  # noqa: N802 - 설정 값처럼 쓰이는 경로다
        return str(BACKEND_DIR)

    @property
    def sqlalchemy_url(self) -> str:
        if self.DATABASE_URL:
            return self.DATABASE_URL
        return f"sqlite:///{(BACKEND_DIR / 'signallink.db').as_posix()}"

    @property
    def is_sqlite(self) -> bool:
        return self.sqlalchemy_url.startswith("sqlite")

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.CORS_ORIGINS.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
