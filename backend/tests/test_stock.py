"""스톡 소재 검색(Pixabay) 검증.

**바깥으로 나가지 않는다.** 실제 Pixabay 를 부르면 네트워크가 막힌 곳에서
테스트가 깨지고, 남의 호출 한도를 쓴다. httpx 호출만 갈아 끼워 우리 코드가
응답을 어떻게 다루는지를 본다.
"""

from __future__ import annotations

import httpx
import pytest

from app.core.config import settings
from app.services import pixabay

SAMPLE_HIT = {
    "id": 12345,
    "pageURL": "https://pixabay.com/photos/school-12345/",
    "previewURL": "https://cdn.pixabay.com/preview.jpg",
    "webformatURL": "https://cdn.pixabay.com/640.jpg",
    "largeImageURL": "https://cdn.pixabay.com/1280.jpg",
    "imageWidth": 1920,
    "imageHeight": 1280,
    "tags": "school, classroom",
    "user": "someone",
}


SAMPLE_VIDEO = {
    "id": 999,
    "pageURL": "https://pixabay.com/videos/school-999/",
    "picture_id": "abc123",
    "duration": 17,
    "tags": "school, kids",
    "user": "someone",
    "videos": {
        "large": {"url": "https://cdn.pixabay.com/large.mp4", "width": 1920, "height": 1080},
        "small": {"url": "https://cdn.pixabay.com/small.mp4", "width": 640, "height": 360},
    },
}


@pytest.fixture
def with_key(monkeypatch):
    monkeypatch.setattr(settings, "PIXABAY_API_KEY", "test-key", raising=False)


@pytest.fixture
def without_key(monkeypatch):
    monkeypatch.setattr(settings, "PIXABAY_API_KEY", "", raising=False)


def stub_response(monkeypatch, *, status_code=200, json_body=None, exc=None):
    """httpx 호출을 갈아 끼우고, 실제로 보낸 파라미터를 돌려준다."""
    sent: dict = {}

    async def fake_get(self, url, params=None, **kwargs):  # noqa: ANN001, ARG001
        sent["url"] = url
        sent["params"] = params or {}
        if exc is not None:
            raise exc
        return httpx.Response(
            status_code, json=json_body if json_body is not None else {},
            request=httpx.Request("GET", url),
        )

    monkeypatch.setattr(httpx.AsyncClient, "get", fake_get)
    return sent


# ------------------------------------------------------------------ 설정 여부
def test_status_reports_missing_key(client, super_headers, without_key):
    body = client.get("/api/v1/stock/status", headers=super_headers).json()
    assert body["configured"] is False
    assert body["provider"] == "pixabay"


def test_status_reports_configured(client, super_headers, with_key):
    assert client.get("/api/v1/stock/status", headers=super_headers).json()["configured"] is True


def test_search_without_key_is_503(client, super_headers, without_key):
    # 설정 문제다. 검색어를 고쳐도 해결되지 않으므로 사용자 오류와 구분한다.
    response = client.get("/api/v1/stock/search", headers=super_headers, params={"q": "학교"})
    assert response.status_code == 503
    assert "PIXABAY_API_KEY" in response.json()["detail"]


# ------------------------------------------------------------------ 인증
def test_search_requires_login(client, with_key):
    # 인증 없이 열어 두면 우리 서버가 남의 이미지 검색 창구가 된다.
    assert client.get("/api/v1/stock/search", params={"q": "학교"}).status_code == 401


def test_status_requires_login(client):
    assert client.get("/api/v1/stock/status").status_code == 401


# ------------------------------------------------------------------ 정상 검색
def test_search_returns_normalized_items(client, super_headers, with_key, monkeypatch):
    stub_response(monkeypatch, json_body={"totalHits": 1, "hits": [SAMPLE_HIT]})

    body = client.get(
        "/api/v1/stock/search", headers=super_headers, params={"q": "학교"}
    ).json()

    assert body["total"] == 1
    item = body["items"][0]
    assert item["url"] == SAMPLE_HIT["largeImageURL"]
    assert item["preview"] == SAMPLE_HIT["previewURL"]
    assert item["author"] == "someone"
    assert item["page"] == SAMPLE_HIT["pageURL"]


def test_large_image_is_preferred(client, super_headers, with_key, monkeypatch):
    # webformatURL 은 최대 640px 이라 DID 화면에는 작다.
    hit = {**SAMPLE_HIT, "largeImageURL": None}
    stub_response(monkeypatch, json_body={"totalHits": 1, "hits": [hit]})

    body = client.get("/api/v1/stock/search", headers=super_headers, params={"q": "x"}).json()
    assert body["items"][0]["url"] == SAMPLE_HIT["webformatURL"]


def test_hits_without_url_are_dropped(client, super_headers, with_key, monkeypatch):
    # 주소가 없으면 콘텐츠에 넣을 수 없다. 빈 카드를 그리느니 빼는 편이 낫다.
    broken = {**SAMPLE_HIT, "largeImageURL": None, "webformatURL": None}
    stub_response(monkeypatch, json_body={"totalHits": 2, "hits": [SAMPLE_HIT, broken]})

    body = client.get("/api/v1/stock/search", headers=super_headers, params={"q": "x"}).json()
    assert len(body["items"]) == 1


def test_api_key_is_not_echoed_back(client, super_headers, with_key, monkeypatch):
    # 응답에 키가 섞여 나가면 서버에 둔 의미가 없다.
    stub_response(monkeypatch, json_body={"totalHits": 1, "hits": [SAMPLE_HIT]})
    raw = client.get("/api/v1/stock/search", headers=super_headers, params={"q": "x"}).text
    assert "test-key" not in raw


# ------------------------------------------------------------------ 요청 파라미터
def test_safesearch_is_always_on(client, super_headers, with_key, monkeypatch):
    # 공공장소에 표출되는 화면이다.
    sent = stub_response(monkeypatch, json_body={"totalHits": 0, "hits": []})
    client.get("/api/v1/stock/search", headers=super_headers, params={"q": "x"})
    assert sent["params"]["safesearch"] == "true"


def test_orientation_is_passed_through(client, super_headers, with_key, monkeypatch):
    sent = stub_response(monkeypatch, json_body={"totalHits": 0, "hits": []})
    client.get(
        "/api/v1/stock/search",
        headers=super_headers,
        params={"q": "x", "orientation": "vertical"},
    )
    assert sent["params"]["orientation"] == "vertical"


def test_orientation_is_omitted_when_not_given(client, super_headers, with_key, monkeypatch):
    sent = stub_response(monkeypatch, json_body={"totalHits": 0, "hits": []})
    client.get("/api/v1/stock/search", headers=super_headers, params={"q": "x"})
    assert "orientation" not in sent["params"]


def test_bad_orientation_is_rejected(client, super_headers, with_key):
    response = client.get(
        "/api/v1/stock/search",
        headers=super_headers,
        params={"q": "x", "orientation": "대각선"},
    )
    assert response.status_code == 400


def test_empty_query_is_rejected(client, super_headers, with_key):
    assert (
        client.get("/api/v1/stock/search", headers=super_headers, params={"q": ""}).status_code
        == 422
    )


# ------------------------------------------------------------------ 외부 실패
def test_upstream_error_is_502(client, super_headers, with_key, monkeypatch):
    stub_response(monkeypatch, status_code=500, json_body={})
    response = client.get("/api/v1/stock/search", headers=super_headers, params={"q": "x"})
    assert response.status_code == 502


def test_rate_limit_says_so(client, super_headers, with_key, monkeypatch):
    stub_response(monkeypatch, status_code=429, json_body={})
    response = client.get("/api/v1/stock/search", headers=super_headers, params={"q": "x"})
    assert response.status_code == 502
    assert "한도" in response.json()["detail"]


def test_network_failure_is_reported(client, super_headers, with_key, monkeypatch):
    # 폐쇄망이면 외부로 나갈 수 없다. 흔한 상황이라 원인을 분명히 말한다.
    stub_response(monkeypatch, exc=httpx.ConnectError("no route"))
    response = client.get("/api/v1/stock/search", headers=super_headers, params={"q": "x"})
    assert response.status_code == 502
    assert "연결" in response.json()["detail"]


def test_timeout_is_reported(client, super_headers, with_key, monkeypatch):
    stub_response(monkeypatch, exc=httpx.ReadTimeout("slow"))
    response = client.get("/api/v1/stock/search", headers=super_headers, params={"q": "x"})
    assert response.status_code == 502
    assert "시간" in response.json()["detail"]


# ------------------------------------------------------------------ 순수 변환
def test_per_page_is_clamped():
    assert pixabay.MIN_PER_PAGE == 3
    assert pixabay.MAX_PER_PAGE == 200


# ------------------------------------------------------------------ 동영상


def test_video_search_uses_the_video_endpoint(client, super_headers, with_key, monkeypatch):
    # 이미지와 동영상은 주소가 다르다. 같은 곳으로 보내면 늘 빈 결과가 온다.
    sent = stub_response(monkeypatch, json_body={"hits": [SAMPLE_VIDEO], "totalHits": 1})
    client.get(
        "/api/v1/stock/search", headers=super_headers, params={"q": "학교", "kind": "video"}
    )
    assert sent["url"] == pixabay.VIDEO_API_URL


def test_video_hit_is_normalized(client, super_headers, with_key, monkeypatch):
    stub_response(monkeypatch, json_body={"hits": [SAMPLE_VIDEO], "totalHits": 1})
    body = client.get(
        "/api/v1/stock/search", headers=super_headers, params={"q": "x", "kind": "video"}
    ).json()

    item = body["items"][0]
    assert item["kind"] == "video"
    assert item["duration"] == 17
    assert item["preview"]  # 목록에 영상 자체를 걸면 수십 MB 가 오간다.


def test_best_quality_is_preferred(client, super_headers, with_key, monkeypatch):
    """DID 는 대개 1080p 다. 작은 화질을 고르면 화면에서 뭉개진다."""
    stub_response(monkeypatch, json_body={"hits": [SAMPLE_VIDEO], "totalHits": 1})
    body = client.get(
        "/api/v1/stock/search", headers=super_headers, params={"q": "x", "kind": "video"}
    ).json()
    assert body["items"][0]["url"] == "https://cdn.pixabay.com/large.mp4"


def test_falls_back_to_smaller_quality(client, super_headers, with_key, monkeypatch):
    only_small = {**SAMPLE_VIDEO, "videos": {"small": SAMPLE_VIDEO["videos"]["small"]}}
    stub_response(monkeypatch, json_body={"hits": [only_small], "totalHits": 1})
    body = client.get(
        "/api/v1/stock/search", headers=super_headers, params={"q": "x", "kind": "video"}
    ).json()
    assert body["items"][0]["url"] == "https://cdn.pixabay.com/small.mp4"


def test_video_without_any_url_is_dropped(client, super_headers, with_key, monkeypatch):
    stub_response(monkeypatch, json_body={"hits": [{**SAMPLE_VIDEO, "videos": {}}], "totalHits": 1})
    body = client.get(
        "/api/v1/stock/search", headers=super_headers, params={"q": "x", "kind": "video"}
    ).json()
    assert body["items"] == []


def test_image_search_still_uses_the_image_endpoint(client, super_headers, with_key, monkeypatch):
    sent = stub_response(monkeypatch, json_body={"hits": [SAMPLE_HIT], "totalHits": 1})
    client.get("/api/v1/stock/search", headers=super_headers, params={"q": "x"})
    assert sent["url"] == pixabay.IMAGE_API_URL


def test_unknown_kind_is_rejected(client, super_headers, with_key):
    response = client.get(
        "/api/v1/stock/search", headers=super_headers, params={"q": "x", "kind": "sound"}
    )
    assert response.status_code == 400


def test_orientation_is_not_sent_for_video(client, super_headers, with_key, monkeypatch):
    # Pixabay 동영상 API 는 그 조건을 받지 않는다. 보내면 무시되거나 거부된다.
    sent = stub_response(monkeypatch, json_body={"hits": [], "totalHits": 0})
    client.get(
        "/api/v1/stock/search",
        headers=super_headers,
        params={"q": "x", "kind": "video", "orientation": "vertical"},
    )
    assert "orientation" not in sent["params"]


# ------------------------------------------------------------------ 자산으로 저장


@pytest.fixture
def media_root(tmp_path, monkeypatch):
    from app.services import assets as asset_service

    monkeypatch.setattr(asset_service.settings, "MEDIA_ROOT", str(tmp_path))
    return tmp_path


def stub_download(monkeypatch, *, data=b"PNGDATA" * 8, content_type="image/png"):
    async def fake_get(self, url, **kwargs):  # noqa: ANN001, ARG001
        return httpx.Response(
            200, content=data, headers={"content-type": content_type},
            request=httpx.Request("GET", url),
        )

    monkeypatch.setattr(httpx.AsyncClient, "get", fake_get)


def test_saving_puts_it_in_the_library(client, super_headers, with_key, media_root, monkeypatch):
    """바깥 주소를 그대로 쓰면 폐쇄망 장치에서 표출되지 않는다."""
    stub_download(monkeypatch)
    body = client.post(
        "/api/v1/stock/save",
        headers=super_headers,
        json={"url": "https://cdn.pixabay.com/1280.jpg", "filename": "학교.png"},
    ).json()

    assert body["kind"] == "image"
    assert body["filename"] == "학교.png"
    assert body["url"].startswith("/api/v1/assets/")

    listed = client.get("/api/v1/assets", headers=super_headers).json()
    assert listed["total"] == 1


def test_saved_file_lands_on_disk(client, super_headers, with_key, media_root, monkeypatch):
    stub_download(monkeypatch)
    client.post(
        "/api/v1/stock/save", headers=super_headers, json={"url": "https://cdn/x.jpg"}
    )
    assert len(list(media_root.rglob("*.png"))) == 1


def test_video_can_be_saved(client, super_headers, with_key, media_root, monkeypatch):
    stub_download(monkeypatch, data=bytes(64), content_type="video/mp4")
    body = client.post(
        "/api/v1/stock/save",
        headers=super_headers,
        json={"url": "https://cdn/x.mp4", "kind": "video"},
    ).json()
    assert body["kind"] == "video"


def test_unsupported_type_is_rejected(client, super_headers, with_key, media_root, monkeypatch):
    """제공처가 알려 준 형식을 그대로 믿지 않는다.

    우리가 그릴 수 없는 형식이면 저장해 봐야 장치에서 안 나온다.
    """
    stub_download(monkeypatch, data=b"%PDF-1.4", content_type="application/pdf")
    response = client.post(
        "/api/v1/stock/save", headers=super_headers, json={"url": "https://cdn/x.pdf"}
    )
    assert response.status_code == 400


def test_empty_download_is_rejected(client, super_headers, with_key, media_root, monkeypatch):
    stub_download(monkeypatch, data=b"")
    response = client.post(
        "/api/v1/stock/save", headers=super_headers, json={"url": "https://cdn/x.jpg"}
    )
    assert response.status_code == 400


def test_download_failure_is_502(client, super_headers, with_key, media_root, monkeypatch):
    async def fake_get(self, url, **kwargs):  # noqa: ANN001, ARG001
        raise httpx.ConnectError("no route")

    monkeypatch.setattr(httpx.AsyncClient, "get", fake_get)
    response = client.post(
        "/api/v1/stock/save", headers=super_headers, json={"url": "https://cdn/x.jpg"}
    )
    assert response.status_code == 502


def test_saving_requires_login(client, with_key):
    assert (
        client.post("/api/v1/stock/save", json={"url": "https://cdn/x.jpg"}).status_code == 401
    )
