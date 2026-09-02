from __future__ import annotations

from typing import TYPE_CHECKING, Any

from sqlalchemy import ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.types import JSON

from app.db.base import Base, TimestampMixin

if TYPE_CHECKING:
    from app.models.asset import PlaylistAsset
    from app.models.content import Content
    from app.models.organization import Organization
    from app.models.user import User


class Playlist(Base, TimestampMixin):
    """위젯 재생목록.

    위젯 여러 개를 순서와 표출 시간만 정해 묶어 둔 것이다. 콘텐츠 편집기에서
    한 요소로 놓으면 그 자리에서 위젯들이 차례로 바뀐다 — 공지·급식·시간표를
    한 자리에서 돌려 보여 주는 흔한 배치를 매번 손으로 만들지 않아도 된다.

    콘텐츠와의 관계는 콘텐츠 라이브러리와 같은 모양이다. 콘텐츠는 재생목록을
    **참조**하고, 재생목록을 고치면 그것을 쓰는 콘텐츠와 스케줄의 버전이
    올라가 장치가 변경을 받아 간다(``api/v1/playlists.py``).
    """

    __tablename__ = "playlist"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False, index=True)
    description: Mapped[str | None] = mapped_column(String(500))
    org_id: Mapped[int] = mapped_column(
        ForeignKey("organization.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    created_by: Mapped[int | None] = mapped_column(
        ForeignKey("app_user.id", ondelete="SET NULL"), index=True
    )
    version: Mapped[int] = mapped_column(Integer, default=1, nullable=False)

    organization: Mapped[Organization] = relationship()
    creator: Mapped[User | None] = relationship()
    items: Mapped[list[PlaylistItem]] = relationship(
        back_populates="playlist",
        cascade="all, delete-orphan",
        order_by="PlaylistItem.sort_order",
        lazy="selectin",
    )
    content_links: Mapped[list[ContentPlaylist]] = relationship(
        back_populates="playlist", cascade="all, delete-orphan"
    )
    #: 칸의 옵션이 가리키는 자산(이미지앨범의 사진들). 쓰이는 파일을 지우지
    #: 못하게 막는 색인이다 — ``services/assets.sync_playlist_links``.
    asset_links: Mapped[list[PlaylistAsset]] = relationship(
        back_populates="playlist", cascade="all, delete-orphan", lazy="selectin"
    )


class PlaylistItem(Base):
    """재생목록의 한 칸. 위젯 하나와 표출 시간.

    위젯은 DB 에 저장되지 않고 서버가 동적으로 제공하므로(요구사항), 여기서는
    ``widget_key`` 문자열만 들고 있는다. 없는 키가 남아도 표출만 건너뛰면 되고,
    위젯이 늘어날 때 이 테이블을 고칠 필요가 없다.
    """

    __tablename__ = "playlist_item"

    id: Mapped[int] = mapped_column(primary_key=True)
    playlist_id: Mapped[int] = mapped_column(
        ForeignKey("playlist.id", ondelete="CASCADE"), nullable=False, index=True
    )
    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    widget_key: Mapped[str] = mapped_column(String(50), nullable=False)
    #: 이 칸을 표출할 시간(초)
    duration_sec: Mapped[int] = mapped_column(Integer, default=10, nullable=False)
    #: 위젯별 설정값. 콘텐츠 요소의 ``options`` 와 같은 모양이다.
    options: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict, nullable=False)
    #: **앞 칸에서 이 칸으로** 넘어올 때의 전환 효과(``services/transitions``).
    #: options 에 섞지 않은 이유는, 이것이 위젯 설정이 아니라 재생 정보이기
    #: 때문이다. options 는 위젯 렌더러에 그대로 넘어간다.
    transition: Mapped[str] = mapped_column(String(20), default="none", nullable=False)
    #: 전환에 걸리는 시간(밀리초). 칸마다 다르게 줄 수 있다 — 사진은 느긋하게,
    #: 공지는 빠르게 넘기는 식으로 내용에 따라 호흡이 달라진다.
    transition_ms: Mapped[int] = mapped_column(Integer, default=600, nullable=False)

    playlist: Mapped[Playlist] = relationship(back_populates="items")


class ContentPlaylist(Base):
    """콘텐츠가 어떤 재생목록을 쓰는지.

    콘텐츠 문서(JSON) 안을 매번 뒤지지 않고 '이 재생목록을 쓰는 콘텐츠' 를
    찾기 위한 색인이다. 콘텐츠를 저장할 때 문서를 훑어 여기에 기록한다.

    이 표가 없으면 재생목록을 고쳤을 때 어느 스케줄의 버전을 올려야 하는지
    알 수 없고, 장치는 바뀐 재생목록을 영영 받지 못한다.
    """

    __tablename__ = "content_playlist"
    __table_args__ = (
        UniqueConstraint("content_id", "playlist_id", name="uq_content_playlist"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    content_id: Mapped[int] = mapped_column(
        ForeignKey("content.id", ondelete="CASCADE"), nullable=False, index=True
    )
    playlist_id: Mapped[int] = mapped_column(
        ForeignKey("playlist.id", ondelete="CASCADE"), nullable=False, index=True
    )

    content: Mapped[Content] = relationship(back_populates="playlist_links")
    playlist: Mapped[Playlist] = relationship(back_populates="content_links")
