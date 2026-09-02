"""기관 관리.

권한
    - 최상위 기관 생성/삭제: SUPER_ADMIN
    - 하위 기관 등록/수정: SUPER_ADMIN, 또는 해당 서브트리의 ORG_ADMIN
    - 조회: 자기 기관 및 하위 기관
"""

from __future__ import annotations

from fastapi import APIRouter, File, Query, UploadFile, status
from sqlalchemy import func, select

from app.api.deps import CurrentUser, DbSession, bad_request, forbid, not_found
from app.models.device import Device
from app.models.organization import Organization
from app.models.user import User
from app.schemas.common import BulkResult, Message
from app.schemas.organization import (
    OrganizationCreate,
    OrganizationNode,
    OrganizationOut,
    OrganizationPublic,
    OrganizationUpdate,
)
from app.services import org_tree, permissions
from app.services.excel_import import parse_organization_workbook

router = APIRouter(prefix="/organizations", tags=["기관"])


@router.get(
    "/public",
    response_model=list[OrganizationPublic],
    summary="회원가입용 기관 목록(인증 불필요)",
)
def public_organizations(
    db: DbSession,
    q: str | None = None,
    limit: int = Query(default=500, ge=1, le=500, description="검색 결과 상한"),
) -> list[OrganizationPublic]:
    """회원가입 화면에서 소속기관을 선택하려면 로그인 전에도 목록이 필요하다.

    이름과 id 만 노출하며 주소·좌표 등 상세는 제공하지 않는다.

    ``limit`` 은 검색 상자용이다(기본값은 종전과 같은 500). 기관이 수백 개인
    환경에서 가입 화면이 목록 전체를 받을 이유가 없다 — 검색어로 좁힌 앞쪽
    몇 건이면 고르기에 충분하다.
    """
    stmt = select(Organization.id, Organization.name, Organization.parent_id)
    if q:
        stmt = stmt.where(Organization.name.ilike(f"%{q}%"))
    rows = db.execute(stmt.order_by(Organization.name).limit(limit)).all()
    return [
        OrganizationPublic(id=r.id, name=r.name, parent_id=r.parent_id) for r in rows
    ]


@router.get("", response_model=list[OrganizationOut], summary="기관 목록")
def list_organizations(
    user: CurrentUser,
    db: DbSession,
    q: str | None = None,
    parent_id: int | None = None,
    limit: int | None = Query(default=None, ge=1, le=1000, description="검색 결과 상한"),
) -> list[Organization]:
    """조회 가능한 기관 목록.

    ``limit`` 은 검색 상자용이다. 기관이 수백 개인 환경에서 선택 상자에 전부
    채우면 고르기도 어렵고 응답도 무거워지므로, 검색어로 좁힌 앞쪽 몇 건만
    받아 가라는 뜻이다. 주지 않으면 예전처럼 전부 돌려준다 — 기존 화면들이
    전체 목록을 전제로 만들어져 있다.
    """
    stmt = select(Organization)
    scope = permissions.managed_org_ids(db, user)
    if scope is not None:
        stmt = stmt.where(Organization.id.in_(scope))
    if q:
        stmt = stmt.where(Organization.name.ilike(f"%{q}%"))
    if parent_id is not None:
        stmt = stmt.where(Organization.parent_id == parent_id)
    stmt = stmt.order_by(Organization.name)
    if limit is not None:
        stmt = stmt.limit(limit)
    return list(db.execute(stmt).scalars().all())


@router.get("/tree", response_model=list[OrganizationNode], summary="기관 트리")
def organization_tree(user: CurrentUser, db: DbSession) -> list[OrganizationNode]:
    scope = permissions.managed_org_ids(db, user)
    orgs = list(db.execute(select(Organization).order_by(Organization.name)).scalars().all())
    if scope is not None:
        orgs = [o for o in orgs if o.id in scope]

    # OrganizationNode 를 ORM 객체에서 바로 검증하면 안 된다. from_attributes 로
    # ``Organization.children`` 관계까지 재귀적으로 읽어 하위 트리를 한 번 채우고,
    # 아래 반복문이 같은 자식을 또 붙여 노드가 중복된다(깊이가 깊을수록 배로 늘어난다).
    # 중복된 노드는 화면에서 같은 기관이 여러 줄로 보이게 하고, 같은 key 가 겹쳐
    # 한 기관을 고치면 다른 줄까지 함께 바뀐 것처럼 보인다.
    # 그래서 children 이 없는 OrganizationOut 으로 값을 뽑아 노드를 만든다.
    nodes = {
        o.id: OrganizationNode(**OrganizationOut.model_validate(o).model_dump(), children=[])
        for o in orgs
    }
    roots: list[OrganizationNode] = []
    for org in orgs:
        node = nodes[org.id]
        parent = nodes.get(org.parent_id) if org.parent_id is not None else None
        if parent is None:
            # 상위 기관이 조회 범위 밖이면 이 노드가 트리의 뿌리가 된다.
            roots.append(node)
        else:
            parent.children.append(node)
    return roots


@router.get("/{org_id}", response_model=OrganizationOut, summary="기관 상세")
def get_organization(org_id: int, user: CurrentUser, db: DbSession) -> Organization:
    org = db.get(Organization, org_id)
    if org is None:
        raise not_found("기관")
    if not permissions.can_view_org(db, user, org_id):
        raise forbid("해당 기관을 조회할 권한이 없습니다.")
    return org


@router.post(
    "", response_model=OrganizationOut, status_code=status.HTTP_201_CREATED, summary="기관 등록"
)
def create_organization(
    payload: OrganizationCreate, user: CurrentUser, db: DbSession
) -> Organization:
    if not permissions.can_create_org(db, user, payload.parent_id):
        raise forbid("기관을 등록할 권한이 없습니다.")

    if payload.parent_id is None:
        existing_root = org_tree.get_root_org(db)
        if existing_root is not None:
            raise bad_request("최상위 기관은 이미 존재합니다. 상위 기관을 지정하세요.")
    elif db.get(Organization, payload.parent_id) is None:
        raise bad_request("존재하지 않는 상위 기관입니다.")

    org = Organization(**payload.model_dump())
    db.add(org)
    db.commit()
    db.refresh(org)
    return org


@router.put("/{org_id}", response_model=OrganizationOut, summary="기관 수정")
def update_organization(
    org_id: int, payload: OrganizationUpdate, user: CurrentUser, db: DbSession
) -> Organization:
    org = db.get(Organization, org_id)
    if org is None:
        raise not_found("기관")
    if not permissions.can_manage_org(db, user, org_id):
        raise forbid("해당 기관을 수정할 권한이 없습니다.")

    data = payload.model_dump(exclude_unset=True)

    if "parent_id" in data:
        new_parent = data["parent_id"]
        if org.parent_id is None and new_parent is not None:
            raise bad_request("최상위 기관은 하위로 이동할 수 없습니다.")
        if new_parent is not None:
            if db.get(Organization, new_parent) is None:
                raise bad_request("존재하지 않는 상위 기관입니다.")
            if org_tree.would_create_cycle(db, org_id=org_id, new_parent_id=new_parent):
                raise bad_request("상위 기관 변경이 순환 구조를 만듭니다.")
            if not permissions.can_create_org(db, user, new_parent):
                raise forbid("지정한 상위 기관 아래로 옮길 권한이 없습니다.")

    for key, value in data.items():
        setattr(org, key, value)
    db.commit()
    db.refresh(org)
    return org


@router.delete("/{org_id}", response_model=Message, summary="기관 삭제")
def delete_organization(org_id: int, user: CurrentUser, db: DbSession) -> Message:
    org = db.get(Organization, org_id)
    if org is None:
        raise not_found("기관")
    if org.parent_id is None:
        raise bad_request("최상위 기관은 삭제할 수 없습니다.")
    if not permissions.can_manage_org(db, user, org_id):
        raise forbid("해당 기관을 삭제할 권한이 없습니다.")

    # 하위 기관/사용자/장치가 남아 있으면 FK RESTRICT 로 DB 오류가 나므로 미리 막는다.
    child_count = db.execute(
        select(func.count()).select_from(Organization).where(Organization.parent_id == org_id)
    ).scalar_one()
    if child_count:
        raise bad_request(f"하위 기관이 {child_count}건 있어 삭제할 수 없습니다.")

    user_count = db.execute(
        select(func.count()).select_from(User).where(User.org_id == org_id)
    ).scalar_one()
    if user_count:
        raise bad_request(f"소속 사용자가 {user_count}명 있어 삭제할 수 없습니다.")

    device_count = db.execute(
        select(func.count()).select_from(Device).where(Device.org_id == org_id)
    ).scalar_one()
    if device_count:
        raise bad_request(f"소속 장치가 {device_count}대 있어 삭제할 수 없습니다.")

    db.delete(org)
    db.commit()
    return Message(detail="기관이 삭제되었습니다.")


@router.post("/bulk-upload", response_model=BulkResult, summary="엑셀 일괄 등록")
async def bulk_upload(
    user: CurrentUser,
    db: DbSession,
    file: UploadFile = File(..., description="기관 목록 엑셀(.xlsx)"),
    parent_id: int = Query(..., description="등록할 기관들의 상위 기관"),
) -> BulkResult:
    """엑셀 파일로 기관을 일괄 등록한다.

    헤더 컬럼: 기관명, 주소, 기관타입, 학교단위, 위도, 경도, 시도교육청코드, 학교코드
    """
    if not permissions.can_create_org(db, user, parent_id):
        raise forbid("해당 상위 기관 아래에 기관을 등록할 권한이 없습니다.")
    if db.get(Organization, parent_id) is None:
        raise bad_request("존재하지 않는 상위 기관입니다.")

    content = await file.read()
    rows, errors = parse_organization_workbook(content)

    result = BulkResult(errors=errors)
    for row in rows:
        # 학교코드가 있으면 중복 등록을 막는다(UNIQUE 제약과 동일 기준).
        if row.get("school_code") and row.get("edu_office_code"):
            existing = db.execute(
                select(Organization).where(
                    Organization.edu_office_code == row["edu_office_code"],
                    Organization.school_code == row["school_code"],
                )
            ).scalar_one_or_none()
            if existing is not None:
                result.skipped += 1
                continue
        db.add(Organization(parent_id=parent_id, **row))
        result.created += 1

    db.commit()
    return result
