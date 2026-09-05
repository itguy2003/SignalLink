"""커뮤니티 — 상위기관 단위의 공유 공간.

확인할 것이 셋이다.

    자리     커뮤니티는 상위기관에만 있다. 학교 소속 사용자는 트리를 따라
             올라가 교육청 커뮤니티를 본다 — 학교에는 커뮤니티가 없다.
    울타리   커뮤니티 유저는 커뮤니티 바깥으로 나가지 못한다. 메뉴를 숨기는
             것만으로는 주소창으로 들어오는 것을 못 막는다.
    공유     커뮤니티 유저가 글·이미지·동영상을 올리고, 남의 것은 조회만
             되며, 제 것에만 수정·삭제가 열린다.

접근은 기관관리자와 커뮤니티 유저에게만 열린다(슈퍼관리자 포함). 일반 회원은
메뉴도 없고, 주소를 쳐도 403 이다.
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
    """교육청 소속 커뮤니티 유저의 인증 헤더."""
    make_user("resident", org_id=office_id, roles=[Role.COMMUNITY_USER])
    return login("resident")


@pytest.fixture
def office_admin(client, make_user, login, office_id):  # noqa: ANN001, ANN201
    """교육청 기관관리자. 콘텐츠·재생목록은 관리자의 일이다."""
    make_user("officeboss", org_id=office_id, roles=[Role.ORG_ADMIN])
    return login("officeboss")


def _share(  # noqa: ANN001, ANN201
    client, headers, name="사진.png", data=PNG, mime="image/png",
    title="공유 자료", org_id=None,
):
    """게시판 글 하나에 파일 하나를 붙여 올린다.

    별도의 공유 창구는 없다 — 게시판 첨부가 곧 공유 재료다. 마지막 응답
    (첨부 = AssetOut)을 돌려주므로 실패 검사와 자산 참조가 그대로 된다.
    """
    params = f"?org_id={org_id}" if org_id else ""
    post = client.post(
        f"/api/v1/community/posts{params}", headers=headers, json={"title": title}
    )
    if post.status_code != 201:
        return post
    return client.post(
        f"/api/v1/community/posts/{post.json()['id']}/attachments",
        headers=headers,
        files={"file": (name, data, mime)},
    )


# ------------------------------------------------------------------ 자리


def test_community_sits_on_the_upper_org(client, community, office_id):  # noqa: ANN001
    body = client.get("/api/v1/community/context", headers=community).json()
    assert body["org_id"] == office_id
    assert body["can_share"] is True


def test_school_user_sees_the_parent_community(client, make_user, login, office_id, school_id):  # noqa: ANN001
    # 학교에는 커뮤니티가 없다. 트리를 올라가 교육청 커뮤니티를 본다.
    make_user("pupil", org_id=school_id, roles=[Role.COMMUNITY_USER])

    body = client.get("/api/v1/community/context", headers=login("pupil")).json()
    assert body["org_id"] == office_id


def test_plain_member_cannot_enter_the_community(client, make_user, login, office_id):  # noqa: ANN001
    # 커뮤니티는 기관관리자와 커뮤니티 유저의 공간이다. 일반 회원은 메뉴도
    # 없지만, 주소를 쳐도 여기서 막는다.
    make_user("staff", org_id=office_id, roles=[])
    headers = login("staff")

    assert client.get("/api/v1/community/context", headers=headers).status_code == 403
    assert client.get("/api/v1/community/posts", headers=headers).status_code == 403
    assert client.get("/api/v1/community/media?kind=image", headers=headers).status_code == 403
    assert _share(client, headers).status_code == 403


def test_org_admin_can_enter_the_community(client, office_admin):  # noqa: ANN001
    assert client.get("/api/v1/community/posts", headers=office_admin).status_code == 200
    assert client.get("/api/v1/community/media?kind=image", headers=office_admin).status_code == 200


def test_community_user_cannot_touch_contents_or_playlists(client, community):  # noqa: ANN001
    # 커뮤니티 유저는 자료를 올리는 사람이다. 자료를 엮어 화면에 내보내는
    # 일(콘텐츠·재생목록)은 관리자의 운영이다.
    assert client.get("/api/v1/community/contents", headers=community).status_code == 403
    assert client.get("/api/v1/community/playlists", headers=community).status_code == 403
    assert (
        client.post(
            "/api/v1/community/contents", headers=community, json={"title": "몰래"}
        ).status_code
        == 403
    )


# ------------------------------------------------------------------ 울타리


@pytest.mark.parametrize(
    "path",
    ["/api/v1/devices", "/api/v1/contents", "/api/v1/organizations", "/api/v1/users", "/api/v1/boards"],
)
def test_community_user_cannot_leave_the_community(client, community, path):  # noqa: ANN001
    # 메뉴를 숨기는 것만으로는 주소창으로 들어오는 것을 못 막는다.
    assert client.get(path, headers=community).status_code == 403


def test_community_user_can_use_the_community(client, community):  # noqa: ANN001
    assert client.get("/api/v1/community/posts", headers=community).status_code == 200
    assert client.get("/api/v1/community/media?kind=image", headers=community).status_code == 200


def test_other_roles_win_over_community(client, make_user, login, office_id):  # noqa: ANN001
    # 커뮤니티 역할은 '이것만' 이라는 제한이지 '이것을' 이라는 허가가 아니다.
    make_user("chief", org_id=office_id, roles=[Role.COMMUNITY_USER, Role.ORG_ADMIN])
    assert client.get("/api/v1/devices", headers=login("chief")).status_code == 200


# ------------------------------------------------------------------ 공유 게시판


def test_post_and_read_back(client, community):  # noqa: ANN001
    created = client.post(
        "/api/v1/community/posts",
        headers=community,
        json={"title": "주말 독서 모임", "content": "토요일 10시"},
    )
    assert created.status_code == 201

    posts = client.get("/api/v1/community/posts", headers=community).json()["items"]
    assert posts[0]["title"] == "주말 독서 모임"
    assert posts[0]["author_name"] == "resident"


def test_post_attachments_keep_their_order(client, community):  # noqa: ANN001
    post = client.post(
        "/api/v1/community/posts", headers=community, json={"title": "사진 나눔"}
    ).json()
    for name in ("하나.png", "둘.png"):
        response = client.post(
            f"/api/v1/community/posts/{post['id']}/attachments",
            headers=community,
            files={"file": (name, PNG, "image/png")},
        )
        assert response.status_code == 201

    posts = client.get("/api/v1/community/posts", headers=community).json()["items"]
    assert [a["filename"] for a in posts[0]["attachments"]] == ["하나.png", "둘.png"]


def test_only_the_author_or_admin_removes_a_post(client, community, make_user, login, office_id, super_headers):  # noqa: ANN001
    post = client.post(
        "/api/v1/community/posts", headers=community, json={"title": "내 글"}
    ).json()
    make_user("other", org_id=office_id, roles=[Role.COMMUNITY_USER])

    assert (
        client.delete(f"/api/v1/community/posts/{post['id']}", headers=login("other")).status_code
        == 403
    )
    assert (
        client.delete(f"/api/v1/community/posts/{post['id']}", headers=community).status_code
        == 200
    )


def test_cannot_attach_to_someone_elses_post(client, community, make_user, login, office_id):  # noqa: ANN001
    # 글과 첨부의 주인이 갈리면 지울 때 다툰다.
    post = client.post(
        "/api/v1/community/posts", headers=community, json={"title": "내 글"}
    ).json()
    make_user("other2", org_id=office_id, roles=[Role.COMMUNITY_USER])

    response = client.post(
        f"/api/v1/community/posts/{post['id']}/attachments",
        headers=login("other2"),
        files={"file": ("훼방.png", PNG, "image/png")},
    )
    assert response.status_code == 403


# ------------------------------------------------------------------ 공유 재료

# 별도의 공유 이미지·동영상 창구는 없다 — 게시판 글에 붙인 파일이 곧
# 공유 재료다. 콘텐츠 편집기와 재생목록이 /media 목록에서 고른다.


def test_attachments_become_materials_by_kind(client, community):  # noqa: ANN001
    _share(client, community, "풍경.png", title="사진 글")
    _share(client, community, "행사.mp4", MP4, "video/mp4", title="영상 글")

    images = client.get("/api/v1/community/media?kind=image", headers=community).json()
    videos = client.get("/api/v1/community/media?kind=video", headers=community).json()
    assert [m["title"] for m in images["items"]] == ["사진 글"]
    assert [m["asset"]["filename"] for m in images["items"]] == ["풍경.png"]
    assert [m["asset"]["filename"] for m in videos["items"]] == ["행사.mp4"]


def test_unsupported_type_is_rejected(client, community):  # noqa: ANN001
    assert _share(client, community, "문서.pdf", b"%PDF", "application/pdf").status_code == 400


def test_neighbors_in_the_same_community_can_see_it(client, community, make_user, login, school_id):  # noqa: ANN001
    # 학교의 커뮤니티 유저도 같은 교육청 커뮤니티의 재료를 본다 —
    # 그러라고 상위기관에 둔다.
    _share(client, community, "풍경.png")
    make_user("pupil2", org_id=school_id, roles=[Role.COMMUNITY_USER])

    body = client.get("/api/v1/community/media?kind=image", headers=login("pupil2")).json()
    assert body["total"] == 1


def test_shared_file_counts_as_used(client, community, super_headers):  # noqa: ANN001
    # 첨부된 파일을 '아무도 안 쓰는 파일' 로 보면 지운 뒤에야 화면이 빈다.
    attached = _share(client, community, "풍경.png").json()

    body = client.get(f"/api/v1/assets/{attached['id']}", headers=super_headers).json()
    assert body["usage_count"] == 1
    assert client.delete(f"/api/v1/assets/{attached['id']}", headers=super_headers).status_code == 400


# ------------------------------------------------------------------ 게시 결과

# 글은 늘 '대기중'으로 시작한다. 작성자는 손대지 못하고, 커뮤니티 소유
# 기관의 관리자(와 슈퍼관리자)만 대기중·게시·게시보류를 정한다 — 올리는
# 사람과 게시를 승인하는 사람을 가른다.


def _status(client, headers, post_id, value):  # noqa: ANN001
    return client.put(
        f"/api/v1/community/posts/{post_id}/status", headers=headers, json={"status": value}
    )


def test_posts_start_as_pending(client, community):  # noqa: ANN001
    post = client.post(
        "/api/v1/community/posts", headers=community, json={"title": "새 글"}
    ).json()
    assert post["publish_status"] == "대기중"
    assert post["can_publish"] is False


def test_the_author_cannot_set_the_status(client, community):  # noqa: ANN001
    post = client.post(
        "/api/v1/community/posts", headers=community, json={"title": "내 글"}
    ).json()
    assert _status(client, community, post["id"], "게시").status_code == 403


def test_the_community_org_admin_sets_the_status(client, community, office_admin):  # noqa: ANN001
    post = client.post(
        "/api/v1/community/posts", headers=community, json={"title": "주민 글"}
    ).json()

    updated = _status(client, office_admin, post["id"], "게시")
    assert updated.status_code == 200
    assert updated.json()["publish_status"] == "게시"
    assert updated.json()["can_publish"] is True

    held = _status(client, office_admin, post["id"], "게시보류")
    assert held.json()["publish_status"] == "게시보류"


def test_a_foreign_org_admin_cannot_set_the_status(client, community, make_user, login, office_id, school_id):  # noqa: ANN001
    # 학교 관리자는 학교까지만 관리한다 — 교육청 커뮤니티의 게시는 그 소유
    # 기관(교육청) 관리자의 일이다.
    post = client.post(
        "/api/v1/community/posts", headers=community, json={"title": "주민 글"}
    ).json()
    make_user("schoolboss", org_id=school_id, roles=[Role.ORG_ADMIN])

    assert _status(client, login("schoolboss"), post["id"], "게시").status_code == 403


def test_super_admin_sets_any_status(client, community, super_headers):  # noqa: ANN001
    post = client.post(
        "/api/v1/community/posts", headers=community, json={"title": "주민 글"}
    ).json()
    assert _status(client, super_headers, post["id"], "게시").status_code == 200


def test_unknown_status_is_rejected(client, community, office_admin):  # noqa: ANN001
    post = client.post(
        "/api/v1/community/posts", headers=community, json={"title": "주민 글"}
    ).json()
    assert _status(client, office_admin, post["id"], "반려").status_code == 400


# ------------------------------------------------------------------ 슈퍼관리자

# 슈퍼관리자는 소속과 무관하게 **모든** 커뮤니티를 쓴다. 시스템 전체를
# 운영하는 사람이라, 제 소속(최상위 기관) 커뮤니티에 갇히면 하위 교육청
# 커뮤니티를 돌볼 수 없다. 대상은 org_id 로 고른다.


def test_super_admin_can_enter_any_community(client, super_headers, office_id, community):  # noqa: ANN001
    client.post(
        "/api/v1/community/posts", headers=community, json={"title": "주민 글"}
    )

    body = client.get(
        f"/api/v1/community/posts?org_id={office_id}", headers=super_headers
    ).json()
    assert [p["title"] for p in body["items"]] == ["주민 글"]


def test_super_admin_can_post_into_any_community(client, super_headers, office_id):  # noqa: ANN001
    response = client.post(
        f"/api/v1/community/posts?org_id={office_id}",
        headers=super_headers,
        json={"title": "운영 공지"},
    )
    assert response.status_code == 201
    assert response.json()["org_id"] == office_id


def test_super_admin_can_share_into_any_community(client, super_headers, office_id, community):  # noqa: ANN001
    created = _share(client, super_headers, "공지.png", title="운영 공지", org_id=office_id)
    assert created.status_code == 201

    # 그 커뮤니티 주민에게 실제로 재료로 보인다.
    body = client.get("/api/v1/community/media?kind=image", headers=community).json()
    assert body["total"] == 1


def test_without_org_id_super_admin_gets_their_own(client, super_headers, root_org_id):  # noqa: ANN001
    # 안 고르면 남들과 같은 규칙이다 — 제 소속(최상위 기관) 커뮤니티.
    body = client.get("/api/v1/community/context", headers=super_headers).json()
    assert body["org_id"] == root_org_id


def test_others_cannot_pick_a_foreign_community(client, community, super_headers, root_org_id):  # noqa: ANN001
    # 고르기는 슈퍼관리자의 것이다. 남이 고르면 자기 것일 때만 통과한다.
    other = client.post(
        "/api/v1/organizations",
        headers=super_headers,
        json={"name": "다라교육청", "parent_id": root_org_id, "org_type": "기관"},
    ).json()["id"]

    assert (
        client.get(f"/api/v1/community/posts?org_id={other}", headers=community).status_code
        == 403
    )


def test_own_org_id_is_allowed_for_everyone(client, community, office_id):  # noqa: ANN001
    # 화면이 목록에서 고른 값을 늘 붙여 보내도 제 것이면 통과해야 한다.
    assert (
        client.get(f"/api/v1/community/posts?org_id={office_id}", headers=community).status_code
        == 200
    )


def test_a_school_id_is_not_a_community(client, super_headers, school_id):  # noqa: ANN001
    # 커뮤니티는 상위기관에만 있다. 학교 id 를 고르면 없는 곳이다.
    assert (
        client.get(f"/api/v1/community/posts?org_id={school_id}", headers=super_headers).status_code
        == 404
    )


def test_super_admin_sees_every_community_in_the_list(client, super_headers, office_id, root_org_id):  # noqa: ANN001
    body = client.get("/api/v1/community/list", headers=super_headers).json()
    ids = {row["org_id"] for row in body}
    assert {root_org_id, office_id} <= ids


def test_others_see_only_their_own_in_the_list(client, community, office_id):  # noqa: ANN001
    # 목록이 하나뿐이면 화면은 고르기를 그리지 않는다.
    body = client.get("/api/v1/community/list", headers=community).json()
    assert [row["org_id"] for row in body] == [office_id]


# ------------------------------------------------------------------ 커뮤니티 콘텐츠

# CMS 와 같은 캔버스 문서다. 다른 점은 재료뿐 — 위젯·재생목록은 기관 데이터를
# 끌어오는 통로라 커뮤니티 문서에 넣지 못한다.


@pytest.fixture
def shared_image_url(client, office_admin) -> str:  # noqa: ANN001
    return _share(client, office_admin, "풍경.png").json()["url"]


def _document(elements):  # noqa: ANN202
    return {
        "version": 1,
        "layout": {"width": 1920, "height": 1080, "background": "#000000"},
        "elements": elements,
    }


def _image_element(src, element_id="e1"):  # noqa: ANN202
    return {
        "id": element_id,
        "type": "image",
        "rect": {"x": 0, "y": 0, "w": 800, "h": 600, "z": 1},
        "options": {},
        "src": src,
    }


def _make_content(client, headers, document=None, title="시월 소식", org_id=None):  # noqa: ANN001
    params = f"?org_id={org_id}" if org_id else ""
    payload = {"title": title}
    if document is not None:
        payload["document"] = document
    return client.post(f"/api/v1/community/contents{params}", headers=headers, json=payload)


def test_content_starts_as_an_empty_canvas(client, office_admin):  # noqa: ANN001
    # 만들고 나서 편집기로 간다 — CMS 콘텐츠와 같은 흐름이다.
    body = _make_content(client, office_admin).json()

    assert body["document"]["elements"] == []
    assert body["document"]["layout"]["width"] == 1920
    assert body["version"] == 1


def test_content_saves_a_canvas_document(client, office_admin, shared_image_url):  # noqa: ANN001
    created = _make_content(
        client, office_admin, _document([_image_element(shared_image_url)])
    ).json()

    fetched = client.get(
        f"/api/v1/community/contents/{created['id']}", headers=office_admin
    ).json()
    assert fetched["document"]["elements"][0]["src"] == shared_image_url
    assert fetched["element_count"] == 1


def test_widgets_and_playlists_are_forbidden(client, office_admin):  # noqa: ANN001
    # 편집기 레일에도 없지만, 화면만 믿으면 API 로 직접 넣을 수 있다.
    for kind in ("widget", "playlist"):
        document = _document(
            [{"id": "e1", "type": kind, "rect": {"x": 0, "y": 0, "w": 100, "h": 100, "z": 1}}]
        )
        assert _make_content(client, office_admin, document).status_code == 400, kind


def test_basic_elements_are_fine(client, office_admin):  # noqa: ANN001
    document = _document(
        [
            {"id": "t", "type": "text", "rect": {"x": 0, "y": 0, "w": 100, "h": 50, "z": 1}, "options": {"text": "안내"}},
            {"id": "w", "type": "web", "rect": {"x": 0, "y": 60, "w": 100, "h": 50, "z": 2}, "src": "https://example.org"},
        ]
    )
    assert _make_content(client, office_admin, document).status_code == 201


def test_update_bumps_the_version(client, office_admin):  # noqa: ANN001
    content = _make_content(client, office_admin).json()

    updated = client.put(
        f"/api/v1/community/contents/{content['id']}",
        headers=office_admin,
        json={"title": "새 제목"},
    ).json()
    assert updated["version"] == 2


def test_only_author_or_admin_edits(client, office_admin, make_user, login, office_id):  # noqa: ANN001
    # 커뮤니티 유저는 콘텐츠 문 앞(_require_manage)에서 이미 403 이다.
    content = _make_content(client, office_admin).json()
    make_user("other4", org_id=office_id, roles=[Role.COMMUNITY_USER])

    response = client.put(
        f"/api/v1/community/contents/{content['id']}",
        headers=login("other4"),
        json={"title": "가로채기"},
    )
    assert response.status_code == 403


def test_used_asset_cannot_be_deleted(client, office_admin, super_headers, shared_image_url):  # noqa: ANN001
    # 문서가 쓰는 파일을 지우면 화면이 깨진다 — CMS 콘텐츠와 같은 보호다.
    _make_content(client, office_admin, _document([_image_element(shared_image_url)]))

    asset_id = int(shared_image_url.split("/assets/")[1].split("/")[0])
    body = client.get(f"/api/v1/assets/{asset_id}", headers=super_headers).json()
    # 공유 1 + 콘텐츠 1
    assert body["usage_count"] == 2


def test_shared_media_carries_a_thumbnail(client, office_admin):  # noqa: ANN001
    # 목록이 원본 대신 그릴 축소본. 진짜 이미지를 올려야 만들어진다.
    from io import BytesIO

    from PIL import Image

    buffer = BytesIO()
    Image.new("RGB", (640, 480), "#993333").save(buffer, "PNG")

    body = _share(client, office_admin, "진짜.png", buffer.getvalue()).json()
    assert body["thumb_url"]
    assert client.get(body["thumb_url"]).status_code == 200


# ------------------------------------------------------------------ 커뮤니티 위젯

# 위젯은 옵션이 없다. 무엇을 틀지는 서버가 고른다 — 사용기간 안이고 장치의
# 학교급(사용대상)에 맞는 콘텐츠 중 가장 최근 것. 화면마다 고르게 하면
# 기간이 지나거나 대상이 어긋난 채 방치된다.


def _widget_data(client, headers, org_id):  # noqa: ANN001
    return client.get(
        f"/api/v1/widgets/community/data?org_id={org_id}&options=%7B%7D", headers=headers
    ).json()["data"]


def _set(client, headers, content_id, **fields):  # noqa: ANN001
    return client.put(
        f"/api/v1/community/contents/{content_id}", headers=headers, json=fields
    )


def test_widget_serves_the_latest_fitting_content(client, office_admin, super_headers, office_id, shared_image_url):  # noqa: ANN001
    _make_content(client, office_admin, _document([_image_element(shared_image_url)]), title="옛 것")
    _make_content(client, office_admin, title="새 것")

    data = _widget_data(client, super_headers, office_id)
    assert data["active"] is True
    assert data["title"] == "새 것"


def test_widget_respects_the_content_period(client, office_admin, super_headers, office_id):  # noqa: ANN001
    # 사용기간은 콘텐츠가 들고 있다 — 같은 콘텐츠를 트는 화면이 몇 개든
    # 기간은 하나다.
    content = _make_content(client, office_admin, title="행사 홍보").json()
    _set(client, office_admin, content["id"], end_date="2000-01-01")

    data = _widget_data(client, super_headers, office_id)
    assert data["active"] is False
    assert data["document"] is None


def test_expired_content_falls_back_to_an_older_one(client, office_admin, super_headers, office_id):  # noqa: ANN001
    # 최신 것이 기간 밖이면 그 아래에서 맞는 것을 찾는다 — 빈 화면보다 낫다.
    _make_content(client, office_admin, title="상시 안내")
    newer = _make_content(client, office_admin, title="끝난 행사").json()
    _set(client, office_admin, newer["id"], end_date="2000-01-01")

    data = _widget_data(client, super_headers, office_id)
    assert data["active"] is True
    assert data["title"] == "상시 안내"


def test_audience_matches_the_school_level(client, office_admin, super_headers, office_id, school_id):  # noqa: ANN001
    # 초등학교 장치에는 '초' 와 '전체' 만 나간다.
    for title, audience in (("고등부용", "고"), ("초등부용", "초")):
        content = _make_content(client, office_admin, title=title).json()
        _set(client, office_admin, content["id"], audience=audience)

    data = _widget_data(client, super_headers, school_id)  # 초등학교
    assert data["title"] == "초등부용"


def test_office_devices_only_see_the_general_audience(client, office_admin, super_headers, office_id):  # noqa: ANN001
    # 교육청에는 학교급이 없다 — '전체' 만 맞는다.
    tagged = _make_content(client, office_admin, title="초등부용").json()
    _set(client, office_admin, tagged["id"], audience="초")
    _make_content(client, office_admin, title="모두에게")
    only = _make_content(client, office_admin, title="중등부용").json()
    _set(client, office_admin, only["id"], audience="중")

    data = _widget_data(client, super_headers, office_id)
    assert data["title"] == "모두에게"


def test_audience_must_be_a_known_value(client, office_admin):  # noqa: ANN001
    content = _make_content(client, office_admin).json()
    assert _set(client, office_admin, content["id"], audience="대학").status_code == 400


def test_widget_spec_has_no_options(client, super_headers):  # noqa: ANN001
    specs = client.get("/api/v1/widgets", headers=super_headers).json()
    widget = next(w for w in specs if w["key"] == "community")

    assert widget["data_driven"] is True
    assert widget["options"] == []


# ------------------------------------------------------------------ 커뮤니티 재생목록

# 공유 이미지·동영상을 순서와 시간으로 엮는다. 재료가 공유물뿐인 이유는
# 커뮤니티 울타리다 — 바깥 재료를 실어 나르면 안 된다.


@pytest.fixture
def shared_video_id(client, office_admin) -> int:  # noqa: ANN001
    return _share(client, office_admin, "행사.mp4", MP4, "video/mp4").json()["id"]


def _make_playlist(client, headers, items, name="가을 모음"):  # noqa: ANN001
    return client.post(
        "/api/v1/community/playlists", headers=headers, json={"name": name, "items": items}
    )


def test_build_a_playlist_from_shared_media(client, office_admin, shared_image_url, shared_video_id):  # noqa: ANN001
    image_id = int(shared_image_url.split("/assets/")[1].split("/")[0])
    response = _make_playlist(
        client,
        office_admin,
        [
            {"kind": "image", "asset_id": image_id, "duration_sec": 8, "transition": "fade"},
            {"kind": "video", "asset_id": shared_video_id, "duration_sec": 30},
        ],
    )
    assert response.status_code == 201

    body = response.json()
    assert body["version"] == 1
    assert [i["kind"] for i in body["items"]] == ["image", "video"]
    # 화면이 그릴 주소가 붙는다.
    assert body["items"][0]["url"].endswith("/file")
    assert body["items"][0]["transition"] == "fade"


def test_unshared_media_is_rejected(client, office_admin):  # noqa: ANN001
    response = _make_playlist(
        client, office_admin, [{"kind": "image", "asset_id": 99999, "duration_sec": 8}]
    )
    assert response.status_code == 400


def test_empty_playlist_is_rejected(client, office_admin):  # noqa: ANN001
    assert _make_playlist(client, office_admin, []).status_code == 400


def test_playlist_update_bumps_the_version(client, office_admin, shared_image_url):  # noqa: ANN001
    image_id = int(shared_image_url.split("/assets/")[1].split("/")[0])
    playlist = _make_playlist(
        client, office_admin, [{"kind": "image", "asset_id": image_id, "duration_sec": 8}]
    ).json()

    updated = client.put(
        f"/api/v1/community/playlists/{playlist['id']}",
        headers=office_admin,
        json={"name": "새 이름"},
    ).json()
    assert updated["version"] == 2


def test_only_the_author_or_admin_touches_a_playlist(client, office_admin, make_user, login, office_id, shared_image_url):  # noqa: ANN001
    image_id = int(shared_image_url.split("/assets/")[1].split("/")[0])
    playlist = _make_playlist(
        client, office_admin, [{"kind": "image", "asset_id": image_id, "duration_sec": 8}]
    ).json()
    make_user("other7", org_id=office_id, roles=[Role.COMMUNITY_USER])

    assert (
        client.delete(
            f"/api/v1/community/playlists/{playlist['id']}", headers=login("other7")
        ).status_code
        == 403
    )
    assert (
        client.delete(
            f"/api/v1/community/playlists/{playlist['id']}", headers=office_admin
        ).status_code
        == 200
    )
