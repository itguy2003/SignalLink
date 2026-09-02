"""재생목록이 쓰는 자산 색인.

이미지앨범 위젯이 사진 주소를 칸의 options 안에 들고 있어서,
콘텐츠 문서만 뒤져서는 그 사진이 쓰이는지 알 수 없다. 쓰이는 파일을
지우지 못하게 막으려면 이 색인이 필요하다(content_asset 의 짝).

Revision ID: e28c8cadaf5a
Revises: 20e845ed2d2b
Create Date: 2026-09-02 00:12:23.202902
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'e28c8cadaf5a'
down_revision: Union[str, None] = '20e845ed2d2b'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table('playlist_asset',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('playlist_id', sa.Integer(), nullable=False),
    sa.Column('asset_id', sa.Integer(), nullable=False),
    sa.ForeignKeyConstraint(['asset_id'], ['asset.id'], name=op.f('fk_playlist_asset_asset_id_asset'), ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['playlist_id'], ['playlist.id'], name=op.f('fk_playlist_asset_playlist_id_playlist'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_playlist_asset')),
    sa.UniqueConstraint('playlist_id', 'asset_id', name='uq_playlist_asset')
    )
    with op.batch_alter_table('playlist_asset', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_playlist_asset_asset_id'), ['asset_id'], unique=False)
        batch_op.create_index(batch_op.f('ix_playlist_asset_playlist_id'), ['playlist_id'], unique=False)



def downgrade() -> None:
    with op.batch_alter_table('playlist_asset', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_playlist_asset_playlist_id'))
        batch_op.drop_index(batch_op.f('ix_playlist_asset_asset_id'))

    op.drop_table('playlist_asset')
