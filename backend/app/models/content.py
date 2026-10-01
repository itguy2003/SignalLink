from __future__ import annotations

from typing import TYPE_CHECKING, Any

from sqlalchemy import ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.types import JSON

from app.db.base import Base, TimestampMixin

if TYPE_CHECKING:
    from app.models.asset import ContentAsset
    from app.models.organization import Organization
    from app.models.playlist import ContentPlaylist
    from app.models.user import User


class Content(Base, TimestampMixin):
    """재사용 가능한 콘텐츠.

    콘텐츠 편집기가 만든 문서(``document``)를 이름 붙여 보관한다. 스케줄
    아이템은 ``ScheduleItem.content_id`` 로 이것을 참조하며, 하나의 콘텐츠를
    여러 시간대·여러 스케줄에서 재사용할 수 있다.

    **플레이어 계약은 바뀌지 않는다.** 서버가 페이로드를 만들 때 참조된
    ``document`` 를 ``ScheduleItem.content`` 자리에 인라인해서 내려주므로,
    플레이어는 콘텐츠 라이브러리의 존재를 알 필요가 없다
    (``services/schedule_service.resolve_item_content``).

    콘텐츠를 수정하면 이를 참조하는 **모든 스케줄의 버전을 올려야** 장치가
    변경을 감지한다(``api/v1/contents.py`` 의 ``_bump_referencing_schedules``).
    """

    __tablename__ = "content"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False, index=True)
    description: Mapped[str | None] = mapped_column(String(500))
    org_id: Mapped[int] = mapped_column(
        ForeignKey("organization.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    created_by: Mapped[int | None] = mapped_column(
        ForeignKey("app_user.id", ondelete="SET NULL"), index=True
    )
    #: 편집 기준 해상도. 플레이어는 장치 해상도에 맞춰 균일 스케일링한다.
    width: Mapped[int] = mapped_column(Integer, default=1920, nullable=False)
    height: Mapped[int] = mapped_column(Integer, default=1080, nullable=False)
    #: ContentDocument 형식의 JSON
    document: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict, nullable=False)
    #: 공유 구분: '없음' | '동일기관' | '소속기관'(같은 상위기관 아래 기관들) | '전체'.
    #: 관리 범위 밖의 사용자에게 콘텐츠를 열어 주는 유일한 통로다
    #: (``services/permissions.content_shared_with``). 열 추가는 EF 마이그레이션
    #: (backend-dotnet, 20260910160659_ContentShareScope)이 했고 이 정의는 거울이다.
    share_scope: Mapped[str] = mapped_column(
        String(10), default="없음", server_default="없음", nullable=False
    )
    version: Mapped[int] = mapped_column(Integer, default=1, nullable=False)

    organization: Mapped[Organization] = relationship()
    creator: Mapped[User | None] = relationship()
    #: 이 콘텐츠가 쓰는 재생목록. 문서(JSON) 를 매번 뒤지지 않기 위한 색인이며,
    #: 저장할 때 문서를 훑어 갱신한다(``api/v1/contents.py``).
    playlist_links: Mapped[list[ContentPlaylist]] = relationship(
        back_populates="content", cascade="all, delete-orphan", lazy="selectin"
    )
    #: 이 콘텐츠가 쓰는 업로드 파일. 같은 이유로 두는 색인이며, 쓰이는 파일을
    #: 지우지 못하게 막는 데 쓴다.
    asset_links: Mapped[list[ContentAsset]] = relationship(
        back_populates="content", cascade="all, delete-orphan", lazy="selectin"
    )

    @property
    def is_portrait(self) -> bool:
        return self.height > self.width
