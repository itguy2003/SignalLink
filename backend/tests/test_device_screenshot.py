"""장치 원격 제어 명령과 화면 캡처 검증.

명령은 WebSocket 으로만 나간다 — 하트비트로 대신 전달할 수 없으므로
접속하지 않은 장치에는 성공했다고 말하면 안 된다.
"""

from __future__ import annotations

import pytest

from app.api.v1.devices import DEVICE_COMMANDS
from app.api.v1.player import ALLOWED_SCREENSHOT_TYPES, MAX_SCREENSHOT_BYTES

WS_PATH = "/api/v1/player/ws"

#: 최소한의 유효 PNG. 내용은 중요하지 않고 바이트가 그대로 오가는지만 본다.
PNG = bytes.fromhex(
    "89504e470d0a1a0a0000000d494844520000000100000001080600000"
    "01f15c4890000000a49444154789c6360000002000100ffff03000006"
    "00057b7d5e0000000049454e44ae426082"
)


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
def device_token(client, device) -> str:
    return client.post(
        "/api/v1/player/provision", json={"device_code": device["device_code"]}
    ).json()["device_token"]


def _upload(client, token: str, data: bytes = PNG, content_type: str = "image/png"):
    return client.post(
        "/api/v1/player/screenshot",
        headers={"X-Device-Token": token},
        files={"file": ("shot.png", data, content_type)},
    )


# ------------------------------------------------------------------ 제어 명령
def test_supported_commands():
    # 플레이어가 이 문자열을 그대로 받아 처리한다. 바꾸면 모든 플레이어를 고쳐야 한다.
    assert set(DEVICE_COMMANDS) == {"reload", "restart", "shutdown", "screenshot"}


@pytest.mark.parametrize("command", ["reload", "restart", "shutdown", "screenshot"])
def test_offline_device_rejects_command(client, super_headers, device, command):
    # 명령은 WebSocket 으로만 나간다. 접속 안 한 장치에 성공했다고 하면 안 된다.
    response = client.post(
        f"/api/v1/devices/{device['id']}/command",
        headers=super_headers,
        params={"command": command},
    )
    assert response.status_code == 400
    assert "접속" in response.json()["detail"]


def test_unknown_command_is_rejected(client, super_headers, device):
    response = client.post(
        f"/api/v1/devices/{device['id']}/command",
        headers=super_headers,
        params={"command": "포맷"},
    )
    assert response.status_code == 400
    assert "지원하지 않는" in response.json()["detail"]


@pytest.mark.parametrize("command", ["reload", "restart", "shutdown", "screenshot"])
def test_online_device_receives_command(client, super_headers, device, device_token, command):
    from app.core.crypto import decrypt_from_device

    code = device["device_code"]
    with client.websocket_connect(f"{WS_PATH}?token={device_token}") as ws:
        ws.receive_text()  # welcome

        response = client.post(
            f"/api/v1/devices/{device['id']}/command",
            headers=super_headers,
            params={"command": command},
        )
        assert response.status_code == 200, response.text

        message = decrypt_from_device(code, ws.receive_text())

    assert message["type"] == "command"
    assert message["command"] == command


def test_command_message_says_what_was_sent(client, super_headers, device, device_token):
    with client.websocket_connect(f"{WS_PATH}?token={device_token}") as ws:
        ws.receive_text()
        response = client.post(
            f"/api/v1/devices/{device['id']}/command",
            headers=super_headers,
            params={"command": "shutdown"},
        )
    # 코드가 아니라 사람이 읽는 이름으로 알려 준다.
    assert "끄기" in response.json()["detail"]


def test_command_requires_permission(client, device, make_user, login, school_id):
    make_user("plain", school_id, [])
    headers = login("plain")
    response = client.post(
        f"/api/v1/devices/{device['id']}/command", headers=headers, params={"command": "reload"}
    )
    assert response.status_code == 403


# ------------------------------------------------------------------ 캡처 업로드
def test_device_uploads_screenshot(client, super_headers, device, device_token):
    assert _upload(client, device_token).status_code == 200

    response = client.get(f"/api/v1/devices/{device['id']}/screenshot", headers=super_headers)
    assert response.status_code == 200
    assert response.content == PNG
    assert response.headers["content-type"] == "image/png"


def test_screenshot_is_not_cached(client, super_headers, device, device_token):
    # 같은 URL 로 계속 갱신된다. 캐시가 남으면 옛 화면이 보인다.
    _upload(client, device_token)
    response = client.get(f"/api/v1/devices/{device['id']}/screenshot", headers=super_headers)
    assert response.headers["cache-control"] == "no-store"


def test_upload_replaces_previous(client, super_headers, device, device_token):
    # 장치당 한 장만 둔다. 쌓아 두면 지우는 일이 따라온다.
    _upload(client, device_token, PNG)
    _upload(client, device_token, PNG + b"\x00", "image/png")

    response = client.get(f"/api/v1/devices/{device['id']}/screenshot", headers=super_headers)
    assert response.content == PNG + b"\x00"


def test_capture_time_appears_in_device_list(client, super_headers, device, device_token):
    # 카드가 '언제 찍은 화면인지' 를 이 값으로 보여 준다.
    before = client.get("/api/v1/devices", headers=super_headers).json()["items"][0]
    assert before["screenshot_at"] is None

    _upload(client, device_token)

    after = client.get("/api/v1/devices", headers=super_headers).json()["items"][0]
    assert after["screenshot_at"] is not None


def test_device_list_does_not_carry_image(client, super_headers, device, device_token):
    # 이미지까지 실으면 장치 200대 목록이 수십 MB 가 된다.
    _upload(client, device_token)
    row = client.get("/api/v1/devices", headers=super_headers).json()["items"][0]
    assert "image" not in row


def test_missing_screenshot_is_404(client, super_headers, device):
    response = client.get(f"/api/v1/devices/{device['id']}/screenshot", headers=super_headers)
    assert response.status_code == 404


def test_upload_requires_device_token(client, device):
    response = client.post(
        "/api/v1/player/screenshot",
        headers={"X-Device-Token": "garbage"},
        files={"file": ("shot.png", PNG, "image/png")},
    )
    assert response.status_code == 401


def test_rejects_unsupported_image_type(client, device_token):
    # 브라우저가 <img> 로 바로 그릴 수 있는 형식만 받는다.
    response = _upload(client, device_token, b"GIF89a", "image/gif")
    assert response.status_code == 400
    assert "image/gif" in response.json()["detail"]


def test_allowed_types():
    assert set(ALLOWED_SCREENSHOT_TYPES) == {"image/jpeg", "image/png", "image/webp"}


def test_rejects_empty_file(client, device_token):
    assert _upload(client, device_token, b"").status_code == 400


def test_rejects_oversized_file(client, device_token):
    # 상한이 없으면 장치 하나가 무압축 PNG 로 DB 를 채울 수 있다.
    response = _upload(client, device_token, b"\x00" * (MAX_SCREENSHOT_BYTES + 1))
    assert response.status_code == 413


def test_upload_counts_as_being_alive(client, super_headers, device, device_token):
    _upload(client, device_token)
    row = client.get("/api/v1/devices", headers=super_headers).json()["items"][0]
    assert row["last_seen_at"] is not None


def test_screenshot_requires_view_permission(
    client, super_headers, root_org_id, device, device_token, make_user, login
):
    # 다른 학교 소속 사용자에게는 남의 장치 화면이 보이면 안 된다.
    _upload(client, device_token)
    other_school = client.post(
        "/api/v1/organizations",
        headers=super_headers,
        json={"name": "다라중학교", "parent_id": root_org_id, "org_type": "학교"},
    ).json()["id"]
    make_user("outsider", other_school, [])

    response = client.get(
        f"/api/v1/devices/{device['id']}/screenshot", headers=login("outsider")
    )
    assert response.status_code == 403


def test_deleting_device_removes_screenshot(client, super_headers, device, device_token, db):
    from app.models.device import DeviceScreenshot

    _upload(client, device_token)
    assert client.delete(f"/api/v1/devices/{device['id']}", headers=super_headers).status_code == 200

    # 장치가 사라지면 캡처도 함께 사라져야 한다(ON DELETE CASCADE).
    assert db.get(DeviceScreenshot, device["id"]) is None
