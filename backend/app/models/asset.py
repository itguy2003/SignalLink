from __future__ import annotations

from pathlib import Path
from typing import TYPE_CHECKING

from sqlalchemy import BigInteger, ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, TimestampMixin

if TYPE_CHECKING:
    from app.models.board import BoardPost
    from app.models.content import Content
    from app.models.organization import Organization
    from app.models.playlist import Playlist
    from app.models.user import User


class Asset(Base, TimestampMixin):
    """콘텐츠에 쓰는 이미지·동영상 파일.

    콘텐츠 편집기는 그림과 영상을 세 가지 방법으로 받는다 — 바깥 주소(링크),
    **여기 올린 파일**, 그리고 앞으로 붙일 AI 생성물. 링크만으로는 학교처럼
    바깥으로 못 나가는 망에서 아무것도 표출되지 않고, 원본이 사라지면 화면이
    깨진다. 그래서 올려 둔 파일은 장치가 이미 말을 트고 있는 이 서버에서
    그대로 내려받는다.

    **바이너리는 DB 가 아니라 파일 시스템에 둔다**(``services/assets``).
    장치 캡처(DeviceScreenshot)는 작고 한 장뿐이라 DB 에 넣었지만, 영상은
    수백 MB 가 될 수 있어 같은 방식을 쓸 수 없다 — 한 번 읽을 때마다 그만큼
    메모리에 올라온다. 여기서는 경로만 들고 응답은 스트리밍한다.
    """

    __tablename__ = "asset"

    id: Mapped[int] = mapped_column(primary_key=True)
    org_id: Mapped[int] = mapped_column(
        ForeignKey("organization.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    uploaded_by: Mapped[int | None] = mapped_column(
        ForeignKey("app_user.id", ondelete="SET NULL"), index=True
    )

    #: 'image' | 'video'. 편집기가 어떤 요소에 넣을 수 있는지 가른다.
    kind: Mapped[str] = mapped_column(String(10), nullable=False, index=True)
    #: 올린 사람이 알아보는 이름. 파일 시스템의 이름과는 다르다.
    filename: Mapped[str] = mapped_column(String(255), nullable=False)
    content_type: Mapped[str] = mapped_column(String(100), nullable=False)
    #: 32비트로는 4GB 를 넘길 수 없다. PostgreSQL 의 INTEGER 가 32비트다.
    size_bytes: Mapped[int] = mapped_column(BigInteger, nullable=False)

    #: MEDIA_ROOT 아래의 상대 경로. 절대 경로를 저장하면 서버를 옮길 때
    #: 모든 행을 고쳐야 한다.
    storage_path: Mapped[str] = mapped_column(String(300), nullable=False)

    @property
    def token(self) -> str:
        """주소에 넣는 열쇠. 저장 파일 이름(무작위 32자)을 그대로 쓴다.

        브라우저의 ``<img>`` 는 Authorization 헤더를 붙일 수 없다. 그래서 파일
        주소는 인증 없이 열려야 하는데, 그러면 id 가 1,2,3… 이라 남의 파일을
        훑어 갈 수 있다. 주소 자체를 알아맞힐 수 없게 만들어 그것을 막는다.

        주소를 아는 사람은 파일을 볼 수 있다 — 공개 링크와 같은 성질이다.
        학교 게시용 이미지·영상에는 흔히 쓰는 맞바꿈이며, 대신 목록·삭제·이름
        수정 같은 관리 동작은 그대로 로그인과 권한을 요구한다.
        """
        return Path(self.storage_path).stem

    organization: Mapped[Organization] = relationship()
    uploader: Mapped[User | None] = relationship()
    content_links: Mapped[list[ContentAsset]] = relationship(
        back_populates="asset", cascade="all, delete-orphan"
    )
    playlist_links: Mapped[list[PlaylistAsset]] = relationship(
        back_populates="asset", cascade="all, delete-orphan"
    )
    post_links: Mapped[list[BoardPostAsset]] = relationship(
        back_populates="asset", cascade="all, delete-orphan"
    )


class ContentAsset(Base):
    """콘텐츠가 어떤 자산을 쓰는지.

    콘텐츠 문서(JSON) 안을 매번 뒤지지 않고 '이 파일을 쓰는 콘텐츠' 를 찾기
    위한 색인이다. 재생목록 색인(``ContentPlaylist``)과 같은 방식이며, 쓰이는
    파일을 지우지 못하게 막는 데 쓴다 — 지우고 나서야 화면이 깨진 것을
    알게 되면 어느 콘텐츠였는지 되짚을 수 없다.
    """

    __tablename__ = "content_asset"
    __table_args__ = (UniqueConstraint("content_id", "asset_id", name="uq_content_asset"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    content_id: Mapped[int] = mapped_column(
        ForeignKey("content.id", ondelete="CASCADE"), nullable=False, index=True
    )
    asset_id: Mapped[int] = mapped_column(
        ForeignKey("asset.id", ondelete="CASCADE"), nullable=False, index=True
    )

    content: Mapped[Content] = relationship(back_populates="asset_links")
    asset: Mapped[Asset] = relationship(back_populates="content_links")


class PlaylistAsset(Base):
    """재생목록이 어떤 자산을 쓰는지.

    ``ContentAsset`` 과 같은 목적의 색인이다. 따로 두는 이유는 이미지앨범
    위젯 때문이다 — 앨범은 사진 주소를 칸의 ``options`` 안에 들고 있어서,
    콘텐츠 문서만 뒤져서는 그 사진을 아무도 안 쓰는 것으로 보게 된다.
    """

    __tablename__ = "playlist_asset"
    __table_args__ = (UniqueConstraint("playlist_id", "asset_id", name="uq_playlist_asset"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    playlist_id: Mapped[int] = mapped_column(
        ForeignKey("playlist.id", ondelete="CASCADE"), nullable=False, index=True
    )
    asset_id: Mapped[int] = mapped_column(
        ForeignKey("asset.id", ondelete="CASCADE"), nullable=False, index=True
    )

    playlist: Mapped[Playlist] = relationship(back_populates="asset_links")
    asset: Mapped[Asset] = relationship(back_populates="playlist_links")


class BoardPostAsset(Base):
    """게시글에 붙인 파일.

    ``ContentAsset`` / ``PlaylistAsset`` 과 같은 모양이다. 자산을 따로 두고
    이어 붙이는 이유는 파일을 다루는 길이 하나뿐이어야 하기 때문이다 —
    올리기·용량 제한·형식 검사·내려받기 주소가 모두 ``services/assets`` 한 곳에
    있고, 게시판은 그것을 가리키기만 한다.

    순서를 들고 있는 이유는 사진 여러 장을 붙였을 때 올린 차례대로 보여
    주기 위해서다.
    """

    __tablename__ = "board_post_asset"
    __table_args__ = (UniqueConstraint("post_id", "asset_id", name="uq_board_post_asset"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    post_id: Mapped[int] = mapped_column(
        ForeignKey("board_post.id", ondelete="CASCADE"), nullable=False, index=True
    )
    asset_id: Mapped[int] = mapped_column(
        ForeignKey("asset.id", ondelete="CASCADE"), nullable=False, index=True
    )
    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    post: Mapped[BoardPost] = relationship(back_populates="attachment_links")
    asset: Mapped[Asset] = relationship(back_populates="post_links")
