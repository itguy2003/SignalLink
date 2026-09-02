"""장치가 보고하는 실제 저장공간 추가

기존 ``device.storage`` 는 등록 시 사람이 적어 넣는 사양 문자열("256GB")이라
사용률을 계산할 수 없다. 장치가 하트비트로 보고하는 실제 값을 따로 받는다.

전부 nullable 이다. 보고하지 않는(옛 버전 앱) 장치는 '미보고'로 남아야 하며,
0 으로 채우면 저장공간이 넉넉한 장치와 구분되지 않는다.

BigInteger 인 이유: PostgreSQL 의 INTEGER 는 32비트라 2GB 를 넘기면 넘친다.
SQLite 의 INTEGER 는 64비트라 양쪽에서 그대로 동작한다.

Revision ID: d3cc65fc7ade
Revises: 197fbf6712f7
Create Date: 2026-08-31 03:53:58.689095
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "d3cc65fc7ade"
down_revision: str | None = "197fbf6712f7"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("device", schema=None) as batch_op:
        batch_op.add_column(sa.Column("storage_total_bytes", sa.BigInteger(), nullable=True))
        batch_op.add_column(sa.Column("storage_free_bytes", sa.BigInteger(), nullable=True))
        batch_op.add_column(
            sa.Column("storage_reported_at", sa.DateTime(timezone=True), nullable=True)
        )


def downgrade() -> None:
    with op.batch_alter_table("device", schema=None) as batch_op:
        batch_op.drop_column("storage_reported_at")
        batch_op.drop_column("storage_free_bytes")
        batch_op.drop_column("storage_total_bytes")
