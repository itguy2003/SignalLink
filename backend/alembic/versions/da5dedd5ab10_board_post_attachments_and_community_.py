"""게시글 첨부파일 색인.

게시판이 커뮤니티 유저에게 열린 유일한 창구가 되면서, 글에 이미지·동영상을
붙일 수 있어야 한다. 파일 자체는 자산(asset)에 그대로 두고 게시글이 그것을
가리킨다 — 파일을 다루는 길이 하나뿐이어야 올리기·용량 제한·형식 검사가
갈리지 않는다(content_asset / playlist_asset 과 같은 모양).

역할 COMMUNITY_USER 자체는 문자열이라 스키마 변경이 없다.

Revision ID: da5dedd5ab10
Revises: e28c8cadaf5a
Create Date: 2026-09-02 15:44:26.917387
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'da5dedd5ab10'
down_revision: Union[str, None] = 'e28c8cadaf5a'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table('board_post_asset',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('post_id', sa.Integer(), nullable=False),
    sa.Column('asset_id', sa.Integer(), nullable=False),
    sa.Column('sort_order', sa.Integer(), nullable=False),
    sa.ForeignKeyConstraint(['asset_id'], ['asset.id'], name=op.f('fk_board_post_asset_asset_id_asset'), ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['post_id'], ['board_post.id'], name=op.f('fk_board_post_asset_post_id_board_post'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_board_post_asset')),
    sa.UniqueConstraint('post_id', 'asset_id', name='uq_board_post_asset')
    )
    with op.batch_alter_table('board_post_asset', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_board_post_asset_asset_id'), ['asset_id'], unique=False)
        batch_op.create_index(batch_op.f('ix_board_post_asset_post_id'), ['post_id'], unique=False)



def downgrade() -> None:
    with op.batch_alter_table('board_post_asset', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_board_post_asset_post_id'))
        batch_op.drop_index(batch_op.f('ix_board_post_asset_asset_id'))

    op.drop_table('board_post_asset')
