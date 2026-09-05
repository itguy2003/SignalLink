from __future__ import annotations

from datetime import date, datetime
from typing import TYPE_CHECKING

from sqlalchemy import Date, DateTime, ForeignKey, Index, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, TimestampMixin
from app.models.enums import BoardKind

if TYPE_CHECKING:
    from app.models.organization import Organization


class OrgBoard(Base, TimestampMixin):
    """기관게시판. 위젯이 표출할 외부 데이터의 수집원 정의."""

    __tablename__ = "org_board"

    id: Mapped[int] = mapped_column(primary_key=True)
    org_id: Mapped[int] = mapped_column(
        ForeignKey("organization.id", ondelete="CASCADE"), nullable=False, index=True
    )
    kind: Mapped[str] = mapped_column(String(20), default=BoardKind.BOARD, nullable=False)
    url: Mapped[str] = mapped_column(String(1000), nullable=False)
    #: 스크래핑방법 (예: "html:table", "rss", "neis-api" 등 수집기 식별자)
    scrape_method: Mapped[str | None] = mapped_column(String(50))
    scrape_result: Mapped[str | None] = mapped_column(String(10))
    scrape_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    last_scraped_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    organization: Mapped[Organization] = relationship(back_populates="boards")
    posts: Mapped[list[BoardPost]] = relationship(
        back_populates="board", cascade="all, delete-orphan"
    )


class BoardPost(Base):
    """게시판정보. 수집 결과 레코드.

    년/월/일/학기를 분해해 저장하는 이유는 위젯이 기간 조건으로 빠르게
    필터링하기 위함이다(학사일정/급식 위젯).
    """

    __tablename__ = "board_post"
    __table_args__ = (Index("ix_board_post_period", "board_id", "year", "month", "day"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    board_id: Mapped[int] = mapped_column(
        ForeignKey("org_board.id", ondelete="CASCADE"), nullable=False, index=True
    )
    title: Mapped[str] = mapped_column(String(500), nullable=False)
    author: Mapped[str | None] = mapped_column(String(100))
    posted_on: Mapped[date | None] = mapped_column(Date)
    year: Mapped[int | None] = mapped_column(Integer)
    month: Mapped[int | None] = mapped_column(Integer)
    day: Mapped[int | None] = mapped_column(Integer)
    term: Mapped[int | None] = mapped_column(Integer)
    content: Mapped[str | None] = mapped_column(Text)

    board: Mapped[OrgBoard] = relationship(back_populates="posts")
