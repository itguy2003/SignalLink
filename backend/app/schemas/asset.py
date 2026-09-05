"""업로드 자산 스키마."""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

AssetKind = Literal["image", "video"]


class AssetOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    org_id: int
    uploaded_by: int | None
    kind: AssetKind
    filename: str
    content_type: str
    size_bytes: int
    created_at: datetime

    #: 문서의 ``src`` 에 그대로 넣는 주소. 서버가 정하므로 클라이언트가
    #: 경로 규칙을 알 필요가 없다.
    url: str = ""
    #: 목록용 축소 이미지 주소. 없으면 화면이 원본(url)으로 그린다.
    thumb_url: str | None = None
    org_name: str | None = None
    #: 이 자산을 쓰는 콘텐츠 수. 삭제 가능 여부 판단에 쓴다.
    usage_count: int = 0


class AssetUpdate(BaseModel):
    """이름만 고친다. 파일 자체를 바꾸려면 새로 올린다 —
    같은 자산의 내용이 조용히 바뀌면 그것을 쓰는 콘텐츠가 함께 바뀐다."""

    filename: str = Field(min_length=1, max_length=255)
