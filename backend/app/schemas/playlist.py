"""위젯 재생목록 스키마."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.services import transitions as fx
from app.services.transitions import DEFAULT_TRANSITION, TransitionKind


class PlaylistItemBase(BaseModel):
    #: ``services/widgets`` 의 위젯 key. DB 에 없는 값이어도 저장은 된다 —
    #: 위젯은 서버가 동적으로 제공하므로 목록이 늘고 줄 수 있다.
    widget_key: str = Field(min_length=1, max_length=50)
    duration_sec: int = Field(default=10, ge=1, le=86400)
    options: dict[str, Any] = Field(default_factory=dict)
    #: 앞 칸에서 이 칸으로 넘어올 때의 효과. 모르는 이름은 스키마가 거부한다 —
    #: 저장은 됐는데 장치마다 다르게 넘어가는 것보다 낫다.
    transition: TransitionKind = DEFAULT_TRANSITION
    transition_ms: int = Field(
        default=fx.DEFAULT_TRANSITION_MS,
        ge=fx.MIN_TRANSITION_MS,
        le=fx.MAX_TRANSITION_MS,
    )

    @model_validator(mode="after")
    def _check_transition_fits(self) -> PlaylistItemBase:
        # 3초 머무는 칸에 5초짜리 전환을 걸면 효과가 끝나기 전에 넘어가,
        # 화면이 영영 제자리에 놓이지 않는다.
        if not fx.fits_in(self.transition, self.transition_ms, self.duration_sec):
            raise ValueError("전환 시간은 표출 시간보다 길 수 없습니다.")
        return self


class PlaylistItemOut(PlaylistItemBase):
    model_config = ConfigDict(from_attributes=True)

    id: int
    sort_order: int


class PlaylistBase(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=500)


class PlaylistCreate(PlaylistBase):
    org_id: int | None = None
    #: 순서가 곧 재생 순서다.
    items: list[PlaylistItemBase] = Field(default_factory=list)


class PlaylistUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=500)
    #: None 이면 칸을 건드리지 않는다. 리스트를 주면 전체 교체한다.
    items: list[PlaylistItemBase] | None = None


class PlaylistOut(PlaylistBase):
    model_config = ConfigDict(from_attributes=True)

    id: int
    org_id: int
    created_by: int | None
    version: int
    created_at: datetime
    updated_at: datetime
    items: list[PlaylistItemOut] = Field(default_factory=list)
    org_name: str | None = None
    #: 이 재생목록을 쓰는 콘텐츠 수. 삭제 가능 여부 판단에 쓴다.
    usage_count: int = 0
    #: 전체 재생에 걸리는 시간(초). 목록에서 한눈에 보기 위한 값이다.
    total_duration_sec: int = 0
