"""장치 등록/권한/고유번호 요구사항 검증."""

from __future__ import annotations

import re

import pytest
from sqlalchemy import select

from app.models.device import Device
from app.models.enums import Role
from app.services.device_code import is_valid_device_code

DEVICE_CODE_PATTERN = re.compile(r"^[A-Z2-9]{4}-[A-Z2-9]{3}-[A-Z2-9]{3}$")


@pytest.fixture
def school_id(client, super_headers, root_org_id) -> int:
    response = client.post(
        "/api/v1/organizations",
        headers=super_headers,
        json={"name": "가나초등학교", "parent_id": root_org_id, "org_type": "학교"},
    )
    return response.json()["id"]


@pytest.fixture
def other_school_id(client, super_headers, root_org_id) -> int:
    response = client.post(
        "/api/v1/organizations",
        headers=super_headers,
        json={"name": "남의학교", "parent_id": root_org_id, "org_type": "학교"},
    )
    return response.json()["id"]


def _device_payload(org_id: int, **extra) -> dict:
    return {
        "org_id": org_id,
        "name": "1층 로비 DID",
        "os": "Windows",
        "form_factor": "DID형",
        "panel_type": "LANDSCAPE",
        "width": 1920,
        "height": 1080,
        **extra,
    }


def test_device_code_is_generated_in_required_format(client, super_headers, school_id):
    response = client.post(
        "/api/v1/devices", headers=super_headers, json=_device_payload(school_id)
    )
    assert response.status_code == 201, response.text
    code = response.json()["device_code"]

    # 4자리-3자리-3자리, 전부 대문자/숫자
    assert DEVICE_CODE_PATTERN.match(code), code
    assert len(code.replace("-", "")) == 10
    assert code == code.upper()
    assert is_valid_device_code(code)


def test_device_codes_are_unique(client, super_headers, school_id):
    codes = {
        client.post(
            "/api/v1/devices", headers=super_headers, json=_device_payload(school_id)
        ).json()["device_code"]
        for _ in range(25)
    }
    assert len(codes) == 25


def test_client_cannot_choose_device_code(client, super_headers, school_id, db):
    """장치 고유번호는 서버가 정한다. 입력값은 무시된다."""
    response = client.post(
        "/api/v1/devices",
        headers=super_headers,
        json=_device_payload(school_id, device_code="AAAA-BBB-CCC"),
    )
    assert response.status_code == 201
    assert response.json()["device_code"] != "AAAA-BBB-CCC"


def test_org_admin_cannot_register_device_in_other_org(
    client, school_id, other_school_id, make_user, login
):
    make_user("school_admin", school_id, [Role.ORG_ADMIN])
    headers = login("school_admin")

    assert (
        client.post("/api/v1/devices", headers=headers, json=_device_payload(school_id)).status_code
        == 201
    )
    denied = client.post(
        "/api/v1/devices", headers=headers, json=_device_payload(other_school_id)
    )
    assert denied.status_code == 403


def test_plain_member_cannot_register_device(client, school_id, make_user, login):
    make_user("plain", school_id, [])
    response = client.post(
        "/api/v1/devices", headers=login("plain"), json=_device_payload(school_id)
    )
    assert response.status_code == 403


def test_device_manager_sees_only_delegated_devices(
    client, super_headers, school_id, make_user, login, db
):
    device_a = client.post(
        "/api/v1/devices", headers=super_headers, json=_device_payload(school_id, name="A")
    ).json()
    device_b = client.post(
        "/api/v1/devices", headers=super_headers, json=_device_payload(school_id, name="B")
    ).json()

    manager_id = make_user("dev_manager", school_id, [Role.DEVICE_MANAGER])
    assign = client.put(
        f"/api/v1/devices/{device_a['id']}/managers",
        headers=super_headers,
        json={"user_ids": [manager_id]},
    )
    assert assign.status_code == 200, assign.text

    headers = login("dev_manager")
    visible = client.get("/api/v1/devices", headers=headers).json()["items"]
    assert [d["id"] for d in visible] == [device_a["id"]]

    # 위임받지 않은 장치는 조회도 수정도 불가하다.
    assert client.get(f"/api/v1/devices/{device_b['id']}", headers=headers).status_code == 403
    assert (
        client.put(
            f"/api/v1/devices/{device_b['id']}", headers=headers, json={"name": "탈취"}
        ).status_code
        == 403
    )
    # 위임받은 장치는 수정 가능하다.
    assert (
        client.put(
            f"/api/v1/devices/{device_a['id']}", headers=headers, json={"name": "변경됨"}
        ).status_code
        == 200
    )


def test_one_device_can_be_delegated_to_multiple_managers(
    client, super_headers, school_id, make_user
):
    device = client.post(
        "/api/v1/devices", headers=super_headers, json=_device_payload(school_id)
    ).json()
    first = make_user("mgr1", school_id, [Role.DEVICE_MANAGER])
    second = make_user("mgr2", school_id, [Role.DEVICE_MANAGER])

    response = client.put(
        f"/api/v1/devices/{device['id']}/managers",
        headers=super_headers,
        json={"user_ids": [first, second]},
    )
    assert response.status_code == 200

    managers = client.get(
        f"/api/v1/devices/{device['id']}/managers", headers=super_headers
    ).json()
    assert {m["id"] for m in managers} == {first, second}


def test_delegation_requires_device_manager_role(client, super_headers, school_id, make_user):
    device = client.post(
        "/api/v1/devices", headers=super_headers, json=_device_payload(school_id)
    ).json()
    plain_id = make_user("nodev", school_id, [])

    response = client.put(
        f"/api/v1/devices/{device['id']}/managers",
        headers=super_headers,
        json={"user_ids": [plain_id]},
    )
    assert response.status_code == 400
    assert "DEVICE_MANAGER" in response.json()["detail"]


def test_device_manager_cannot_delete_device(
    client, super_headers, school_id, make_user, login
):
    """등록/삭제 권한은 기관관리자와 슈퍼관리자만 갖는다."""
    device = client.post(
        "/api/v1/devices", headers=super_headers, json=_device_payload(school_id)
    ).json()
    manager_id = make_user("dev_manager", school_id, [Role.DEVICE_MANAGER])
    client.put(
        f"/api/v1/devices/{device['id']}/managers",
        headers=super_headers,
        json={"user_ids": [manager_id]},
    )
    response = client.delete(f"/api/v1/devices/{device['id']}", headers=login("dev_manager"))
    assert response.status_code == 403


def test_new_device_has_no_schedule(client, super_headers, school_id, db):
    device = client.post(
        "/api/v1/devices", headers=super_headers, json=_device_payload(school_id)
    ).json()
    assert device["schedules"] == []
    stored = db.execute(select(Device).where(Device.id == device["id"])).scalar_one()
    assert stored.schedule_links == []
