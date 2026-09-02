"""장치 화면 캡처 테이블 추가

장치가 ``screenshot`` 명령을 받고 올린 현재 화면을 보관한다. 장치와 1:1 이지만
``device`` 테이블에 컬럼으로 붙이지 않았다 — 그러면 장치 목록 조회가 매번
수백 KB 짜리 이미지를 함께 읽어 온다.

장치당 한 장만 두고 새 캡처가 오면 덮어쓴다. 장치를 지우면 캡처도 함께
사라지도록 ON DELETE CASCADE 다.

Revision ID: fd6c33795ec5
Revises: d3cc65fc7ade
Create Date: 2026-08-31 04:05:23.064117
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "fd6c33795ec5"
down_revision: str | None = "d3cc65fc7ade"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "device_screenshot",
        sa.Column("device_id", sa.Integer(), nullable=False),
        # LargeBinary 는 SQLite 의 BLOB, PostgreSQL 의 BYTEA 로 각각 매핑된다.
        sa.Column("image", sa.LargeBinary(), nullable=False),
        sa.Column("content_type", sa.String(length=50), nullable=False),
        sa.Column("captured_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["device_id"],
            ["device.id"],
            name=op.f("fk_device_screenshot_device_id_device"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("device_id", name=op.f("pk_device_screenshot")),
    )


def downgrade() -> None:
    op.drop_table("device_screenshot")
