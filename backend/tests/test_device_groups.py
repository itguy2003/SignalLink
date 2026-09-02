"""장치그룹 검증.

장치그룹은 **사용자 개인의** 묶음이다. 남의 그룹은 보이지도 고쳐지지도
않아야 하고, 담을 수 있는 장치는 그 사용자가 볼 수 있는 장치뿐이다.
"""

from __future__ import annotations

import pytest

from app.models.enums import Role


@pytest.fixture
def school_id(client, super_headers, root_org_id) -> int:
    return client.post(
        "/api/v1/organizations",
        headers=super_headers,
        json={"name": "가나초등학교", "parent_id": root_org_id, "org_type": "학교"},
    ).json()["id"]


@pytest.fixture
def other_school_id(client, super_headers, root_org_id) -> int:
    return client.post(
        "/api/v1/organizations",
        headers=super_headers,
        json={"name": "다라중학교", "parent_id": root_org_id, "org_type": "학교"},
    ).json()["id"]


@pytest.fixture
def make_device(client, super_headers):
    def _make(org_id: int, name: str) -> dict:
        response = client.post(
            "/api/v1/devices",
            headers=super_headers,
            json={"org_id": org_id, "name": name, "os": "Windows", "form_factor": "DID형"},
        )
        assert response.status_code == 201, response.text
        return response.json()

    return _make


@pytest.fixture
def devices(make_device, school_id) -> list[dict]:
    return [make_device(school_id, f"로비 DID {i}") for i in range(3)]


def _create(client, headers, name: str, device_ids: list[int]):
    return client.post(
        "/api/v1/device-groups", headers=headers, json={"name": name, "device_ids": device_ids}
    )


# ------------------------------------------------------------------ 기본 동작
def test_create_group_with_devices(client, super_headers, devices):
    response = _create(client, super_headers, "1층 전체", [devices[0]["id"], devices[1]["id"]])
    assert response.status_code == 201, response.text

    body = response.json()
    assert body["name"] == "1층 전체"
    assert body["device_ids"] == [devices[0]["id"], devices[1]["id"]]


def test_create_empty_group(client, super_headers):
    # 먼저 만들어 두고 나중에 장치를 담는 흐름을 막을 이유가 없다.
    response = _create(client, super_headers, "빈 그룹", [])
    assert response.status_code == 201
    assert response.json()["device_ids"] == []


def test_duplicate_device_ids_are_collapsed(client, super_headers, devices):
    # 같은 장치를 두 번 담으면 UNIQUE 제약에 걸려 저장이 통째로 실패한다.
    device_id = devices[0]["id"]
    response = _create(client, super_headers, "중복", [device_id, device_id])
    assert response.status_code == 201, response.text
    assert response.json()["device_ids"] == [device_id]


def test_list_returns_own_groups(client, super_headers, devices):
    _create(client, super_headers, "A", [devices[0]["id"]])
    _create(client, super_headers, "B", [])

    groups = client.get("/api/v1/device-groups", headers=super_headers).json()
    assert [g["name"] for g in groups] == ["A", "B"]


def test_update_name_and_members(client, super_headers, devices):
    group = _create(client, super_headers, "원래 이름", [devices[0]["id"]]).json()

    response = client.put(
        f"/api/v1/device-groups/{group['id']}",
        headers=super_headers,
        json={"name": "바꾼 이름", "device_ids": [devices[1]["id"], devices[2]["id"]]},
    )
    assert response.status_code == 200, response.text

    body = response.json()
    assert body["name"] == "바꾼 이름"
    assert body["device_ids"] == [devices[1]["id"], devices[2]["id"]]


def test_update_name_only_keeps_members(client, super_headers, devices):
    # device_ids 를 안 보내면 구성원을 건드리지 않는다(None 과 빈 리스트는 다르다).
    group = _create(client, super_headers, "이름", [devices[0]["id"]]).json()

    body = client.put(
        f"/api/v1/device-groups/{group['id']}", headers=super_headers, json={"name": "새 이름"}
    ).json()
    assert body["device_ids"] == [devices[0]["id"]]


def test_empty_list_clears_members(client, super_headers, devices):
    group = _create(client, super_headers, "이름", [devices[0]["id"]]).json()

    body = client.put(
        f"/api/v1/device-groups/{group['id']}", headers=super_headers, json={"device_ids": []}
    ).json()
    assert body["device_ids"] == []


def test_delete_group(client, super_headers, devices):
    group = _create(client, super_headers, "지울 그룹", [devices[0]["id"]]).json()

    assert (
        client.delete(f"/api/v1/device-groups/{group['id']}", headers=super_headers).status_code
        == 200
    )
    assert client.get("/api/v1/device-groups", headers=super_headers).json() == []


def test_deleting_group_keeps_devices(client, super_headers, devices):
    # 그룹은 묶음일 뿐이다. 지운다고 장치가 사라지면 안 된다.
    group = _create(client, super_headers, "지울 그룹", [devices[0]["id"]]).json()
    client.delete(f"/api/v1/device-groups/{group['id']}", headers=super_headers)

    page = client.get("/api/v1/devices", headers=super_headers).json()
    assert len(page["items"]) == 3


def test_deleting_device_removes_it_from_group(client, super_headers, devices):
    _create(client, super_headers, "그룹", [devices[0]["id"], devices[1]["id"]])
    client.delete(f"/api/v1/devices/{devices[0]['id']}", headers=super_headers)

    after = client.get("/api/v1/device-groups", headers=super_headers).json()[0]
    assert after["device_ids"] == [devices[1]["id"]]


def test_missing_group_is_404(client, super_headers):
    assert client.put(
        "/api/v1/device-groups/999", headers=super_headers, json={"name": "x"}
    ).status_code == 404
    assert client.delete("/api/v1/device-groups/999", headers=super_headers).status_code == 404


# ------------------------------------------------------------------ 권한
def test_cannot_add_unknown_device(client, super_headers):
    response = _create(client, super_headers, "그룹", [9999])
    assert response.status_code == 400
    assert "존재하지 않는" in response.json()["detail"]


def test_cannot_add_device_outside_scope(
    client, other_school_id, make_device, school_id, make_user, login
):
    # 다른 학교 장치는 보이지도 않으므로 그룹에도 담을 수 없어야 한다.
    outsider_device = make_device(other_school_id, "남의 장치")
    make_user("teacher", school_id, [Role.HOMEROOM_TEACHER])

    response = _create(client, login("teacher"), "몰래", [outsider_device["id"]])
    assert response.status_code == 403


def test_groups_are_private(client, super_headers, devices, school_id, make_user, login):
    # 장치그룹은 사용자 개인의 묶음이다. 남의 그룹이 목록에 섞이면 안 된다.
    _create(client, super_headers, "관리자 그룹", [devices[0]["id"]])
    make_user("teacher", school_id, [Role.HOMEROOM_TEACHER])

    assert client.get("/api/v1/device-groups", headers=login("teacher")).json() == []


def test_cannot_edit_someone_elses_group(client, super_headers, devices, school_id, make_user, login):
    group = _create(client, super_headers, "관리자 그룹", [devices[0]["id"]]).json()
    make_user("teacher", school_id, [Role.HOMEROOM_TEACHER])
    headers = login("teacher")

    assert (
        client.put(
            f"/api/v1/device-groups/{group['id']}", headers=headers, json={"name": "가로채기"}
        ).status_code
        == 403
    )
    assert (
        client.delete(f"/api/v1/device-groups/{group['id']}", headers=headers).status_code == 403
    )


def test_each_user_keeps_own_groups(client, super_headers, devices, school_id, make_user, login):
    make_user("teacher", school_id, [Role.HOMEROOM_TEACHER])
    headers = login("teacher")

    _create(client, super_headers, "관리자 그룹", [devices[0]["id"]])
    _create(client, headers, "교사 그룹", [devices[1]["id"]])

    assert [g["name"] for g in client.get("/api/v1/device-groups", headers=headers).json()] == [
        "교사 그룹"
    ]
    assert [
        g["name"] for g in client.get("/api/v1/device-groups", headers=super_headers).json()
    ] == ["관리자 그룹"]
