from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field


class OrganizationBase(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    address: str | None = Field(default=None, max_length=500)
    #: 기관구분 이름. 고정 enum 이 아니라 마스터(org_type 테이블)로 검증한다.
    org_type: str = Field(default="기관", min_length=1, max_length=20)
    #: 분류 — 기관구분이 정한 선택지 중 하나(예: 학교의 초/중/고).
    school_level: str | None = Field(default=None, max_length=10)
    latitude: float | None = Field(default=None, ge=-90, le=90)
    longitude: float | None = Field(default=None, ge=-180, le=180)
    edu_office_code: str | None = Field(default=None, max_length=20)
    school_code: str | None = Field(default=None, max_length=20)
    # 학교 정보 일괄 등록(나이스 표준 헤더)에서 수집하는 부가 정보.
    edu_office_name: str | None = Field(default=None, max_length=40)
    sido_name: str | None = Field(default=None, max_length=20)
    jurisdiction_name: str | None = Field(default=None, max_length=100)
    address_detail: str | None = Field(default=None, max_length=300)
    phone: str | None = Field(default=None, max_length=30)
    homepage: str | None = Field(default=None, max_length=300)


class OrganizationCreate(OrganizationBase):
    #: NULL 은 최상위 기관을 뜻하며 SUPER_ADMIN 만 생성할 수 있다.
    parent_id: int | None = None


class OrganizationUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    address: str | None = Field(default=None, max_length=500)
    org_type: str | None = Field(default=None, min_length=1, max_length=20)
    school_level: str | None = Field(default=None, max_length=10)
    parent_id: int | None = None
    latitude: float | None = Field(default=None, ge=-90, le=90)
    longitude: float | None = Field(default=None, ge=-180, le=180)
    edu_office_code: str | None = Field(default=None, max_length=20)
    school_code: str | None = Field(default=None, max_length=20)
    edu_office_name: str | None = Field(default=None, max_length=40)
    sido_name: str | None = Field(default=None, max_length=20)
    jurisdiction_name: str | None = Field(default=None, max_length=100)
    address_detail: str | None = Field(default=None, max_length=300)
    phone: str | None = Field(default=None, max_length=30)
    homepage: str | None = Field(default=None, max_length=300)


class OrganizationOut(OrganizationBase):
    model_config = ConfigDict(from_attributes=True)

    id: int
    parent_id: int | None


class OrganizationBulkDelete(BaseModel):
    """일괄 삭제 대상 — ids 를 주면 그 기관들, 아니면 검색 조건으로 고른다."""

    ids: list[int] | None = None
    q: str | None = None
    #: 기관구분 분류(기관/학교/기타) — 이름이 아니라 분류로 거른다.
    category: str | None = None
    parent_id: int | None = None


class BulkDeleteResult(BaseModel):
    deleted: int
    skipped: int
    errors: list[str] = Field(default_factory=list)


class OrganizationPublic(BaseModel):
    """회원가입 화면용 최소 정보(인증 없이 노출된다)."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    parent_id: int | None = None


class OrganizationNode(OrganizationOut):
    """트리 응답용. 기관 관리 화면의 좌측 트리에 그대로 바인딩된다."""

    children: list[OrganizationNode] = Field(default_factory=list)


OrganizationNode.model_rebuild()
