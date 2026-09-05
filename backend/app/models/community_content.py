"""커뮤니티 콘텐츠 — 커뮤니티에서 만드는 캔버스 문서.

CMS 콘텐츠와 같은 문서 형식(``ContentDocument``)을 쓴다. 편집기도 같은
캔버스다 — 다른 점은 재료뿐이다: 기본 요소(글자·이미지·동영상·웹)와
공유 이미지·동영상, 라이브러리, 외부 링크만 쓰고, **위젯과 재생목록은
넣지 못한다**(``api/v1/community._validate_document``). 그 둘은 기관
데이터를 끌어오는 통로라, 커뮤니티 울타리 안에서 열리면 안 된다.

커뮤니티 위젯이 이 문서를 그대로 표출한다(사용기간 포함).
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from sqlalchemy import ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.types import JSON

from app.db.base import Base, TimestampMixin

if TYPE_CHECKING:
    from app.models.organization import Organization
    from app.models.user import User


class CommunityContent(Base, TimestampMixin):
    __tablename__ = "community_content"

    id: Mapped[int] = mapped_column(primary_key=True)
    org_id: Mapped[int] = mapped_column(
        ForeignKey("organization.id", ondelete="CASCADE"), nullable=False, index=True
    )
    author_id: Mapped[int | None] = mapped_column(
        ForeignKey("app_user.id", ondelete="SET NULL"), index=True
    )
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    #: 캔버스 문서(ContentDocument). CMS 콘텐츠와 같은 계약이라 플레이어가
    #: 새 렌더러 없이 그대로 그린다.
    document: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict, nullable=False)
    #: 사용기간(YYYY-MM-DD). 비우면 늘 표출한다. 위젯이 아니라 콘텐츠가
    #: 들고 있는 이유는, 같은 콘텐츠를 트는 화면이 몇 개든 기간은 하나이기
    #: 때문이다 — 위젯마다 적으면 하나만 고치고 나머지를 잊는다.
    start_date: Mapped[str | None] = mapped_column(String(10))
    end_date: Mapped[str | None] = mapped_column(String(10))
    #: 사용대상: 전체 | 초 | 중 | 고. 위젯이 장치의 학교급에 맞는 콘텐츠를
    #: 고르는 근거다 — 초등학교 장치에는 '초' 와 '전체' 만 나간다.
    audience: Mapped[str] = mapped_column(String(10), default="전체", nullable=False)
    #: 위젯이 변경을 감지하는 근거. 고칠 때마다 올라간다.
    version: Mapped[int] = mapped_column(Integer, default=1, nullable=False)

    organization: Mapped[Organization] = relationship()
    author: Mapped[User | None] = relationship()
    #: 문서가 쓰는 자산 색인. 쓰이는 파일을 지우지 못하게 막는다
    #: (``services/assets.sync_community_links``).
    asset_links: Mapped[list[CommunityContentAsset]] = relationship(
        back_populates="content", cascade="all, delete-orphan", lazy="selectin"
    )


class CommunityContentAsset(Base):
    """커뮤니티 콘텐츠가 어떤 자산을 쓰는지. ``ContentAsset`` 과 같은 색인."""

    __tablename__ = "community_content_asset"
    __table_args__ = (
        UniqueConstraint("content_id", "asset_id", name="uq_community_content_asset"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    content_id: Mapped[int] = mapped_column(
        ForeignKey("community_content.id", ondelete="CASCADE"), nullable=False, index=True
    )
    asset_id: Mapped[int] = mapped_column(
        ForeignKey("asset.id", ondelete="CASCADE"), nullable=False, index=True
    )

    content: Mapped[CommunityContent] = relationship(back_populates="asset_links")
