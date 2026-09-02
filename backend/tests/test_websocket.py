"""장치 WebSocket 제어 채널 검증.

핸드셰이크 이후 모든 메시지가 암호화되어 오가는지, 하트비트가
스케줄 변경을 알리는지 확인한다(요구사항 제한사항 2, 5).
"""

from __future__ import annotations

import pytest
from starlette.websockets import WebSocketDisconnect

from app.core.crypto import decrypt_from_device, encrypt_for_device

WS_PATH = "/api/v1/player/ws"


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
        json={"org_id": school_id, "name": "로비 DID", "os": "Windows", "form_factor": "DID형"},
    ).json()


@pytest.fixture
def provisioned(client, device) -> dict:
    body = client.post(
        "/api/v1/player/provision", json={"device_code": device["device_code"]}
    ).json()
    return {"device": device, **body}


def test_connection_requires_valid_token(client):
    with (
        pytest.raises(WebSocketDisconnect) as exc,
        client.websocket_connect(f"{WS_PATH}?token=invalid"),
    ):
        pass
    assert exc.value.code == 4401


def test_welcome_message_is_encrypted(client, provisioned):
    code = provisioned["device_code"]
    with client.websocket_connect(f"{WS_PATH}?token={provisioned['device_token']}") as ws:
        raw = ws.receive_text()
        # 평문 JSON 이 아니어야 한다.
        assert not raw.startswith("{")
        welcome = decrypt_from_device(code, raw)
        assert welcome["type"] == "welcome"
        assert welcome["device_id"] == provisioned["device_id"]
        assert welcome["heartbeat_interval_sec"] > 0


def test_heartbeat_reports_no_change_when_versions_match(client, provisioned):
    code = provisioned["device_code"]
    with client.websocket_connect(f"{WS_PATH}?token={provisioned['device_token']}") as ws:
        welcome = decrypt_from_device(code, ws.receive_text())
        version = welcome["schedule_version"]

        ws.send_text(
            encrypt_for_device(code, {"type": "heartbeat", "schedule_version": version})
        )
        ack = decrypt_from_device(code, ws.receive_text())
        assert ack["type"] == "heartbeat_ack"
        assert ack["schedule_changed"] is False


def test_heartbeat_detects_schedule_change(client, super_headers, school_id, provisioned):
    """장치가 들고 있는 버전과 서버 버전이 다르면 재수신하라고 알린다."""
    code = provisioned["device_code"]
    schedule = client.post(
        "/api/v1/schedules",
        headers=super_headers,
        json={"name": "새 스케줄", "org_id": school_id, "items": []},
    ).json()
    client.put(
        f"/api/v1/devices/{provisioned['device']['id']}/schedules",
        headers=super_headers,
        json={"schedule_ids": [schedule["id"]]},
    )

    with client.websocket_connect(f"{WS_PATH}?token={provisioned['device_token']}") as ws:
        ws.receive_text()  # welcome
        # 장치는 아직 데모(버전 0)를 재생 중이라고 보고한다.
        ws.send_text(encrypt_for_device(code, {"type": "heartbeat", "schedule_version": 0}))
        ack = decrypt_from_device(code, ws.receive_text())
        assert ack["schedule_changed"] is True

        # 스케줄을 여러 개 배정할 수 있게 되면서 버전은 배정 전체를 합친 값이다.
        # 값 자체에 의미는 없고, 장치가 그 값을 되돌려 보내면 '변경 없음' 이어야 한다.
        assert ack["schedule_version"] != 0
        ws.send_text(
            encrypt_for_device(
                code, {"type": "heartbeat", "schedule_version": ack["schedule_version"]}
            )
        )
        again = decrypt_from_device(code, ws.receive_text())
        assert again["schedule_changed"] is False


def test_plaintext_message_closes_connection(client, provisioned):
    """복호화할 수 없는 메시지를 보내면 채널을 끊는다."""
    with client.websocket_connect(f"{WS_PATH}?token={provisioned['device_token']}") as ws:
        ws.receive_text()  # welcome
        ws.send_text('{"type": "heartbeat"}')  # 평문
        with pytest.raises(WebSocketDisconnect) as exc:
            ws.receive_text()
        assert exc.value.code == 4400


def test_unknown_message_type_returns_error(client, provisioned):
    code = provisioned["device_code"]
    with client.websocket_connect(f"{WS_PATH}?token={provisioned['device_token']}") as ws:
        ws.receive_text()  # welcome
        ws.send_text(encrypt_for_device(code, {"type": "무엇인가"}))
        response = decrypt_from_device(code, ws.receive_text())
        assert response["type"] == "error"


def test_hub_tracks_online_state(client, provisioned):
    assert client.get("/api/v1/player/stats").json()["online_count"] == 0
    with client.websocket_connect(f"{WS_PATH}?token={provisioned['device_token']}") as ws:
        ws.receive_text()
        assert client.get("/api/v1/player/stats").json()["online_count"] == 1
    # 연결이 닫히면 목록에서 빠진다.
    assert client.get("/api/v1/player/stats").json()["online_count"] == 0
