"""소속기관 공지.

상위 기관이 소속기관에 내리는, **기간이 정해진 재생목록** 형태의 공지다.
슬라이드(item)마다 콘텐츠 편집기 문서를 인라인으로 갖고, 순서(sort_order)와
유지 시간(duration_sec)으로 순환한다.

테이블 생성은 EF 마이그레이션(backend-dotnet, ..._OrgNotices)이 했고 이
정의는 거울이다.
"""

from __future__ import annotations

from typing import Any

from sqlalchemy import ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.types import JSON

from app.db.base import Base, TimestampMixin


class OrgNotice(Base, TimestampMixin):
    __tablename__ = "org_notice"

    id: Mapped[int] = mapped_column(primary_key=True)
    org_id: Mapped[int] = mapped_column(
        ForeignKey("organization.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    #: 사용기간(YYYY-MM-DD). 비면 늘 유효.
    #: 사용기간(YYYY-MM-DDTHH:MM, 서버 로컬 시각). 날짜만 저장된 옛 값은
    #: 판정 시 시작 00:00 / 종료 23:59 로 넓혀 읽는다.
    start_date: Mapped[str | None] = mapped_column(String(16))
    end_date: Mapped[str | None] = mapped_column(String(16))
    created_by: Mapped[int | None] = mapped_column(
        ForeignKey("app_user.id", ondelete="SET NULL"), index=True
    )
    #: 고칠 때마다 오른다 — 표출 쪽이 변경을 감지하는 번호.
    version: Mapped[int] = mapped_column(Integer, default=1, nullable=False)

    items: Mapped[list[OrgNoticeItem]] = relationship(
        back_populates="notice",
        cascade="all, delete-orphan",
        order_by="OrgNoticeItem.sort_order",
        lazy="selectin",
    )


class OrgNoticeItem(Base):
    __tablename__ = "org_notice_item"

    id: Mapped[int] = mapped_column(primary_key=True)
    notice_id: Mapped[int] = mapped_column(
        ForeignKey("org_notice.id", ondelete="CASCADE"), nullable=False, index=True
    )
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False)
    duration_sec: Mapped[int] = mapped_column(Integer, default=10, nullable=False)
    #: 콘텐츠 편집기 산출물(JSON) — 슬라이드가 문서를 인라인으로 갖는다.
    document: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict, nullable=False)

    notice: Mapped[OrgNotice] = relationship(back_populates="items")
