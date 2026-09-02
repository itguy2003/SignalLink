"""SQLAlchemy 선언적 베이스와 공통 타입.

SQLite(개발)/PostgreSQL(운영) 모두에서 동작해야 하므로 방언 전용 타입을
직접 쓰지 않는다. JSON 은 SQLAlchemy 의 방언 중립 JSON 타입을 사용한다.
"""

from datetime import UTC, datetime

from sqlalchemy import DateTime, MetaData, func
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

#: 제약 이름 규칙.
#:
#: SQLite 는 ALTER TABLE 이 빈약해 Alembic 이 '새 테이블 생성 → 복사 → 교체'
#: (batch mode)로 우회하는데, 이때 **이름 없는 제약은 재생성할 수 없다**
#: (``ValueError: Constraint must have a name``). 예를 들어 기존 테이블에
#: 외래키 컬럼을 하나 추가하는 마이그레이션이 그대로 실패한다.
#:
#: 규칙을 지정해 모든 제약에 결정적인 이름을 붙이면 batch mode 가 동작하고,
#: PostgreSQL 쪽 이름도 자동 생성 이름 대신 예측 가능해진다.
NAMING_CONVENTION = {
    "ix": "ix_%(table_name)s_%(column_0_N_name)s",
    "uq": "uq_%(table_name)s_%(column_0_N_name)s",
    "ck": "ck_%(table_name)s_%(constraint_name)s",
    "fk": "fk_%(table_name)s_%(column_0_N_name)s_%(referred_table_name)s",
    "pk": "pk_%(table_name)s",
}


def utcnow() -> datetime:
    return datetime.now(UTC)


class Base(DeclarativeBase):
    metadata = MetaData(naming_convention=NAMING_CONVENTION)


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )
