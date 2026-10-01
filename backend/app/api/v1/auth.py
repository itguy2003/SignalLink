"""인증: 로그인, 회원가입, ID 중복검사.

요구사항
    - 회원가입은 소속기관/사용자ID/비밀번호/비밀번호확인을 받는다.
    - 사용자ID 중복검사를 통과해야 가입할 수 있다.
    - 신규 가입자는 '미승인' 상태로 시작한다.
    - 모든 사용자는 기본 역할로 MEMBER 를 갖는다.
    - 로그인 시도는 성공/실패 모두 로그로 남긴다.
"""

from __future__ import annotations

from datetime import UTC, datetime

from fastapi import APIRouter, HTTPException, Request, status
from sqlalchemy import select

from app.api.deps import CurrentUser, DbSession, bad_request
from app.core.config import settings
from app.core.passwords import complexity_error
from app.core.security import create_access_token, hash_password, verify_password
from app.models.enums import Role, UserStatus
from app.models.organization import Organization
from app.models.user import LoginLog, User, UserRole
from app.schemas.auth import (
    LoginRequest,
    MeResponse,
    PasswordChangeRequest,
    ProfileUpdateRequest,
    RegisterRequest,
    TokenResponse,
    UserIdCheckResponse,
)
from app.schemas.common import Message

router = APIRouter(prefix="/auth", tags=["인증"])


def _me(db_user: User, org_name: str | None) -> MeResponse:
    return MeResponse(
        id=db_user.id,
        user_id=db_user.user_id,
        name=db_user.name,
        phone=db_user.phone,
        email=db_user.email,
        org_id=db_user.org_id,
        org_name=org_name,
        status=db_user.status,
        roles=sorted(db_user.role_names),
    )


def _log_login(
    db: DbSession,
    request: Request,
    *,
    attempted_user_id: str,
    user_id: int | None,
    success: bool,
    reason: str | None = None,
) -> None:
    db.add(
        LoginLog(
            user_id=user_id,
            attempted_user_id=attempted_user_id,
            success=success,
            ip_address=request.client.host if request.client else None,
            user_agent=request.headers.get("user-agent", "")[:300] or None,
            reason=reason,
            created_at=datetime.now(UTC),
        )
    )
    db.commit()


@router.get("/check-user-id", response_model=UserIdCheckResponse, summary="사용자ID 중복검사")
def check_user_id(user_id: str, db: DbSession) -> UserIdCheckResponse:
    exists = db.execute(select(User.id).where(User.user_id == user_id)).scalar_one_or_none()
    return UserIdCheckResponse(user_id=user_id, available=exists is None)


@router.post(
    "/register",
    response_model=MeResponse,
    status_code=status.HTTP_201_CREATED,
    summary="회원가입(승인 대기 상태로 생성)",
)
def register(payload: RegisterRequest, db: DbSession) -> MeResponse:
    org = db.get(Organization, payload.org_id)
    if org is None:
        raise bad_request("존재하지 않는 소속기관입니다.")

    duplicated = db.execute(
        select(User.id).where(User.user_id == payload.user_id)
    ).scalar_one_or_none()
    if duplicated is not None:
        raise bad_request("이미 사용 중인 사용자ID 입니다.")
    if (reason := complexity_error(payload.password)) is not None:
        raise bad_request(reason)

    user = User(
        user_id=payload.user_id,
        password_hash=hash_password(payload.password),
        org_id=payload.org_id,
        name=payload.name,
        phone=payload.phone,
        email=str(payload.email) if payload.email else None,
        status=UserStatus.PENDING,
    )
    # 모든 사용자는 기본 역할로 MEMBER 를 갖는다.
    user.roles.append(UserRole(role=Role.MEMBER))
    db.add(user)
    db.commit()
    db.refresh(user)
    return _me(user, org.name)


@router.post("/login", response_model=TokenResponse, summary="로그인")
def login(payload: LoginRequest, request: Request, db: DbSession) -> TokenResponse:
    user = db.execute(
        select(User).where(User.user_id == payload.user_id)
    ).scalar_one_or_none()

    if user is None or not verify_password(payload.password, user.password_hash):
        _log_login(
            db,
            request,
            attempted_user_id=payload.user_id,
            user_id=user.id if user else None,
            success=False,
            reason="자격 증명 불일치",
        )
        # 계정 존재 여부를 노출하지 않기 위해 동일한 메시지를 쓴다.
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="사용자ID 또는 비밀번호가 올바르지 않습니다.",
        )

    if user.status != UserStatus.APPROVED:
        _log_login(
            db,
            request,
            attempted_user_id=payload.user_id,
            user_id=user.id,
            success=False,
            reason="승인 대기",
        )
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="승인 대기 중인 계정입니다. 기관 관리자에게 문의하세요.",
        )

    _log_login(db, request, attempted_user_id=payload.user_id, user_id=user.id, success=True)

    org = db.get(Organization, user.org_id)
    token = create_access_token(
        user.id, roles=sorted(user.role_names), org_id=user.org_id
    )
    return TokenResponse(
        access_token=token,
        expires_in=settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60,
        user=_me(user, org.name if org else None),
    )


@router.get("/me", response_model=MeResponse, summary="내 정보")
def me(user: CurrentUser, db: DbSession) -> MeResponse:
    org = db.get(Organization, user.org_id)
    return _me(user, org.name if org else None)


@router.put("/me", response_model=MeResponse, summary="내 정보 변경")
def update_me(payload: ProfileUpdateRequest, user: CurrentUser, db: DbSession) -> MeResponse:
    """이름·연락처·이메일을 본인이 고친다.

    ``/users/{id}`` 를 쓰지 않는 이유는 커뮤니티 유저 때문이다 — 그 경로는
    울타리 밖이라 닿지 못하는데, 자기 정보 변경은 누구에게나 있어야 한다.
    소속과 역할은 여기서 못 바꾼다(그건 관리자의 일이다).
    """
    if payload.name is not None:
        user.name = payload.name.strip()
    if payload.phone is not None:
        user.phone = payload.phone.strip() or None
    if payload.email is not None:
        user.email = str(payload.email)
    db.commit()
    db.refresh(user)

    org = db.get(Organization, user.org_id)
    return _me(user, org.name if org else None)


@router.post("/change-password", response_model=Message, summary="비밀번호 변경")
def change_password(
    payload: PasswordChangeRequest, user: CurrentUser, db: DbSession
) -> Message:
    if not verify_password(payload.current_password, user.password_hash):
        raise bad_request("현재 비밀번호가 올바르지 않습니다.")
    if (reason := complexity_error(payload.new_password)) is not None:
        raise bad_request(reason)
    user.password_hash = hash_password(payload.new_password)
    db.commit()
    return Message(detail="비밀번호가 변경되었습니다.")
