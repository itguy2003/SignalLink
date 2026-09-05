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
    COMMUNITY_USER     커뮤니티(공유 게시판·이미지·동영상)만. 관리 화면에는 들어오지 못한다.
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


def community_org_of(db: Session, org_id: int) -> int | None:
    """이 기관이 속한 커뮤니티(상위기관)의 id. 없으면 None.

    커뮤니티는 상위기관(org_type=기관)에만 있다 — 학교에는 없다. 트리를 따라
    올라가 **처음 만나는 상위기관**이 그 자리다. 사람도 장치도 같은 규칙으로
    제 커뮤니티를 찾는다.
    """
    org = db.get(Organization, org_id)
    seen: set[int] = set()
    while org is not None and org.id not in seen:
        seen.add(org.id)
        if org.org_type == OrgType.ORG:
            return org.id
        org = db.get(Organization, org.parent_id) if org.parent_id is not None else None
    return None


def community_org_id(db: Session, user: User) -> int | None:
    """이 사용자가 보는 커뮤니티(상위기관)의 id. 없으면 None."""
    return community_org_of(db, user.org_id)


def can_use_community(user: User) -> bool:
    """커뮤니티 공간(게시판·이미지·동영상)에 들어올 수 있는가.

    기관관리자와 커뮤니티 유저의 공간이다(슈퍼관리자는 어디든 들어온다).
    일반 회원·장치담당·담임은 들어오지 못한다 — 메뉴도 서지 않지만,
    주소를 쳐도 여기서 막는다.
    """
    return (
        user.has_role(Role.COMMUNITY_USER) or is_super_admin(user) or is_org_admin(user)
    )


def can_manage_community(user: User) -> bool:
    """커뮤니티 콘텐츠·재생목록을 다룰 수 있는가 — 관리자만.

    커뮤니티 유저는 자료(글·이미지·동영상)를 올리는 사람이고, 그것을 엮어
    화면에 내보내는 일(콘텐츠·재생목록)은 운영이다.
    """
    return is_super_admin(user) or is_org_admin(user)


def can_share_in_community(user: User) -> bool:
    """커뮤니티에 올릴 수 있는가(글·이미지·동영상).

    커뮤니티에 들어올 수 있는 사람은 모두 올릴 수 있다 — 남의 것에는
    조회만 되고, 제 것에만 수정·삭제가 열린다(``can_remove_shared``).
    """
    return can_use_community(user)


def can_remove_shared(user: User, uploaded_by: int | None) -> bool:
    """공유한 것을 지울 수 있는가. 올린 사람 본인과 관리자만."""
    if is_super_admin(user) or is_org_admin(user):
        return True
    return uploaded_by is not None and uploaded_by == user.id


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
