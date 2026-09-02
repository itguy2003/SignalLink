"""Alembic 환경 설정.

개발은 SQLite, 운영은 PostgreSQL 이므로 같은 마이그레이션 스크립트가
두 방언에서 모두 동작해야 한다.

- URL 은 ``app.core.config.settings`` 에서 읽는다(환경변수 DATABASE_URL).
- SQLite 는 ALTER TABLE 지원이 빈약해 컬럼 변경/제약 조작이 실패한다.
  ``render_as_batch=True`` 를 켜면 Alembic 이 '새 테이블 생성 → 복사 → 교체'
  방식으로 우회한다. PostgreSQL 에서는 이 옵션이 무해하다.
- batch mode 는 이름 없는 제약을 재생성하지 못하므로, 모든 제약에 이름을
  붙이는 규칙을 ``db/base.py`` 의 ``NAMING_CONVENTION`` 으로 강제한다.
  ``render_as_batch`` 만 켜고 규칙을 빼면 FK 추가 마이그레이션이 실패한다.
"""

from __future__ import annotations

from logging.config import fileConfig

from alembic import context
from sqlalchemy import engine_from_config, pool

from app.core.config import settings
from app.db.base import Base
from app.models import *  # noqa: F401,F403  (모든 모델을 메타데이터에 등록)

config = context.config
config.set_main_option("sqlalchemy.url", settings.sqlalchemy_url)

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata


def run_migrations_offline() -> None:
    context.configure(
        url=settings.sqlalchemy_url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        render_as_batch=settings.is_sqlite,
        compare_type=True,
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    with connectable.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            render_as_batch=settings.is_sqlite,
            compare_type=True,
        )
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
