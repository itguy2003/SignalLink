"""사용자 관리: 목록, 등록, 수정, 승인.

승인 규칙(요구사항)
    - 기관관리자는 자기 기관 및 하위 기관 사용자를 승인할 수 있다.
    - 슈퍼관리자는 모든 사용자를 승인할 수 있다.
"""

from __future__ import annotations

from fastapi import APIRouter, Query, status
from sqlalchemy import func, select
from sqlalchemy.orm import selectinload

from app.api.deps import (
    CurrentUser,
    DbSession,
    bad_request,
    ensure_unique_roles,
    forbid,
    not_found,
)
from app.core.security import hash_password
from app.models.enums import Role, UserStatus
from app.models.organization import Organization
from app.models.user import LoginLog, User, UserRole
from app.schemas.common import Message, Page
from app.schemas.user import LoginLogOut, UserCreate, UserOut, UserUpdate
from app.services import org_tree, permissions

router = APIRouter(prefix="/users", tags=["사용자"])


def _to_out(db: DbSession, user: User) -> UserOut:
    org = db.get(Organization, user.org_id)
    return UserOut(
        id=user.id,
        user_id=user.user_id,
        name=user.name,
        org_id=user.org_id,
        phone=user.phone,
        email=user.email,
        status=user.status,
        roles=sorted(user.role_names),
        org_name=org.name if org else None,
        created_at=user.created_at,
    )


def _scope_filter(db: DbSession, actor: User, stmt):  # noqa: ANN001, ANN202
    scope = permissions.managed_org_ids(db, actor)
    if scope is None:
        return stmt
    return stmt.where(User.org_id.in_(scope))


@router.get("", response_model=Page[UserOut], summary="사용자 목록")
def list_users(
    actor: CurrentUser,
    db: DbSession,
    q: str | None = None,
    org_id: int | None = None,
    status_filter: UserStatus | None = Query(default=None, alias="status"),
    role: Role | None = None,
    page: int = Query(1, ge=1),
    size: int = Query(20, ge=1, le=200),
) -> Page[UserOut]:
    stmt = select(User).options(selectinload(User.roles))
    stmt = _scope_filter(db, actor, stmt)

    if q:
        like = f"%{q}%"
        stmt = stmt.where((User.name.ilike(like)) | (User.user_id.ilike(like)))
    if org_id is not None:
        if not permissions.can_view_org(db, actor, org_id):
            raise forbid("해당 기관의 사용자를 조회할 권한이 없습니다.")
        stmt = stmt.where(User.org_id.in_(org_tree.descendant_ids(db, org_id)))
    if status_filter is not None:
        stmt = stmt.where(User.status == status_filter)
    if role is not None:
        stmt = stmt.where(User.roles.any(UserRole.role == str(role)))

    total = db.execute(
        select(func.count()).select_from(stmt.order_by(None).subquery())
    ).scalar_one()
    rows = (
        db.execute(stmt.order_by(User.id.desc()).offset((page - 1) * size).limit(size))
        .scalars()
        .all()
    )
    return Page[UserOut](
        items=[_to_out(db, u) for u in rows], total=total, page=page, size=size
    )


@router.get("/pending-count", response_model=dict, summary="승인 대기 인원수")
def pending_count(actor: CurrentUser, db: DbSession) -> dict:
    stmt = select(func.count()).select_from(User).where(User.status == UserStatus.PENDING)
    scope = permissions.managed_org_ids(db, actor)
    if scope is not None:
        stmt = stmt.where(User.org_id.in_(scope))
    return {"count": db.execute(stmt).scalar_one()}


@router.get("/{user_id}", response_model=UserOut, summary="사용자 상세")
def get_user(user_id: int, actor: CurrentUser, db: DbSession) -> UserOut:
    target = db.get(User, user_id)
    if target is None:
        raise not_found("사용자")
    if not permissions.can_manage_user(db, actor, target):
        raise forbid("해당 사용자를 조회할 권한이 없습니다.")
    return _to_out(db, target)


@router.post("", response_model=UserOut, status_code=status.HTTP_201_CREATED, summary="사용자 등록")
def create_user(payload: UserCreate, actor: CurrentUser, db: DbSession) -> UserOut:
    if not permissions.can_manage_org(db, actor, payload.org_id):
        raise forbid("해당 기관에 사용자를 등록할 권한이 없습니다.")
    if db.get(Organization, payload.org_id) is None:
        raise bad_request("존재하지 않는 기관입니다.")
    if db.execute(select(User.id).where(User.user_id == payload.user_id)).scalar_one_or_none():
        raise bad_request("이미 사용 중인 사용자ID 입니다.")

    user = User(
        user_id=payload.user_id,
        password_hash=hash_password(payload.password),
        org_id=payload.org_id,
        name=payload.name,
        phone=payload.phone,
        email=str(payload.email) if payload.email else None,
        # 관리자가 직접 등록한 계정은 즉시 사용 가능하다.
        status=UserStatus.APPROVED,
    )
    # 새 계정은 MEMBER 로만 시작한다. 권한은 등록 뒤 수정에서 부여한다.
    for role in ensure_unique_roles([]):
        user.roles.append(UserRole(role=role))

    db.add(user)
    db.commit()
    db.refresh(user)
    return _to_out(db, user)


@router.put("/{user_id}", response_model=UserOut, summary="사용자 수정")
def update_user(
    user_id: int, payload: UserUpdate, actor: CurrentUser, db: DbSession
) -> UserOut:
    target = db.get(User, user_id)
    if target is None:
        raise not_found("사용자")
    if not permissions.can_manage_user(db, actor, target):
        raise forbid("해당 사용자를 수정할 권한이 없습니다.")

    data = payload.model_dump(exclude_unset=True)
    is_self = actor.id == target.id

    if "org_id" in data and data["org_id"] is not None:
        if is_self and not permissions.is_super_admin(actor):
            raise forbid("자신의 소속기관은 변경할 수 없습니다.")
        if not permissions.can_manage_org(db, actor, data["org_id"]):
            raise forbid("해당 기관으로 소속을 옮길 권한이 없습니다.")
        if db.get(Organization, data["org_id"]) is None:
            raise bad_request("존재하지 않는 기관입니다.")
        # 커뮤니티 유저를 학교나 상급기관으로 옮기면 그 사람이 있을 자리가
        # 없어진다. 역할을 함께 바꾸는 요청이면 그쪽 검사가 뒤에서 다시 본다.
        next_roles = data.get("roles")
        keeps_community = Role.COMMUNITY_USER in target.role_names and (
            next_roles is None or Role.COMMUNITY_USER in {str(r) for r in next_roles}
        )
        if keeps_community and not permissions.role_fits_org(
            db, Role.COMMUNITY_USER, data["org_id"]
        ):
            raise bad_request("커뮤니티 유저는 부설기관 소속이어야 합니다.")
        target.org_id = data["org_id"]

    if "status" in data and data["status"] is not None:
        if not permissions.can_approve_user(db, actor, target):
            raise forbid("해당 사용자의 상태를 변경할 권한이 없습니다.")
        target.status = data["status"]

    if "roles" in data and data["roles"] is not None:
        if is_self and not permissions.is_super_admin(actor):
            raise forbid("자신의 역할은 변경할 수 없습니다.")
        for role in data["roles"]:
            if not permissions.can_grant_role(actor, role):
                raise forbid(f"{role} 역할을 부여할 권한이 없습니다.")
            # 커뮤니티 유저는 부설기관 소속이다. 소속을 함께 바꾸는 요청이면
            # 바뀐 뒤의 기관으로 따진다 — 옮기고 나서야 막히면 두 번 일한다.
            if not permissions.role_fits_org(db, role, target.org_id):
                raise bad_request("커뮤니티 유저는 부설기관 소속이어야 합니다.")
        _replace_roles(db, target, [str(r) for r in data["roles"]])

    if "password" in data and data["password"]:
        target.password_hash = hash_password(data["password"])

    for field in ("name", "phone", "email"):
        if field in data:
            setattr(target, field, str(data[field]) if data[field] is not None else None)

    db.commit()
    db.refresh(target)
    return _to_out(db, target)


def _replace_roles(db: DbSession, user: User, roles: list[str]) -> None:
    """역할 전체 교체. 동일 역할 중복은 ``ensure_unique_roles`` 가 제거한다."""
    wanted = set(ensure_unique_roles(roles))
    current = {r.role: r for r in user.roles}

    for role_name, row in current.items():
        if role_name not in wanted:
            db.delete(row)
    for role_name in wanted - set(current):
        user.roles.append(UserRole(role=role_name))
    db.flush()


@router.post("/{user_id}/approve", response_model=UserOut, summary="사용자 승인")
def approve_user(user_id: int, actor: CurrentUser, db: DbSession) -> UserOut:
    target = db.get(User, user_id)
    if target is None:
        raise not_found("사용자")
    if not permissions.can_approve_user(db, actor, target):
        raise forbid("해당 사용자를 승인할 권한이 없습니다.")
    target.status = UserStatus.APPROVED
    db.commit()
    db.refresh(target)
    return _to_out(db, target)


@router.post("/{user_id}/reject", response_model=UserOut, summary="사용자 승인 취소")
def reject_user(user_id: int, actor: CurrentUser, db: DbSession) -> UserOut:
    target = db.get(User, user_id)
    if target is None:
        raise not_found("사용자")
    if not permissions.can_approve_user(db, actor, target):
        raise forbid("해당 사용자의 승인을 취소할 권한이 없습니다.")
    target.status = UserStatus.PENDING
    db.commit()
    db.refresh(target)
    return _to_out(db, target)


@router.delete("/{user_id}", response_model=Message, summary="사용자 삭제")
def delete_user(user_id: int, actor: CurrentUser, db: DbSession) -> Message:
    target = db.get(User, user_id)
    if target is None:
        raise not_found("사용자")
    if target.id == actor.id:
        raise bad_request("자기 자신은 삭제할 수 없습니다.")
    if not permissions.can_approve_user(db, actor, target):
        raise forbid("해당 사용자를 삭제할 권한이 없습니다.")
    db.delete(target)
    db.commit()
    return Message(detail="사용자가 삭제되었습니다.")


@router.get("/{user_id}/login-logs", response_model=list[LoginLogOut], summary="로그인 이력")
def login_logs(
    user_id: int,
    actor: CurrentUser,
    db: DbSession,
    limit: int = Query(50, ge=1, le=500),
) -> list[LoginLog]:
    target = db.get(User, user_id)
    if target is None:
        raise not_found("사용자")
    if not permissions.can_manage_user(db, actor, target):
        raise forbid("해당 사용자의 로그인 이력을 조회할 권한이 없습니다.")
    return list(
        db.execute(
            select(LoginLog)
            .where(LoginLog.user_id == user_id)
            .order_by(LoginLog.created_at.desc())
            .limit(limit)
        )
        .scalars()
        .all()
    )
