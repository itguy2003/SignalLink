"""소속기관 공지 검증.

기간이 정해진 재생목록 형태다 — 슬라이드마다 편집기 문서를 인라인으로 갖고,
순서와 유지 시간으로 순환한다. 저장은 아이템 전체 교체이고, 고칠 때마다
version 이 올라 표출 쪽이 변경을 감지한다.
"""

from __future__ import annotations

import pytest


@pytest.fixture
def office_id(client, super_headers, root_org_id) -> int:
    return client.post(
        "/api/v1/organizations",
        headers=super_headers,
        json={"name": "공지교육청", "parent_id": root_org_id, "org_type": "기관"},
    ).json()["id"]


def _doc(text: str) -> dict:
    return {
        "version": 1,
        "layout": {"width": 1920, "height": 1080, "background": "#000000"},
        "elements": [
            {
                "id": "e1",
                "type": "text",
                "rect": {"x": 0, "y": 0, "w": 400, "h": 100, "z": 1},
                "options": {"text": text},
            }
        ],
    }


def _make(client, headers, org_id, name="9월 공지", **extra):  # noqa: ANN001
    return client.post(
        "/api/v1/org-notices", headers=headers, json={"org_id": org_id, "name": name, **extra}
    )


def test_create_starts_empty(client, super_headers, office_id):
    response = _make(client, super_headers, office_id, start_date="2026-09-01", end_date="2026-09-30")
    assert response.status_code == 201, response.text
    body = response.json()
    assert body["items"] == []
    assert body["item_count"] == 0
    assert body["start_date"] == "2026-09-01T00:00"


def test_bad_period_is_rejected(client, super_headers, office_id):
    response = _make(client, super_headers, office_id, start_date="2026/09/01")
    assert response.status_code == 400
    assert "YYYY-MM-DD" in response.json()["detail"]


def test_period_accepts_time_and_expands_dates(client, super_headers, office_id):
    """기간은 분 단위 — 날짜만 보내면 시작 00:00 / 종료 23:59 로 넓혀 저장한다."""
    dated = _make(
        client, super_headers, office_id, start_date="2026-09-01", end_date="2026-09-30"
    ).json()
    assert dated["start_date"] == "2026-09-01T00:00"
    assert dated["end_date"] == "2026-09-30T23:59"

    timed = _make(
        client,
        super_headers,
        office_id,
        name="시간 공지",
        start_date="2026-09-01T09:00",
        end_date="2026-09-01T15:30",
    ).json()
    assert timed["start_date"] == "2026-09-01T09:00"
    assert timed["end_date"] == "2026-09-01T15:30"


def test_items_are_replaced_in_order(client, super_headers, office_id):
    notice = _make(client, super_headers, office_id).json()

    updated = client.put(
        f"/api/v1/org-notices/{notice['id']}",
        headers=super_headers,
        json={
            "items": [
                {"duration_sec": 10, "document": _doc("첫 장")},
                {"duration_sec": 20, "document": _doc("둘째 장")},
            ]
        },
    ).json()
    assert [i["sort_order"] for i in updated["items"]] == [0, 1]
    assert updated["items"][1]["duration_sec"] == 20

    # 순서를 뒤집어 다시 저장 — 전체 교체이므로 그대로 반영된다.
    flipped = client.put(
        f"/api/v1/org-notices/{notice['id']}",
        headers=super_headers,
        json={
            "items": [
                {"duration_sec": 20, "document": _doc("둘째 장")},
                {"duration_sec": 10, "document": _doc("첫 장")},
            ]
        },
    ).json()
    texts = [i["document"]["elements"][0]["options"]["text"] for i in flipped["items"]]
    assert texts == ["둘째 장", "첫 장"]


def test_every_edit_bumps_the_version(client, super_headers, office_id):
    notice = _make(client, super_headers, office_id).json()
    assert notice["version"] == 1

    renamed = client.put(
        f"/api/v1/org-notices/{notice['id']}", headers=super_headers, json={"name": "10월 공지"}
    ).json()
    assert renamed["version"] == 2


def test_clearing_the_period_with_empty_strings(client, super_headers, office_id):
    notice = _make(client, super_headers, office_id, start_date="2026-09-01").json()
    cleared = client.put(
        f"/api/v1/org-notices/{notice['id']}",
        headers=super_headers,
        json={"start_date": "", "end_date": ""},
    ).json()
    assert cleared["start_date"] is None


def test_scoped_to_the_requested_org(client, super_headers, office_id, root_org_id):
    _make(client, super_headers, office_id)
    _make(client, super_headers, root_org_id, name="최상위 공지")

    rows = client.get(
        f"/api/v1/org-notices?org_id={office_id}", headers=super_headers
    ).json()
    assert [row["name"] for row in rows] == ["9월 공지"]


def test_for_org_includes_ancestor_notices(
    client, super_headers, office_id, root_org_id, make_user, login
):
    """스케줄 편집기용 for_org 조회 — 자기 것 + 상위기관이 내린 공지까지."""
    school_id = client.post(
        "/api/v1/organizations",
        headers=super_headers,
        json={"name": "공지구성원학교", "parent_id": office_id, "org_type": "기관"},
    ).json()["id"]
    _make(client, super_headers, root_org_id, name="최상위 공지")
    _make(client, super_headers, office_id, name="교육청 공지")
    _make(client, super_headers, school_id, name="학교 공지")

    make_user("school-member", school_id, [])
    headers = login("school-member")

    rows = client.get(f"/api/v1/org-notices?for_org={school_id}", headers=headers).json()
    # 자기 것 먼저, 그다음 가까운 상위 순.
    assert [row["name"] for row in rows] == ["학교 공지", "교육청 공지", "최상위 공지"]
    assert rows[1]["org_name"] == "공지교육청"

    # 상위기관 공지의 상세(슬라이드)도 하위에서 읽을 수 있어야 담는다.
    ancestor = next(row for row in rows if row["name"] == "교육청 공지")
    assert (
        client.get(f"/api/v1/org-notices/{ancestor['id']}", headers=headers).status_code == 200
    )
    # 관리 화면(org_id 조회)은 여전히 관리 범위를 요구한다.
    assert (
        client.get(f"/api/v1/org-notices?org_id={office_id}", headers=headers).status_code == 403
    )


def test_management_requires_org_admin(client, super_headers, office_id, make_user, login):
    make_user("viewer", office_id, [])
    notice = _make(client, super_headers, office_id).json()

    headers = login("viewer")
    # 같은 기관 구성원은 볼 수 있다.
    assert client.get(f"/api/v1/org-notices/{notice['id']}", headers=headers).status_code == 200
    # 만들고 고치는 것은 기관 관리자의 일이다.
    assert _make(client, headers, office_id, name="몰래").status_code == 403
    assert (
        client.put(
            f"/api/v1/org-notices/{notice['id']}", headers=headers, json={"name": "가로채기"}
        ).status_code
        == 403
    )


def test_delete_removes_items_too(client, super_headers, office_id):
    notice = _make(client, super_headers, office_id).json()
    client.put(
        f"/api/v1/org-notices/{notice['id']}",
        headers=super_headers,
        json={"items": [{"duration_sec": 10, "document": _doc("한 장")}]},
    )

    assert (
        client.delete(f"/api/v1/org-notices/{notice['id']}", headers=super_headers).status_code
        == 200
    )
    assert (
        client.get(f"/api/v1/org-notices/{notice['id']}", headers=super_headers).status_code == 404
    )
