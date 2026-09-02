"""비밀번호 해싱과 CMS 사용자용 JWT.

bcrypt 는 72바이트를 넘는 입력을 잘라내므로, 긴 비밀번호에서 서로 다른 값이
같은 해시가 되는 것을 막기 위해 SHA-256 으로 선해싱한 뒤 base64 로 넘긴다
(Django 의 bcrypt_sha256 과 동일한 방식).
"""

from __future__ import annotations

import base64
import hashlib
from datetime import UTC, datetime, timedelta
from typing import Any

import bcrypt
import jwt

from app.core.config import settings


def _prehash(password: str) -> bytes:
    digest = hashlib.sha256(password.encode("utf-8")).digest()
    return base64.b64encode(digest)


def hash_password(password: str) -> str:
    return bcrypt.hashpw(_prehash(password), bcrypt.gensalt()).decode("ascii")


def verify_password(password: str, password_hash: str) -> bool:
    try:
        return bcrypt.checkpw(_prehash(password), password_hash.encode("ascii"))
    except (ValueError, TypeError):
        return False


def create_access_token(
    subject: str | int,
    *,
    roles: list[str],
    org_id: int,
    expires_delta: timedelta | None = None,
) -> str:
    expire = datetime.now(UTC) + (
        expires_delta or timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    )
    payload: dict[str, Any] = {
        "sub": str(subject),
        "roles": roles,
        "org": org_id,
        "exp": expire,
        "iat": datetime.now(UTC),
        "typ": "access",
    }
    return jwt.encode(payload, settings.SECRET_KEY, algorithm=settings.ALGORITHM)


def decode_access_token(token: str) -> dict[str, Any] | None:
    try:
        return jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
    except jwt.PyJWTError:
        return None
