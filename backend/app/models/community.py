"""커뮤니티 — 상위기관 단위의 공유 공간.

커뮤니티는 **상위기관(org_type=기관)에만** 있다. 학교에는 없다 — 학교
구성원과 지역 이용자가 함께 쓰는 공간이라, 학교 하나보다 넓은 단위(교육청
등)에 두어야 서로 만난다. 어느 커뮤니티를 보는지는 소속 기관에서 트리를
따라 올라가 처음 만나는 상위기관으로 정한다
(``services/permissions.community_org_id``).

내용은 공유 게시판 하나다 — 글에 이미지·동영상을 붙인다. 붙인 파일이 곧
커뮤니티의 공유 재료다(콘텐츠·재생목록이 가져다 쓴다). 파일은 전부
자산(``Asset``)으로 저장하고 여기서는 가리키기만 한다 — 파일을 다루는
길이 하나뿐이어야 올리기·용량 제한·형식 검사·내려받기 주소가 갈리지 않는다.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from sqlalchemy import ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, TimestampMixin

if TYPE_CHECKING:
    from app.models.asset import Asset
    from app.models.organization import Organization
    from app.models.user import User


class CommunityPost(Base, TimestampMixin):
    """공유 게시판의 글."""

    __tablename__ = "community_post"

    id: Mapped[int] = mapped_column(primary_key=True)
    #: 커뮤니티가 걸린 상위기관
    org_id: Mapped[int] = mapped_column(
        ForeignKey("organization.id", ondelete="CASCADE"), nullable=False, index=True
    )
    #: 쓴 사람. 계정이 지워져도 글은 남는다 — 공유된 내용이기 때문이다.
    author_id: Mapped[int | None] = mapped_column(
        ForeignKey("app_user.id", ondelete="SET NULL"), index=True
    )
    title: Mapped[str] = mapped_column(String(500), nullable=False)
    content: Mapped[str | None] = mapped_column(Text)
    #: 게시 결과 — '대기중' | '게시' | '게시보류'. 작성자는 손대지 못하고
    #: 커뮤니티 소유 기관의 관리자가 정한다. 글은 늘 대기중으로 시작한다.
    publish_status: Mapped[str] = mapped_column(String(10), default="대기중", nullable=False)

    organization: Mapped[Organization] = relationship()
    author: Mapped[User | None] = relationship()
    #: 첨부의 연결 행. 스키마의 ``attachments`` 는 자산 목록이라 이름을 가른다.
    attachment_links: Mapped[list[CommunityPostAsset]] = relationship(
        back_populates="post",
        cascade="all, delete-orphan",
        order_by="CommunityPostAsset.sort_order",
        lazy="selectin",
    )


class CommunityPostAsset(Base):
    """글에 붙인 이미지·동영상. 올린 차례가 곧 보여 줄 차례다."""

    __tablename__ = "community_post_asset"
    __table_args__ = (UniqueConstraint("post_id", "asset_id", name="uq_community_post_asset"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    post_id: Mapped[int] = mapped_column(
        ForeignKey("community_post.id", ondelete="CASCADE"), nullable=False, index=True
    )
    asset_id: Mapped[int] = mapped_column(
        ForeignKey("asset.id", ondelete="CASCADE"), nullable=False, index=True
    )
    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    post: Mapped[CommunityPost] = relationship(back_populates="attachment_links")
    asset: Mapped[Asset] = relationship()
