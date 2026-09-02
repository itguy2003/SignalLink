"""장치 채널 암호화 검증(요구사항 제한사항 2)."""

from __future__ import annotations

import base64

import pytest

from app.core.crypto import (
    DecryptError,
    decrypt_from_device,
    derive_device_key,
    encrypt_for_device,
)


def test_roundtrip():
    payload = {"type": "heartbeat", "schedule_version": 7, "메시지": "한글도 된다"}
    token = encrypt_for_device("ABCD-EFG-HJK", payload)
    assert decrypt_from_device("ABCD-EFG-HJK", token) == payload


def test_ciphertext_is_not_plaintext():
    token = encrypt_for_device("ABCD-EFG-HJK", {"secret": "값"})
    assert "secret" not in base64.b64decode(token).decode("latin-1")


def test_nonce_makes_each_envelope_unique():
    """같은 평문이라도 매번 다른 봉투가 나온다(재전송 구분 가능)."""
    payloads = {encrypt_for_device("ABCD-EFG-HJK", {"a": 1}) for _ in range(10)}
    assert len(payloads) == 10


def test_key_is_per_device():
    assert derive_device_key("AAAA-BBB-CCC") != derive_device_key("AAAA-BBB-CCD")


def test_message_for_one_device_cannot_be_read_by_another():
    token = encrypt_for_device("AAAA-BBB-CCC", {"command": "restart"})
    with pytest.raises(DecryptError):
        decrypt_from_device("AAAA-BBB-CCD", token)


def test_tampered_envelope_is_rejected():
    token = encrypt_for_device("AAAA-BBB-CCC", {"command": "restart"})
    raw = bytearray(base64.b64decode(token))
    raw[-1] ^= 0xFF  # 인증 태그 변조
    with pytest.raises(DecryptError):
        decrypt_from_device("AAAA-BBB-CCC", base64.b64encode(bytes(raw)).decode())


def test_unknown_envelope_version_is_rejected():
    token = encrypt_for_device("AAAA-BBB-CCC", {"a": 1})
    raw = bytearray(base64.b64decode(token))
    raw[0] = 99
    with pytest.raises(DecryptError, match="봉투 버전"):
        decrypt_from_device("AAAA-BBB-CCC", base64.b64encode(bytes(raw)).decode())


def test_garbage_input_is_rejected():
    with pytest.raises(DecryptError):
        decrypt_from_device("AAAA-BBB-CCC", "not-base64!!!")
    with pytest.raises(DecryptError):
        decrypt_from_device("AAAA-BBB-CCC", base64.b64encode(b"short").decode())


def test_derived_key_length_is_256_bits():
    assert len(derive_device_key("AAAA-BBB-CCC")) == 32
