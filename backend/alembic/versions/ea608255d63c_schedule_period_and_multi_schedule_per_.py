"""스케줄 사용 기간 추가, 장치-스케줄을 1:N 에서 N:M 으로

두 가지를 함께 바꾼다.

1. ``schedule.start_at`` / ``end_at`` — 이 스케줄을 실제로 쓰는 기간.
   NULL 은 '제한 없음'. 요일·시각(schedule_item)이 '하루 중 언제'라면
   이 값은 '어느 날부터 어느 날까지'다.

2. ``device_schedule`` — 장치 한 대에 스케줄을 여러 개 배정한다.
   행사 기간용과 평상시용을 함께 걸어 두고 기간으로 갈리게 하려면
   1:N 으로는 표현할 수 없다.

**기존 배정을 옮긴다.** 자동 생성본은 ``device.schedule_id`` 를 그냥 지우는데,
그러면 지금 배정된 장치가 전부 데모 화면으로 떨어진다. 컬럼을 없애기 전에
연결 테이블로 복사한다.

Revision ID: ea608255d63c
Revises: fd6c33795ec5
Create Date: 2026-08-31 21:30:58.225095
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "ea608255d63c"
down_revision: str | None = "fd6c33795ec5"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "device_schedule",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("device_id", sa.Integer(), nullable=False),
        sa.Column("schedule_id", sa.Integer(), nullable=False),
        # 같은 시각에 여러 스케줄이 유효할 때의 우선순위. 작을수록 먼저다.
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        sa.ForeignKeyConstraint(
            ["device_id"],
            ["device.id"],
            name=op.f("fk_device_schedule_device_id_device"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["schedule_id"],
            ["schedule.id"],
            name=op.f("fk_device_schedule_schedule_id_schedule"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_device_schedule")),
        sa.UniqueConstraint("device_id", "schedule_id", name="uq_device_schedule"),
    )
    with op.batch_alter_table("device_schedule", schema=None) as batch_op:
        batch_op.create_index(
            batch_op.f("ix_device_schedule_device_id"), ["device_id"], unique=False
        )
        batch_op.create_index(
            batch_op.f("ix_device_schedule_schedule_id"), ["schedule_id"], unique=False
        )

    # 컬럼을 없애기 전에 옮긴다. 순서가 바뀌면 배정이 통째로 사라진다.
    op.execute(
        sa.text(
            "INSERT INTO device_schedule (device_id, schedule_id, sort_order) "
            "SELECT id, schedule_id, 0 FROM device WHERE schedule_id IS NOT NULL"
        )
    )

    with op.batch_alter_table("device", schema=None) as batch_op:
        batch_op.drop_index("ix_device_schedule_id")
        batch_op.drop_constraint("fk_device_schedule_id_schedule", type_="foreignkey")
        batch_op.drop_column("schedule_id")

    with op.batch_alter_table("schedule", schema=None) as batch_op:
        batch_op.add_column(sa.Column("start_at", sa.DateTime(timezone=True), nullable=True))
        batch_op.add_column(sa.Column("end_at", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("schedule", schema=None) as batch_op:
        batch_op.drop_column("end_at")
        batch_op.drop_column("start_at")

    with op.batch_alter_table("device", schema=None) as batch_op:
        batch_op.add_column(sa.Column("schedule_id", sa.INTEGER(), nullable=True))
        batch_op.create_foreign_key(
            "fk_device_schedule_id_schedule",
            "schedule",
            ["schedule_id"],
            ["id"],
            ondelete="SET NULL",
        )
        batch_op.create_index("ix_device_schedule_id", ["schedule_id"], unique=False)

    # 1:N 으로 돌아가므로 우선순위가 가장 높은 것 하나만 남길 수 있다.
    # 나머지 배정은 여기서 사라진다 — 되돌리기의 어쩔 수 없는 손실이다.
    op.execute(
        sa.text(
            "UPDATE device SET schedule_id = ("
            "  SELECT schedule_id FROM device_schedule"
            "  WHERE device_schedule.device_id = device.id"
            "  ORDER BY sort_order, id LIMIT 1"
            ")"
        )
    )

    with op.batch_alter_table("device_schedule", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("ix_device_schedule_schedule_id"))
        batch_op.drop_index(batch_op.f("ix_device_schedule_device_id"))

    op.drop_table("device_schedule")
