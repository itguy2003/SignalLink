"""Canva Connect 연결 토큰 — .NET(Data.CanvaAccount)의 거울.

토큰은 서버만 안다 — 프런트에 내려 주면 번들·개발자 도구에서 새어 나간다.
refresh_token 은 회전식이라 갱신 때마다 새 값으로 바꿔 저장한다.
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin


class CanvaAccount(Base, TimestampMixin):
    __tablename__ = "canva_account"
    __table_args__ = (UniqueConstraint("user_id", name="IX_canva_account_user_id"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("app_user.id", ondelete="CASCADE"), nullable=False
    )
    access_token: Mapped[str] = mapped_column(Text, nullable=False, default="")
    refresh_token: Mapped[str] = mapped_column(Text, nullable=False, default="")
    expires_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
