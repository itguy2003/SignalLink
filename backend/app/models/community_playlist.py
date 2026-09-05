"""커뮤니티 재생목록 — 공유 이미지·동영상을 순서와 시간으로 엮은 것.

CMS 재생목록이 위젯을 엮듯, 커뮤니티 재생목록은 **이 커뮤니티의 공유물**을
엮는다. 재료가 공유물뿐인 이유는 커뮤니티 울타리다 — 커뮤니티 유저에게
열린 공간에서 만든 것이 바깥 재료를 실어 나르면 안 된다(저장에서 검사한다).

칸의 재생 규약(duration_sec / transition / transition_ms)은 CMS 재생목록과
같다 — 트는 쪽이 같은 규칙(useWidgetCycle 류)을 그대로 쓰게 하기 위해서다.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from sqlalchemy import ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.types import JSON

from app.db.base import Base, TimestampMixin

if TYPE_CHECKING:
    from app.models.organization import Organization
    from app.models.user import User


class CommunityPlaylist(Base, TimestampMixin):
    __tablename__ = "community_playlist"

    id: Mapped[int] = mapped_column(primary_key=True)
    org_id: Mapped[int] = mapped_column(
        ForeignKey("organization.id", ondelete="CASCADE"), nullable=False, index=True
    )
    author_id: Mapped[int | None] = mapped_column(
        ForeignKey("app_user.id", ondelete="SET NULL"), index=True
    )
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    #: [{kind: image|video, asset_id, duration_sec, transition?, transition_ms?}]
    items: Mapped[list[dict[str, Any]]] = mapped_column(JSON, default=list, nullable=False)
    #: 트는 쪽이 변경을 감지하는 근거. 고칠 때마다 올라간다.
    version: Mapped[int] = mapped_column(Integer, default=1, nullable=False)

    organization: Mapped[Organization] = relationship()
    author: Mapped[User | None] = relationship()
