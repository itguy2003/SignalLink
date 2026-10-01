from __future__ import annotations

from datetime import datetime, time
from typing import TYPE_CHECKING, Any

from sqlalchemy import DateTime, ForeignKey, Integer, String, Time
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.types import JSON

from app.db.base import Base, TimestampMixin
from app.models.enums import PanelType, ScheduleKind

if TYPE_CHECKING:
    from app.models.content import Content
    from app.models.device import DeviceScheduleLink
    from app.models.user import User


class Schedule(Base, TimestampMixin):
    """스케쥴.

    ``version`` 은 스케줄 또는 그 아이템이 변경될 때마다 증가한다.
    장치는 하트비트에서 자신의 ``Device.version`` 과 이 값을 비교해
    다르면 스케줄을 재수신한다(``services/schedule_service.bump_version``).

    ``orientation`` 은 이 스케줄이 어떤 화면에 나갈지를 정한다. 아이템에
    붙는 콘텐츠는 **같은 방향이어야 한다** — 가로 콘텐츠를 세로 화면에
    태우면 위아래에 검은 띠만 남고 글자는 읽을 수 없게 작아진다. 검사는
    ``api/v1/schedules.py`` 가 저장 시점에 한다.
    """

    __tablename__ = "schedule"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    kind: Mapped[str] = mapped_column(
        String(20), default=ScheduleKind.TIME_BASED, nullable=False
    )
    #: 가로형(LANDSCAPE) / 세로형(PORTRAIT). ``Device.panel_type`` 과 같은 열거형이다.
    orientation: Mapped[str] = mapped_column(
        String(20), default=PanelType.LANDSCAPE, server_default=PanelType.LANDSCAPE, nullable=False
    )
    #: 이 스케줄을 실제로 쓰는 기간. NULL 은 '제한 없음'이다.
    #:
    #: 행사 기간에만 트는 안내처럼 시작·종료가 정해진 스케줄이 있다. 기간이
    #: 지나면 서버가 페이로드에서 빼므로, 장치에 남겨 두고도 안 나가게 된다.
    #: 요일·시각(ScheduleItem)은 '하루 중 언제'이고 이 값은 '어느 날부터
    #: 어느 날까지'다 — 두 층이 함께 적용된다.
    start_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    end_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    org_id: Mapped[int] = mapped_column(
        ForeignKey("organization.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    created_by: Mapped[int | None] = mapped_column(
        ForeignKey("app_user.id", ondelete="SET NULL"), index=True
    )
    version: Mapped[int] = mapped_column(Integer, default=1, nullable=False)

    creator: Mapped[User | None] = relationship()
    items: Mapped[list[ScheduleItem]] = relationship(
        back_populates="schedule",
        cascade="all, delete-orphan",
        order_by="ScheduleItem.sort_order",
        lazy="selectin",
    )
    device_links: Mapped[list[DeviceScheduleLink]] = relationship(
        back_populates="schedule", cascade="all, delete-orphan"
    )


class ScheduleItem(Base):
    """스케쥴아이템.

    ``content`` 는 콘텐츠 편집기 산출물을 그대로 담는 JSON 이며,
    편집기와 모든 플레이어(JS/.NET/Flutter)가 공유하는 계약이다.
    스키마는 ``schemas/content.py`` 의 ``ContentDocument`` 참조.

    ``day_of_week`` 는 시간지정 스케줄에서 0(월)~6(일), 목록반복이면 -1.
    """

    __tablename__ = "schedule_item"

    id: Mapped[int] = mapped_column(primary_key=True)
    schedule_id: Mapped[int] = mapped_column(
        ForeignKey("schedule.id", ondelete="CASCADE"), nullable=False, index=True
    )
    day_of_week: Mapped[int] = mapped_column(Integer, default=-1, nullable=False)
    start_time: Mapped[time | None] = mapped_column(Time)
    end_time: Mapped[time | None] = mapped_column(Time)
    #: 목록반복 스케줄에서의 재생 순서 / 시간지정에서는 동일 시간대 내 정렬 기준
    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    #: 목록반복에서 한 아이템을 표출할 시간(초)
    duration_sec: Mapped[int] = mapped_column(Integer, default=10, nullable=False)
    #: **앞 칸에서 이 칸으로** 넘어올 때의 전환 효과(``services/transitions``).
    #: 재생목록 칸(``PlaylistItem``)과 같은 규약이다.
    transition: Mapped[str] = mapped_column(
        String(20), default="none", server_default="none", nullable=False
    )
    transition_ms: Mapped[int] = mapped_column(
        Integer, default=600, server_default="600", nullable=False
    )
    #: 콘텐츠 라이브러리 참조. 설정되면 ``content`` 대신 이쪽 문서가 표출된다.
    #: 하나의 콘텐츠를 여러 시간대에서 재사용하기 위한 것이다.
    content_id: Mapped[int | None] = mapped_column(
        ForeignKey("content.id", ondelete="SET NULL"), index=True
    )
    #: 소속기관 공지 참조. 설정되면 표출 시 공지의 슬라이드 전체로 펼쳐진다.
    org_notice_id: Mapped[int | None] = mapped_column(
        ForeignKey("org_notice.id", ondelete="SET NULL"), index=True
    )
    #: 인라인 콘텐츠. ``content_id`` 가 없을 때 사용한다.
    content: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict, nullable=False)

    schedule: Mapped[Schedule] = relationship(back_populates="items")
    content_ref: Mapped[Content | None] = relationship(lazy="selectin")
    notice_ref = relationship("OrgNotice", lazy="selectin")

    @property
    def content_name(self) -> str | None:
        """편집 화면에서 블록에 표시할 이름. 공지 참조가 우선이다."""
        if self.notice_ref is not None:
            return self.notice_ref.name
        return self.content_ref.name if self.content_ref is not None else None

    @property
    def resolved_content(self) -> dict[str, Any]:
        """실제로 표출될 문서. 참조가 있으면 그 문서를, 없으면 인라인을 쓴다."""
        if self.content_ref is not None:
            return self.content_ref.document or {}
        return self.content or {}
