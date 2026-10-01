"""커뮤니티 — 상위기관 단위의 공유 공간 (2026-10 개편판).

확인할 것이 넷이다.

    자리     커뮤니티는 상위기관에만 있다. 학교 소속 사용자는 트리를 따라
             올라가 교육청 커뮤니티를 본다 — 학교에는 커뮤니티가 없다.
             모든 승인 사용자의 공간이다(COMMUNITY_USER 역할 폐지).
    게시물   제목·공지대상(기관구분)·공지희망기간·연락처·메모를 메타데이터로
             등록한다. 파일은 게시물에 직접 올리고, 전체 재생시간은 칸 시간의
             합으로 서버가 계산한다.
    팝업     '게시' + 공지대상·기간이 맞는 글만 /popup 이 알린다.
    위젯     '게시' 상태만 커뮤니티 위젯이 표출한다 — 게시가 곧 표출이다.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from app.models.enums import Role
from app.services import assets as asset_service

PNG = b"\x89PNG\r\n\x1a\n" + b"0" * 64
MP4 = b"\x00\x00\x00\x18ftypmp42" + b"0" * 64


@pytest.fixture(autouse=True)
def media_root(tmp_path: Path, monkeypatch) -> Path:  # noqa: ANN001
    monkeypatch.setattr(asset_service.settings, "MEDIA_ROOT", str(tmp_path))
    return tmp_path


@pytest.fixture
def office_id(client, super_headers, root_org_id) -> int:  # noqa: ANN001
    """상위기관(교육청). 커뮤니티가 걸리는 자리다."""
    return client.post(
        "/api/v1/organizations",
        headers=super_headers,
        json={"name": "가나교육청", "parent_id": root_org_id, "org_type": "기관"},
    ).json()["id"]


@pytest.fixture
def school_id(client, super_headers, office_id) -> int:  # noqa: ANN001
    return client.post(
        "/api/v1/organizations",
        headers=super_headers,
        json={"name": "가나초등학교", "parent_id": office_id, "org_type": "학교", "school_level": "초"},
    ).json()["id"]


@pytest.fixture
def community(client, make_user, login, office_id):  # noqa: ANN001, ANN201
    """교육청 소속 일반 사용자의 인증 헤더 — 커뮤니티는 모두의 공간이다."""
    make_user("resident", org_id=office_id, roles=[])
    return login("resident")


@pytest.fixture
def office_admin(client, make_user, login, office_id):  # noqa: ANN001, ANN201
    """교육청 기관관리자. 게시 결과는 관리자의 일이다."""
    make_user("officeboss", org_id=office_id, roles=[Role.ORG_ADMIN])
    return login("officeboss")


def _create(client, headers, title="가을 축제 홍보", memo=None, org_id=None, **extra):  # noqa: ANN001, ANN201
    params = f"?org_id={org_id}" if org_id else ""
    return client.post(
        f"/api/v1/community/playlists{params}",
        headers=headers,
        json={"title": title, "memo": memo, **extra},
    )


def _upload(client, headers, playlist_id, name="사진.png", data=PNG, mime="image/png"):  # noqa: ANN001, ANN201
    return client.post(
        f"/api/v1/community/playlists/{playlist_id}/media",
        headers=headers,
        files={"file": (name, data, mime)},
    )


def _doc(text="안내"):
    """콘텐츠 편집기 문서 — 소속기관 공지와 같은 칸 모양."""
    return {
        "version": 1,
        "layout": {"width": 1920, "height": 1080, "background": "#000000"},
        "elements": [
            {
                "id": "e1",
                "type": "text",
                "rect": {"x": 0, "y": 0, "w": 400, "h": 200, "z": 1},
                "options": {"text": text},
            }
        ],
    }


def _fill(client, headers, playlist_id, durations=(8, 12)):  # noqa: ANN001, ANN201
    """문서 칸을 담는다. 게시물 응답을 돌려준다."""
    updated = client.put(
        f"/api/v1/community/playlists/{playlist_id}",
        headers=headers,
        json={
            "items": [
                {"document": _doc(f"칸 {at}"), "duration_sec": duration}
                for at, duration in enumerate(durations)
            ]
        },
    )
    assert updated.status_code == 200, updated.text
    return updated.json()


# ------------------------------------------------------------------ 자리


def test_community_sits_on_the_upper_org(client, community, office_id):  # noqa: ANN001
    body = client.get("/api/v1/community/context", headers=community).json()
    assert body["org_id"] == office_id
    assert body["can_share"] is True


def test_school_user_sees_the_parent_community(client, make_user, login, office_id, school_id):  # noqa: ANN001
    # 학교에는 커뮤니티가 없다. 트리를 올라가 교육청 커뮤니티를 본다.
    make_user("pupil", org_id=school_id, roles=[])

    body = client.get("/api/v1/community/context", headers=login("pupil")).json()
    assert body["org_id"] == office_id


def test_plain_member_can_enter_and_share(client, make_user, login, office_id):  # noqa: ANN001
    # 2026-10 개편: 커뮤니티는 모든 승인 사용자의 공간이다 — 일반 회원도
    # 들어오고 올린다. 게시 승인만 관리자의 일로 남는다.
    make_user("staff", org_id=office_id, roles=[])
    headers = login("staff")

    assert client.get("/api/v1/community/context", headers=headers).status_code == 200
    assert client.get("/api/v1/community/playlists", headers=headers).status_code == 200
    assert _create(client, headers, title="일반 회원의 글").status_code == 201


def test_org_admin_can_enter_the_community(client, office_admin):  # noqa: ANN001
    assert client.get("/api/v1/community/playlists", headers=office_admin).status_code == 200


def test_super_admin_picks_a_community(client, super_headers, community, office_id):  # noqa: ANN001
    # 슈퍼관리자는 org_id 로 어느 커뮤니티든 고른다.
    created = _create(client, community, title="선택 확인")
    assert created.status_code == 201

    listed = client.get(
        f"/api/v1/community/playlists?org_id={office_id}", headers=super_headers
    ).json()
    assert listed["total"] == 1
    assert client.get("/api/v1/community/list", headers=super_headers).status_code == 200


# ------------------------------------------------------------------ 재생목록


def test_register_starts_pending_with_author(client, community):  # noqa: ANN001
    # 등록하면 '대기중'으로 시작하고 게시자가 남는다.
    body = _create(client, community, memo="가을 축제를 알리고 싶어요").json()
    assert body["title"] == "가을 축제 홍보"
    assert body["memo"] == "가을 축제를 알리고 싶어요"
    assert body["publish_status"] == "대기중"
    assert body["author_name"] == "resident"
    assert body["items"] == [] and body["total_duration_sec"] == 0
    # 본인 것은 고치고 지울 수 있지만, 게시 결과는 관리자의 몫이다.
    assert body["can_edit"] is True and body["can_remove"] is True
    assert body["can_publish"] is False


def test_title_is_required(client, community):  # noqa: ANN001
    assert (
        client.post(
            "/api/v1/community/playlists", headers=community, json={"title": ""}
        ).status_code
        == 422
    )


def test_document_slides_become_items_and_total_is_summed(client, community):  # noqa: ANN001
    # 문서 칸을 담으면 전체 재생시간 = 칸 시간의 합. 저장 모양은 {document, duration_sec}.
    playlist_id = _create(client, community).json()["id"]
    body = _fill(client, community, playlist_id, durations=(8, 12))

    assert [item["duration_sec"] for item in body["items"]] == [8, 12]
    assert body["items"][0]["document"]["elements"][0]["options"]["text"] == "칸 0"
    assert body["total_duration_sec"] == 20
    assert body["version"] == 2  # 수정마다 올라간다 — 위젯이 감지하는 근거.


def test_item_requires_a_document(client, community):  # noqa: ANN001
    # 옛 모양(파일 참조·QR)은 더 이상 칸이 아니다 — 문서가 있어야 한다.
    playlist_id = _create(client, community).json()["id"]
    response = client.put(
        f"/api/v1/community/playlists/{playlist_id}",
        headers=community,
        json={"items": [{"kind": "image", "asset_id": 1, "duration_sec": 10}]},
    )
    assert response.status_code == 400
    assert "콘텐츠 문서" in response.json()["detail"]


def test_community_widget_cannot_nest_inside_a_slide(client, community):  # noqa: ANN001
    # 커뮤니티 안에서 커뮤니티를 틀면 끝없이 파고든다.
    playlist_id = _create(client, community).json()["id"]
    document = _doc()
    document["elements"].append(
        {"id": "w1", "type": "widget", "widget_key": "community", "rect": {}, "options": {}}
    )
    response = client.put(
        f"/api/v1/community/playlists/{playlist_id}",
        headers=community,
        json={"items": [{"document": document, "duration_sec": 10}]},
    )
    assert response.status_code == 400
    assert "커뮤니티 위젯" in response.json()["detail"]


def test_uploaded_media_is_listed_for_the_editor(client, community):  # noqa: ANN001
    # 파일은 게시물에 직접 올리고(assets 목록) 문서의 이미지 요소가 그 주소를 쓴다.
    playlist_id = _create(client, community).json()["id"]
    upload = _upload(client, community, playlist_id)
    assert upload.status_code == 201, upload.text
    body = client.get(f"/api/v1/community/playlists/{playlist_id}", headers=community).json()
    assert [asset["id"] for asset in body["assets"]] == [upload.json()["id"]]
    assert body["assets"][0]["url"]


def test_only_owner_edits_and_deletes(client, community, make_user, login, office_id):  # noqa: ANN001
    playlist_id = _create(client, community).json()["id"]
    make_user("neighbor", org_id=office_id, roles=[])
    neighbor = login("neighbor")

    # 남의 것은 조회만 된다.
    assert (
        client.get(f"/api/v1/community/playlists/{playlist_id}", headers=neighbor).status_code
        == 200
    )
    assert (
        client.put(
            f"/api/v1/community/playlists/{playlist_id}",
            headers=neighbor,
            json={"title": "가로채기"},
        ).status_code
        == 403
    )
    assert (
        client.delete(
            f"/api/v1/community/playlists/{playlist_id}", headers=neighbor
        ).status_code
        == 403
    )

    # 본인은 고치고 지운다.
    renamed = client.put(
        f"/api/v1/community/playlists/{playlist_id}",
        headers=community,
        json={"title": "고친 제목", "memo": ""},
    ).json()
    assert renamed["title"] == "고친 제목" and renamed["memo"] is None
    assert (
        client.delete(
            f"/api/v1/community/playlists/{playlist_id}", headers=community
        ).status_code
        == 200
    )


def test_publish_status_is_the_admins_call(client, community, office_admin):  # noqa: ANN001
    playlist_id = _create(client, community).json()["id"]

    # 작성자 본인이라도 게시 결과는 손대지 못한다.
    denied = client.put(
        f"/api/v1/community/playlists/{playlist_id}/status",
        headers=community,
        json={"status": "게시"},
    )
    assert denied.status_code == 403

    bad = client.put(
        f"/api/v1/community/playlists/{playlist_id}/status",
        headers=office_admin,
        json={"status": "몰래"},
    )
    assert bad.status_code == 400

    published = client.put(
        f"/api/v1/community/playlists/{playlist_id}/status",
        headers=office_admin,
        json={"status": "게시"},
    ).json()
    assert published["publish_status"] == "게시"


def test_list_carries_author_and_status(client, community, office_admin):  # noqa: ANN001
    _create(client, community, title="목록 확인")
    listed = client.get("/api/v1/community/playlists", headers=office_admin).json()
    row = listed["items"][0]
    assert row["title"] == "목록 확인"
    assert row["author_name"] == "resident"
    assert row["publish_status"] == "대기중"
    assert row["can_publish"] is True  # 관리자는 게시 결과를 정한다.


def test_author_name_and_contact_travel_with_the_playlist(client, community):  # noqa: ANN001
    # 게시자 표시 이름과 연락처는 계정 정보와 별개로 글에 실린다.
    created = client.post(
        "/api/v1/community/playlists",
        headers=community,
        json={
            "title": "연락처 확인",
            "memo": "토요일 오전, 교육청 앞마당",
            "author_name": "홍길동",
            "contact": "010-1234-5678",
        },
    ).json()
    assert created["author_name"] == "홍길동"  # 계정 이름(resident)보다 우선.
    assert created["contact"] == "010-1234-5678"
    assert created["memo"] == "토요일 오전, 교육청 앞마당"

    # 표시 이름을 비우면 계정 이름으로 돌아간다.
    cleared = client.put(
        f"/api/v1/community/playlists/{created['id']}",
        headers=community,
        json={"author_name": "", "contact": ""},
    ).json()
    assert cleared["author_name"] == "resident"
    assert cleared["contact"] is None


class TestPublishPolicy:
    """게시 정책 — 관리자 승인 후(기본) / 승인 없이 즉시 게시."""

    def test_default_requires_approval(self, client, community, office_admin):  # noqa: ANN001
        setting = client.get("/api/v1/community/settings", headers=community).json()
        assert setting == {"auto_publish": False, "can_manage": False}
        assert _create(client, community).json()["publish_status"] == "대기중"

    def test_auto_publish_skips_approval(self, client, community, office_admin):  # noqa: ANN001
        updated = client.put(
            "/api/v1/community/settings", headers=office_admin, json={"auto_publish": True}
        ).json()
        assert updated["auto_publish"] is True

        # 이제 등록 즉시 '게시'다 — 승인 없이 표출된다.
        assert _create(client, community).json()["publish_status"] == "게시"

        # 다시 끄면 새 등록은 승인 대기로 돌아간다.
        client.put(
            "/api/v1/community/settings", headers=office_admin, json={"auto_publish": False}
        )
        assert (
            _create(client, community, title="두 번째").json()["publish_status"] == "대기중"
        )

    def test_only_admin_changes_the_policy(self, client, community):  # noqa: ANN001
        denied = client.put(
            "/api/v1/community/settings", headers=community, json={"auto_publish": True}
        )
        assert denied.status_code == 403


# ------------------------------------------------------------------ 위젯


def _widget_data(client, headers, org_id, options=""):  # noqa: ANN001, ANN201
    params = f"?org_id={org_id}" + (f"&options={options}" if options else "")
    return client.get(f"/api/v1/widgets/community/data{params}", headers=headers).json()


def test_widget_plays_only_published_playlists(  # noqa: ANN001
    client, super_headers, community, office_admin, school_id
):
    playlist_id = _create(client, community).json()["id"]
    _fill(client, community, playlist_id, durations=(8, 12))

    # 게시 전에는 틀 것이 없다.
    assert _widget_data(client, super_headers, school_id)["data"] is None

    client.put(
        f"/api/v1/community/playlists/{playlist_id}/status",
        headers=office_admin,
        json={"status": "게시"},
    )
    data = _widget_data(client, super_headers, school_id)["data"]
    assert data["active"] is True
    assert data["title"] == "가을 축제 홍보"
    # 칸은 문서 그대로 실린다 — 플레이어가 캔버스로 그린다.
    assert len(data["items"]) == 2 and all(item["document"]["elements"] for item in data["items"])
    assert data["total_duration_sec"] == 20


def test_widget_skips_empty_playlists(  # noqa: ANN001
    client, super_headers, community, office_admin, school_id
):
    # 칸이 없는 게시물은 건너뛰고 칸이 있는 최신 것을 튼다.
    filled = _create(client, community, title="칸 있음").json()["id"]
    _fill(client, community, filled, durations=(5,))
    empty = _create(client, community, title="칸 없음").json()["id"]
    for playlist_id in (filled, empty):
        client.put(
            f"/api/v1/community/playlists/{playlist_id}/status",
            headers=office_admin,
            json={"status": "게시"},
        )

    data = _widget_data(client, super_headers, school_id)["data"]
    assert data["title"] == "칸 있음"
    assert data["total_duration_sec"] == 5


def test_widget_pinned_playlist_respects_publish_status(  # noqa: ANN001
    client, super_headers, community, office_admin, school_id
):
    # 지정 삽입(playlist_id)이라도 게시 전이면 틀지 않는다.
    import json as _json

    playlist_id = _create(client, community).json()["id"]
    _fill(client, community, playlist_id, durations=(7,))
    options = _json.dumps({"playlist_id": playlist_id})

    data = _widget_data(client, super_headers, school_id, options=options)["data"]
    assert data["active"] is False

    client.put(
        f"/api/v1/community/playlists/{playlist_id}/status",
        headers=office_admin,
        json={"status": "게시"},
    )
    data = _widget_data(client, super_headers, school_id, options=options)["data"]
    assert data["active"] is True and data["total_duration_sec"] == 7


# ------------------------------------------------------------------ 메타·팝업


def test_meta_round_trips_and_is_validated(client, community):  # noqa: ANN001
    """공지대상(기관구분)·공지희망기간이 저장·수정으로 오가고, 서버가 지킨다."""
    created = _create(
        client,
        community,
        title="메타 확인",
        memo="메모",
        target_org_types=["학교"],
        notice_start="2026-10-01",
        notice_end="2026-10-14",
    ).json()
    assert created["target_org_types"] == ["학교"]
    assert created["notice_start"] == "2026-10-01"
    assert created["notice_end"] == "2026-10-14"

    # 기관구분 마스터에 없는 이름은 거절한다.
    bad_target = _create(client, community, title="대상 오류", target_org_types=["없는구분"])
    assert bad_target.status_code == 400
    assert "기관구분에서" in bad_target.json()["detail"]

    # 날짜 형식과 순서도 지킨다.
    assert _create(client, community, title="형식 오류", notice_start="2026/10/01").status_code == 400
    wrong_order = _create(
        client, community, title="순서 오류", notice_start="2026-10-20", notice_end="2026-10-01"
    )
    assert wrong_order.status_code == 400
    assert "늦을 수" in wrong_order.json()["detail"]

    # 수정에서 한쪽만 고쳐 순서가 어긋나도 막는다.
    moved = client.put(
        f"/api/v1/community/playlists/{created['id']}",
        headers=community,
        json={"notice_start": "2026-10-20"},
    )
    assert moved.status_code == 400


def test_popup_matches_target_and_period(  # noqa: ANN001
    client, community, office_admin, make_user, login, office_id, school_id
):
    """로그인 팝업 — '게시' + 공지대상(기관구분)·공지희망기간이 맞는 글만."""
    from datetime import date, timedelta

    today = date.today()
    created = _create(
        client,
        community,
        title="학교 대상 공지",
        memo="팝업 확인",
        target_org_types=["학교"],
        notice_start=today.isoformat(),
        notice_end=(today + timedelta(days=7)).isoformat(),
    ).json()

    make_user("pupil2", org_id=school_id, roles=[])
    pupil = login("pupil2")

    # 게시 전에는 팝업에 실리지 않는다.
    assert client.get("/api/v1/community/popup", headers=pupil).json() == []

    client.put(
        f"/api/v1/community/playlists/{created['id']}/status",
        headers=office_admin,
        json={"status": "게시"},
    )

    # 학교 소속에게는 실리고, 기관(교육청) 소속에게는 실리지 않는다.
    shown = client.get("/api/v1/community/popup", headers=pupil).json()
    assert [n["title"] for n in shown] == ["학교 대상 공지"]
    assert shown[0]["memo"] == "팝업 확인"
    assert client.get("/api/v1/community/popup", headers=community).json() == []

    # 기간이 지나면 더는 실리지 않는다.
    client.put(
        f"/api/v1/community/playlists/{created['id']}",
        headers=community,
        json={"notice_start": "2000-01-01", "notice_end": "2000-01-02"},
    )
    assert client.get("/api/v1/community/popup", headers=pupil).json() == []


def test_popup_empty_target_reaches_everyone(  # noqa: ANN001
    client, community, office_admin
):
    created = _create(client, community, title="전체 대상 공지").json()
    client.put(
        f"/api/v1/community/playlists/{created['id']}/status",
        headers=office_admin,
        json={"status": "게시"},
    )
    shown = client.get("/api/v1/community/popup", headers=community).json()
    assert [n["title"] for n in shown] == ["전체 대상 공지"]


def test_new_org_type_becomes_a_target_choice(client, super_headers, community):  # noqa: ANN001
    """공지대상 선택지는 기관구분 마스터다 — 새 구분을 등록하면 곧장 쓸 수 있다."""
    client.post(
        "/api/v1/org-types",
        headers=super_headers,
        json={"name": "평생교육기관", "category": "기관"},
    )
    created = _create(
        client, community, title="새 구분 대상", target_org_types=["평생교육기관"]
    )
    assert created.status_code == 201, created.text
    assert created.json()["target_org_types"] == ["평생교육기관"]


def test_sub_level_targets_match_school_level(  # noqa: ANN001
    client, community, office_admin, make_user, login, school_id
):
    """세부 구분("학교:초")은 그 학교급의 기관에만 실린다.

    school_id 픽스처는 school_level='초' 로 만든다 — "학교:초" 는 받고
    "학교:고" 는 받지 않아야 한다.
    """

    def publish(title, targets):
        created = _create(client, community, title=title, target_org_types=targets).json()
        client.put(
            f"/api/v1/community/playlists/{created['id']}/status",
            headers=office_admin,
            json={"status": "게시"},
        )
        return created

    publish("초등 대상 공지", ["학교:초"])
    publish("고등 대상 공지", ["학교:고"])

    make_user("pupil3", org_id=school_id, roles=[])
    shown = client.get("/api/v1/community/popup", headers=login("pupil3")).json()
    assert [n["title"] for n in shown] == ["초등 대상 공지"]

    # 분류 선택지에 없는 세부 구분은 거절한다(학교의 분류: 초,중,고).
    denied = _create(client, community, title="없는 분류", target_org_types=["학교:유치원"])
    assert denied.status_code == 400
    assert "기관구분에서" in denied.json()["detail"]
