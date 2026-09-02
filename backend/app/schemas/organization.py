from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field

from app.models.enums import OrgType, SchoolLevel


class OrganizationBase(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    address: str | None = Field(default=None, max_length=500)
    org_type: OrgType = OrgType.ORG
    school_level: SchoolLevel | None = None
    latitude: float | None = Field(default=None, ge=-90, le=90)
    longitude: float | None = Field(default=None, ge=-180, le=180)
    edu_office_code: str | None = Field(default=None, max_length=20)
    school_code: str | None = Field(default=None, max_length=20)


class OrganizationCreate(OrganizationBase):
    #: NULL 은 최상위 기관을 뜻하며 SUPER_ADMIN 만 생성할 수 있다.
    parent_id: int | None = None


class OrganizationUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    address: str | None = Field(default=None, max_length=500)
    org_type: OrgType | None = None
    school_level: SchoolLevel | None = None
    parent_id: int | None = None
    latitude: float | None = Field(default=None, ge=-90, le=90)
    longitude: float | None = Field(default=None, ge=-180, le=180)
    edu_office_code: str | None = Field(default=None, max_length=20)
    school_code: str | None = Field(default=None, max_length=20)


class OrganizationOut(OrganizationBase):
    model_config = ConfigDict(from_attributes=True)

    id: int
    parent_id: int | None


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
