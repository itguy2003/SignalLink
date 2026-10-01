"""기관 관리.

권한
    - 최상위 기관 생성/삭제: SUPER_ADMIN
    - 하위 기관 등록/수정: SUPER_ADMIN, 또는 해당 서브트리의 ORG_ADMIN
    - 조회: 자기 기관 및 하위 기관
"""

from __future__ import annotations

from fastapi import APIRouter, File, Query, UploadFile, status
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError

from app.api.deps import CurrentUser, DbSession, bad_request, forbid, not_found
from app.models.asset import Asset
from app.models.content import Content
from app.models.device import Device
from app.models.organization import Organization
from app.models.playlist import Playlist
from app.models.schedule import Schedule
from app.models.user import User
from app.services import assets as asset_service
from app.schemas.common import BulkResult, Message, Page
from app.schemas.organization import (
    BulkDeleteResult,
    OrganizationBulkDelete,
    OrganizationCreate,
    OrganizationNode,
    OrganizationOut,
    OrganizationPublic,
    OrganizationUpdate,
)
from app.services import org_tree, org_types, permissions
from app.services.excel_import import (
    merge_supplement,
    parse_organization_csv,
    parse_organization_workbook,
)

router = APIRouter(prefix="/organizations", tags=["기관"])


@router.get(
    "/public",
    response_model=list[OrganizationPublic],
    summary="회원가입용 기관 목록(인증 불필요)",
)
def public_organizations(
    db: DbSession,
    q: str | None = None,
    category: str | None = Query(default=None, description="기관구분 분류(기관/학교/기타)"),
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
    if category:
        # 커뮤니티 가입 화면이 '기관' 분류만 받는 데 쓴다. 이름이 아니라
        # 분류로 거른다 — 이름은 관리자가 바꾼다.
        stmt = stmt.where(
            Organization.org_type.in_(org_types.names_of_category(db, category))
        )
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


@router.get("/paged", response_model=Page[OrganizationOut], summary="기관 목록(페이지)")
def list_organizations_paged(
    user: CurrentUser,
    db: DbSession,
    q: str | None = None,
    parent_id: int | None = None,
    category: str | None = Query(default=None, description="기관구분 분류(기관/학교/기타)"),
    page: int = Query(1, ge=1),
    size: int = Query(20, ge=1, le=200),
) -> Page[OrganizationOut]:
    """학교 정보 관리처럼 수천 건이 될 수 있는 화면용.

    ``category`` 는 기관구분 마스터의 **분류**로 거른다 — 이름이 아니라
    분류로 판정해야 관리자가 구분 이름을 바꿔도 화면이 계속 맞는다.
    """
    stmt = select(Organization)
    scope = permissions.managed_org_ids(db, user)
    if scope is not None:
        stmt = stmt.where(Organization.id.in_(scope))
    if q:
        stmt = stmt.where(Organization.name.ilike(f"%{q}%"))
    if parent_id is not None:
        stmt = stmt.where(Organization.parent_id == parent_id)
    if category:
        names = org_types.names_of_category(db, category)
        stmt = stmt.where(Organization.org_type.in_(names))
    total = db.execute(
        select(func.count()).select_from(stmt.subquery())
    ).scalar_one()
    rows = (
        db.execute(stmt.order_by(Organization.name).offset((page - 1) * size).limit(size))
        .scalars()
        .all()
    )
    return Page[OrganizationOut](
        items=[OrganizationOut.model_validate(org) for org in rows],
        total=total,
        page=page,
        size=size,
    )


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

    # 기관구분은 마스터(org_type 테이블)에 있어야 한다.
    if payload.org_type not in org_types.all_names(db):
        raise bad_request(f"알 수 없는 기관구분입니다: {payload.org_type}")
    # 분류(school_level)는 그 구분이 정한 선택지 안에서만 고른다.
    if payload.school_level is not None and payload.school_level not in (
        org_types.classifications_of(db, payload.org_type)
    ):
        raise bad_request(f"이 기관구분에서 고를 수 없는 분류입니다: {payload.school_level}")

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

    if data.get("org_type") is not None and data["org_type"] not in org_types.all_names(db):
        raise bad_request(f"알 수 없는 기관구분입니다: {data['org_type']}")

    if data.get("school_level") is not None:
        # 분류는 (바뀐다면 새) 기관구분의 선택지 안에서만.
        target_type = data.get("org_type") or org.org_type
        if data["school_level"] not in org_types.classifications_of(db, target_type):
            raise bad_request(f"이 기관구분에서 고를 수 없는 분류입니다: {data['school_level']}")

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


def _purge_org_data(db, org_id: int) -> None:  # noqa: ANN001
    """기관이 소유한 CMS 자료를 함께 지운다 — 스케줄·재생목록·콘텐츠·자산.

    이들이 RESTRICT FK 로 기관 삭제를 막아 "학교가 지워지지 않는" 문제가
    됐었다. 하위 행(아이템·연결)은 DB 캐스케이드가 정리하고, 다른 기관의
    스케줄이 참조하던 콘텐츠는 SET NULL 로 풀린다. 자산은 파일까지 지운다.
    게시판·공지·커뮤니티는 원래 CASCADE 라 손댈 것이 없다.
    """
    for model in (Schedule, Playlist, Content):
        for row in db.execute(select(model).where(model.org_id == org_id)).scalars():
            db.delete(row)
    for asset in db.execute(select(Asset).where(Asset.org_id == org_id)).scalars():
        asset_service.remove_file(asset)
        db.delete(asset)
    db.flush()


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
        raise bad_request(f"소속기관이 {child_count}건 있어 삭제할 수 없습니다.")

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

    _purge_org_data(db, org_id)
    db.delete(org)
    db.commit()
    return Message(detail="기관이 삭제되었습니다.")


@router.post("/bulk-delete", response_model=BulkDeleteResult, summary="기관 일괄 삭제")
def bulk_delete(
    payload: OrganizationBulkDelete, user: CurrentUser, db: DbSession
) -> BulkDeleteResult:
    """학교 정보 관리처럼 수천 건을 한 번에 정리하는 화면용.

    단건 삭제와 같은 규칙을 기관마다 적용한다: 최상위 불가, 권한 범위 안,
    하위 기관/사용자/장치가 남아 있으면 그 기관만 건너뛴다. 건너뛴 이유는
    사유별 건수로 알린다 — 수천 건을 이름으로 나열하면 아무도 안 읽는다.
    """
    has_filter = payload.q or payload.category or payload.parent_id is not None
    if not payload.ids and not has_filter:
        # 조건 없는 요청은 '전부 삭제'가 된다 — 실수를 여기서 막는다.
        raise bad_request("삭제할 대상을 지정하세요 (ids 또는 검색 조건).")

    stmt = select(Organization)
    if payload.ids:
        stmt = stmt.where(Organization.id.in_(payload.ids))
    else:
        if payload.q:
            stmt = stmt.where(Organization.name.ilike(f"%{payload.q}%"))
        if payload.parent_id is not None:
            stmt = stmt.where(Organization.parent_id == payload.parent_id)
        if payload.category:
            names = org_types.names_of_category(db, payload.category)
            stmt = stmt.where(Organization.org_type.in_(names))
    candidates = list(db.execute(stmt).scalars().all())

    scope = permissions.managed_org_ids(db, user)
    candidate_ids = {org.id for org in candidates}
    with_children = set(
        db.execute(
            select(Organization.parent_id)
            .where(Organization.parent_id.in_(candidate_ids))
            .distinct()
        ).scalars()
    )
    with_users = set(
        db.execute(select(User.org_id).where(User.org_id.in_(candidate_ids)).distinct()).scalars()
    )
    with_devices = set(
        db.execute(
            select(Device.org_id).where(Device.org_id.in_(candidate_ids)).distinct()
        ).scalars()
    )

    reasons = {"root": 0, "denied": 0, "children": 0, "users": 0, "devices": 0, "fk": 0}
    deleted = 0
    for org in candidates:
        if org.parent_id is None:
            reasons["root"] += 1
        elif scope is not None and org.id not in scope:
            reasons["denied"] += 1
        elif org.id in with_children:
            reasons["children"] += 1
        elif org.id in with_users:
            reasons["users"] += 1
        elif org.id in with_devices:
            reasons["devices"] += 1
        else:
            try:
                # 소유 CMS 자료는 함께 지우고, 그래도 남는 FK(예상 밖의
                # 참조)가 막는 기관만 건너뛴다.
                with db.begin_nested():
                    _purge_org_data(db, org.id)
                    db.delete(org)
                    db.flush()
                deleted += 1
            except IntegrityError:
                reasons["fk"] += 1
    db.commit()

    labels = {
        "root": "최상위 기관",
        "denied": "권한이 없는 기관",
        "children": "하위 기관이 있는 기관",
        "users": "소속 사용자가 있는 기관",
        "devices": "소속 장치가 있는 기관",
        "fk": "다른 데이터가 남아 있는 기관",
    }
    errors = [
        f"{labels[key]} {count}건은 건너뛰었습니다." for key, count in reasons.items() if count
    ]
    if payload.ids and len(candidate_ids) < len(set(payload.ids)):
        errors.append(f"찾을 수 없는 기관 {len(set(payload.ids)) - len(candidate_ids)}건.")
    return BulkDeleteResult(
        deleted=deleted, skipped=len(candidates) - deleted, errors=errors
    )


@router.post("/bulk-upload", response_model=BulkResult, summary="엑셀·CSV 일괄 등록")
async def bulk_upload(
    user: CurrentUser,
    db: DbSession,
    file: UploadFile = File(..., description="기관 목록 엑셀(.xlsx) 또는 CSV"),
    coords_file: UploadFile | None = File(
        default=None,
        description="보조 파일(위도·경도 등). 학교코드 또는 이름으로 본 파일과 짝을 맞춘다.",
    ),
    parent_id: int = Query(..., description="등록할 기관들의 상위 기관"),
    default_org_type: str | None = Query(
        default=None,
        description="기관타입 컬럼이 비어 있을 때 쓸 값. 학교 등록 화면이 '학교' 를 보낸다.",
    ),
) -> BulkResult:
    """엑셀 또는 CSV 파일로 기관을 일괄 등록한다.

    헤더 컬럼: 기관명(또는 학교명), 주소, 기관타입, 학교단위, 위도, 경도,
    시도교육청코드, 학교코드 + 나이스 표준 헤더(시도교육청명, 행정코드,
    학교종류명, 시도명, 관할조직명, 도로명주소·상세, 전화번호, 홈페이지주소)

    학교 정보와 좌표가 **서로 다른 파일**로 오는 경우 보조 파일을 함께 올리면
    서버가 합친다 — 짝은 (시도교육청코드, 학교코드) 우선, 없으면 이름.

    시도교육청명이 있으면 최상위 바로 아래에(없을 때만) 만들고, 관할조직명은
    그 교육청의 하위로(없을 때만) 만들어 학교를 그 아래에 둔다. 같은 학교
    (코드 우선, 이름 차선)가 이미 있으면 새로 만들지 않고 **변경**한다.
    """
    if not permissions.can_create_org(db, user, parent_id):
        raise forbid("해당 상위 기관 아래에 기관을 등록할 권한이 없습니다.")
    if db.get(Organization, parent_id) is None:
        raise bad_request("존재하지 않는 상위 기관입니다.")
    allowed_types = org_types.all_names(db)
    if default_org_type is not None and default_org_type not in allowed_types:
        raise bad_request("default_org_type 은 등록된 기관구분 중 하나여야 합니다.")

    content = await file.read()
    # 형식은 파일 이름으로 가른다 — CSV 를 zip 파서(openpyxl)에 넣으면
    # 알 수 없는 오류 문구만 나온다.
    def _parse(name: str, data: bytes):  # noqa: ANN202
        # 형식은 파일 이름으로 가른다 — CSV 를 zip 파서에 넣으면 알 수 없는
        # 오류 문구만 나온다.
        if name.lower().endswith(".csv"):
            return parse_organization_csv(data, default_org_type, allowed_types)
        return parse_organization_workbook(data, default_org_type, allowed_types)

    rows, errors = _parse(file.filename or "", content)

    if coords_file is not None:
        extra_rows, extra_errors = _parse(coords_file.filename or "", await coords_file.read())
        errors.extend(extra_errors)
        errors.extend(merge_supplement(rows, extra_rows))

    result = BulkResult(errors=errors)

    # --- 기관 트리 구성: 시도교육청(최상위 바로 아래) → 교육지원청(관할조직명)
    #     → 학교. 같은 이름이 이미 있으면 만들지 않고 그 기관을 쓴다.
    root = db.execute(
        select(Organization).where(Organization.parent_id.is_(None))
    ).scalars().first()
    can_create_under_root = root is not None and permissions.can_create_org(db, user, root.id)
    org_by_name: dict[str, Organization] = {}

    def _find_by_name(name: str, prefer_parent: int) -> Organization | None:
        if name in org_by_name:
            return org_by_name[name]
        matches = list(
            db.execute(select(Organization).where(Organization.name == name)).scalars()
        )
        found = next((m for m in matches if m.parent_id == prefer_parent), None) or (
            matches[0] if matches else None
        )
        if found is not None:
            org_by_name[name] = found
        return found

    def _ensure_org(name: str, parent_org_id: int, row: dict) -> Organization:
        org = Organization(
            name=name,
            org_type=root.org_type,
            parent_id=parent_org_id,
            edu_office_code=row.get("edu_office_code"),
            edu_office_name=row.get("edu_office_name"),
            sido_name=row.get("sido_name"),
        )
        db.add(org)
        # 하위를 붙이려면 id 가 필요하다 — 교육청·지원청은 몇십 건뿐이라 바로 반영.
        db.flush()
        org_by_name[name] = org
        return org

    # 같은 파일 안의 중복(같은 학교가 두 줄)도 '변경'으로 잡히도록 기억해 둔다.
    pending_by_name: dict[str, Organization] = {}
    pending_by_code: dict[tuple[str, str], Organization] = {}

    for row in rows:
        target_parent = parent_id
        office_name = row.get("edu_office_name")
        if office_name:
            office = _find_by_name(office_name, root.id if root else 0)
            if office is None:
                if not can_create_under_root:
                    result.errors.append(
                        f"'{office_name}' 기관을 최상위 아래에 만들 권한이 없습니다."
                    )
                    result.skipped += 1
                    continue
                office = _ensure_org(office_name, root.id, row)
            target_parent = office.id

            jurisdiction_name = row.get("jurisdiction_name")
            if jurisdiction_name and jurisdiction_name != office_name:
                jurisdiction = _find_by_name(jurisdiction_name, office.id) or _ensure_org(
                    jurisdiction_name, office.id, row
                )
                target_parent = jurisdiction.id

        # 같은 학교(코드 우선, 이름 차선)가 있으면 만들지 않고 **변경**한다.
        existing: Organization | None = None
        if row.get("school_code") and row.get("edu_office_code"):
            code_key = (row["edu_office_code"], row["school_code"])
            existing = pending_by_code.get(code_key) or db.execute(
                select(Organization).where(
                    Organization.edu_office_code == row["edu_office_code"],
                    Organization.school_code == row["school_code"],
                )
            ).scalar_one_or_none()
        if existing is None:
            existing = pending_by_name.get(row["name"]) or db.execute(
                select(Organization).where(
                    Organization.name == row["name"],
                    Organization.parent_id.is_not(None),
                )
            ).scalars().first()

        if existing is not None:
            # 파일 행의 값(비어 있지 않은 것만)을 옮겨 적는다.
            for field, value in row.items():
                if value is not None:
                    setattr(existing, field, value)
            existing.parent_id = target_parent
            result.updated += 1
        else:
            existing = Organization(parent_id=target_parent, **row)
            db.add(existing)
            result.created += 1
        pending_by_name[existing.name] = existing
        if existing.edu_office_code and existing.school_code:
            pending_by_code[(existing.edu_office_code, existing.school_code)] = existing

    db.commit()
    return result
