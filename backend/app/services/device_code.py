"""장치 고유번호 생성.

요구사항: 문자+숫자 10자리, ``4자리-3자리-3자리`` 포맷, 전부 대문자, 전역 유일.

설치 기사가 장치 화면의 코드를 손으로 옮겨 적는 경우가 많아
혼동하기 쉬운 글자(I, O, 0, 1)는 알파벳에서 제외했다. 32자 알파벳 10자리이므로
경우의 수는 약 1.1e15 로 충돌 확률은 무시할 수 있으나, 유일성은 DB UNIQUE 제약과
재시도 루프로 보장한다.
"""

from __future__ import annotations

import secrets

from sqlalchemy import select
from sqlalchemy.orm import Session

ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
MAX_ATTEMPTS = 20


def format_code(raw: str) -> str:
    """10자 원문을 ``XXXX-XXX-XXX`` 로 포맷한다."""
    if len(raw) != 10:
        raise ValueError("장치 고유번호 원문은 10자여야 한다")
    return f"{raw[:4]}-{raw[4:7]}-{raw[7:]}"


def generate_raw() -> str:
    return "".join(secrets.choice(ALPHABET) for _ in range(10))


def generate_unique_device_code(db: Session) -> str:
    """DB 에 존재하지 않는 장치 고유번호를 생성한다."""
    from app.models.device import Device

    for _ in range(MAX_ATTEMPTS):
        code = format_code(generate_raw())
        exists = db.execute(
            select(Device.id).where(Device.device_code == code)
        ).scalar_one_or_none()
        if exists is None:
            return code
    raise RuntimeError("장치 고유번호 생성에 반복 실패했다")


def is_valid_device_code(code: str) -> bool:
    parts = code.split("-")
    if len(parts) != 3 or [len(p) for p in parts] != [4, 3, 3]:
        return False
    return all(ch in ALPHABET for ch in "".join(parts))
