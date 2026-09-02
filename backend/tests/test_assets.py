"""업로드 자산(이미지·동영상) 검증.

콘텐츠 편집기가 그림·영상을 받는 방법은 링크와 업로드 둘이다(AI 는 아직
없다). 업로드 쪽이 있는 이유는 학교처럼 바깥으로 못 나가는 망 때문이므로,
**장치가 이 파일을 받아 갈 수 있는가**가 가장 중요한 확인 대상이다.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from app.services import assets as asset_service

PNG = b"\x89PNG\r\n\x1a\n" + b"0" * 64
MP4 = b"\x00\x00\x00\x18ftypmp42" + b"0" * 64


@pytest.fixture(autouse=True)
def media_root(tmp_path: Path, monkeypatch) -> Path:  # noqa: ANN001
    """파일을 임시 폴더에 쓴다. 저장소나 개발용 media/ 를 더럽히지 않는다."""
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
def upload(client, super_headers, school_id):  # noqa: ANN001, ANN201
    def _upload(name: str = "poster.png", data: bytes = PNG, mime: str = "image/png"):
        return client.post(
            f"/api/v1/assets?org_id={school_id}",
            headers=super_headers,
            files={"file": (name, data, mime)},
        )

    return _upload


def _content_with(client, headers, org_id: int, src: str) -> dict:  # noqa: ANN001
    return client.post(
        "/api/v1/contents",
        headers=headers,
        json={
            "name": "포스터",
            "org_id": org_id,
            "document": {
                "version": 1,
                "layout": {"width": 1920, "height": 1080, "background": "#000000"},
                "elements": [
                    {
                        "id": "e1",
                        "type": "image",
                        "rect": {"x": 0, "y": 0, "w": 1920, "h": 1080, "z": 1},
                        "options": {},
                        "src": src,
                    }
                ],
            },
        },
    ).json()


# ------------------------------------------------------------------ 업로드


def test_image_upload(upload):
    body = upload().json()
    assert body["kind"] == "image"
    assert body["filename"] == "poster.png"
    assert body["size_bytes"] == len(PNG)


def test_video_upload(upload):
    body = upload("intro.mp4", MP4, "video/mp4").json()
    assert body["kind"] == "video"


def test_url_is_returned(upload):
    """편집기가 경로 규칙을 알 필요가 없도록 서버가 주소를 준다."""
    body = upload().json()
    assert body["url"].startswith(f"/api/v1/assets/{body['id']}/")
    assert body["url"].endswith("/file")


def test_unknown_type_is_rejected(upload):
    # 저장은 됐는데 장치에서 안 나오는 파일이 쌓이면 원인을 찾기 어렵다.
    assert upload("doc.pdf", b"%PDF-1.4", "application/pdf").status_code == 400


def test_empty_file_is_rejected(upload):
    assert upload("empty.png", b"", "image/png").status_code == 400


def test_oversized_image_is_rejected(client, super_headers, school_id, monkeypatch):
    monkeypatch.setattr(asset_service.settings, "MAX_IMAGE_BYTES", 10)
    response = client.post(
        f"/api/v1/assets?org_id={school_id}",
        headers=super_headers,
        files={"file": ("big.png", PNG, "image/png")},
    )
    assert response.status_code == 400


def test_file_lands_on_disk(upload, media_root):
    upload()
    written = list(media_root.rglob("*.png"))
    assert len(written) == 1
    assert written[0].read_bytes() == PNG


def test_stored_name_is_not_the_uploaded_name(upload, media_root):
    """올린 이름을 그대로 쓰면 같은 이름끼리 서로를 덮는다."""
    upload()
    written = list(media_root.rglob("*.png"))[0]
    assert written.name != "poster.png"


def test_two_uploads_do_not_collide(upload, media_root):
    upload()
    upload()
    assert len(list(media_root.rglob("*.png"))) == 2


# ------------------------------------------------------------------ 내려받기


def test_anyone_with_the_url_can_download(client, upload):
    """브라우저의 <img> 는 인증 헤더를 붙일 수 없다.

    인증을 요구하면 CMS 화면에서도 장치에서도 그림이 뜨지 않는다 — 주소를
    알아맞힐 수 없게 만드는 쪽으로 막는다.
    """
    asset = upload().json()
    response = client.get(asset["url"])
    assert response.status_code == 200
    assert response.content == PNG


def test_wrong_key_is_not_found(client, upload):
    """열쇠가 틀리면 '없다' 고 답한다.

    '있지만 열쇠가 틀렸다' 고 알려 주면 어떤 id 가 존재하는지가 드러난다.
    """
    asset = upload().json()
    assert client.get(f"/api/v1/assets/{asset['id']}/deadbeef/file").status_code == 404


def test_key_is_not_guessable(upload):
    # id 는 1,2,3… 이라 열쇠가 없으면 남의 파일을 훑어 갈 수 있다.
    asset = upload().json()
    key = asset["url"].split("/")[-2]
    assert len(key) == 32


def test_missing_file_is_not_found(client, super_headers, upload, media_root):
    # 파일만 사라진 경우. 500 이 아니라 404 여야 원인이 드러난다.
    asset = upload().json()
    for path in media_root.rglob("*.png"):
        path.unlink()
    assert client.get(asset["url"], headers=super_headers).status_code == 404


def test_download_is_cacheable(client, super_headers, upload):
    """내용이 바뀌지 않는 파일이다. 매번 다시 받으면 좁은 회선을 잡아먹는다."""
    asset = upload().json()
    response = client.get(asset["url"], headers=super_headers)
    assert "max-age" in response.headers["cache-control"]


# ------------------------------------------------------------------ 색인·삭제


def test_content_records_the_link(client, super_headers, school_id, upload):
    asset = upload().json()
    _content_with(client, super_headers, school_id, asset["url"])

    body = client.get(f"/api/v1/assets/{asset['id']}", headers=super_headers).json()
    assert body["usage_count"] == 1


def test_link_is_dropped_when_removed(client, super_headers, school_id, upload):
    asset = upload().json()
    content = _content_with(client, super_headers, school_id, asset["url"])
    client.put(
        f"/api/v1/contents/{content['id']}",
        headers=super_headers,
        json={"document": {"version": 1, "layout": content["document"]["layout"], "elements": []}},
    )

    body = client.get(f"/api/v1/assets/{asset['id']}", headers=super_headers).json()
    assert body["usage_count"] == 0


def test_external_link_is_not_indexed(client, super_headers, school_id, upload):
    # 바깥 주소를 쓰는 콘텐츠는 우리 자산과 무관하다.
    asset = upload().json()
    _content_with(client, super_headers, school_id, "https://cdn.example.com/a.png")

    body = client.get(f"/api/v1/assets/{asset['id']}", headers=super_headers).json()
    assert body["usage_count"] == 0


def test_delete_unused(client, super_headers, upload, media_root):
    asset = upload().json()
    assert client.delete(f"/api/v1/assets/{asset['id']}", headers=super_headers).status_code == 200
    assert list(media_root.rglob("*.png")) == []


def test_delete_is_blocked_while_in_use(client, super_headers, school_id, upload):
    """지우고 나서야 화면이 깨진 것을 알면 어느 콘텐츠였는지 되짚을 수 없다."""
    asset = upload().json()
    _content_with(client, super_headers, school_id, asset["url"])

    response = client.delete(f"/api/v1/assets/{asset['id']}", headers=super_headers)
    assert response.status_code == 400
    assert "사용 중" in response.json()["detail"]


# ------------------------------------------------------------------ 목록·이름


def test_list_filters_by_kind(client, super_headers, upload):
    upload()
    upload("intro.mp4", MP4, "video/mp4")

    body = client.get("/api/v1/assets?kind=video", headers=super_headers).json()
    assert [i["kind"] for i in body["items"]] == ["video"]


def test_list_is_scoped(client, super_headers, upload, root_org_id, make_user, login):
    # 남의 기관 파일이 목록에 보이면 안 된다.
    upload()
    other = client.post(
        "/api/v1/organizations",
        headers=super_headers,
        json={"name": "다른학교", "parent_id": root_org_id, "org_type": "학교"},
    ).json()["id"]
    make_user("teacher", org_id=other, roles=[])

    body = client.get("/api/v1/assets", headers=login("teacher")).json()
    assert body["items"] == []


def test_rename(client, super_headers, upload):
    asset = upload().json()
    body = client.put(
        f"/api/v1/assets/{asset['id']}", headers=super_headers, json={"filename": "행사 포스터.png"}
    ).json()
    assert body["filename"] == "행사 포스터.png"


# ------------------------------------------------------------------ 주소 파싱


@pytest.mark.parametrize(
    ("src", "expected"),
    [
        ("/api/v1/assets/7/file", 7),
        ("http://host/api/v1/assets/12/file", 12),
        ("https://cdn.example.com/a.png", None),
        ("", None),
        (None, None),
        ("/api/v1/assets/abc/file", None),
    ],
)
def test_asset_id_from_url(src, expected):
    assert asset_service.asset_id_from_url(src) == expected


# ------------------------------------------------------------------ 이미지앨범

# 앨범은 사진 주소를 **요소가 아니라 위젯 옵션 안에** 여러 개 들고 있다.
# 요소의 src 만 세면 앨범이 쓰는 사진은 '아무도 안 쓰는 파일' 로 보여,
# 지운 뒤에야 앨범이 빈 것을 알게 된다.


def _content_with_album(client, headers, org_id: int, sources: list[str]) -> dict:  # noqa: ANN001
    return client.post(
        "/api/v1/contents",
        headers=headers,
        json={
            "name": "앨범 콘텐츠",
            "org_id": org_id,
            "document": {
                "version": 1,
                "layout": {"width": 1920, "height": 1080, "background": "#000000"},
                "elements": [
                    {
                        "id": "e1",
                        "type": "widget",
                        "widget_key": "album",
                        "rect": {"x": 0, "y": 0, "w": 1920, "h": 1080, "z": 1},
                        "options": {"images": [{"src": src} for src in sources]},
                    }
                ],
            },
        },
    ).json()


def test_album_images_are_indexed(client, super_headers, school_id, upload):
    first = upload("a.png").json()
    second = upload("b.png").json()
    _content_with_album(client, super_headers, school_id, [first["url"], second["url"]])

    for asset in (first, second):
        body = client.get(f"/api/v1/assets/{asset['id']}", headers=super_headers).json()
        assert body["usage_count"] == 1


def test_album_image_cannot_be_deleted_while_in_use(client, super_headers, school_id, upload):
    asset = upload().json()
    _content_with_album(client, super_headers, school_id, [asset["url"]])

    response = client.delete(f"/api/v1/assets/{asset['id']}", headers=super_headers)
    assert response.status_code == 400


def test_album_link_is_dropped_when_image_removed(client, super_headers, school_id, upload):
    asset = upload().json()
    content = _content_with_album(client, super_headers, school_id, [asset["url"]])

    # 앨범에서 사진을 빼면 색인도 함께 빠져야 지울 수 있게 된다.
    document = content["document"]
    document["elements"][0]["options"]["images"] = []
    client.put(
        f"/api/v1/contents/{content['id']}", headers=super_headers, json={"document": document}
    )

    assert client.delete(f"/api/v1/assets/{asset['id']}", headers=super_headers).status_code == 200


def test_album_external_link_is_not_indexed(client, super_headers, school_id, upload):
    asset = upload().json()
    _content_with_album(client, super_headers, school_id, ["https://cdn.example.com/a.png"])

    body = client.get(f"/api/v1/assets/{asset['id']}", headers=super_headers).json()
    assert body["usage_count"] == 0


def test_album_in_playlist_is_indexed(client, super_headers, school_id, upload):
    # 앨범은 재생목록의 한 칸으로도 놓인다. 그 경로도 같이 막혀야 한다.
    asset = upload().json()
    client.post(
        "/api/v1/playlists",
        headers=super_headers,
        json={
            "name": "사진 돌리기",
            "org_id": school_id,
            "items": [
                {
                    "widget_key": "album",
                    "duration_sec": 30,
                    "options": {"images": [{"src": asset["url"]}]},
                }
            ],
        },
    )

    body = client.get(f"/api/v1/assets/{asset['id']}", headers=super_headers).json()
    assert body["usage_count"] == 1
    assert client.delete(f"/api/v1/assets/{asset['id']}", headers=super_headers).status_code == 400


def test_playlist_album_link_follows_edits(client, super_headers, school_id, upload):
    asset = upload().json()
    playlist = client.post(
        "/api/v1/playlists",
        headers=super_headers,
        json={
            "name": "사진 돌리기",
            "org_id": school_id,
            "items": [
                {
                    "widget_key": "album",
                    "duration_sec": 30,
                    "options": {"images": [{"src": asset["url"]}]},
                }
            ],
        },
    ).json()

    client.put(
        f"/api/v1/playlists/{playlist['id']}",
        headers=super_headers,
        json={"items": [{"widget_key": "clock", "duration_sec": 10, "options": {}}]},
    )

    body = client.get(f"/api/v1/assets/{asset['id']}", headers=super_headers).json()
    assert body["usage_count"] == 0
