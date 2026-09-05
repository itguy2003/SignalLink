"""커뮤니티 공유 공간.

커뮤니티가 기관게시판에 얹혀 있던 설계를 걷어내고(게시글 첨부 색인 삭제),
상위기관 단위의 전용 공간으로 다시 만든다 — 공유 게시판(글+첨부),
공유 이미지·동영상. 파일은 자산에 두고 여기서는 가리키기만 한다.

Revision ID: dd43910cadd6
Revises: da5dedd5ab10
Create Date: 2026-09-03 23:31:23.755474
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'dd43910cadd6'
down_revision: Union[str, None] = 'da5dedd5ab10'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table('community_post',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('org_id', sa.Integer(), nullable=False),
    sa.Column('author_id', sa.Integer(), nullable=True),
    sa.Column('title', sa.String(length=500), nullable=False),
    sa.Column('content', sa.Text(), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=False),
    sa.ForeignKeyConstraint(['author_id'], ['app_user.id'], name=op.f('fk_community_post_author_id_app_user'), ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['org_id'], ['organization.id'], name=op.f('fk_community_post_org_id_organization'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_community_post'))
    )
    with op.batch_alter_table('community_post', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_community_post_author_id'), ['author_id'], unique=False)
        batch_op.create_index(batch_op.f('ix_community_post_org_id'), ['org_id'], unique=False)

    op.create_table('community_media',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('org_id', sa.Integer(), nullable=False),
    sa.Column('asset_id', sa.Integer(), nullable=False),
    sa.Column('title', sa.String(length=200), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=False),
    sa.ForeignKeyConstraint(['asset_id'], ['asset.id'], name=op.f('fk_community_media_asset_id_asset'), ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['org_id'], ['organization.id'], name=op.f('fk_community_media_org_id_organization'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_community_media')),
    sa.UniqueConstraint('org_id', 'asset_id', name='uq_community_media')
    )
    with op.batch_alter_table('community_media', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_community_media_asset_id'), ['asset_id'], unique=False)
        batch_op.create_index(batch_op.f('ix_community_media_org_id'), ['org_id'], unique=False)

    op.create_table('community_post_asset',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('post_id', sa.Integer(), nullable=False),
    sa.Column('asset_id', sa.Integer(), nullable=False),
    sa.Column('sort_order', sa.Integer(), nullable=False),
    sa.ForeignKeyConstraint(['asset_id'], ['asset.id'], name=op.f('fk_community_post_asset_asset_id_asset'), ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['post_id'], ['community_post.id'], name=op.f('fk_community_post_asset_post_id_community_post'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_community_post_asset')),
    sa.UniqueConstraint('post_id', 'asset_id', name='uq_community_post_asset')
    )
    with op.batch_alter_table('community_post_asset', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_community_post_asset_asset_id'), ['asset_id'], unique=False)
        batch_op.create_index(batch_op.f('ix_community_post_asset_post_id'), ['post_id'], unique=False)

    with op.batch_alter_table('board_post_asset', schema=None) as batch_op:
        batch_op.drop_index('ix_board_post_asset_asset_id')
        batch_op.drop_index('ix_board_post_asset_post_id')

    op.drop_table('board_post_asset')


def downgrade() -> None:
    op.create_table('board_post_asset',
    sa.Column('id', sa.INTEGER(), nullable=False),
    sa.Column('post_id', sa.INTEGER(), nullable=False),
    sa.Column('asset_id', sa.INTEGER(), nullable=False),
    sa.Column('sort_order', sa.INTEGER(), nullable=False),
    sa.ForeignKeyConstraint(['asset_id'], ['asset.id'], name='fk_board_post_asset_asset_id_asset', ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['post_id'], ['board_post.id'], name='fk_board_post_asset_post_id_board_post', ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name='pk_board_post_asset'),
    sa.UniqueConstraint('post_id', 'asset_id', name='uq_board_post_asset')
    )
    with op.batch_alter_table('board_post_asset', schema=None) as batch_op:
        batch_op.create_index('ix_board_post_asset_post_id', ['post_id'], unique=False)
        batch_op.create_index('ix_board_post_asset_asset_id', ['asset_id'], unique=False)

    with op.batch_alter_table('community_post_asset', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_community_post_asset_post_id'))
        batch_op.drop_index(batch_op.f('ix_community_post_asset_asset_id'))

    op.drop_table('community_post_asset')
    with op.batch_alter_table('community_media', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_community_media_org_id'))
        batch_op.drop_index(batch_op.f('ix_community_media_asset_id'))

    op.drop_table('community_media')
    with op.batch_alter_table('community_post', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_community_post_org_id'))
        batch_op.drop_index(batch_op.f('ix_community_post_author_id'))

    op.drop_table('community_post')
