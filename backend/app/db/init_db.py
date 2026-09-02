"""부트스트랩.

요구사항: 시스템은 기본적으로 "최상위 기관"을 생성한다.
최상위 기관 없이는 회원가입도 불가능하므로, 함께 슈퍼관리자 계정도 만든다.
이미 존재하면 아무것도 하지 않는다(멱등).
"""

from __future__ import annotations

import logging

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.security import hash_password
from app.db.base import Base
from app.db.session import engine
from app.models.enums import OrgType, Role, UserStatus
from app.models.organization import Organization
from app.models.user import User, UserRole

logger = logging.getLogger(__name__)


def create_tables() -> None:
    """개발/테스트 편의용. 운영에서는 Alembic 마이그레이션을 사용한다."""
    Base.metadata.create_all(bind=engine)


def ensure_root_organization(db: Session) -> Organization:
    root = db.execute(
        select(Organization).where(Organization.parent_id.is_(None)).order_by(Organization.id)
    ).scalars().first()
    if root is not None:
        return root

    root = Organization(name=settings.ROOT_ORG_NAME, org_type=OrgType.ORG, parent_id=None)
    db.add(root)
    db.flush()
    logger.info("최상위 기관을 생성했습니다: %s (id=%s)", root.name, root.id)
    return root


def ensure_super_admin(db: Session, org: Organization) -> User:
    existing = db.execute(
        select(User).where(User.user_id == settings.BOOTSTRAP_ADMIN_ID)
    ).scalar_one_or_none()
    if existing is not None:
        return existing

    admin = User(
        user_id=settings.BOOTSTRAP_ADMIN_ID,
        password_hash=hash_password(settings.BOOTSTRAP_ADMIN_PASSWORD),
        org_id=org.id,
        name="시스템 관리자",
        status=UserStatus.APPROVED,
    )
    admin.roles.append(UserRole(role=Role.SUPER_ADMIN))
    admin.roles.append(UserRole(role=Role.MEMBER))
    db.add(admin)
    db.flush()
    logger.info("슈퍼관리자 계정을 생성했습니다: %s", admin.user_id)
    return admin


def init_db(db: Session) -> None:
    root = ensure_root_organization(db)
    ensure_super_admin(db, root)
    db.commit()
