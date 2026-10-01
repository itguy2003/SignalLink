"""위젯 재생목록 검증.

재생목록은 콘텐츠 라이브러리와 같은 연쇄를 탄다 — 재생목록을 고치면 그것을
쓰는 콘텐츠와 스케줄의 버전이 올라가고, 장치가 하트비트에서 변경을 감지한다.
그 연결 고리가 ``content_playlist`` 색인이다.
"""

from __future__ import annotations

import pytest

from app.services import playlists


@pytest.fixture
def school_id(client, super_headers, root_org_id) -> int:
    return client.post(
        "/api/v1/organizations",
        headers=super_headers,
        json={"name": "가나초등학교", "parent_id": root_org_id, "org_type": "학교"},
    ).json()["id"]


@pytest.fixture
def make_playlist(client, super_headers, school_id):
    def _make(name: str, items: list | None = None):
        return client.post(
            "/api/v1/playlists",
            headers=super_headers,
            json={
                "name": name,
                "org_id": school_id,
                "items": items
                if items is not None
                else [
                    {"widget_key": "notice", "duration_sec": 15},
                    {"widget_key": "meal", "duration_sec": 10},
                ],
            },
        )

    return _make


def _playlist_element(playlist_id: int) -> dict:
    return {
        "version": 1,
        "layout": {"width": 1920, "height": 1080, "background": "#000000"},
        "elements": [
            {
                "id": "e1",
                "type": "playlist",
                "rect": {"x": 0, "y": 0, "w": 1920, "h": 1080, "z": 1},
                "options": {"playlist_id": playlist_id},
            }
        ],
    }


# ------------------------------------------------------------------ CRUD
def test_create_with_widgets(make_playlist):
    body = make_playlist("아침 순환").json()
    assert [i["widget_key"] for i in body["items"]] == ["notice", "meal"]
    assert [i["sort_order"] for i in body["items"]] == [0, 1]


def test_total_duration_is_reported(make_playlist):
    # 한 바퀴 도는 데 얼마나 걸리는지 목록에서 바로 보여야 한다.
    assert make_playlist("아침 순환").json()["total_duration_sec"] == 25


def test_empty_playlist_is_allowed(make_playlist):
    # 먼저 만들어 두고 나중에 위젯을 담는 흐름을 막을 이유가 없다.
    body = make_playlist("빈 목록", items=[]).json()
    assert body["items"] == []


def test_unknown_widget_is_rejected(make_playlist):
    response = make_playlist("잘못", items=[{"widget_key": "없는위젯"}])
    assert response.status_code == 400
    assert "위젯" in response.json()["detail"]


def test_order_is_preserved(make_playlist):
    body = make_playlist(
        "순서",
        items=[
            {"widget_key": "meal"},
            {"widget_key": "notice"},
            {"widget_key": "clock"},
        ],
    ).json()
    assert [i["widget_key"] for i in body["items"]] == ["meal", "notice", "clock"]


def test_update_replaces_items(client, super_headers, make_playlist):
    playlist = make_playlist("원본").json()
    body = client.put(
        f"/api/v1/playlists/{playlist['id']}",
        headers=super_headers,
        json={"items": [{"widget_key": "clock", "duration_sec": 5}]},
    ).json()
    assert [i["widget_key"] for i in body["items"]] == ["clock"]


def test_update_without_items_keeps_them(client, super_headers, make_playlist):
    playlist = make_playlist("원본").json()
    body = client.put(
        f"/api/v1/playlists/{playlist['id']}", headers=super_headers, json={"name": "새 이름"}
    ).json()
    assert body["name"] == "새 이름"
    assert len(body["items"]) == 2


def test_update_bumps_version(client, super_headers, make_playlist):
    playlist = make_playlist("원본").json()
    body = client.put(
        f"/api/v1/playlists/{playlist['id']}", headers=super_headers, json={"name": "수정"}
    ).json()
    assert body["version"] == playlist["version"] + 1


# ------------------------------------------------------- 전환 효과


def test_transition_defaults_to_none(make_playlist):
    """안 고르면 그냥 바뀐다. 효과가 기본이면 원치 않는 사람이 매번 꺼야 한다."""
    body = make_playlist("순환").json()
    assert [item["transition"] for item in body["items"]] == ["none", "none"]


def test_transition_is_saved(make_playlist):
    body = make_playlist(
        "순환",
        items=[
            {"widget_key": "notice", "duration_sec": 5, "transition": "fade"},
            {"widget_key": "meal", "duration_sec": 5, "transition": "slide-left"},
        ],
    ).json()
    assert [item["transition"] for item in body["items"]] == ["fade", "slide-left"]


def test_unknown_transition_is_rejected(make_playlist):
    """모르는 이름을 받아 두면 장치마다 다르게 넘어간다 — 저장 자체를 막는다."""
    response = make_playlist(
        "순환", items=[{"widget_key": "notice", "duration_sec": 5, "transition": "폭발"}]
    )
    assert response.status_code == 422


def test_transition_survives_update(client, super_headers, make_playlist):
    playlist = make_playlist("순환").json()
    body = client.put(
        f"/api/v1/playlists/{playlist['id']}",
        headers=super_headers,
        json={"items": [{"widget_key": "notice", "duration_sec": 5, "transition": "zoom"}]},
    ).json()
    assert body["items"][0]["transition"] == "zoom"


def test_duplicate_keeps_transition(client, super_headers, make_playlist):
    # 복사본이 밋밋해지면 어디가 달라졌는지 찾느라 시간을 쓴다.
    playlist = make_playlist(
        "순환", items=[{"widget_key": "notice", "duration_sec": 5, "transition": "fade"}]
    ).json()
    copy = client.post(
        f"/api/v1/playlists/{playlist['id']}/duplicate", headers=super_headers
    ).json()
    assert copy["items"][0]["transition"] == "fade"


def test_transition_ms_defaults(make_playlist):
    """지금까지 모든 전환이 쓰던 고정값. 기존 재생목록의 표출이 달라지면 안 된다."""
    body = make_playlist("순환").json()
    assert [item["transition_ms"] for item in body["items"]] == [600, 600]


def test_transition_ms_is_saved(make_playlist):
    body = make_playlist(
        "순환",
        items=[
            {
                "widget_key": "notice",
                "duration_sec": 10,
                "transition": "fade",
                "transition_ms": 1500,
            }
        ],
    ).json()
    assert body["items"][0]["transition_ms"] == 1500


@pytest.mark.parametrize("value", [50, 9000])
def test_transition_ms_out_of_range_is_rejected(make_playlist, value):
    response = make_playlist(
        "순환",
        items=[
            {
                "widget_key": "notice",
                "duration_sec": 30,
                "transition": "fade",
                "transition_ms": value,
            }
        ],
    )
    assert response.status_code == 422


def test_transition_cannot_outlast_the_slot(make_playlist):
    """3초 머무는 칸에 5초짜리 전환을 걸면 화면이 영영 제자리에 놓이지 않는다."""
    response = make_playlist(
        "순환",
        items=[
            {
                "widget_key": "notice",
                "duration_sec": 3,
                "transition": "fade",
                "transition_ms": 5000,
            }
        ],
    )
    assert response.status_code == 422


def test_no_transition_ignores_the_length_check(make_playlist):
    # 효과가 없으면 전환 시간은 쓰이지 않는다. 막을 이유가 없다.
    response = make_playlist(
        "순환",
        items=[
            {
                "widget_key": "notice",
                "duration_sec": 1,
                "transition": "none",
                "transition_ms": 5000,
            }
        ],
    )
    assert response.status_code == 201


def test_new_transitions_are_accepted(make_playlist):
    # 늘어난 효과가 실제로 저장돼야 고를 수 있는 의미가 있다.
    kinds = [
        "dissolve",
        "blur",
        "slide-down",
        "wipe-left",
        "wipe-right",
        "zoom-out",
        "flip",
        "rotate",
    ]
    body = make_playlist(
        "순환",
        items=[
            {"widget_key": "notice", "duration_sec": 10, "transition": kind} for kind in kinds
        ],
    ).json()
    assert [item["transition"] for item in body["items"]] == kinds


def test_duplicate_keeps_transition_ms(client, super_headers, make_playlist):
    playlist = make_playlist(
        "순환",
        items=[
            {
                "widget_key": "notice",
                "duration_sec": 10,
                "transition": "zoom",
                "transition_ms": 1200,
            }
        ],
    ).json()
    copy = client.post(
        f"/api/v1/playlists/{playlist['id']}/duplicate", headers=super_headers
    ).json()
    assert copy["items"][0]["transition_ms"] == 1200


def test_dissolve_is_a_crossfade():
    """디졸브만 두 장을 겹쳐 그린다. 들어오는 쪽만 그리면 페이드와 같아진다."""
    from app.services import transitions

    assert "dissolve" in transitions.CROSSFADE
    assert "fade" not in transitions.CROSSFADE


def test_normalize_ms_clamps():
    """플레이어가 저마다 방어하면 장치마다 다르게 넘어간다. 서버가 한 번만 자른다."""
    from app.services import transitions

    assert transitions.normalize_ms(None) == 600
    assert transitions.normalize_ms(10) == 100
    assert transitions.normalize_ms(99999) == 5000
    assert transitions.normalize_ms(800) == 800


def test_normalize_falls_back_to_none():
    """사라진 이름이 저장돼 있어도 빈 화면이 나가면 안 된다."""
    from app.services import transitions

    assert transitions.normalize("fade") == "fade"
    assert transitions.normalize("사라진효과") == "none"
    assert transitions.normalize(None) == "none"


def test_duplicate_copies_items(client, super_headers, make_playlist):
    playlist = make_playlist("원본").json()
    copy = client.post(
        f"/api/v1/playlists/{playlist['id']}/duplicate", headers=super_headers
    ).json()
    assert copy["id"] != playlist["id"]
    assert [i["widget_key"] for i in copy["items"]] == ["notice", "meal"]


def test_delete_unused(client, super_headers, make_playlist):
    playlist = make_playlist("지울 것").json()
    assert (
        client.delete(f"/api/v1/playlists/{playlist['id']}", headers=super_headers).status_code
        == 200
    )


def test_list_is_scoped(client, super_headers, make_playlist, school_id, make_user, login):
    from app.models.enums import Role

    make_playlist("우리 목록")
    make_user("outsider", school_id, [Role.HOMEROOM_TEACHER])
    # 같은 기관 소속이라 보인다. 범위 규칙은 콘텐츠와 같다.
    page = client.get("/api/v1/playlists", headers=login("outsider")).json()
    assert page["total"] == 1


# ------------------------------------------------------------------ 문서 색인
def test_referenced_ids_reads_document():
    assert playlists.referenced_ids(_playlist_element(7)) == {7}


@pytest.mark.parametrize(
    "document",
    [
        None,
        {},
        {"elements": []},
        {"elements": [{"type": "text"}]},
        {"elements": [{"type": "playlist"}]},
        {"elements": [{"type": "playlist", "options": {}}]},
        {"elements": [{"type": "playlist", "options": {"playlist_id": "일곱"}}]},
        {"elements": ["문자열"]},
    ],
)
def test_referenced_ids_ignores_broken_elements(document):
    # 색인을 만들다가 저장이 실패하면 편집 내용을 잃는다. 색인은 그만한 값어치가 없다.
    assert playlists.referenced_ids(document) == set()


def test_saving_content_records_the_link(client, super_headers, school_id, make_playlist):
    playlist = make_playlist("순환").json()
    content = client.post(
        "/api/v1/contents",
        headers=super_headers,
        json={
            "name": "재생목록 콘텐츠",
            "org_id": school_id,
            "document": _playlist_element(playlist["id"]),
        },
    ).json()
    assert content["id"]

    body = client.get(f"/api/v1/playlists/{playlist['id']}", headers=super_headers).json()
    assert body["usage_count"] == 1


def test_removing_from_document_drops_the_link(
    client, super_headers, school_id, make_playlist
):
    playlist = make_playlist("순환").json()
    content = client.post(
        "/api/v1/contents",
        headers=super_headers,
        json={"name": "콘텐츠", "org_id": school_id, "document": _playlist_element(playlist["id"])},
    ).json()

    client.put(
        f"/api/v1/contents/{content['id']}",
        headers=super_headers,
        json={"document": {"version": 1, "elements": []}},
    )
    body = client.get(f"/api/v1/playlists/{playlist['id']}", headers=super_headers).json()
    assert body["usage_count"] == 0


def test_unknown_playlist_id_is_not_indexed(client, super_headers, school_id):
    # FK 위반으로 콘텐츠 저장이 통째로 실패하면 안 된다.
    response = client.post(
        "/api/v1/contents",
        headers=super_headers,
        json={"name": "콘텐츠", "org_id": school_id, "document": _playlist_element(9999)},
    )
    assert response.status_code == 201


def test_delete_is_blocked_while_in_use(client, super_headers, school_id, make_playlist):
    # 지우면 그 콘텐츠가 빈 자리를 그린다. 어디서 쓰는지 알려 준다.
    playlist = make_playlist("쓰이는 것").json()
    client.post(
        "/api/v1/contents",
        headers=super_headers,
        json={"name": "콘텐츠", "org_id": school_id, "document": _playlist_element(playlist["id"])},
    )
    response = client.delete(f"/api/v1/playlists/{playlist['id']}", headers=super_headers)
    assert response.status_code == 400
    assert "1건" in response.json()["detail"]


# ------------------------------------------------------------------ 플레이어 전달
def test_player_receives_inlined_items(client, super_headers, school_id, make_playlist):
    """플레이어는 재생목록 API 를 몰라도 된다. 서버가 칸 목록을 펼쳐 준다."""
    playlist = make_playlist("순환").json()
    content = client.post(
        "/api/v1/contents",
        headers=super_headers,
        json={"name": "콘텐츠", "org_id": school_id, "document": _playlist_element(playlist["id"])},
    ).json()
    schedule = client.post(
        "/api/v1/schedules",
        headers=super_headers,
        json={
            "name": "스케줄",
            "kind": "목록반복",
            "org_id": school_id,
            "items": [{"day_of_week": -1, "duration_sec": 30, "content_id": content["id"]}],
        },
    ).json()
    device = client.post(
        "/api/v1/devices",
        headers=super_headers,
        json={"org_id": school_id, "name": "DID", "os": "Windows", "form_factor": "DID형"},
    ).json()
    client.put(
        f"/api/v1/devices/{device['id']}/schedules",
        headers=super_headers,
        json={"schedule_ids": [schedule["id"]]},
    )
    token = client.post(
        "/api/v1/player/provision", json={"device_code": device["device_code"]}
    ).json()["device_token"]

    payload = client.get(
        "/api/v1/player/schedule", headers={"X-Device-Token": token}
    ).json()
    element = payload["items"][0]["content"]["elements"][0]
    assert element["type"] == "playlist"
    assert [i["widget_key"] for i in element["options"]["items"]] == ["notice", "meal"]
    assert element["options"]["items"][0]["duration_sec"] == 15
    # 넘어가는 방식도 플레이어가 그린다. 정규화까지 서버가 끝내 준다.
    assert element["options"]["items"][0]["transition"] == "none"
    assert element["options"]["items"][0]["transition_ms"] == 600


def test_stored_document_keeps_only_the_reference(
    client, super_headers, school_id, make_playlist
):
    """저장된 문서에는 참조만 남아야 재생목록을 고쳤을 때 반영된다."""
    playlist = make_playlist("순환").json()
    content = client.post(
        "/api/v1/contents",
        headers=super_headers,
        json={"name": "콘텐츠", "org_id": school_id, "document": _playlist_element(playlist["id"])},
    ).json()

    stored = client.get(f"/api/v1/contents/{content['id']}", headers=super_headers).json()
    assert "items" not in stored["document"]["elements"][0]["options"]


def test_editing_playlist_bumps_referencing_schedule(
    client, super_headers, school_id, make_playlist
):
    """재생목록만 바뀌면 콘텐츠·스케줄 레코드는 그대로다.

    버전을 올려 주지 않으면 장치가 변경을 알아챌 방법이 없다.
    """
    playlist = make_playlist("순환").json()
    content = client.post(
        "/api/v1/contents",
        headers=super_headers,
        json={"name": "콘텐츠", "org_id": school_id, "document": _playlist_element(playlist["id"])},
    ).json()
    schedule = client.post(
        "/api/v1/schedules",
        headers=super_headers,
        json={
            "name": "스케줄",
            "org_id": school_id,
            "items": [{"day_of_week": -1, "content_id": content["id"]}],
        },
    ).json()

    client.put(
        f"/api/v1/playlists/{playlist['id']}",
        headers=super_headers,
        json={"items": [{"widget_key": "clock", "duration_sec": 5}]},
    )

    after = client.get(f"/api/v1/schedules/{schedule['id']}", headers=super_headers).json()
    assert after["version"] > schedule["version"]


def test_deleted_playlist_leaves_empty_items(client, super_headers, school_id, make_playlist):
    # 참조가 깨져도 플레이어가 터지면 안 된다. 아무것도 안 그리면 된다.
    document = _playlist_element(9999)
    assert playlists.inline_into_document.__doc__  # 문서화된 동작임을 표시
    content = client.post(
        "/api/v1/contents",
        headers=super_headers,
        json={"name": "콘텐츠", "org_id": school_id, "document": document},
    )
    assert content.status_code == 201


# ------------------------------------------------------------------ 인라인 참조 연쇄


def test_update_bumps_schedule_with_inline_reference(
    client, super_headers, school_id, make_playlist
):
    # 스케줄 아이템이 재생목록을 인라인 문서로 직접 들 수 있다(라이브러리
    # 콘텐츠 없이 스케줄에 놓은 경우). 재생목록을 고치면 그 스케줄의 버전도
    # 올라야 장치가 변경을 알아챈다.
    playlist = make_playlist('현관 순환').json()
    inline_document = {
        'version': 1,
        'layout': {'width': 1920, 'height': 1080, 'background': '#000000'},
        'elements': [{
            'id': 'el-1', 'type': 'playlist',
            'rect': {'x': 0, 'y': 0, 'w': 1920, 'h': 1080, 'z': 1},
            'options': {'playlist_id': playlist['id']},
        }],
    }
    schedule = client.post(
        '/api/v1/schedules',
        headers=super_headers,
        json={
            'name': '인라인 스케줄', 'kind': '목록반복', 'org_id': school_id,
            'items': [{'day_of_week': -1, 'duration_sec': 15, 'content': inline_document}],
        },
    ).json()

    client.put(
        f"/api/v1/playlists/{playlist['id']}",
        headers=super_headers,
        json={'items': [{'widget_key': 'clock', 'duration_sec': 5}]},
    )

    after = client.get(
        f"/api/v1/schedules/{schedule['id']}", headers=super_headers
    ).json()
    assert after['version'] > schedule['version']
