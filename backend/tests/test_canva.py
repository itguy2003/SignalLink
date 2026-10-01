"""Canva Connect 연동 검증 (외부 호출 없이).

실제 Canva API 는 부르지 않는다 — OAuth 주소 구성, state(PKCE) 수명,
설정/연결 전 안내, 콜백의 state 검증까지가 서버 로직의 몫이고 그것만 본다.
"""

from __future__ import annotations

import pytest

from app.core.config import settings
from app.services import canva_connect as canva


@pytest.fixture
def configured(monkeypatch) -> None:  # noqa: ANN001
    monkeypatch.setattr(settings, "CANVA_CLIENT_ID", "client-id-1")
    monkeypatch.setattr(settings, "CANVA_CLIENT_SECRET", "secret-1")


def test_status_reports_unconfigured(client, super_headers):
    body = client.get("/api/v1/canva/status", headers=super_headers).json()
    assert body == {"configured": False, "connected": False}


def test_endpoints_guide_when_unconfigured(client, super_headers):
    for method, path, kwargs in (
        ("post", "/api/v1/canva/authorize", {}),
        ("get", "/api/v1/canva/designs", {}),
        ("post", "/api/v1/canva/import", {"json": {"design_id": "d1"}}),
    ):
        response = getattr(client, method)(path, headers=super_headers, **kwargs)
        assert response.status_code == 400
        assert "CANVA_CLIENT_ID" in response.json()["detail"]


def test_authorize_builds_pkce_url(client, super_headers, configured):
    body = client.post("/api/v1/canva/authorize", headers=super_headers).json()
    url = body["url"]
    assert url.startswith(canva.AUTHORIZE_ENDPOINT)
    assert "client_id=client-id-1" in url
    assert "code_challenge_method=s256" in url
    assert "code_challenge=" in url
    assert "state=" in url
    # 리디렉션은 우리 콜백으로 돌아온다.
    assert "redirect_uri=" in url and "canva%2Fcallback" in url


def test_state_is_single_use():
    canva._pending_states.clear()  # noqa: SLF001
    url = canva.create_authorize_url(7, "http://x/api/v1/canva/callback")
    state = url.split("state=")[1].split("&")[0]

    taken = canva.take_state(state)
    assert taken is not None and taken[1] == 7
    # 한 번 쓰면 끝 — 재사용(리플레이)을 막는다.
    assert canva.take_state(state) is None


def test_callback_rejects_unknown_state(client, configured):
    response = client.get("/api/v1/canva/callback?code=abc&state=unknown")
    assert response.status_code == 200  # 팝업 안내 화면
    assert "만료" in response.text


def test_designs_require_connection(client, super_headers, configured):
    response = client.get("/api/v1/canva/designs", headers=super_headers)
    assert response.status_code == 400
    assert "연결되지 않았습니다" in response.json()["detail"]


def test_disconnect_is_idempotent(client, super_headers, configured):
    assert (
        client.delete("/api/v1/canva/connection", headers=super_headers).status_code == 200
    )
