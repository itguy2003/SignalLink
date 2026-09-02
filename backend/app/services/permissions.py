"""역할 기반 권한 판정.

요구사항의 권한 규칙을 한 곳에 모은다. 라우터는 여기 있는 함수만 호출하고
직접 역할 문자열을 비교하지 않는다. 프론트엔드도 동일한 규칙을 화면 제어에
사용하지만(요구사항: Backend/Frontend 양쪽에서 제어), **최종 판정은 항상 서버**다.

규칙 요약
    SUPER_ADMIN        모든 기관/사용자/장치
    ORG_ADMIN          자기 기관 + 모든 하위 기관의 기관/사용자/장치
    DEVICE_MANAGER     자신에게 위임된 장치만
    HOMEROOM_TEACHER   자기 기관 장치 조회 + 위임받은 장치 관리
    MEMBER             기본 역할. 본인 정보만.
    COMMUNITY_USER     게시판만. 관리 화면에는 들어오지 못하고, 부설기관에만 둔다.
"""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.device import Device, DeviceManager
from app.models.enums import OrgType, Role
from app.models.organization import Organization
from app.models.user import User
from app.services import org_tree


def is_super_admin(user: User) -> bool:
    return user.has_role(Role.SUPER_ADMIN)


def is_org_admin(user: User) -> bool:
    return user.has_role(Role.ORG_ADMIN)


def is_community_user(user: User) -> bool:
    """게시판만 쓰는 사람인가.

    다른 역할을 함께 가졌다면 그쪽이 이긴다 — 커뮤니티 역할은 '이것만 할 수
    있다' 는 제한이지 '이것을 할 수 있다' 는 허가가 아니다. 기관 담당자에게
    커뮤니티 역할을 얹었다고 해서 그 사람이 갑자기 장치를 못 보게 되면 곤란하다.
    """
    return user.has_role(Role.COMMUNITY_USER) and not any(
        user.has_role(role)
        for role in (Role.SUPER_ADMIN, Role.ORG_ADMIN, Role.DEVICE_MANAGER, Role.HOMEROOM_TEACHER)
    )


def can_read_board(db: Session, user: User, org_id: int) -> bool:
    """게시판을 볼 수 있는가. 소속 기관(과 하위 기관)의 것만."""
    return can_view_org(db, user, org_id)


def can_post_to_board(db: Session, user: User, org_id: int) -> bool:
    """게시판에 글을 올릴 수 있는가.

    관리자는 어느 기관이든 자기 범위 안이면 되고, 커뮤니티 유저는 **자기
    기관** 게시판에만 올린다 — 게시판이 그 사람에게 열려 있는 유일한 창구다.
    """
    if can_manage_org(db, user, org_id):
        return True
    return is_community_user(user) and org_id == user.org_id


def managed_org_ids(db: Session, user: User) -> set[int] | None:
    """사용자가 관리 가능한 기관 id 집합. ``None`` 은 '전체'(SUPER_ADMIN)를 뜻한다."""
    if is_super_admin(user):
        return None
    if is_org_admin(user):
        return org_tree.descendant_ids(db, user.org_id)
    return {user.org_id}


def can_view_org(db: Session, user: User, org_id: int) -> bool:
    scope = managed_org_ids(db, user)
    return scope is None or org_id in scope


def can_manage_org(db: Session, user: User, org_id: int) -> bool:
    """기관 정보 수정/삭제 권한."""
    if is_super_admin(user):
        return True
    if not is_org_admin(user):
        return False
    # 자기 기관과 하위 기관은 관리 가능하다.
    return org_id in org_tree.descendant_ids(db, user.org_id)


def can_create_org(db: Session, user: User, parent_id: int | None) -> bool:
    """기관 등록 권한.

    최상위 기관(parent 없음) 생성은 SUPER_ADMIN 만 가능하다.
    ORG_ADMIN 은 자기 기관 또는 하위 기관 아래에만 새 기관을 만들 수 있다.
    """
    if is_super_admin(user):
        return True
    if not is_org_admin(user) or parent_id is None:
        return False
    return parent_id in org_tree.descendant_ids(db, user.org_id)


def can_approve_user(db: Session, actor: User, target: User) -> bool:
    """사용자 승인 권한. 슈퍼관리자는 전체, 기관관리자는 자기/하위 기관."""
    if is_super_admin(actor):
        return True
    if not is_org_admin(actor):
        return False
    if actor.id == target.id:
        # 자기 자신을 승인할 수는 없다.
        return False
    return target.org_id in org_tree.descendant_ids(db, actor.org_id)


def can_manage_user(db: Session, actor: User, target: User) -> bool:
    if actor.id == target.id:
        return True
    return can_approve_user(db, actor, target)


def role_fits_org(db: Session, role: Role | str, org_id: int) -> bool:
    """그 역할을 그 기관에 둘 수 있는가.

    커뮤니티 유저는 **부설기관**(도서관·문화센터 등) 소속이다. 학교에 두지
    않는 이유는 그 사람이 학교 구성원이 아니기 때문이다 — 학교 게시판을
    바깥 사람에게 열어 주는 것과, 부설기관 게시판을 그 이용자에게 열어 주는
    것은 다른 일이다.

    다른 역할에는 이런 제약이 없다.
    """
    if str(role) != Role.COMMUNITY_USER:
        return True
    org = db.get(Organization, org_id)
    return org is not None and org.org_type == OrgType.AFFILIATE


def can_grant_role(actor: User, role: Role | str) -> bool:
    """역할 부여 권한. SUPER_ADMIN 역할은 SUPER_ADMIN 만 부여할 수 있다."""
    if is_super_admin(actor):
        return True
    if not is_org_admin(actor):
        return False
    return str(role) != Role.SUPER_ADMIN


def delegated_device_ids(db: Session, user: User) -> set[int]:
    rows = db.execute(
        select(DeviceManager.device_id).where(DeviceManager.user_id == user.id)
    ).scalars().all()
    return set(rows)


def can_view_device(db: Session, user: User, device: Device) -> bool:
    if is_super_admin(user):
        return True
    if is_org_admin(user) and device.org_id in org_tree.descendant_ids(db, user.org_id):
        return True
    if device.org_id == user.org_id and user.has_role(Role.HOMEROOM_TEACHER):
        return True
    return device.id in delegated_device_ids(db, user)


def can_manage_device(db: Session, user: User, device: Device) -> bool:
    """장치 설정 변경(스케줄 배정, 속성 수정) 권한."""
    if is_super_admin(user):
        return True
    if is_org_admin(user) and device.org_id in org_tree.descendant_ids(db, user.org_id):
        return True
    return device.id in delegated_device_ids(db, user)


def can_create_device(db: Session, user: User, org_id: int) -> bool:
    """장치 등록/삭제 권한은 기관관리자와 슈퍼관리자만 갖는다."""
    return can_manage_org(db, user, org_id)


def can_delete_device(db: Session, user: User, device: Device) -> bool:
    return can_create_device(db, user, device.org_id)
