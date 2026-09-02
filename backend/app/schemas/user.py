from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict, EmailStr, Field

from app.models.enums import Role, UserStatus


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    user_id: str
    name: str
    org_id: int
    phone: str | None = None
    email: str | None = None
    status: str
    roles: list[str] = Field(default_factory=list)
    org_name: str | None = None
    created_at: datetime | None = None


class UserCreate(BaseModel):
    """관리자가 직접 사용자를 등록할 때 사용. 즉시 승인 상태로 생성된다.

    **역할은 받지 않는다.** 새 계정은 언제나 MEMBER 로만 시작하고, 권한은
    등록한 뒤 수정에서 따로 부여한다. 등록과 권한 부여를 한 번에 처리하면
    계정을 만드는 김에 권한까지 딸려 나가기 쉽고, "누가 언제 이 권한을
    줬는가" 가 등록 행위에 묻힌다. 자체 회원가입(``/auth/register``)이
    MEMBER 로만 시작하는 것과도 같은 규칙이 된다.

    ``roles`` 를 보내도 무시된다(Pydantic 기본값이 추가 필드 무시).
    """

    org_id: int
    user_id: str = Field(min_length=4, max_length=50, pattern=r"^[A-Za-z0-9_.\-]+$")
    password: str = Field(min_length=8, max_length=128)
    name: str = Field(min_length=1, max_length=100)
    phone: str | None = Field(default=None, max_length=30)
    email: EmailStr | None = None


class UserUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=100)
    phone: str | None = Field(default=None, max_length=30)
    email: EmailStr | None = None
    org_id: int | None = None
    status: UserStatus | None = None
    roles: list[Role] | None = None
    #: 관리자가 비밀번호를 재설정할 때만 사용.
    password: str | None = Field(default=None, min_length=8, max_length=128)


class LoginLogOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    user_id: int | None
    attempted_user_id: str
    success: bool
    ip_address: str | None
    reason: str | None
    created_at: datetime
