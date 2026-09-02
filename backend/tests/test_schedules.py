"""스케줄 버전 관리와 플레이어 동기화 검증(요구사항 제한사항 5, 6)."""

from __future__ import annotations

import pytest


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
            "os": "Android",
            "form_factor": "DID형",
            "panel_type": "PORTRAIT",
        },
    ).json()


@pytest.fixture
def schedule(client, super_headers, school_id) -> dict:
    response = client.post(
        "/api/v1/schedules",
        headers=super_headers,
        json={
            "name": "평일 스케줄",
            "kind": "시간지정",
            "org_id": school_id,
            "items": [
                {
                    "day_of_week": 0,
                    "start_time": "09:00:00",
                    "end_time": "12:00:00",
                    "content": {"version": 1, "elements": []},
                }
            ],
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


@pytest.fixture
def device_token(client, device) -> str:
    response = client.post(
        "/api/v1/player/provision", json={"device_code": device["device_code"]}
    )
    assert response.status_code == 200, response.text
    return response.json()["device_token"]


def _device_headers(token: str) -> dict[str, str]:
    return {"X-Device-Token": token}


def test_provision_requires_valid_device_code(client):
    response = client.post("/api/v1/player/provision", json={"device_code": "ZZZZ-ZZZ-ZZZ"})
    assert response.status_code == 401


def test_provision_returns_ws_url_and_token(client, device):
    body = client.post(
        "/api/v1/player/provision",
        json={"device_code": device["device_code"], "app_version": "1.0.0"},
    ).json()
    assert body["ws_url"].endswith("/api/v1/player/ws")
    assert body["device_token"]
    assert body["schedule_version"] == 0  # 스케줄 미배정


def test_unassigned_device_gets_demo_content(client, device_token):
    """스케줄 일련번호가 null 인 장치는 기본 데모를 출력한다."""
    payload = client.get(
        "/api/v1/player/schedule", headers=_device_headers(device_token)
    ).json()
    assert payload["is_demo"] is True
    assert payload["schedule_id"] is None
    assert len(payload["items"]) == 1
    assert payload["items"][0]["content"]["elements"]


def test_schedule_requires_device_token(client):
    assert client.get("/api/v1/player/schedule").status_code == 401
    assert (
        client.get(
            "/api/v1/player/schedule", headers=_device_headers("garbage")
        ).status_code
        == 401
    )


def test_cms_token_is_not_accepted_as_device_token(client, super_token):
    """CMS 사용자 토큰으로는 플레이어 API 를 쓸 수 없다."""
    response = client.get("/api/v1/player/schedule", headers=_device_headers(super_token))
    assert response.status_code == 401


def test_assigning_schedule_changes_payload(
    client, super_headers, device, schedule, device_token
):
    client.put(
        f"/api/v1/devices/{device['id']}/schedules",
        headers=super_headers,
        json={"schedule_ids": [schedule["id"]]},
    )
    payload = client.get(
        "/api/v1/player/schedule", headers=_device_headers(device_token)
    ).json()
    assert payload["is_demo"] is False
    assert payload["schedule_id"] == schedule["id"]
    assert payload["items"][0]["start_time"] == "09:00:00"


def test_heartbeat_signals_schedule_change(
    client, super_headers, device, schedule, device_token
):
    """하트비트에서 버전이 다르면 schedule_changed 가 True 여야 한다."""
    client.put(
        f"/api/v1/devices/{device['id']}/schedules",
        headers=super_headers,
        json={"schedule_ids": [schedule["id"]]},
    )
    # 장치가 스케줄을 받아 간다.
    payload = client.get(
        "/api/v1/player/schedule", headers=_device_headers(device_token)
    ).json()
    version = payload["version"]

    same = client.post(
        "/api/v1/player/heartbeat",
        headers=_device_headers(device_token),
        json={"schedule_version": version},
    ).json()
    assert same["schedule_changed"] is False

    # CMS 에서 스케줄을 수정하면 버전이 오른다.
    client.put(
        f"/api/v1/schedules/{schedule['id']}",
        headers=super_headers,
        json={"items": [{"day_of_week": -1, "duration_sec": 15, "content": {}}]},
    )

    changed = client.post(
        "/api/v1/player/heartbeat",
        headers=_device_headers(device_token),
        json={"schedule_version": version},
    ).json()
    assert changed["schedule_changed"] is True
    assert changed["schedule_version"] > version


def test_schedule_version_increases_on_every_update(client, super_headers, schedule):
    before = schedule["version"]
    for _ in range(3):
        client.put(
            f"/api/v1/schedules/{schedule['id']}",
            headers=super_headers,
            json={"name": "이름만 변경"},
        )
    after = client.get(f"/api/v1/schedules/{schedule['id']}", headers=super_headers).json()
    assert after["version"] == before + 3


def test_cannot_delete_schedule_in_use(client, super_headers, device, schedule):
    client.put(
        f"/api/v1/devices/{device['id']}/schedules",
        headers=super_headers,
        json={"schedule_ids": [schedule["id"]]},
    )
    response = client.delete(f"/api/v1/schedules/{schedule['id']}", headers=super_headers)
    assert response.status_code == 400
    assert "사용 중인 장치" in response.json()["detail"]


def test_unassigning_schedule_returns_device_to_demo(
    client, super_headers, device, schedule, device_token
):
    client.put(
        f"/api/v1/devices/{device['id']}/schedules",
        headers=super_headers,
        json={"schedule_ids": [schedule["id"]]},
    )
    client.put(
        f"/api/v1/devices/{device['id']}/schedules",
        headers=super_headers,
        json={"schedule_ids": []},
    )
    payload = client.get(
        "/api/v1/player/schedule", headers=_device_headers(device_token)
    ).json()
    assert payload["is_demo"] is True


def test_duplicate_copies_items(client, super_headers, schedule):
    copy = client.post(
        f"/api/v1/schedules/{schedule['id']}/duplicate", headers=super_headers
    ).json()
    assert copy["id"] != schedule["id"]
    assert copy["name"].endswith("(복사본)")
    assert len(copy["items"]) == len(schedule["items"])


def test_item_rejects_inverted_time_range(client, super_headers, school_id):
    response = client.post(
        "/api/v1/schedules",
        headers=super_headers,
        json={
            "name": "잘못된 스케줄",
            "org_id": school_id,
            "items": [
                {"day_of_week": 1, "start_time": "18:00:00", "end_time": "09:00:00"}
            ],
        },
    )
    assert response.status_code == 422


def test_blank_content_template(client, super_headers):
    doc = client.get(
        "/api/v1/schedules/content/blank",
        headers=super_headers,
        params={"width": 1080, "height": 1920},
    ).json()
    assert doc["layout"] == {"width": 1080, "height": 1920, "background": "#000000"}
    assert doc["elements"] == []
