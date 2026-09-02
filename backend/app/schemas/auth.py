from __future__ import annotations

from pydantic import BaseModel, EmailStr, Field, field_validator, model_validator


class LoginRequest(BaseModel):
    user_id: str
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_in: int
    user: MeResponse


class RegisterRequest(BaseModel):
    """회원가입: 소속기관, 사용자ID, 비밀번호, 비밀번호확인."""

    org_id: int
    user_id: str = Field(min_length=4, max_length=50, pattern=r"^[A-Za-z0-9_.\-]+$")
    password: str = Field(min_length=8, max_length=128)
    password_confirm: str
    name: str = Field(min_length=1, max_length=100)
    phone: str | None = Field(default=None, max_length=30)
    email: EmailStr | None = None

    @model_validator(mode="after")
    def _passwords_match(self) -> RegisterRequest:
        if self.password != self.password_confirm:
            raise ValueError("비밀번호와 비밀번호 확인이 일치하지 않습니다.")
        return self


class UserIdCheckResponse(BaseModel):
    user_id: str
    available: bool


class MeResponse(BaseModel):
    id: int
    user_id: str
    name: str
    org_id: int
    org_name: str | None = None
    status: str
    roles: list[str]


class PasswordChangeRequest(BaseModel):
    current_password: str
    new_password: str = Field(min_length=8, max_length=128)
    new_password_confirm: str

    @model_validator(mode="after")
    def _match(self) -> PasswordChangeRequest:
        if self.new_password != self.new_password_confirm:
            raise ValueError("새 비밀번호와 확인이 일치하지 않습니다.")
        return self

    @field_validator("new_password")
    @classmethod
    def _not_trivial(cls, v: str) -> str:
        if v.isdigit() or v.isalpha():
            raise ValueError("비밀번호는 영문과 숫자를 함께 사용해야 합니다.")
        return v


TokenResponse.model_rebuild()
