"""장치 인증 (요구사항 제한사항 3).

장치는 기동 시 장치 고유번호로 서버 인증을 받고 세션 토큰을 발급받는다.
이후 REST 요청은 ``X-Device-Token`` 헤더로, WebSocket 은 접속 시 토큰으로 인증한다.

CMS 사용자 토큰과 서명 키는 같지만 ``typ`` 클레임으로 구분하며,
서로의 엔드포인트에서 사용할 수 없다.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import jwt
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.device import Device

DEVICE_TOKEN_TTL = timedelta(days=30)
TOKEN_TYPE = "device"


class DeviceAuthError(Exception):
    pass


def create_device_token(device: Device) -> str:
    now = datetime.now(UTC)
    payload = {
        "sub": str(device.id),
        "code": device.device_code,
        "org": device.org_id,
        "typ": TOKEN_TYPE,
        "iat": now,
        "exp": now + DEVICE_TOKEN_TTL,
    }
    return jwt.encode(payload, settings.SECRET_KEY, algorithm=settings.ALGORITHM)


def resolve_device(db: Session, token: str) -> Device:
    """장치 토큰을 검증하고 해당 장치를 반환한다."""
    try:
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
    except jwt.PyJWTError as exc:
        raise DeviceAuthError("장치 토큰이 유효하지 않습니다.") from exc

    if payload.get("typ") != TOKEN_TYPE:
        raise DeviceAuthError("장치 토큰이 아닙니다.")

    device = db.get(Device, int(payload["sub"]))
    if device is None:
        raise DeviceAuthError("등록되지 않은 장치입니다.")
    # 장치가 삭제 후 재등록되면 고유번호가 달라진다. 토큰에 박힌 코드와 대조한다.
    if device.device_code != payload.get("code"):
        raise DeviceAuthError("장치 고유번호가 일치하지 않습니다.")
    return device


def authenticate_by_code(db: Session, device_code: str) -> Device:
    device = db.execute(
        select(Device).where(Device.device_code == device_code.strip().upper())
    ).scalar_one_or_none()
    if device is None:
        raise DeviceAuthError("등록되지 않은 장치 고유번호입니다.")
    return device
