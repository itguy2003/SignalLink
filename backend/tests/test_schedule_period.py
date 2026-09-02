"""스케줄 사용 기간과 장치의 다중 스케줄 배정 검증.

두 기능은 함께 쓰라고 만든 것이다 — 행사 기간용과 평상시용을 한 장치에
같이 걸어 두고, 기간으로 언제 무엇이 나갈지 갈리게 한다.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest

from app.models.device import Device
from app.services import schedule_service

NOW = datetime(2026, 6, 15, 12, 0, tzinfo=UTC)


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
def make_schedule(client, super_headers, school_id):
    def _make(name: str, **extra) -> dict:
        response = client.post(
            "/api/v1/schedules",
            headers=super_headers,
            json={
                "name": name,
                "kind": "목록반복",
                "org_id": school_id,
                "items": [{"day_of_week": -1, "duration_sec": 10, "content": {"version": 1}}],
                **extra,
            },
        )
        assert response.status_code == 201, response.text
        return response.json()

    return _make


def _assign(client, headers, device_id: int, schedule_ids: list[int]):
    return client.put(
        f"/api/v1/devices/{device_id}/schedules",
        headers=headers,
        json={"schedule_ids": schedule_ids},
    )


def _device_token(client, device: dict) -> dict[str, str]:
    token = client.post(
        "/api/v1/player/provision", json={"device_code": device["device_code"]}
    ).json()["device_token"]
    return {"X-Device-Token": token}


# ------------------------------------------------------------------ 기간 저장
def test_period_defaults_to_unlimited(make_schedule):
    body = make_schedule("무기한")
    assert body["start_at"] is None
    assert body["end_at"] is None


def test_period_is_saved(make_schedule):
    body = make_schedule(
        "행사", start_at="2026-10-01T00:00:00Z", end_at="2026-10-31T23:59:59Z"
    )
    assert body["start_at"].startswith("2026-10-01")
    assert body["end_at"].startswith("2026-10-31")


def test_end_must_follow_start(client, super_headers, school_id):
    response = client.post(
        "/api/v1/schedules",
        headers=super_headers,
        json={
            "name": "거꾸로",
            "org_id": school_id,
            "start_at": "2026-10-31T00:00:00Z",
            "end_at": "2026-10-01T00:00:00Z",
        },
    )
    assert response.status_code == 422


def test_partial_update_compares_with_stored_end(client, super_headers, make_schedule):
    """한쪽만 고쳐도 이미 저장된 반대쪽과 견뎌야 한다.

    행사 일정을 미룰 때 시작만 보내는 일이 흔하다. 페이로드 안에서만 앞뒤를
    보면 뒤집힌 기간이 저장되고, 그 스케줄은 언제나 '기간 밖'이 되어 아무
    때도 표출되지 않는다 — 저장은 성공했는데 화면만 안 나온다.
    """
    schedule = make_schedule("행사", start_at="2026-10-01T00:00:00Z", end_at="2026-10-10T00:00:00Z")
    response = client.put(
        f"/api/v1/schedules/{schedule['id']}",
        headers=super_headers,
        json={"start_at": "2026-10-20T00:00:00Z"},
    )
    assert response.status_code == 400


def test_partial_update_compares_with_stored_start(client, super_headers, make_schedule):
    schedule = make_schedule("행사", start_at="2026-10-20T00:00:00Z")
    response = client.put(
        f"/api/v1/schedules/{schedule['id']}",
        headers=super_headers,
        json={"end_at": "2026-10-01T00:00:00Z"},
    )
    assert response.status_code == 400


def test_clearing_one_side_lifts_the_check(client, super_headers, make_schedule):
    # 반대쪽을 지우면서 이쪽을 옮기는 것은 막을 이유가 없다.
    schedule = make_schedule("행사", start_at="2026-10-01T00:00:00Z", end_at="2026-10-10T00:00:00Z")
    response = client.put(
        f"/api/v1/schedules/{schedule['id']}",
        headers=super_headers,
        json={"start_at": "2026-10-20T00:00:00Z", "end_at": None},
    )
    assert response.status_code == 200
    assert response.json()["end_at"] is None


def test_period_can_be_changed(client, super_headers, make_schedule):
    """기간을 넣은 채로 수정할 수 있어야 한다.

    행사가 밀리는 일이 잦아 만든 뒤에 기간만 고치는 경우가 가장 흔하다.
    """
    schedule = make_schedule("행사", start_at="2026-10-01T00:00:00Z")
    body = client.put(
        f"/api/v1/schedules/{schedule['id']}",
        headers=super_headers,
        json={"start_at": "2026-11-01T00:00:00Z", "end_at": "2026-11-30T00:00:00Z"},
    ).json()
    assert body["start_at"].startswith("2026-11-01")
    assert body["end_at"].startswith("2026-11-30")


def test_period_can_be_cleared(client, super_headers, make_schedule):
    # null 은 '제한 없음'이라는 뜻이므로 보내온 null 도 반영해야 한다.
    schedule = make_schedule("행사", start_at="2026-10-01T00:00:00Z")
    body = client.put(
        f"/api/v1/schedules/{schedule['id']}",
        headers=super_headers,
        json={"start_at": None},
    ).json()
    assert body["start_at"] is None


def test_duplicate_keeps_period(client, super_headers, make_schedule):
    # 복사본이 무기한이 되면 지난 행사 안내가 다시 나간다.
    schedule = make_schedule("행사", start_at="2026-10-01T00:00:00Z", end_at="2026-10-31T00:00:00Z")
    copy = client.post(
        f"/api/v1/schedules/{schedule['id']}/duplicate", headers=super_headers
    ).json()
    assert copy["start_at"] == schedule["start_at"]
    assert copy["end_at"] == schedule["end_at"]


# ------------------------------------------------------------------ 기간 판정
def _schedule_obj(db, schedule_id: int):
    from app.models.schedule import Schedule

    return db.get(Schedule, schedule_id)


def test_is_active_without_period(db, make_schedule):
    schedule = _schedule_obj(db, make_schedule("무기한")["id"])
    assert schedule_service.is_active(schedule, NOW) is True


def test_is_active_before_start(db, make_schedule):
    schedule = _schedule_obj(db, make_schedule("미래", start_at="2026-12-01T00:00:00Z")["id"])
    assert schedule_service.is_active(schedule, NOW) is False


def test_is_active_after_end(db, make_schedule):
    schedule = _schedule_obj(db, make_schedule("과거", end_at="2026-01-01T00:00:00Z")["id"])
    assert schedule_service.is_active(schedule, NOW) is False


def test_is_active_inside_period(db, make_schedule):
    schedule = _schedule_obj(
        db,
        make_schedule("진행중", start_at="2026-06-01T00:00:00Z", end_at="2026-07-01T00:00:00Z")[
            "id"
        ],
    )
    assert schedule_service.is_active(schedule, NOW) is True


# ------------------------------------------------------------------ 다중 배정
def test_assign_multiple_schedules(client, super_headers, device, make_schedule):
    a = make_schedule("평상시")
    b = make_schedule("행사")

    body = _assign(client, super_headers, device["id"], [a["id"], b["id"]]).json()
    assert [s["name"] for s in body["schedules"]] == ["평상시", "행사"]


def test_assignment_order_is_priority(client, super_headers, device, make_schedule):
    # 같은 시각에 둘 다 유효하면 앞의 것이 먼저 나간다.
    a = make_schedule("첫째")
    b = make_schedule("둘째")

    body = _assign(client, super_headers, device["id"], [b["id"], a["id"]]).json()
    assert [s["name"] for s in body["schedules"]] == ["둘째", "첫째"]


def test_duplicate_ids_are_collapsed(client, super_headers, device, make_schedule):
    # UNIQUE 제약에 걸려 저장이 통째로 실패하는 것을 막는다.
    schedule = make_schedule("하나")
    body = _assign(client, super_headers, device["id"], [schedule["id"], schedule["id"]]).json()
    assert len(body["schedules"]) == 1


def test_assignment_replaces_previous(client, super_headers, device, make_schedule):
    a = make_schedule("이전")
    b = make_schedule("이후")
    _assign(client, super_headers, device["id"], [a["id"]])

    body = _assign(client, super_headers, device["id"], [b["id"]]).json()
    assert [s["name"] for s in body["schedules"]] == ["이후"]


def test_empty_list_clears_assignment(client, super_headers, device, make_schedule):
    schedule = make_schedule("하나")
    _assign(client, super_headers, device["id"], [schedule["id"]])

    body = _assign(client, super_headers, device["id"], []).json()
    assert body["schedules"] == []


def test_unknown_schedule_is_rejected(client, super_headers, device):
    assert _assign(client, super_headers, device["id"], [9999]).status_code == 400


def test_active_flag_is_reported(client, super_headers, device, make_schedule):
    # 걸려 있지만 지금은 안 나가는 상태를 화면이 구분할 수 있어야 한다.
    past = make_schedule("지난 행사", end_at="2020-01-01T00:00:00Z")
    now_on = make_schedule("평상시")

    body = _assign(client, super_headers, device["id"], [past["id"], now_on["id"]]).json()
    by_name = {s["name"]: s["active"] for s in body["schedules"]}
    assert by_name == {"지난 행사": False, "평상시": True}


def test_unassigned_filter_uses_link_table(client, super_headers, device, make_schedule):
    schedule = make_schedule("하나")
    before = client.get("/api/v1/devices", headers=super_headers, params={"unassigned": True})
    assert any(d["id"] == device["id"] for d in before.json()["items"])

    _assign(client, super_headers, device["id"], [schedule["id"]])
    after = client.get("/api/v1/devices", headers=super_headers, params={"unassigned": True})
    assert all(d["id"] != device["id"] for d in after.json()["items"])


def test_schedule_filter_uses_link_table(client, super_headers, device, make_schedule):
    schedule = make_schedule("하나")
    _assign(client, super_headers, device["id"], [schedule["id"]])

    page = client.get(
        "/api/v1/devices", headers=super_headers, params={"schedule_id": schedule["id"]}
    ).json()
    assert [d["id"] for d in page["items"]] == [device["id"]]


def test_bulk_assign_replaces_for_all(client, super_headers, school_id, make_schedule):
    devices = [
        client.post(
            "/api/v1/devices",
            headers=super_headers,
            json={"org_id": school_id, "name": f"장치{i}", "os": "Windows", "form_factor": "DID형"},
        ).json()
        for i in range(2)
    ]
    a = make_schedule("A")
    b = make_schedule("B")

    client.post(
        "/api/v1/devices/schedule/bulk",
        headers=super_headers,
        json={"device_ids": [d["id"] for d in devices], "schedule_ids": [a["id"], b["id"]]},
    )
    for device in devices:
        body = client.get(f"/api/v1/devices/{device['id']}", headers=super_headers).json()
        assert [s["name"] for s in body["schedules"]] == ["A", "B"]


# ------------------------------------------------------------------ 페이로드
def test_payload_merges_active_schedules(client, super_headers, device, make_schedule):
    a = make_schedule("평상시")
    b = make_schedule("행사")
    _assign(client, super_headers, device["id"], [a["id"], b["id"]])

    payload = client.get("/api/v1/player/schedule", headers=_device_token(client, device)).json()
    # 아이템이 합쳐져 내려온다. 플레이어가 보는 모양은 예전과 같다.
    assert len(payload["items"]) == 2
    assert payload["is_demo"] is False
    assert "평상시" in payload["name"] and "행사" in payload["name"]


def test_payload_skips_schedules_out_of_period(client, super_headers, device, make_schedule):
    # 기간이 지난 스케줄은 배정돼 있어도 나가지 않는다.
    past = make_schedule("지난 행사", end_at="2020-01-01T00:00:00Z")
    live = make_schedule("평상시")
    _assign(client, super_headers, device["id"], [past["id"], live["id"]])

    payload = client.get("/api/v1/player/schedule", headers=_device_token(client, device)).json()
    assert payload["name"] == "평상시"
    assert len(payload["items"]) == 1


def test_all_out_of_period_falls_back_to_demo(client, super_headers, device, make_schedule):
    # 검은 화면 대신 기본 데모를 튼다.
    past = make_schedule("지난 행사", end_at="2020-01-01T00:00:00Z")
    _assign(client, super_headers, device["id"], [past["id"]])

    payload = client.get("/api/v1/player/schedule", headers=_device_token(client, device)).json()
    assert payload["is_demo"] is True


def test_demo_from_expired_period_keeps_a_version(client, super_headers, device, make_schedule):
    """기간 밖이라 데모를 틀어도 버전은 0 이 아니어야 한다.

    0 이면 '배정 없음' 과 같아져, 기간이 시작될 때 장치가 변경을 알아채지 못한다.
    """
    future = make_schedule("다음 행사", start_at="2030-01-01T00:00:00Z")
    _assign(client, super_headers, device["id"], [future["id"]])

    payload = client.get("/api/v1/player/schedule", headers=_device_token(client, device)).json()
    assert payload["is_demo"] is True
    assert payload["version"] != 0


# ------------------------------------------------------------------ 합성 버전
def test_version_changes_when_a_member_schedule_changes(
    client, super_headers, db, device, make_schedule
):
    a = make_schedule("A")
    _assign(client, super_headers, device["id"], [a["id"]])
    stored = db.get(Device, device["id"])
    before = schedule_service.current_version(db, stored)

    client.put(f"/api/v1/schedules/{a['id']}", headers=super_headers, json={"name": "A 수정"})
    db.expire_all()
    assert schedule_service.current_version(db, db.get(Device, device["id"])) != before


def test_version_changes_when_assignment_set_changes(
    client, super_headers, db, device, make_schedule
):
    a = make_schedule("A")
    b = make_schedule("B")
    _assign(client, super_headers, device["id"], [a["id"]])
    db.expire_all()
    before = schedule_service.current_version(db, db.get(Device, device["id"]))

    _assign(client, super_headers, device["id"], [a["id"], b["id"]])
    db.expire_all()
    assert schedule_service.current_version(db, db.get(Device, device["id"])) != before


def test_version_changes_at_period_boundary(client, super_headers, db, device, make_schedule):
    """기간이 시작·종료되는 순간에는 어떤 레코드도 바뀌지 않는다.

    버전을 내용만으로 만들면 장치는 그 변화를 영영 알아채지 못한다.
    """
    start = NOW + timedelta(days=1)
    schedule = make_schedule("예정", start_at=start.isoformat().replace("+00:00", "Z"))
    _assign(client, super_headers, device["id"], [schedule["id"]])
    stored = db.get(Device, device["id"])

    before_start = schedule_service.current_version(db, stored, NOW)
    after_start = schedule_service.current_version(db, stored, start + timedelta(hours=1))
    assert before_start != after_start


def test_no_assignment_is_demo_version(db, device):
    assert schedule_service.current_version(db, db.get(Device, device["id"])) == 0
