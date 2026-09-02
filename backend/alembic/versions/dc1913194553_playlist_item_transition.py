"""playlist item transition

재생목록의 한 칸에서 다음 칸으로 넘어갈 때의 효과.

``server_default`` 를 붙인 이유: 이미 들어 있는 칸들에 채워 넣을 값이 없으면
NOT NULL 컬럼을 추가할 수 없다. 기본값을 그대로 두는 것은 의도적이다 —
없애려면 다시 테이블을 다시 만들어야 하는데(SQLite), 얻는 것이 없다.

Revision ID: dc1913194553
Revises: 2af1a0d4ada1
Create Date: 2026-09-01 10:57:57.826109
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "dc1913194553"
down_revision: Union[str, None] = "2af1a0d4ada1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("playlist_item", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column(
                "transition",
                sa.String(length=20),
                nullable=False,
                server_default="none",
            )
        )


def downgrade() -> None:
    with op.batch_alter_table("playlist_item", schema=None) as batch_op:
        batch_op.drop_column("transition")
