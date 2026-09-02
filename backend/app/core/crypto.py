"""장치↔서버 제어 채널 암호화 (요구사항 제한사항 2).

모든 클라이언트 스택(JavaScript / .NET / Flutter)에서 표준 라이브러리만으로
구현 가능한 프리미티브만 사용한다.

- 키 유도: HKDF-SHA256(master_key, salt=device_code, info=INFO) -> 32 byte
- 암호화 : AES-256-GCM (nonce 12 byte, tag 16 byte)
- 전송형식: base64( VERSION(1) || nonce(12) || ciphertext || tag(16) )

장치별로 키가 갈리므로 한 장치의 키가 노출돼도 다른 장치 트래픽은 안전하다.
AAD 로 장치 고유번호를 묶어 다른 장치로의 메시지 재사용(치환)을 막는다.

포팅 참고
    JS      : crypto.subtle.deriveBits({name:'HKDF'...}) + AES-GCM
    .NET    : System.Security.Cryptography.HKDF + AesGcm
    Flutter : package:cryptography 의 Hkdf(Hmac.sha256()) + AesGcm.with256bits()
"""

from __future__ import annotations

import base64
import json
import os
from typing import Any

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.hkdf import HKDF

from app.core.config import settings

ENVELOPE_VERSION = 1
NONCE_SIZE = 12
KDF_INFO = b"signallink-device-channel-v1"


class DecryptError(Exception):
    """복호화 실패(키 불일치, 변조, 형식 오류)."""


def derive_device_key(device_code: str, master_key: str | None = None) -> bytes:
    """장치 고유번호로부터 32바이트 대칭키를 유도한다."""
    hkdf = HKDF(
        algorithm=hashes.SHA256(),
        length=32,
        salt=device_code.encode("utf-8"),
        info=KDF_INFO,
    )
    secret = (master_key or settings.DEVICE_MASTER_KEY).encode("utf-8")
    return hkdf.derive(secret)


def encrypt_for_device(device_code: str, payload: dict[str, Any]) -> str:
    """dict 를 JSON 직렬화 후 암호화해 base64 문자열로 반환한다."""
    key = derive_device_key(device_code)
    nonce = os.urandom(NONCE_SIZE)
    plaintext = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    ciphertext = AESGCM(key).encrypt(nonce, plaintext, device_code.encode("utf-8"))
    envelope = bytes([ENVELOPE_VERSION]) + nonce + ciphertext
    return base64.b64encode(envelope).decode("ascii")


def decrypt_from_device(device_code: str, token: str) -> dict[str, Any]:
    """base64 봉투를 복호화해 dict 로 반환한다."""
    try:
        envelope = base64.b64decode(token, validate=True)
    except (ValueError, TypeError) as exc:
        raise DecryptError("잘못된 base64 형식") from exc

    if len(envelope) < 1 + NONCE_SIZE + 16:
        raise DecryptError("봉투 길이가 too short")
    if envelope[0] != ENVELOPE_VERSION:
        raise DecryptError(f"지원하지 않는 봉투 버전: {envelope[0]}")

    nonce = envelope[1 : 1 + NONCE_SIZE]
    ciphertext = envelope[1 + NONCE_SIZE :]
    key = derive_device_key(device_code)
    try:
        plaintext = AESGCM(key).decrypt(nonce, ciphertext, device_code.encode("utf-8"))
    except InvalidTag as exc:
        raise DecryptError("인증 태그 불일치(키 오류 또는 변조)") from exc

    try:
        data = json.loads(plaintext.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise DecryptError("평문이 JSON 이 아님") from exc

    if not isinstance(data, dict):
        raise DecryptError("평문 JSON 이 객체가 아님")
    return data
