"""위젯 재생목록 추가

위젯 여러 개를 순서와 표출 시간만 정해 묶어 둔 것. 콘텐츠 편집기에서 한
요소로 놓으면 그 자리에서 위젯들이 차례로 바뀐다.

``content_playlist`` 는 '이 재생목록을 쓰는 콘텐츠' 색인이다. 콘텐츠 문서는
통째로 JSON 이라 이 표가 없으면 재생목록을 고쳤을 때 어느 스케줄의 버전을
올려야 하는지 알 수 없고, 장치는 바뀐 재생목록을 영영 받지 못한다.

Revision ID: 2af1a0d4ada1
Revises: ea608255d63c
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = '2af1a0d4ada1'
down_revision: str | None = 'ea608255d63c'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table('playlist',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('name', sa.String(length=200), nullable=False),
    sa.Column('description', sa.String(length=500), nullable=True),
    sa.Column('org_id', sa.Integer(), nullable=False),
    sa.Column('created_by', sa.Integer(), nullable=True),
    sa.Column('version', sa.Integer(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=False),
    sa.ForeignKeyConstraint(['created_by'], ['app_user.id'], name=op.f('fk_playlist_created_by_app_user'), ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['org_id'], ['organization.id'], name=op.f('fk_playlist_org_id_organization'), ondelete='RESTRICT'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_playlist'))
    )
    with op.batch_alter_table('playlist', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_playlist_created_by'), ['created_by'], unique=False)
        batch_op.create_index(batch_op.f('ix_playlist_name'), ['name'], unique=False)
        batch_op.create_index(batch_op.f('ix_playlist_org_id'), ['org_id'], unique=False)

    op.create_table('content_playlist',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('content_id', sa.Integer(), nullable=False),
    sa.Column('playlist_id', sa.Integer(), nullable=False),
    sa.ForeignKeyConstraint(['content_id'], ['content.id'], name=op.f('fk_content_playlist_content_id_content'), ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['playlist_id'], ['playlist.id'], name=op.f('fk_content_playlist_playlist_id_playlist'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_content_playlist')),
    sa.UniqueConstraint('content_id', 'playlist_id', name='uq_content_playlist')
    )
    with op.batch_alter_table('content_playlist', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_content_playlist_content_id'), ['content_id'], unique=False)
        batch_op.create_index(batch_op.f('ix_content_playlist_playlist_id'), ['playlist_id'], unique=False)

    op.create_table('playlist_item',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('playlist_id', sa.Integer(), nullable=False),
    sa.Column('sort_order', sa.Integer(), nullable=False),
    sa.Column('widget_key', sa.String(length=50), nullable=False),
    sa.Column('duration_sec', sa.Integer(), nullable=False),
    sa.Column('options', sa.JSON(), nullable=False),
    sa.ForeignKeyConstraint(['playlist_id'], ['playlist.id'], name=op.f('fk_playlist_item_playlist_id_playlist'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_playlist_item'))
    )
    with op.batch_alter_table('playlist_item', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_playlist_item_playlist_id'), ['playlist_id'], unique=False)



def downgrade() -> None:
    with op.batch_alter_table('playlist_item', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_playlist_item_playlist_id'))

    op.drop_table('playlist_item')
    with op.batch_alter_table('content_playlist', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_content_playlist_playlist_id'))
        batch_op.drop_index(batch_op.f('ix_content_playlist_content_id'))

    op.drop_table('content_playlist')
    with op.batch_alter_table('playlist', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_playlist_org_id'))
        batch_op.drop_index(batch_op.f('ix_playlist_name'))
        batch_op.drop_index(batch_op.f('ix_playlist_created_by'))

    op.drop_table('playlist')
