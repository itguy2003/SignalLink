"""장치 저장공간 보고와 사용률 경고 검증.

``Device.storage`` 는 등록 시 사람이 적어 넣는 사양 문자열이라 계산에 쓸 수
없다. 사용률은 장치가 하트비트로 보고한 바이트 값에서만 나온다.
"""

from __future__ import annotations

import pytest

from app.core.crypto import decrypt_from_device, encrypt_for_device
from app.services import storage

WS_PATH = "/api/v1/player/ws"

GB = 1000**3


@pytest.fixture
def school_id(client, super_headers, root_org_id) -> int:
    return client.post(
        "/api/v1/organizations",
        headers=super_headers,
        json={"name": "가나초등학교", "parent_id": root_org_id, "org_type": "학교"},
    ).json()["id"]


@pytest.fixture
def device(client, super_headers, school_id) -> dict:
    return client.post(
        "/api/v1/devices",
        headers=super_headers,
        json={
            "org_id": school_id,
            "name": "로비 DID",
            "os": "Windows",
            "form_factor": "DID형",
            "storage": "256GB",
        },
    ).json()


@pytest.fixture
def device_token(client, device) -> str:
    return client.post(
        "/api/v1/player/provision", json={"device_code": device["device_code"]}
    ).json()["device_token"]


def _beat(client, token: str, **body) -> dict:
    response = client.post(
        "/api/v1/player/heartbeat", headers={"X-Device-Token": token}, json=body
    )
    assert response.status_code == 200, response.text
    return response.json()


def _device_out(client, super_headers, device_id: int) -> dict:
    return client.get(f"/api/v1/devices/{device_id}", headers=super_headers).json()


# ------------------------------------------------------------------ 순수 계산
@pytest.mark.parametrize(
    ("total", "free", "expected"),
    [
        (100, 20, 0.8),
        (100, 100, 0.0),
        (100, 0, 1.0),
        (256 * GB, 51 * GB, pytest.approx(0.80078125)),
    ],
)
def test_usage_ratio(total, free, expected):
    assert storage.usage_ratio(total, free) == expected


@pytest.mark.parametrize(
    ("total", "free"),
    [
        (None, 10),
        (100, None),
        (None, None),
        (0, 0),  # 전체가 0 이면 나눌 수 없다
        (-1, 0),
        (100, -1),
        (100, 200),  # 여유가 전체보다 큰 앞뒤 안 맞는 보고
    ],
)
def test_usage_ratio_is_none_when_uncomputable(total, free):
    # None 은 '미보고'다. 0 으로 갈음하면 여유로운 장치와 구분되지 않는다.
    assert storage.usage_ratio(total, free) is None


def test_used_bytes():
    assert storage.used_bytes(100, 30) == 70
    assert storage.used_bytes(100, None) is None


def test_warning_threshold_is_80_percent():
    assert storage.WARN_THRESHOLD == 0.8
    assert storage.is_warning(0.8) is True
    assert storage.is_warning(0.7999) is False
    assert storage.is_warning(1.0) is True


def test_unreported_does_not_warn():
    # 모르는 것은 나쁜 것이 아니다. 미보고를 경고로 올리면 전부 빨개진다.
    assert storage.is_warning(None) is False


# ------------------------------------------------------------------ REST 하트비트
def test_heartbeat_records_storage(client, super_headers, device, device_token):
    _beat(client, device_token, storage_total_bytes=256 * GB, storage_free_bytes=100 * GB)

    out = _device_out(client, super_headers, device["id"])
    assert out["storage_total_bytes"] == 256 * GB
    assert out["storage_free_bytes"] == 100 * GB
    assert out["storage_used_bytes"] == 156 * GB
    assert out["storage_reported_at"] is not None


def test_usage_and_warning_are_computed_by_server(client, super_headers, device, device_token):
    # 임계 기준을 화면마다 두면 갈라진다. 서버가 판정해서 내려준다.
    _beat(client, device_token, storage_total_bytes=100 * GB, storage_free_bytes=15 * GB)

    out = _device_out(client, super_headers, device["id"])
    assert out["storage_usage"] == pytest.approx(0.85)
    assert out["storage_warning"] is True


def test_below_threshold_does_not_warn(client, super_headers, device, device_token):
    _beat(client, device_token, storage_total_bytes=100 * GB, storage_free_bytes=50 * GB)

    out = _device_out(client, super_headers, device["id"])
    assert out["storage_usage"] == pytest.approx(0.5)
    assert out["storage_warning"] is False


def test_exactly_80_percent_warns(client, super_headers, device, device_token):
    _beat(client, device_token, storage_total_bytes=100 * GB, storage_free_bytes=20 * GB)
    assert _device_out(client, super_headers, device["id"])["storage_warning"] is True


def test_device_without_report_is_unknown(client, super_headers, device):
    out = _device_out(client, super_headers, device["id"])
    assert out["storage_total_bytes"] is None
    assert out["storage_usage"] is None
    assert out["storage_warning"] is False
    # 사람이 적어 넣은 사양 문자열은 그대로 남는다. 둘은 다른 값이다.
    assert out["storage"] == "256GB"


def test_partial_report_is_ignored(client, super_headers, device, device_token):
    # 반쪽만 갱신하면 이전 보고의 나머지 절반과 섞여 있지도 않은 사용률이 나온다.
    _beat(client, device_token, storage_total_bytes=100 * GB, storage_free_bytes=50 * GB)
    _beat(client, device_token, storage_total_bytes=200 * GB)

    out = _device_out(client, super_headers, device["id"])
    assert out["storage_total_bytes"] == 100 * GB
    assert out["storage_free_bytes"] == 50 * GB


def test_heartbeat_without_storage_keeps_previous(client, super_headers, device, device_token):
    _beat(client, device_token, storage_total_bytes=100 * GB, storage_free_bytes=10 * GB)
    _beat(client, device_token, app_version="1.3.0")

    out = _device_out(client, super_headers, device["id"])
    assert out["storage_warning"] is True
    assert out["app_version"] == "1.3.0"


def test_negative_storage_is_rejected(client, device_token):
    response = client.post(
        "/api/v1/player/heartbeat",
        headers={"X-Device-Token": device_token},
        json={"storage_total_bytes": -1, "storage_free_bytes": 0},
    )
    assert response.status_code == 422


def test_storage_appears_in_device_list(client, super_headers, device, device_token):
    # 대시보드는 목록 API 를 쓴다. 상세에만 있으면 경고가 뜨지 않는다.
    _beat(client, device_token, storage_total_bytes=100 * GB, storage_free_bytes=5 * GB)

    page = client.get("/api/v1/devices", headers=super_headers).json()
    row = next(d for d in page["items"] if d["id"] == device["id"])
    assert row["storage_warning"] is True
    assert row["storage_usage"] == pytest.approx(0.95)


def test_admin_cannot_set_reported_storage(client, super_headers, device):
    # 실측값을 손으로 고칠 수 있으면 경고가 의미를 잃는다.
    client.put(
        f"/api/v1/devices/{device['id']}",
        headers=super_headers,
        json={"storage_total_bytes": 999, "storage_free_bytes": 0},
    )
    assert _device_out(client, super_headers, device["id"])["storage_total_bytes"] is None


# ------------------------------------------------------------------ WS 하트비트
@pytest.fixture
def provisioned(client, device) -> dict:
    body = client.post(
        "/api/v1/player/provision", json={"device_code": device["device_code"]}
    ).json()
    return {"device": device, **body}


def _ws_beat(client, provisioned, payload: dict) -> dict:
    code = provisioned["device_code"]
    with client.websocket_connect(f"{WS_PATH}?token={provisioned['device_token']}") as ws:
        ws.receive_text()  # welcome
        ws.send_text(encrypt_for_device(code, {"type": "heartbeat", **payload}))
        return decrypt_from_device(code, ws.receive_text())


def test_ws_heartbeat_records_storage(client, super_headers, provisioned):
    # REST 와 갈라지면 WebSocket 을 쓰는 장치만 사용률이 빈다.
    ack = _ws_beat(
        client, provisioned, {"storage_total_bytes": 100 * GB, "storage_free_bytes": 5 * GB}
    )
    assert ack["type"] == "heartbeat_ack"

    out = _device_out(client, super_headers, provisioned["device"]["id"])
    assert out["storage_warning"] is True


@pytest.mark.parametrize(
    "payload",
    [
        {"storage_total_bytes": "많음", "storage_free_bytes": "조금"},
        {"storage_total_bytes": -5, "storage_free_bytes": 1},
        {"storage_total_bytes": True, "storage_free_bytes": False},
    ],
)
def test_ws_heartbeat_survives_bad_storage_values(client, super_headers, provisioned, payload):
    # WS 메시지는 Pydantic 검증을 거치지 않는다. 저장공간은 부가 정보이므로
    # 값이 이상해도 하트비트 자체는 살아 있어야 한다.
    ack = _ws_beat(client, provisioned, payload)
    assert ack["type"] == "heartbeat_ack"

    out = _device_out(client, super_headers, provisioned["device"]["id"])
    assert out["storage_total_bytes"] is None
