"""스케줄에 화면 방향(가로형/세로형) 추가

이 스케줄에 붙일 수 있는 콘텐츠의 방향을 정하는 값이다. 기존 스케줄은
모두 가로형(LANDSCAPE)으로 채운다 — 지금까지 만들어진 콘텐츠의 기본
해상도가 1920×1080 이라 그 편이 실제와 맞고, 세로형으로 채우면 기존
스케줄이 전부 방향 불일치가 되어 열리지 않는다.

``server_default`` 를 남겨 두는 이유: SQLite 는 NOT NULL 컬럼을 나중에
추가할 때 기본값이 없으면 실패하고, 배치 모드 재생성 비용도 크다.

Revision ID: 197fbf6712f7
Revises: a5511efe37b5
Create Date: 2026-08-31 03:03:06.722431
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "197fbf6712f7"
down_revision: str | None = "a5511efe37b5"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("schedule", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column(
                "orientation",
                sa.String(length=20),
                server_default="LANDSCAPE",
                nullable=False,
            )
        )


def downgrade() -> None:
    with op.batch_alter_table("schedule", schema=None) as batch_op:
        batch_op.drop_column("orientation")
