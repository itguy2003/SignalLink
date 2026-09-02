from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


class WidgetOptionSpec(BaseModel):
    """편집기가 위젯 설정 폼을 자동 생성하기 위한 필드 명세."""

    key: str
    label: str
    type: str = "text"  # text | number | select | boolean | color | image_list | transition
    default: Any = None
    choices: list[dict[str, Any]] = Field(default_factory=list)
    required: bool = False
    #: 숫자 옵션의 한계. 편집기가 입력칸에 걸고, 벗어난 값은 끌어다 맞춘다.
    #:
    #: 서버가 정하는 이유는 그 값의 뜻을 아는 쪽이 여기이기 때문이다 — 유지
    #: 시간 0 초는 한 틱에 목록을 다 돌아 화면이 깜빡이고, 음수는 아예 뜻이
    #: 없다. 편집기마다 제 나름의 방어를 하게 두면 어딘가는 빠진다.
    min: float | None = None
    max: float | None = None


class WidgetSpec(BaseModel):
    """위젯 명세.

    위젯은 DB 에 저장되지 않고 서버가 동적으로 제공한다(요구사항).
    편집기는 이 목록을 받아 팔레트를 구성하고, 플레이어는 ``key`` 로
    렌더러를 선택한다.
    """

    key: str
    name: str
    category: str  # 기능형 | 콘텐츠형
    description: str = ""
    #: 데이터 조회 API 가 필요한 위젯인지. True 면 플레이어가
    #: /api/v1/widgets/{key}/data 를 주기적으로 호출한다.
    data_driven: bool = False
    refresh_sec: int = 300
    default_size: dict[str, int] = Field(default_factory=lambda: {"w": 600, "h": 400})
    options: list[WidgetOptionSpec] = Field(default_factory=list)


class WidgetDataResponse(BaseModel):
    key: str
    fetched_at: str
    data: Any
