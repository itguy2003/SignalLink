"""커뮤니티 콘텐츠에 사용기간·사용대상, 커뮤니티 재생목록.

위젯은 옵션 없이 서버가 고른다 — 기간 안이고 장치의 학교급(초/중/고)에
맞는 콘텐츠 중 가장 최근 것. 재생목록은 공유 이미지·동영상을 엮는다.

Revision ID: 781a7cc6f19c
Revises: d850f714b679
Create Date: 2026-09-04 15:08:39.540729
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '781a7cc6f19c'
down_revision: Union[str, None] = 'd850f714b679'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table('community_playlist',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('org_id', sa.Integer(), nullable=False),
    sa.Column('author_id', sa.Integer(), nullable=True),
    sa.Column('name', sa.String(length=200), nullable=False),
    sa.Column('items', sa.JSON(), nullable=False),
    sa.Column('version', sa.Integer(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=False),
    sa.ForeignKeyConstraint(['author_id'], ['app_user.id'], name=op.f('fk_community_playlist_author_id_app_user'), ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['org_id'], ['organization.id'], name=op.f('fk_community_playlist_org_id_organization'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_community_playlist'))
    )
    with op.batch_alter_table('community_playlist', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_community_playlist_author_id'), ['author_id'], unique=False)
        batch_op.create_index(batch_op.f('ix_community_playlist_org_id'), ['org_id'], unique=False)

    with op.batch_alter_table('community_content', schema=None) as batch_op:
        batch_op.add_column(sa.Column('start_date', sa.String(length=10), nullable=True))
        batch_op.add_column(sa.Column('end_date', sa.String(length=10), nullable=True))
        batch_op.add_column(sa.Column('audience', sa.String(length=10), nullable=False, server_default='전체'))
        batch_op.create_index(batch_op.f('ix_community_content_org_id'), ['org_id'], unique=False)



def downgrade() -> None:
    with op.batch_alter_table('community_content', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_community_content_org_id'))
        batch_op.drop_column('audience')
        batch_op.drop_column('end_date')
        batch_op.drop_column('start_date')

    with op.batch_alter_table('community_playlist', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_community_playlist_org_id'))
        batch_op.drop_index(batch_op.f('ix_community_playlist_author_id'))

    op.drop_table('community_playlist')
