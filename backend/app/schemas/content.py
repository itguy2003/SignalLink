"""콘텐츠 문서 스키마.

이것이 **콘텐츠 편집기 ↔ 서버 ↔ 모든 플레이어(JS/.NET/Flutter)가 공유하는 계약**이다.
``ScheduleItem.content`` 에 이 형태의 JSON 이 그대로 저장된다.

호환성 규칙
    - 필드 추가는 자유롭게 하되(플레이어는 모르는 필드를 무시한다),
      기존 필드의 의미를 바꾸거나 제거할 때는 ``version`` 을 올리고
      모든 플레이어를 함께 갱신해야 한다.
    - 예외: ``element.visible`` 은 **표출 여부를 결정**하므로 무시하면 안 된다.
      False 인 요소를 그리면 편집자가 숨긴 것이 장치에 나온다.
      ``element.locked`` 는 편집기 전용이라 플레이어가 무시해도 된다.
    - 좌표계는 ``layout.width``/``layout.height`` 를 기준으로 한 절대 픽셀이며,
      플레이어는 장치 해상도에 맞춰 균일 스케일링한다.
"""

from __future__ import annotations

from datetime import datetime
from enum import StrEnum
from typing import Any

from pydantic import BaseModel, ConfigDict, Field

CONTENT_SCHEMA_VERSION = 1


class ElementType(StrEnum):
    WIDGET = "widget"
    IMAGE = "image"
    VIDEO = "video"
    TEXT = "text"
    SHAPE = "shape"
    WEB = "web"
    #: 위젯 재생목록. ``options.playlist_id`` 로 재생목록을 가리키고, 서버가
    #: 플레이어에게 내려줄 때 ``options.items`` 에 실제 칸 목록을 채워 준다
    #: (``services/playlists.inline_into_document``). 편집기가 저장하는
    #: 문서에는 참조만 남으므로, 재생목록을 고치면 다음 표출에 반영된다.
    PLAYLIST = "playlist"


class Rect(BaseModel):
    x: float = 0
    y: float = 0
    w: float = 100
    h: float = 100
    z: int = 0
    rotation: float = 0


class ContentElement(BaseModel):
    """편집기가 배치한 하나의 요소.

    ``extra="allow"`` 로 둔 이유: 편집기가 새 요소 속성을 추가해도 서버가
    저장을 거부하지 않도록 하기 위함이다. 플레이어는 모르는 속성을 무시한다.
    """

    model_config = ConfigDict(extra="allow")

    id: str
    type: ElementType
    rect: Rect = Field(default_factory=Rect)
    opacity: float = Field(default=1.0, ge=0, le=1)
    #: False 면 표출하지 않는다. **플레이어가 반드시 지켜야 하는 값**이다.
    #: 편집기의 레이어 목록에서 눈 아이콘으로 끄고 켠다.
    visible: bool = True
    #: 편집기에서 실수로 옮기지 못하게 잠근 상태. 표출에는 영향이 없으므로
    #: 플레이어는 무시한다.
    locked: bool = False
    #: type=widget 일 때 위젯 식별자(``services/widgets`` 의 key)
    widget_key: str | None = None
    #: 위젯/요소별 설정값
    options: dict[str, Any] = Field(default_factory=dict)
    #: image/video/web 의 소스 URL
    src: str | None = None


class ContentLayout(BaseModel):
    width: int = 1920
    height: int = 1080
    background: str = "#000000"


class ContentDocument(BaseModel):
    model_config = ConfigDict(extra="allow")

    version: int = CONTENT_SCHEMA_VERSION
    layout: ContentLayout = Field(default_factory=ContentLayout)
    elements: list[ContentElement] = Field(default_factory=list)


def empty_document(width: int = 1920, height: int = 1080) -> dict[str, Any]:
    return ContentDocument(layout=ContentLayout(width=width, height=height)).model_dump(
        mode="json"
    )


# --------------------------------------------------------------------------
# 콘텐츠 라이브러리 (재사용 가능한 콘텐츠)
# --------------------------------------------------------------------------


class ContentBase(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=500)
    width: int = Field(default=1920, ge=1, le=32767)
    height: int = Field(default=1080, ge=1, le=32767)


class ContentCreate(ContentBase):
    org_id: int | None = None
    #: 비우면 빈 문서로 시작한다.
    document: dict[str, Any] | None = None


class ContentUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=500)
    width: int | None = Field(default=None, ge=1, le=32767)
    height: int | None = Field(default=None, ge=1, le=32767)
    document: dict[str, Any] | None = None


class ContentSummary(ContentBase):
    """목록/브라우저용. 문서 본문은 빼고 요약 정보만 담는다."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    org_id: int
    created_by: int | None
    version: int
    created_at: datetime
    updated_at: datetime
    org_name: str | None = None
    #: 이 콘텐츠를 쓰는 스케줄 아이템 수. 삭제 가능 여부 판단에 쓴다.
    usage_count: int = 0
    #: 브라우저에서 미리보기 카드를 그리기 위한 최소 정보
    element_count: int = 0
    background: str = "#000000"


class ContentOut(ContentSummary):
    document: dict[str, Any] = Field(default_factory=dict)
