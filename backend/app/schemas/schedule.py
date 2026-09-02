from __future__ import annotations

from datetime import datetime, time
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.models.enums import PanelType, ScheduleKind


class ScheduleItemBase(BaseModel):
    #: 0(월)~6(일), 목록반복 스케줄이면 -1
    day_of_week: int = Field(default=-1, ge=-1, le=6)
    start_time: time | None = None
    end_time: time | None = None
    sort_order: int = 0
    duration_sec: int = Field(default=10, ge=1, le=86400)
    #: 콘텐츠 라이브러리 참조. 지정하면 표출 시 ``content`` 대신 이쪽이 쓰인다.
    content_id: int | None = None
    #: 인라인 콘텐츠. ``content_id`` 가 없을 때 사용한다.
    content: dict[str, Any] = Field(default_factory=dict)

    @model_validator(mode="after")
    def _check_time_range(self) -> ScheduleItemBase:
        if self.start_time and self.end_time and self.start_time >= self.end_time:
            raise ValueError("종료시간은 시작시간보다 뒤여야 합니다.")
        return self


class ScheduleItemCreate(ScheduleItemBase):
    pass


class ScheduleItemOut(ScheduleItemBase):
    """CMS 응답용.

    ``content`` 는 저장된 값 그대로다(참조 방식이면 비어 있을 수 있다).
    플레이어에게 나가는 ``SchedulePayload`` 에서는 참조가 해소되어 채워진다.
    """

    model_config = ConfigDict(from_attributes=True)

    id: int
    schedule_id: int
    #: 주간 편집기에서 블록에 표시할 콘텐츠 이름
    content_name: str | None = None


class ScheduleBase(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    kind: ScheduleKind = ScheduleKind.TIME_BASED
    #: 가로형/세로형. 붙일 수 있는 콘텐츠의 방향을 이 값이 정한다.
    orientation: PanelType = PanelType.LANDSCAPE
    #: 사용 기간. NULL 은 '제한 없음'. 기간 밖이면 배정돼 있어도 나가지 않는다.
    #: 요일·시각은 '하루 중 언제'이고 이 값은 '어느 날부터 어느 날까지'다.
    start_at: datetime | None = None
    end_at: datetime | None = None

    @model_validator(mode="after")
    def _check_period(self) -> ScheduleBase:
        if self.start_at and self.end_at and self.start_at >= self.end_at:
            raise ValueError("종료일시는 시작일시보다 뒤여야 합니다.")
        return self


class ScheduleCreate(ScheduleBase):
    org_id: int | None = None
    items: list[ScheduleItemCreate] = Field(default_factory=list)


class ScheduleUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    kind: ScheduleKind | None = None
    #: 방향을 바꾸면 이미 붙어 있는 콘텐츠도 새 방향과 맞아야 한다.
    #: 맞지 않으면 저장을 거부한다(``api/v1/schedules.py``).
    orientation: PanelType | None = None
    #: 사용 기간. 지우려면 명시적으로 null 을 보낸다.
    start_at: datetime | None = None
    end_at: datetime | None = None
    #: None 이면 아이템을 건드리지 않는다. 리스트를 주면 전체 교체한다.
    items: list[ScheduleItemCreate] | None = None


class ScheduleOut(ScheduleBase):
    model_config = ConfigDict(from_attributes=True)

    id: int
    org_id: int
    created_by: int | None
    version: int
    created_at: datetime
    updated_at: datetime
    device_count: int = 0


class ScheduleDetail(ScheduleOut):
    items: list[ScheduleItemOut] = Field(default_factory=list)


class SchedulePayload(BaseModel):
    """플레이어에게 내려가는 스케줄 페이로드.

    장치는 이 응답의 ``version`` 을 저장해 두었다가 하트비트 응답의 버전과
    비교한다. 데모 모드(스케줄 미배정)에서는 ``is_demo`` 가 True 다.
    """

    schedule_id: int | None
    name: str
    kind: str
    version: int
    is_demo: bool = False
    server_time: datetime
    items: list[ScheduleItemOut] = Field(default_factory=list)
