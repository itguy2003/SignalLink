"""커뮤니티 콘텐츠를 캔버스 문서로.

슬라이드 목록(items)을 CMS 와 같은 문서(document)로 바꾸고, 문서가 쓰는
자산 색인(community_content_asset)을 더한다. 기존 슬라이드 데이터는
시연용뿐이라 옮기지 않고 빈 문서로 초기화한다.

Revision ID: d850f714b679
Revises: 3f0617d939a4
Create Date: 2026-09-04 00:52:51.561994
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import sqlite

revision: str = 'd850f714b679'
down_revision: Union[str, None] = '3f0617d939a4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table('community_content_asset',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('content_id', sa.Integer(), nullable=False),
    sa.Column('asset_id', sa.Integer(), nullable=False),
    sa.ForeignKeyConstraint(['asset_id'], ['asset.id'], name=op.f('fk_community_content_asset_asset_id_asset'), ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['content_id'], ['community_content.id'], name=op.f('fk_community_content_asset_content_id_community_content'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_community_content_asset')),
    sa.UniqueConstraint('content_id', 'asset_id', name='uq_community_content_asset')
    )
    with op.batch_alter_table('community_content_asset', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_community_content_asset_asset_id'), ['asset_id'], unique=False)
        batch_op.create_index(batch_op.f('ix_community_content_asset_content_id'), ['content_id'], unique=False)

    with op.batch_alter_table('community_content', schema=None) as batch_op:
        batch_op.add_column(sa.Column('document', sa.JSON(), nullable=False, server_default='{}'))
        batch_op.drop_column('items')



def downgrade() -> None:
    with op.batch_alter_table('community_content', schema=None) as batch_op:
        batch_op.add_column(sa.Column('items', sqlite.JSON(), nullable=False))
        batch_op.drop_column('document')

    with op.batch_alter_table('community_content_asset', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_community_content_asset_content_id'))
        batch_op.drop_index(batch_op.f('ix_community_content_asset_asset_id'))

    op.drop_table('community_content_asset')
