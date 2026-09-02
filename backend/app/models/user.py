from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, DateTime, ForeignKey, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, TimestampMixin
from app.models.enums import Role, UserStatus

if TYPE_CHECKING:
    from app.models.organization import Organization


class User(Base, TimestampMixin):
    """CMS 로그인 사용자."""

    __tablename__ = "app_user"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[str] = mapped_column(String(50), unique=True, nullable=False, index=True)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    org_id: Mapped[int] = mapped_column(
        ForeignKey("organization.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    phone: Mapped[str | None] = mapped_column(String(30))
    email: Mapped[str | None] = mapped_column(String(200))
    status: Mapped[str] = mapped_column(String(10), default=UserStatus.PENDING, nullable=False)

    organization: Mapped[Organization] = relationship(back_populates="users")
    roles: Mapped[list[UserRole]] = relationship(
        back_populates="user", cascade="all, delete-orphan", lazy="selectin"
    )

    @property
    def role_names(self) -> set[str]:
        return {r.role for r in self.roles}

    def has_role(self, role: Role | str) -> bool:
        return str(role) in self.role_names

    @property
    def is_approved(self) -> bool:
        return self.status == UserStatus.APPROVED


class UserRole(Base):
    """사용자역할정보. 한 사용자에게 동일 역할이 중복될 수 없다(UNIQUE)."""

    __tablename__ = "user_role"
    __table_args__ = (UniqueConstraint("user_id", "role", name="uq_user_role"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("app_user.id", ondelete="CASCADE"), nullable=False, index=True
    )
    role: Mapped[str] = mapped_column(String(30), nullable=False)

    user: Mapped[User] = relationship(back_populates="roles")


class LoginLog(Base):
    """로그인 시도 기록(요구사항: 로그인 정보에 대해 로그를 기록한다)."""

    __tablename__ = "login_log"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int | None] = mapped_column(
        ForeignKey("app_user.id", ondelete="SET NULL"), index=True
    )
    #: 존재하지 않는 계정으로 시도한 경우에도 남겨야 하므로 문자열로 별도 보관한다.
    attempted_user_id: Mapped[str] = mapped_column(String(50), nullable=False)
    success: Mapped[bool] = mapped_column(Boolean, nullable=False)
    ip_address: Mapped[str | None] = mapped_column(String(64))
    user_agent: Mapped[str | None] = mapped_column(String(300))
    reason: Mapped[str | None] = mapped_column(String(100))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, index=True
    )
