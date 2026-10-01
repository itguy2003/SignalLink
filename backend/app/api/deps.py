"""API 의존성: 인증된 사용자 주입과 역할 가드."""

from __future__ import annotations

from collections.abc import Callable, Iterable
from typing import Annotated

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app.core.security import decode_access_token
from app.db.session import get_db
from app.models.enums import Role, UserStatus
from app.models.user import User

bearer_scheme = HTTPBearer(auto_error=False)

DbSession = Annotated[Session, Depends(get_db)]


def get_current_user(
    db: DbSession,
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer_scheme)],
) -> User:
    if credentials is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="인증 정보가 없습니다.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    payload = decode_access_token(credentials.credentials)
    if payload is None or payload.get("typ") != "access":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="토큰이 유효하지 않거나 만료되었습니다.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    user = db.get(User, int(payload["sub"]))
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="사용자를 찾을 수 없습니다."
        )
    if user.status != UserStatus.APPROVED:
        # 승인 전 계정은 토큰을 받았더라도(예: 승인 후 취소) 사용할 수 없다.
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="승인 대기 중인 계정입니다."
        )

    # 2026-10 개편: 커뮤니티 유저 역할이 사라지면서 경로 울타리도 함께
    # 걷어냈다 — 커뮤니티는 모든 승인 사용자의 공간이다.
    return user


CurrentUser = Annotated[User, Depends(get_current_user)]


def get_optional_user(
    db: DbSession,
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer_scheme)],
) -> User | None:
    """토큰이 있으면 사용자, 없거나 잘못됐으면 None.

    사용자와 장치가 함께 부르는 경로에 쓴다(자산 파일 내려받기). 여기서
    401 을 던지면 장치 토큰으로 온 요청이 사용자 인증에서 먼저 막힌다.
    """
    if credentials is None:
        return None
    try:
        return get_current_user(db=db, credentials=credentials)
    except HTTPException:
        return None


OptionalUser = Annotated[User | None, Depends(get_optional_user)]


def require_roles(*roles: Role) -> Callable[[User], User]:
    """지정한 역할 중 하나라도 가진 사용자만 통과시킨다."""
    allowed: set[str] = {str(r) for r in roles}

    def _guard(user: CurrentUser) -> User:
        if not (allowed & user.role_names):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"권한이 없습니다. 필요한 역할: {', '.join(sorted(allowed))}",
            )
        return user

    return _guard


def forbid(detail: str = "권한이 없습니다.") -> HTTPException:
    return HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=detail)


def not_found(what: str) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_404_NOT_FOUND, detail=f"{what}을(를) 찾을 수 없습니다."
    )


def bad_request(detail: str) -> HTTPException:
    return HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=detail)


def roles_of(user: User) -> list[str]:
    return sorted(user.role_names)


def ensure_unique_roles(roles: Iterable[str]) -> list[str]:
    """중복 제거 + 유효성 검사. MEMBER 는 항상 포함된다."""
    valid = {str(r) for r in Role}
    result: set[str] = {str(Role.MEMBER)}
    for role in roles:
        if role not in valid:
            raise bad_request(f"알 수 없는 역할입니다: {role}")
        result.add(role)
    return sorted(result)
