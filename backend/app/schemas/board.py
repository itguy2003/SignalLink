from __future__ import annotations

from datetime import date, datetime

from pydantic import BaseModel, ConfigDict, Field

from app.models.enums import BoardKind


class OrgBoardBase(BaseModel):
    #: 운영자가 알아보는 이름표. 표시용이다.
    name: str = Field(default="", max_length=200)
    kind: BoardKind = BoardKind.BOARD
    url: str = Field(min_length=1, max_length=1000)
    scrape_method: str | None = Field(default=None, max_length=50)


class OrgBoardCreate(OrgBoardBase):
    org_id: int


class OrgBoardUpdate(BaseModel):
    name: str | None = Field(default=None, max_length=200)
    kind: BoardKind | None = None
    url: str | None = Field(default=None, min_length=1, max_length=1000)
    scrape_method: str | None = Field(default=None, max_length=50)


class OrgBoardOut(OrgBoardBase):
    model_config = ConfigDict(from_attributes=True)

    id: int
    org_id: int
    scrape_result: str | None
    scrape_count: int
    last_scraped_at: datetime | None


class BoardPostOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    board_id: int
    title: str
    author: str | None
    posted_on: date | None
    year: int | None
    month: int | None
    day: int | None
    term: int | None
    content: str | None


class BoardPostCreate(BaseModel):
    title: str = Field(min_length=1, max_length=500)
    author: str | None = Field(default=None, max_length=100)
    posted_on: date | None = None
    term: int | None = Field(default=None, ge=1, le=4)
    content: str | None = None
