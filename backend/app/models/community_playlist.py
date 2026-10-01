"""커뮤니티 게시물 — 게시를 원하는 것을 재생목록 형태로 등록.

개편(2026-10): COMMUNITY_USER 역할을 걷어내고 커뮤니티를 모든 승인 사용자의
공간으로 바꿨다. 메타데이터는 제목·공지대상(기관구분)·공지희망기간·연락처·
메모. 게시 결과는 커뮤니티 소유 기관의 관리자가 정하고, '게시' 상태만 위젯이
표출하며 로그인 팝업도 '게시' + 대상·기간이 맞는 글만 알린다.

파일은 재생목록에 직접 올린다(community_playlist_asset 색인) — 칸(items)은
그 파일들만 가리킬 수 있다. 칸의 재생 규약(duration_sec / transition /
transition_ms)은 CMS 재생목록과 같다. 전체 재생시간은 저장하지 않고
응답에서 칸 시간의 합으로 계산한다.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from sqlalchemy import Boolean, ForeignKey, Index, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.types import JSON

from app.db.base import Base, TimestampMixin

if TYPE_CHECKING:
    from app.models.asset import Asset
    from app.models.organization import Organization
    from app.models.user import User


class CommunityPlaylist(Base, TimestampMixin):
    __tablename__ = "community_playlist"

    id: Mapped[int] = mapped_column(primary_key=True)
    org_id: Mapped[int] = mapped_column(
        ForeignKey("organization.id", ondelete="CASCADE"), nullable=False, index=True
    )
    author_id: Mapped[int | None] = mapped_column(
        ForeignKey("app_user.id", ondelete="SET NULL"), index=True
    )
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    #: 간단한 메모 — 게시 요청에 덧붙이는 짧은 글.
    memo: Mapped[str | None] = mapped_column(String(500))
    #: 공지대상 — 기관구분 이름들의 JSON 배열. 빈 배열은 '전체 대상'.
    target_org_types: Mapped[list[str]] = mapped_column(JSON, default=list, nullable=False)
    #: 공지희망기간 — "YYYY-MM-DD". 비우면 기간 제한 없음. 문자열로 두는
    #: 이유: 두 백엔드(JSON 날짜 직렬화)와 두 DB 방언에서 모양이 같다.
    notice_start: Mapped[str | None] = mapped_column(String(10))
    notice_end: Mapped[str | None] = mapped_column(String(10))
    #: 게시자가 적는 표시 이름 — 비우면 계정 이름을 쓴다.
    author_name: Mapped[str | None] = mapped_column(String(100))
    #: 연락처 — 전화·이메일 등 자유 형식. 계정 정보와 별개로 글에 싣는다.
    contact: Mapped[str | None] = mapped_column(String(200))
    #: '대기중' | '게시' | '게시보류' — 커뮤니티 소유 기관 관리자가 정한다.
    publish_status: Mapped[str] = mapped_column(String(10), default="대기중", nullable=False)
    #: [{document, duration_sec}] — 소속기관 공지와 같은 칸 모양(콘텐츠 문서 인라인).
    items: Mapped[list[dict[str, Any]]] = mapped_column(JSON, default=list, nullable=False)
    #: 트는 쪽이 변경을 감지하는 근거. 고칠 때마다 올라간다.
    version: Mapped[int] = mapped_column(Integer, default=1, nullable=False)

    organization: Mapped[Organization] = relationship()
    author: Mapped[User | None] = relationship()
    asset_links: Mapped[list[CommunityPlaylistAsset]] = relationship(
        back_populates="playlist", cascade="all, delete-orphan"
    )


class CommunityPlaylistAsset(Base):
    """재생목록에 올린 파일의 색인 — 항목 검증과 사용처 집계의 근거."""

    __tablename__ = "community_playlist_asset"

    id: Mapped[int] = mapped_column(primary_key=True)
    playlist_id: Mapped[int] = mapped_column(
        ForeignKey("community_playlist.id", ondelete="CASCADE"), nullable=False, index=True
    )
    asset_id: Mapped[int] = mapped_column(
        ForeignKey("asset.id", ondelete="CASCADE"), nullable=False, index=True
    )

    playlist: Mapped[CommunityPlaylist] = relationship(back_populates="asset_links")
    asset: Mapped[Asset] = relationship()

    __table_args__ = (
        Index("uq_community_playlist_asset", "playlist_id", "asset_id", unique=True),
    )


class CommunitySetting(Base):
    """커뮤니티(소유 기관)별 설정 — 게시 정책.

    ``auto_publish`` 가 켜지면 등록 즉시 '게시', 꺼져 있으면(기본) 관리자
    승인 후 게시('대기중'으로 시작)다.
    """

    __tablename__ = "community_setting"

    id: Mapped[int] = mapped_column(primary_key=True)
    org_id: Mapped[int] = mapped_column(
        ForeignKey("organization.id", ondelete="CASCADE"), nullable=False
    )
    auto_publish: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    __table_args__ = (Index("uq_community_setting_org_id", "org_id", unique=True),)
