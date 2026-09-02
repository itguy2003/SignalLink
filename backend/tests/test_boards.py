"""게시판 — 커뮤니티 유저와 첨부파일.

게시판은 커뮤니티 유저(``Role.COMMUNITY_USER``)에게 열려 있는 **유일한**
창구다. 그래서 확인할 것이 둘이다.

    울타리   그 사람이 게시판 바깥으로 나가지 못하는가. 화면에서 메뉴를
             숨기는 것만으로는 주소창에 직접 치고 들어오는 것을 못 막는다.
    창구     그 안에서는 제 일을 할 수 있는가. 읽고, 쓰고, 사진을 붙인다.
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
def school_id(client, super_headers, root_org_id) -> int:  # noqa: ANN001
    return client.post(
        "/api/v1/organizations",
        headers=super_headers,
        json={"name": "가나초등학교", "parent_id": root_org_id, "org_type": "학교"},
    ).json()["id"]


@pytest.fixture
def affiliate_id(client, super_headers, root_org_id) -> int:  # noqa: ANN001
    """기관에 딸린 곳(도서관 등). 커뮤니티 유저가 소속되는 자리다."""
    return client.post(
        "/api/v1/organizations",
        headers=super_headers,
        json={"name": "가나도서관", "parent_id": root_org_id, "org_type": "부설기관"},
    ).json()["id"]


@pytest.fixture
def board_id(client, super_headers, affiliate_id) -> int:  # noqa: ANN001
    return client.post(
        "/api/v1/boards",
        headers=super_headers,
        json={"org_id": affiliate_id, "kind": "게시판", "url": "https://library.example/notice"},
    ).json()["id"]


@pytest.fixture
def post_id(client, super_headers, board_id) -> int:  # noqa: ANN001
    return client.post(
        f"/api/v1/boards/{board_id}/posts",
        headers=super_headers,
        json={"title": "가을 운동회 안내", "content": "10월 15일에 엽니다."},
    ).json()["id"]


@pytest.fixture
def community(client, make_user, login, affiliate_id):  # noqa: ANN001, ANN201
    """부설기관 소속 커뮤니티 유저의 인증 헤더."""
    make_user("visitor", org_id=affiliate_id, roles=[Role.COMMUNITY_USER])
    return login("visitor")


# ------------------------------------------------------------------ 울타리


@pytest.mark.parametrize(
    "path",
    ["/api/v1/devices", "/api/v1/contents", "/api/v1/organizations", "/api/v1/users", "/api/v1/schedules"],
)
def test_community_user_cannot_leave_the_board(client, community, path):  # noqa: ANN001
    # 메뉴를 숨기는 것만으로는 주소창에 직접 치고 들어오는 것을 못 막는다.
    assert client.get(path, headers=community).status_code == 403


def test_community_user_can_read_own_board(client, community, board_id):  # noqa: ANN001
    assert client.get("/api/v1/boards", headers=community).status_code == 200
    assert client.get(f"/api/v1/boards/{board_id}/posts", headers=community).status_code == 200


def test_community_user_can_see_who_they_are(client, community):  # noqa: ANN001
    # 로그인한 뒤 이름조차 못 읽으면 화면을 그릴 수 없다.
    body = client.get("/api/v1/auth/me", headers=community).json()
    assert Role.COMMUNITY_USER in body["roles"]


def test_admin_is_not_fenced_in(client, super_headers):  # noqa: ANN001
    assert client.get("/api/v1/devices", headers=super_headers).status_code == 200


def test_other_roles_win_over_community(client, make_user, login, school_id):  # noqa: ANN001
    # 커뮤니티 역할은 '이것만' 이라는 제한이지 '이것을' 이라는 허가가 아니다.
    # 담당자에게 얹었다고 그 사람이 장치를 못 보게 되면 곤란하다.
    make_user("teacher", org_id=school_id, roles=[Role.COMMUNITY_USER, Role.ORG_ADMIN])

    assert client.get("/api/v1/devices", headers=login("teacher")).status_code == 200


# ------------------------------------------------------------------ 글쓰기


def test_community_user_can_post(client, community, board_id):  # noqa: ANN001
    # 게시판이 그 사람에게 열려 있는 유일한 창구다.
    response = client.post(
        f"/api/v1/boards/{board_id}/posts",
        headers=community,
        json={"title": "학부모 모임 안내", "content": "다음 주 화요일"},
    )
    assert response.status_code == 201


def test_community_user_cannot_post_to_another_org(client, community, super_headers, root_org_id):  # noqa: ANN001
    other = client.post(
        "/api/v1/organizations",
        headers=super_headers,
        json={"name": "다른도서관", "parent_id": root_org_id, "org_type": "부설기관"},
    ).json()["id"]
    board = client.post(
        "/api/v1/boards",
        headers=super_headers,
        json={"org_id": other, "kind": "게시판", "url": "https://other.example"},
    ).json()["id"]

    response = client.post(
        f"/api/v1/boards/{board}/posts", headers=community, json={"title": "남의 학교"}
    )
    assert response.status_code == 403


def test_community_user_cannot_manage_the_board_itself(client, community, affiliate_id, board_id):  # noqa: ANN001
    # 글을 쓰는 것과 수집원을 손대는 것은 다른 일이다.
    assert (
        client.post(
            "/api/v1/boards",
            headers=community,
            json={"org_id": affiliate_id, "kind": "게시판", "url": "https://x.example"},
        ).status_code
        == 403
    )
    assert client.delete(f"/api/v1/boards/{board_id}", headers=community).status_code == 403


# ------------------------------------------------------------------ 첨부파일


def _attach(client, headers, board_id, post_id, name="사진.png", data=PNG, mime="image/png"):  # noqa: ANN001
    return client.post(
        f"/api/v1/boards/{board_id}/posts/{post_id}/attachments",
        headers=headers,
        files={"file": (name, data, mime)},
    )


def test_attach_image(client, super_headers, board_id, post_id):  # noqa: ANN001
    body = _attach(client, super_headers, board_id, post_id).json()

    assert body["kind"] == "image"
    assert body["url"].endswith("/file")


def test_attach_video(client, super_headers, board_id, post_id):  # noqa: ANN001
    body = _attach(client, super_headers, board_id, post_id, "영상.mp4", MP4, "video/mp4").json()
    assert body["kind"] == "video"


def test_attachment_shows_up_on_the_post(client, super_headers, board_id, post_id):  # noqa: ANN001
    _attach(client, super_headers, board_id, post_id)

    posts = client.get(f"/api/v1/boards/{board_id}/posts", headers=super_headers).json()["items"]
    assert len(posts[0]["attachments"]) == 1
    assert posts[0]["attachments"][0]["filename"] == "사진.png"


def test_attachments_keep_the_order_they_came_in(client, super_headers, board_id, post_id):  # noqa: ANN001
    # 사진 여러 장을 붙였으면 올린 차례대로 보여야 한다.
    for name in ("하나.png", "둘.png", "셋.png"):
        _attach(client, super_headers, board_id, post_id, name)

    posts = client.get(f"/api/v1/boards/{board_id}/posts", headers=super_headers).json()["items"]
    assert [a["filename"] for a in posts[0]["attachments"]] == ["하나.png", "둘.png", "셋.png"]


def test_community_user_can_attach(client, community, board_id):  # noqa: ANN001
    post = client.post(
        f"/api/v1/boards/{board_id}/posts", headers=community, json={"title": "사진 올립니다"}
    ).json()

    assert _attach(client, community, board_id, post["id"]).status_code == 201


def test_unsupported_type_is_rejected(client, super_headers, board_id, post_id):  # noqa: ANN001
    # 그릴 수 없는 형식은 붙여 봐야 화면에 안 나온다.
    response = _attach(client, super_headers, board_id, post_id, "문서.pdf", b"%PDF", "application/pdf")
    assert response.status_code == 400


def test_empty_file_is_rejected(client, super_headers, board_id, post_id):  # noqa: ANN001
    assert _attach(client, super_headers, board_id, post_id, "빈.png", b"", "image/png").status_code == 400


def test_detach(client, super_headers, board_id, post_id):  # noqa: ANN001
    asset = _attach(client, super_headers, board_id, post_id).json()

    response = client.delete(
        f"/api/v1/boards/{board_id}/posts/{post_id}/attachments/{asset['id']}",
        headers=super_headers,
    )
    assert response.status_code == 200

    posts = client.get(f"/api/v1/boards/{board_id}/posts", headers=super_headers).json()["items"]
    assert posts[0]["attachments"] == []


def test_detach_renumbers_the_rest(client, super_headers, board_id, post_id):  # noqa: ANN001
    # 뗀 자리를 비워 두면 다음에 붙일 때 순서가 겹친다.
    ids = [
        _attach(client, super_headers, board_id, post_id, name).json()["id"]
        for name in ("하나.png", "둘.png", "셋.png")
    ]
    client.delete(
        f"/api/v1/boards/{board_id}/posts/{post_id}/attachments/{ids[0]}", headers=super_headers
    )
    _attach(client, super_headers, board_id, post_id, "넷.png")

    posts = client.get(f"/api/v1/boards/{board_id}/posts", headers=super_headers).json()["items"]
    assert [a["filename"] for a in posts[0]["attachments"]] == ["둘.png", "셋.png", "넷.png"]


def test_attached_file_counts_as_used(client, super_headers, board_id, post_id):  # noqa: ANN001
    # 붙은 파일을 '아무도 안 쓰는 파일' 로 보면 지운 뒤에야 글이 빈 것을 알게 된다.
    asset = _attach(client, super_headers, board_id, post_id).json()

    body = client.get(f"/api/v1/assets/{asset['id']}", headers=super_headers).json()
    assert body["usage_count"] == 1
    assert client.delete(f"/api/v1/assets/{asset['id']}", headers=super_headers).status_code == 400


def test_deleting_the_post_frees_the_file(client, super_headers, board_id, post_id):  # noqa: ANN001
    asset = _attach(client, super_headers, board_id, post_id).json()
    client.delete(f"/api/v1/boards/{board_id}/posts/{post_id}", headers=super_headers)

    body = client.get(f"/api/v1/assets/{asset['id']}", headers=super_headers).json()
    assert body["usage_count"] == 0


# ------------------------------------------------------------------ 소속 자리

# 커뮤니티 유저는 **부설기관**(도서관·문화센터 등) 소속이다. 학교에 두지 않는
# 이유는 그 사람이 학교 구성원이 아니기 때문이다 — 학교 게시판을 바깥 사람에게
# 열어 주는 것과, 부설기관 게시판을 그 이용자에게 열어 주는 것은 다른 일이다.


def _make_plain_user(client, super_headers, org_id: int, user_id: str) -> int:  # noqa: ANN001
    return client.post(
        "/api/v1/users",
        headers=super_headers,
        json={"org_id": org_id, "user_id": user_id, "password": "test1234", "name": user_id},
    ).json()["id"]


def _set_roles(client, super_headers, user_id: int, roles: list[str]):  # noqa: ANN001, ANN202
    return client.put(f"/api/v1/users/{user_id}", headers=super_headers, json={"roles": roles})


def test_community_role_needs_an_affiliate_org(client, super_headers, affiliate_id):  # noqa: ANN001
    target = _make_plain_user(client, super_headers, affiliate_id, "visitor2")

    response = _set_roles(client, super_headers, target, ["COMMUNITY_USER"])
    assert response.status_code == 200
    assert "COMMUNITY_USER" in response.json()["roles"]


def test_community_role_is_refused_in_a_school(client, super_headers, school_id):  # noqa: ANN001
    target = _make_plain_user(client, super_headers, school_id, "pupil")

    response = _set_roles(client, super_headers, target, ["COMMUNITY_USER"])
    assert response.status_code == 400


def test_community_role_is_refused_in_a_plain_org(client, super_headers, root_org_id):  # noqa: ANN001
    # 상급기관 자체에도 두지 않는다. 부설기관이라는 자리를 따로 만든 이유다.
    target = _make_plain_user(client, super_headers, root_org_id, "staff")

    assert _set_roles(client, super_headers, target, ["COMMUNITY_USER"]).status_code == 400


def test_other_roles_are_free_of_the_rule(client, super_headers, school_id):  # noqa: ANN001
    target = _make_plain_user(client, super_headers, school_id, "manager")

    assert _set_roles(client, super_headers, target, ["DEVICE_MANAGER"]).status_code == 200


def test_community_user_cannot_be_moved_into_a_school(client, super_headers, affiliate_id, school_id):  # noqa: ANN001
    # 옮기고 나서야 있을 자리가 없어지면, 그 계정은 아무 게시판도 못 쓴다.
    target = _make_plain_user(client, super_headers, affiliate_id, "visitor3")
    _set_roles(client, super_headers, target, ["COMMUNITY_USER"])

    response = client.put(
        f"/api/v1/users/{target}", headers=super_headers, json={"org_id": school_id}
    )
    assert response.status_code == 400


def test_moving_out_is_fine_when_the_role_goes_too(client, super_headers, affiliate_id, school_id):  # noqa: ANN001
    # 역할을 함께 거두면 학교로 옮겨도 된다.
    target = _make_plain_user(client, super_headers, affiliate_id, "visitor4")
    _set_roles(client, super_headers, target, ["COMMUNITY_USER"])

    response = client.put(
        f"/api/v1/users/{target}",
        headers=super_headers,
        json={"org_id": school_id, "roles": []},
    )
    assert response.status_code == 200
