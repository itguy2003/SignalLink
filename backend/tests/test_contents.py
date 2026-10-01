"""콘텐츠 라이브러리와 주간 편집기 저장 규칙 검증."""

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
def other_school_id(client, super_headers, root_org_id) -> int:
    return client.post(
        "/api/v1/organizations",
        headers=super_headers,
        json={"name": "남의학교", "parent_id": root_org_id, "org_type": "학교"},
    ).json()["id"]


DOC = {
    "version": 1,
    "layout": {"width": 1920, "height": 1080, "background": "#0f172a"},
    "elements": [
        {
            "id": "e1",
            "type": "text",
            "rect": {"x": 0, "y": 0, "w": 100, "h": 50, "z": 1},
            "options": {"text": "안녕하세요"},
        }
    ],
}


@pytest.fixture
def content(client, super_headers, school_id) -> dict:
    response = client.post(
        "/api/v1/contents",
        headers=super_headers,
        json={"name": "아침 알림판", "org_id": school_id, "document": DOC},
    )
    assert response.status_code == 201, response.text
    return response.json()


@pytest.fixture
def schedule(client, super_headers, school_id) -> dict:
    return client.post(
        "/api/v1/schedules",
        headers=super_headers,
        json={"name": "주간 스케줄", "kind": "시간지정", "org_id": school_id, "items": []},
    ).json()


@pytest.fixture
def device(client, super_headers, school_id) -> dict:
    return client.post(
        "/api/v1/devices",
        headers=super_headers,
        json={"org_id": school_id, "name": "로비 DID", "os": "Windows", "form_factor": "DID형"},
    ).json()


def _device_headers(client, device) -> dict[str, str]:
    token = client.post(
        "/api/v1/player/provision", json={"device_code": device["device_code"]}
    ).json()["device_token"]
    return {"X-Device-Token": token}


def test_create_content_without_document_starts_empty(client, super_headers, school_id):
    body = client.post(
        "/api/v1/contents",
        headers=super_headers,
        json={"name": "빈 콘텐츠", "org_id": school_id, "width": 1080, "height": 1920},
    ).json()
    assert body["document"]["elements"] == []
    assert body["document"]["layout"] == {
        "width": 1080,
        "height": 1920,
        "background": "#000000",
    }


def test_list_returns_summary_without_document(client, super_headers, content):
    page = client.get("/api/v1/contents", headers=super_headers).json()
    assert page["total"] == 1
    item = page["items"][0]
    # 브라우저 목록은 문서 본문을 싣지 않는다(카드 렌더링에 필요한 요약만).
    assert "document" not in item
    assert item["element_count"] == 1
    assert item["background"] == "#0f172a"


def test_orientation_filter(client, super_headers, school_id, content):
    client.post(
        "/api/v1/contents",
        headers=super_headers,
        json={"name": "세로형", "org_id": school_id, "width": 1080, "height": 1920},
    )
    landscape = client.get(
        "/api/v1/contents", headers=super_headers, params={"orientation": "landscape"}
    ).json()
    portrait = client.get(
        "/api/v1/contents", headers=super_headers, params={"orientation": "portrait"}
    ).json()
    assert [c["name"] for c in landscape["items"]] == ["아침 알림판"]
    assert [c["name"] for c in portrait["items"]] == ["세로형"]


def test_content_scoped_to_managed_orgs(client, super_headers, other_school_id, content, make_user, login):
    make_user("outsider", other_school_id, [])
    page = client.get("/api/v1/contents", headers=login("outsider")).json()
    assert page["total"] == 0


def test_player_receives_referenced_document_inlined(
    client, super_headers, schedule, content, device
):
    """플레이어 계약은 그대로다 — 참조는 서버가 풀어서 content 에 담아 보낸다."""
    client.put(
        f"/api/v1/schedules/{schedule['id']}",
        headers=super_headers,
        json={
            "items": [
                {
                    "day_of_week": 0,
                    "start_time": "09:00:00",
                    "end_time": "12:00:00",
                    "content_id": content["id"],
                }
            ]
        },
    )
    client.put(
        f"/api/v1/devices/{device['id']}/schedules",
        headers=super_headers,
        json={"schedule_ids": [schedule["id"]]},
    )

    payload = client.get(
        "/api/v1/player/schedule", headers=_device_headers(client, device)
    ).json()
    item = payload["items"][0]
    assert item["content"] == DOC
    assert item["content_id"] == content["id"]


def test_cms_response_carries_content_name_for_blocks(
    client, super_headers, schedule, content
):
    updated = client.put(
        f"/api/v1/schedules/{schedule['id']}",
        headers=super_headers,
        json={
            "items": [
                {
                    "day_of_week": 2,
                    "start_time": "13:00:00",
                    "end_time": "14:00:00",
                    "content_id": content["id"],
                }
            ]
        },
    ).json()
    assert updated["items"][0]["content_name"] == "아침 알림판"


def test_referenced_item_does_not_duplicate_document(client, super_headers, schedule, content):
    """참조 방식이면 인라인 사본을 남기지 않는다(정본이 둘이 되면 안 된다)."""
    updated = client.put(
        f"/api/v1/schedules/{schedule['id']}",
        headers=super_headers,
        json={
            "items": [
                {
                    "day_of_week": 1,
                    "start_time": "09:00:00",
                    "end_time": "10:00:00",
                    "content_id": content["id"],
                    "content": DOC,
                }
            ]
        },
    ).json()
    assert updated["items"][0]["content"] == {}


def test_editing_content_bumps_referencing_schedule_version(
    client, super_headers, schedule, content, device
):
    """콘텐츠만 바꿔도 장치가 변경을 감지해야 한다."""
    client.put(
        f"/api/v1/schedules/{schedule['id']}",
        headers=super_headers,
        json={
            "items": [
                {
                    "day_of_week": 0,
                    "start_time": "09:00:00",
                    "end_time": "12:00:00",
                    "content_id": content["id"],
                }
            ]
        },
    )
    client.put(
        f"/api/v1/devices/{device['id']}/schedules",
        headers=super_headers,
        json={"schedule_ids": [schedule["id"]]},
    )
    headers = _device_headers(client, device)
    version = client.get("/api/v1/player/schedule", headers=headers).json()["version"]

    # 스케줄은 그대로 두고 콘텐츠 문서만 수정한다.
    client.put(
        f"/api/v1/contents/{content['id']}",
        headers=super_headers,
        json={"document": {"version": 1, "layout": {}, "elements": []}},
    )

    beat = client.post(
        "/api/v1/player/heartbeat", headers=headers, json={"schedule_version": version}
    ).json()
    assert beat["schedule_changed"] is True
    assert beat["schedule_version"] > version


def test_content_in_use_cannot_be_deleted(client, super_headers, schedule, content):
    client.put(
        f"/api/v1/schedules/{schedule['id']}",
        headers=super_headers,
        json={
            "items": [
                {"day_of_week": 0, "start_time": "09:00:00", "end_time": "10:00:00", "content_id": content["id"]}
            ]
        },
    )
    response = client.delete(f"/api/v1/contents/{content['id']}", headers=super_headers)
    assert response.status_code == 400
    assert "사용하는 스케줄 아이템" in response.json()["detail"]


def test_unused_content_can_be_deleted(client, super_headers, content):
    assert client.delete(f"/api/v1/contents/{content['id']}", headers=super_headers).status_code == 200


def test_usage_count_reported(client, super_headers, schedule, content):
    client.put(
        f"/api/v1/schedules/{schedule['id']}",
        headers=super_headers,
        json={
            "items": [
                {"day_of_week": 0, "start_time": "09:00:00", "end_time": "10:00:00", "content_id": content["id"]},
                {"day_of_week": 1, "start_time": "09:00:00", "end_time": "10:00:00", "content_id": content["id"]},
            ]
        },
    )
    body = client.get(f"/api/v1/contents/{content['id']}", headers=super_headers).json()
    assert body["usage_count"] == 2


def test_duplicate_content_shares_nothing_but_document(client, super_headers, content):
    copy = client.post(
        f"/api/v1/contents/{content['id']}/duplicate", headers=super_headers
    ).json()
    assert copy["id"] != content["id"]
    assert copy["name"].endswith("(복사본)")
    assert copy["document"] == content["document"]
    assert copy["version"] == 1


def test_overlapping_blocks_on_same_day_are_rejected(client, super_headers, schedule, content):
    """같은 요일에 시간대가 겹치면 무엇을 틀지 모호해지므로 거부한다."""
    response = client.put(
        f"/api/v1/schedules/{schedule['id']}",
        headers=super_headers,
        json={
            "items": [
                {"day_of_week": 0, "start_time": "09:00:00", "end_time": "12:00:00", "content_id": content["id"]},
                {"day_of_week": 0, "start_time": "11:00:00", "end_time": "13:00:00", "content_id": content["id"]},
            ]
        },
    )
    assert response.status_code == 400
    assert "겹칩니다" in response.json()["detail"]


def test_touching_blocks_are_allowed(client, super_headers, schedule, content):
    """끝나는 시각과 시작 시각이 같은 것은 겹침이 아니다."""
    response = client.put(
        f"/api/v1/schedules/{schedule['id']}",
        headers=super_headers,
        json={
            "items": [
                {"day_of_week": 0, "start_time": "09:00:00", "end_time": "12:00:00", "content_id": content["id"]},
                {"day_of_week": 0, "start_time": "12:00:00", "end_time": "13:00:00", "content_id": content["id"]},
            ]
        },
    )
    assert response.status_code == 200, response.text


def test_same_time_on_different_days_is_allowed(client, super_headers, schedule, content):
    response = client.put(
        f"/api/v1/schedules/{schedule['id']}",
        headers=super_headers,
        json={
            "items": [
                {"day_of_week": day, "start_time": "09:00:00", "end_time": "12:00:00", "content_id": content["id"]}
                for day in range(7)
            ]
        },
    )
    assert response.status_code == 200, response.text
    assert len(response.json()["items"]) == 7


def test_unknown_content_id_is_rejected(client, super_headers, schedule):
    response = client.put(
        f"/api/v1/schedules/{schedule['id']}",
        headers=super_headers,
        json={"items": [{"day_of_week": 0, "start_time": "09:00:00", "end_time": "10:00:00", "content_id": 9999}]},
    )
    assert response.status_code == 400
    assert "존재하지 않는 콘텐츠" in response.json()["detail"]


def test_cannot_use_content_from_unmanaged_org(
    client, super_headers, other_school_id, schedule, make_user, login
):
    foreign = client.post(
        "/api/v1/contents",
        headers=super_headers,
        json={"name": "남의 콘텐츠", "org_id": other_school_id},
    ).json()

    make_user("school_admin", schedule["org_id"], ["ORG_ADMIN"])
    response = client.put(
        f"/api/v1/schedules/{schedule['id']}",
        headers=login("school_admin"),
        json={
            "items": [
                {"day_of_week": 0, "start_time": "09:00:00", "end_time": "10:00:00", "content_id": foreign["id"]}
            ]
        },
    )
    assert response.status_code == 403


def test_duplicated_schedule_shares_content_reference(client, super_headers, schedule, content):
    client.put(
        f"/api/v1/schedules/{schedule['id']}",
        headers=super_headers,
        json={
            "items": [
                {"day_of_week": 0, "start_time": "09:00:00", "end_time": "10:00:00", "content_id": content["id"]}
            ]
        },
    )
    copy = client.post(
        f"/api/v1/schedules/{schedule['id']}/duplicate", headers=super_headers
    ).json()
    # 콘텐츠는 라이브러리에서 공유된다 — 문서를 복제하지 않고 참조만 넘긴다.
    assert copy["items"][0]["content_id"] == content["id"]
    assert client.get(f"/api/v1/contents/{content['id']}", headers=super_headers).json()["usage_count"] == 2


# ------------------------------------------------------------------ 콘텐츠 공유

# 공유 구분은 관리 범위 **밖의** 사용자에게 콘텐츠를 열어 주는 유일한 통로다.
# 없음(기본)=관리 범위 그대로 / 동일기관=같은 기관 / 소속기관=같은 상위기관
# 아래 기관들(형제) / 전체=모두. 열리는 것은 조회·사용뿐이고 수정·삭제는
# 여전히 소유 쪽 규칙을 따른다.


def _set_share(client, headers, content_id, scope):  # noqa: ANN001
    return client.put(
        f"/api/v1/contents/{content_id}", headers=headers, json={"share_scope": scope}
    )


@pytest.fixture
def far_school_id(client, super_headers, root_org_id) -> int:
    """다른 상위기관(교육청) 아래 학교 — '소속기관' 공유가 닿지 않는 곳."""
    office = client.post(
        "/api/v1/organizations",
        headers=super_headers,
        json={"name": "다른교육청", "parent_id": root_org_id, "org_type": "기관"},
    ).json()["id"]
    return client.post(
        "/api/v1/organizations",
        headers=super_headers,
        json={"name": "먼학교", "parent_id": office, "org_type": "학교"},
    ).json()["id"]


def test_share_scope_defaults_to_private(content):
    assert content["share_scope"] == "없음"
    assert content["shared"] is False


def test_share_scope_must_be_a_known_value(client, super_headers, content):
    assert _set_share(client, super_headers, content["id"], "우주").status_code == 400
    response = client.post(
        "/api/v1/contents",
        headers=super_headers,
        json={"name": "잘못된 공유", "share_scope": "우주"},
    )
    assert response.status_code == 400


def test_sibling_share_reaches_the_neighbor_school(
    client, super_headers, other_school_id, content, make_user, login
):
    # 같은 상위기관(최상위) 아래 형제 학교에는 '소속기관' 공유가 닿는다.
    _set_share(client, super_headers, content["id"], "소속기관")

    make_user("neighbor", other_school_id, [])
    page = client.get("/api/v1/contents", headers=login("neighbor")).json()
    assert [c["id"] for c in page["items"]] == [content["id"]]
    assert page["items"][0]["shared"] is True

    # 상세(문서 포함)도 읽을 수 있다 — 스케줄에 넣으려면 문서가 필요하다.
    detail = client.get(f"/api/v1/contents/{content['id']}", headers=login("neighbor"))
    assert detail.status_code == 200
    assert detail.json()["shared"] is True


def test_sibling_share_stops_at_a_different_parent(
    client, super_headers, far_school_id, content, make_user, login
):
    _set_share(client, super_headers, content["id"], "소속기관")

    make_user("faraway", far_school_id, [])
    page = client.get("/api/v1/contents", headers=login("faraway")).json()
    assert page["total"] == 0
    assert (
        client.get(f"/api/v1/contents/{content['id']}", headers=login("faraway")).status_code
        == 403
    )


def test_global_share_reaches_everyone(
    client, super_headers, far_school_id, content, make_user, login
):
    _set_share(client, super_headers, content["id"], "전체")

    make_user("anyone", far_school_id, [])
    page = client.get("/api/v1/contents", headers=login("anyone")).json()
    assert [c["id"] for c in page["items"]] == [content["id"]]


def test_share_filter_splits_mine_and_shared(
    client, super_headers, other_school_id, content, make_user, login
):
    # 브라우저의 필터: share=mine 은 관리 범위의 것만, share=shared 는 공유로
    # 열려 온 것만.
    _set_share(client, super_headers, content["id"], "소속기관")
    mine = client.post(
        "/api/v1/contents",
        headers=super_headers,
        json={"name": "내 콘텐츠", "org_id": other_school_id},
    ).json()

    make_user("neighbor2", other_school_id, ["ORG_ADMIN"])
    headers = login("neighbor2")

    both = client.get("/api/v1/contents", headers=headers).json()
    assert {c["id"] for c in both["items"]} == {content["id"], mine["id"]}

    only_mine = client.get("/api/v1/contents?share=mine", headers=headers).json()
    assert [c["id"] for c in only_mine["items"]] == [mine["id"]]

    only_shared = client.get("/api/v1/contents?share=shared", headers=headers).json()
    assert [c["id"] for c in only_shared["items"]] == [content["id"]]


def test_shared_content_can_be_scheduled(
    client, super_headers, other_school_id, content, make_user, login
):
    # 공유 판정의 기준은 스케줄의 기관이다 — 형제 학교의 스케줄에 붙는다.
    _set_share(client, super_headers, content["id"], "소속기관")
    schedule = client.post(
        "/api/v1/schedules",
        headers=super_headers,
        json={"name": "이웃 스케줄", "kind": "시간지정", "org_id": other_school_id, "items": []},
    ).json()

    make_user("scheduler", other_school_id, ["ORG_ADMIN"])
    response = client.put(
        f"/api/v1/schedules/{schedule['id']}",
        headers=login("scheduler"),
        json={
            "items": [
                {
                    "day_of_week": 0,
                    "start_time": "09:00:00",
                    "end_time": "10:00:00",
                    "content_id": content["id"],
                }
            ]
        },
    )
    assert response.status_code == 200, response.text


def test_shared_content_is_still_read_only_for_others(
    client, super_headers, other_school_id, content, make_user, login
):
    # 공유가 열어 주는 것은 조회·사용뿐이다.
    _set_share(client, super_headers, content["id"], "전체")

    make_user("reader", other_school_id, ["ORG_ADMIN"])
    response = client.put(
        f"/api/v1/contents/{content['id']}",
        headers=login("reader"),
        json={"name": "가로채기"},
    )
    assert response.status_code == 403


def test_duplicate_starts_unshared(client, super_headers, school_id):
    # 공유는 명시적인 행동이어야 한다 — 복사본이 몰래 공유되면 안 된다.
    source = client.post(
        "/api/v1/contents",
        headers=super_headers,
        json={"name": "널리 공유", "org_id": school_id, "share_scope": "전체"},
    ).json()
    assert source["share_scope"] == "전체"

    copy = client.post(
        f"/api/v1/contents/{source['id']}/duplicate", headers=super_headers
    ).json()
    assert copy["share_scope"] == "없음"
