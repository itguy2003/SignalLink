"""playlist item transition duration

전환에 걸리는 시간(밀리초). 칸마다 다르게 줄 수 있다.

``server_default`` 를 붙인 이유는 앞선 ``transition`` 컬럼과 같다 — 이미 들어
있는 칸에 채울 값이 없으면 NOT NULL 컬럼을 추가할 수 없다. 기본값 600ms 는
지금까지 모든 전환이 쓰던 고정값이라, 기존 재생목록의 표출이 달라지지 않는다.

Revision ID: 0f85f283e9c5
Revises: dc1913194553
Create Date: 2026-09-01 11:05:00.000000
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0f85f283e9c5"
down_revision: Union[str, None] = "dc1913194553"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("playlist_item", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column(
                "transition_ms",
                sa.Integer(),
                nullable=False,
                server_default="600",
            )
        )


def downgrade() -> None:
    with op.batch_alter_table("playlist_item", schema=None) as batch_op:
        batch_op.drop_column("transition_ms")
