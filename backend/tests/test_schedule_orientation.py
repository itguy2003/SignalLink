"""스케줄의 가로형/세로형 구분과 콘텐츠 방향 일치 검증.

가로 콘텐츠를 세로 화면에 태우면 위아래에 검은 띠만 남고 글자는 읽을 수
없게 작아진다. 플레이어는 균일 스케일링만 하므로 이 어긋남을 보정하지
않는다. 그래서 스케줄에 붙는 시점에 막는다.
"""

from __future__ import annotations

import pytest

from app.models.enums import PanelType
from app.services import orientation


@pytest.fixture
def school_id(client, super_headers, root_org_id) -> int:
    return client.post(
        "/api/v1/organizations",
        headers=super_headers,
        json={"name": "가나초등학교", "parent_id": root_org_id, "org_type": "학교"},
    ).json()["id"]


@pytest.fixture
def make_content(client, super_headers, school_id):
    """주어진 크기의 콘텐츠를 만든다."""

    def _make(name: str, width: int, height: int) -> dict:
        response = client.post(
            "/api/v1/contents",
            headers=super_headers,
            json={"name": name, "org_id": school_id, "width": width, "height": height},
        )
        assert response.status_code == 201, response.text
        return response.json()

    return _make


@pytest.fixture
def landscape_content(make_content) -> dict:
    return make_content("가로 안내판", 1920, 1080)


@pytest.fixture
def portrait_content(make_content) -> dict:
    return make_content("세로 안내판", 1080, 1920)


@pytest.fixture
def make_schedule(client, super_headers, school_id):
    def _make(name: str, orientation_value: str, items: list | None = None):
        return client.post(
            "/api/v1/schedules",
            headers=super_headers,
            json={
                "name": name,
                "kind": "시간지정",
                "orientation": orientation_value,
                "org_id": school_id,
                "items": items or [],
            },
        )

    return _make


def _item(content_id: int | None = None, content: dict | None = None) -> dict:
    return {
        "day_of_week": 0,
        "start_time": "09:00:00",
        "end_time": "12:00:00",
        "content_id": content_id,
        "content": content or {},
    }


# ------------------------------------------------------------------ 방향 판정
def test_of_size_uses_height_over_width():
    assert orientation.of_size(1920, 1080) is PanelType.LANDSCAPE
    assert orientation.of_size(1080, 1920) is PanelType.PORTRAIT


def test_square_counts_as_landscape():
    # 한쪽으로 정해 두지 않으면 1:1 콘텐츠가 어느 스케줄에도 못 붙는다.
    assert orientation.of_size(1000, 1000) is PanelType.LANDSCAPE


def test_of_document_reads_layout():
    doc = {"layout": {"width": 1080, "height": 1920}}
    assert orientation.of_document(doc) is PanelType.PORTRAIT


@pytest.mark.parametrize(
    "document",
    [None, {}, {"layout": {}}, {"layout": {"width": 100}}, {"layout": {"width": 0, "height": 0}}],
)
def test_of_document_returns_none_when_size_unknown(document):
    # 크기를 모르는 것은 '틀렸다'가 아니다. 빈 아이템까지 막으면 편집을 시작할 수 없다.
    assert orientation.of_document(document) is None


def test_default_size_matches_orientation():
    assert orientation.default_size(PanelType.LANDSCAPE) == (1920, 1080)
    assert orientation.default_size(PanelType.PORTRAIT) == (1080, 1920)


# ------------------------------------------------------------------ 스케줄 생성
def test_schedule_defaults_to_landscape(client, super_headers, school_id):
    # 방향을 안 주고 만든 스케줄. 기존 스케줄이 전부 가로형으로 마이그레이션되므로
    # 기본값도 같아야 한다. 다르면 예전 화면에서 만든 스케줄이 곧바로 막힌다.
    response = client.post(
        "/api/v1/schedules",
        headers=super_headers,
        json={"name": "기본", "kind": "시간지정", "org_id": school_id},
    )
    assert response.status_code == 201, response.text
    assert response.json()["orientation"] == "LANDSCAPE"


def test_orientation_is_returned_in_list(client, super_headers, make_schedule):
    make_schedule("세로 스케줄", "PORTRAIT")
    page = client.get("/api/v1/schedules", headers=super_headers).json()
    assert page["items"][0]["orientation"] == "PORTRAIT"


def test_landscape_schedule_accepts_landscape_content(make_schedule, landscape_content):
    response = make_schedule("가로", "LANDSCAPE", [_item(content_id=landscape_content["id"])])
    assert response.status_code == 201, response.text


def test_landscape_schedule_rejects_portrait_content(make_schedule, portrait_content):
    response = make_schedule("가로", "LANDSCAPE", [_item(content_id=portrait_content["id"])])
    assert response.status_code == 400
    detail = response.json()["detail"]
    assert "가로형" in detail
    assert "세로 안내판" in detail
    # 어느 콘텐츠가 왜 안 되는지 알려 줘야 고칠 수 있다.
    assert "1080×1920" in detail


def test_portrait_schedule_rejects_landscape_content(make_schedule, landscape_content):
    response = make_schedule("세로", "PORTRAIT", [_item(content_id=landscape_content["id"])])
    assert response.status_code == 400
    assert "세로형" in response.json()["detail"]


def test_portrait_schedule_accepts_portrait_content(make_schedule, portrait_content):
    response = make_schedule("세로", "PORTRAIT", [_item(content_id=portrait_content["id"])])
    assert response.status_code == 201, response.text


# ------------------------------------------------------- 인라인 콘텐츠도 검사한다
def test_inline_content_orientation_is_checked(make_schedule):
    # 라이브러리를 거치지 않고 문서를 직접 넣는 경로가 남아 있다.
    response = make_schedule(
        "가로",
        "LANDSCAPE",
        [_item(content={"version": 1, "layout": {"width": 1080, "height": 1920}, "elements": []})],
    )
    assert response.status_code == 400
    assert "세로형" in response.json()["detail"]


def test_inline_content_without_size_is_allowed(make_schedule):
    response = make_schedule("가로", "LANDSCAPE", [_item(content={"version": 1, "elements": []})])
    assert response.status_code == 201, response.text


# ------------------------------------------------------------------ 수정
def test_update_rejects_mismatched_content(client, super_headers, make_schedule, portrait_content):
    schedule = make_schedule("가로", "LANDSCAPE").json()
    response = client.put(
        f"/api/v1/schedules/{schedule['id']}",
        headers=super_headers,
        json={"items": [_item(content_id=portrait_content["id"])]},
    )
    assert response.status_code == 400


def test_changing_orientation_is_blocked_while_content_mismatches(
    client, super_headers, make_schedule, landscape_content
):
    schedule = make_schedule(
        "가로", "LANDSCAPE", [_item(content_id=landscape_content["id"])]
    ).json()

    response = client.put(
        f"/api/v1/schedules/{schedule['id']}",
        headers=super_headers,
        json={"orientation": "PORTRAIT"},
    )
    assert response.status_code == 400
    assert "세로형" in response.json()["detail"]


def test_rejected_orientation_change_is_not_saved(
    client, super_headers, make_schedule, landscape_content
):
    # 검사보다 먼저 값을 바꾸면 거부된 요청이 세션에 변경을 남긴다.
    schedule = make_schedule(
        "가로", "LANDSCAPE", [_item(content_id=landscape_content["id"])]
    ).json()
    client.put(
        f"/api/v1/schedules/{schedule['id']}",
        headers=super_headers,
        json={"orientation": "PORTRAIT"},
    )

    after = client.get(f"/api/v1/schedules/{schedule['id']}", headers=super_headers).json()
    assert after["orientation"] == "LANDSCAPE"


def test_orientation_change_allowed_when_empty(client, super_headers, make_schedule):
    schedule = make_schedule("빈 스케줄", "LANDSCAPE").json()
    response = client.put(
        f"/api/v1/schedules/{schedule['id']}",
        headers=super_headers,
        json={"orientation": "PORTRAIT"},
    )
    assert response.status_code == 200, response.text
    assert response.json()["orientation"] == "PORTRAIT"


def test_orientation_and_items_can_change_together(
    client, super_headers, make_schedule, landscape_content, portrait_content
):
    # 방향을 돌리면서 콘텐츠도 같이 갈아 끼우는 것은 정상적인 흐름이다.
    schedule = make_schedule(
        "가로", "LANDSCAPE", [_item(content_id=landscape_content["id"])]
    ).json()
    response = client.put(
        f"/api/v1/schedules/{schedule['id']}",
        headers=super_headers,
        json={"orientation": "PORTRAIT", "items": [_item(content_id=portrait_content["id"])]},
    )
    assert response.status_code == 200, response.text
    assert response.json()["orientation"] == "PORTRAIT"


# ------------------------------------------------------------------ 복제
def test_duplicate_keeps_orientation(client, super_headers, make_schedule, portrait_content):
    schedule = make_schedule("세로", "PORTRAIT", [_item(content_id=portrait_content["id"])]).json()
    copy = client.post(
        f"/api/v1/schedules/{schedule['id']}/duplicate", headers=super_headers
    ).json()

    # 방향이 안 따라오면 복사본의 아이템이 전부 방향 불일치가 된다.
    assert copy["orientation"] == "PORTRAIT"
    assert len(copy["items"]) == 1
