"""기관구분 관리.

조회는 로그인한 누구나(기관 등록 폼이 선택지로 쓴다), 추가/수정/삭제는
슈퍼관리자만. 이름을 바꾸면 그 구분을 쓰는 기관들의 ``org_type`` 문자열도
함께 바뀐다 — 사용 중이어도 수정은 되고, 삭제만 막는다.
"""

from __future__ import annotations

from fastapi import APIRouter, status
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import func, select

from app.api.deps import CurrentUser, DbSession, bad_request, forbid, not_found
from app.models.org_type import OrgTypeDef
from app.models.organization import Organization
from app.schemas.common import Message
from app.services import org_types, permissions

router = APIRouter(prefix="/org-types", tags=["기관구분"])


class OrgTypeOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    category: str
    #: 분류 선택지 — 쉼표로 이어진 문자열(화면이 쪼갠다).
    classifications: str = ""
    usage_count: int = 0


class OrgTypeCreate(BaseModel):
    name: str = Field(min_length=1, max_length=20)
    category: str = "기타"
    classifications: str = ""


class OrgTypeUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=20)
    category: str | None = None
    classifications: str | None = None


def _require_super(actor) -> None:  # noqa: ANN001
    if not permissions.is_super_admin(actor):
        raise forbid("기관구분을 관리할 권한이 없습니다.")


def _usage(db: DbSession, name: str) -> int:
    return db.execute(
        select(func.count()).select_from(Organization).where(Organization.org_type == name)
    ).scalar_one()


def _out(db: DbSession, row: OrgTypeDef) -> OrgTypeOut:
    out = OrgTypeOut.model_validate(row)
    out.usage_count = _usage(db, row.name)
    return out


@router.get("", response_model=list[OrgTypeOut], summary="기관구분 목록")
def list_org_types(actor: CurrentUser, db: DbSession) -> list[OrgTypeOut]:
    rows = db.execute(select(OrgTypeDef).order_by(OrgTypeDef.id)).scalars()
    return [_out(db, row) for row in rows]


@router.post(
    "", response_model=OrgTypeOut, status_code=status.HTTP_201_CREATED, summary="기관구분 추가"
)
def create_org_type(payload: OrgTypeCreate, actor: CurrentUser, db: DbSession) -> OrgTypeOut:
    _require_super(actor)
    name = payload.name.strip()
    if not name or len(name) > 20:
        raise bad_request("기관구분 이름은 1~20자여야 합니다.")
    if payload.category not in org_types.CATEGORIES:
        raise bad_request("category 는 기관·학교·기타 중 하나여야 합니다.")
    if db.execute(select(OrgTypeDef).where(OrgTypeDef.name == name)).scalar_one_or_none():
        raise bad_request("이미 있는 기관구분 이름입니다.")
    classifications = org_types.normalize_classifications(payload.classifications)
    if classifications is None:
        raise bad_request(org_types.INVALID_CLASSIFICATIONS_ERROR)

    row = OrgTypeDef(name=name, category=payload.category, classifications=classifications)
    db.add(row)
    db.commit()
    db.refresh(row)
    return _out(db, row)


@router.put("/{type_id}", response_model=OrgTypeOut, summary="기관구분 수정")
def update_org_type(
    type_id: int, payload: OrgTypeUpdate, actor: CurrentUser, db: DbSession
) -> OrgTypeOut:
    _require_super(actor)
    row = db.get(OrgTypeDef, type_id)
    if row is None:
        raise not_found("기관구분")

    if payload.classifications is not None:
        normalized = org_types.normalize_classifications(payload.classifications)
        if normalized is None:
            raise bad_request(org_types.INVALID_CLASSIFICATIONS_ERROR)
        row.classifications = normalized

    if payload.category is not None:
        if payload.category not in org_types.CATEGORIES:
            raise bad_request("category 는 기관·학교·기타 중 하나여야 합니다.")
        row.category = payload.category

    if payload.name is not None and payload.name.strip() != row.name:
        name = payload.name.strip()
        if not name or len(name) > 20:
            raise bad_request("기관구분 이름은 1~20자여야 합니다.")
        duplicate = db.execute(
            select(OrgTypeDef).where(OrgTypeDef.name == name, OrgTypeDef.id != type_id)
        ).scalar_one_or_none()
        if duplicate is not None:
            raise bad_request("이미 있는 기관구분 이름입니다.")

        # 사용 중이어도 수정은 된다 — 그 구분을 쓰는 기관들을 함께 옮긴다.
        old_name = row.name
        row.name = name
        for org in db.execute(
            select(Organization).where(Organization.org_type == old_name)
        ).scalars():
            org.org_type = name

    db.commit()
    db.refresh(row)
    return _out(db, row)


@router.delete("/{type_id}", response_model=Message, summary="기관구분 삭제")
def delete_org_type(type_id: int, actor: CurrentUser, db: DbSession) -> Message:
    _require_super(actor)
    row = db.get(OrgTypeDef, type_id)
    if row is None:
        raise not_found("기관구분")

    used = _usage(db, row.name)
    if used:
        raise bad_request(f"이 기관구분을 사용하는 기관이 {used}곳 있어 삭제할 수 없습니다.")

    db.delete(row)
    db.commit()
    return Message(detail="기관구분이 삭제되었습니다.")
