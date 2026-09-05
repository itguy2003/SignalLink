"""커뮤니티 콘텐츠.

공유 이미지·동영상·게시판 글을 슬라이드로 엮은 묶음. 커뮤니티 위젯이
재생목록처럼 순환 표출한다.

Revision ID: 3f0617d939a4
Revises: dd43910cadd6
Create Date: 2026-09-04 00:00:04.255405
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '3f0617d939a4'
down_revision: Union[str, None] = 'dd43910cadd6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table('community_content',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('org_id', sa.Integer(), nullable=False),
    sa.Column('author_id', sa.Integer(), nullable=True),
    sa.Column('title', sa.String(length=200), nullable=False),
    sa.Column('items', sa.JSON(), nullable=False),
    sa.Column('version', sa.Integer(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=False),
    sa.ForeignKeyConstraint(['author_id'], ['app_user.id'], name=op.f('fk_community_content_author_id_app_user'), ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['org_id'], ['organization.id'], name=op.f('fk_community_content_org_id_organization'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_community_content'))
    )
    with op.batch_alter_table('community_content', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_community_content_author_id'), ['author_id'], unique=False)
        batch_op.create_index(batch_op.f('ix_community_content_org_id'), ['org_id'], unique=False)



def downgrade() -> None:
    with op.batch_alter_table('community_content', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_community_content_org_id'))
        batch_op.drop_index(batch_op.f('ix_community_content_author_id'))

    op.drop_table('community_content')
