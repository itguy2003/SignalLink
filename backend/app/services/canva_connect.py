"""Canva Connect(공식 REST API) 연동 — .NET(Services/CanvaConnect.cs)의 짝.

사용자가 자기 Canva 계정을 OAuth(PKCE)로 연결하면, 서버가 토큰을 보관하고
디자인 목록 조회·PNG 내보내기를 대신 수행해 자산 라이브러리에 저장한다.
토큰·클라이언트 시크릿은 서버만 안다.

필요한 설정(.env): CANVA_CLIENT_ID / CANVA_CLIENT_SECRET
  (+ 선택 CANVA_REDIRECT_URI — 비우면 <요청 호스트>/api/v1/canva/callback)
Canva 개발자 포털에서 통합(Integration)을 만들고 리디렉션 URI 를 등록해야
한다. 사용 스코프: design:meta:read design:content:read.
"""

from __future__ import annotations

import base64
import hashlib
import secrets
from datetime import UTC, datetime, timedelta
from typing import Any
from urllib.parse import quote, urlencode

import httpx
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.canva import CanvaAccount

AUTHORIZE_ENDPOINT = "https://www.canva.com/api/oauth/authorize"
API_BASE = "https://api.canva.com/rest/v1"
SCOPES = "design:meta:read design:content:read"

#: 내보내기 완료 대기 상한 / 한 디자인에서 받는 최대 장 수(.NET 동일).
EXPORT_TIMEOUT_SEC = 60
MAX_PAGES = 10


class CanvaError(Exception):
    """사용자에게 그대로 보여 줄 문구를 담는다."""

    def __init__(self, message: str, status: int = 502) -> None:
        super().__init__(message)
        self.status = status


def is_configured() -> bool:
    return bool(settings.CANVA_CLIENT_ID and settings.CANVA_CLIENT_SECRET)


def redirect_uri(request_base: str) -> str:
    if settings.CANVA_REDIRECT_URI:
        return settings.CANVA_REDIRECT_URI
    return f"{request_base.rstrip('/')}/api/v1/canva/callback"


# ------------------------------------------------------------ OAuth(PKCE)
#: state → (검증값, 사용자, 만료). 콜백은 비인증이라 state 가 신원을 잇는다.
_pending_states: dict[str, tuple[str, int, datetime]] = {}


def _code_challenge(verifier: str) -> str:
    digest = hashlib.sha256(verifier.encode("ascii")).digest()
    return base64.urlsafe_b64encode(digest).decode("ascii").rstrip("=")


def create_authorize_url(user_id: int, redirect: str) -> str:
    now = datetime.now(UTC)
    for state in [s for s, (_, _, exp) in _pending_states.items() if exp < now]:
        _pending_states.pop(state, None)

    verifier = secrets.token_hex(32) + secrets.token_hex(32)  # 43~128자 요건
    state = secrets.token_hex(32)
    _pending_states[state] = (verifier, user_id, now + timedelta(minutes=10))

    query = urlencode(
        {
            "code_challenge": _code_challenge(verifier),
            "code_challenge_method": "s256",
            "scope": SCOPES,
            "response_type": "code",
            "client_id": settings.CANVA_CLIENT_ID,
            "state": state,
            "redirect_uri": redirect,
        },
        quote_via=quote,
    )
    return f"{AUTHORIZE_ENDPOINT}?{query}"


def take_state(state: str) -> tuple[str, int] | None:
    pending = _pending_states.pop(state, None)
    if pending is None:
        return None
    verifier, user_id, expires_at = pending
    if expires_at < datetime.now(UTC):
        return None
    return verifier, user_id


async def _token_request(form: dict[str, str]) -> dict[str, Any]:
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            response = await client.post(
                f"{API_BASE}/oauth/token",
                data=form,
                auth=(settings.CANVA_CLIENT_ID, settings.CANVA_CLIENT_SECRET),
            )
    except httpx.HTTPError as exc:
        raise CanvaError("Canva 에 연결할 수 없습니다.") from exc
    if response.status_code >= 400:
        raise CanvaError("Canva 인증에 실패했습니다. 다시 연결해 주세요.", 400)
    return response.json()


def _save_token(db: Session, user_id: int, token: dict[str, Any]) -> CanvaAccount:
    account = db.execute(
        select(CanvaAccount).where(CanvaAccount.user_id == user_id)
    ).scalar_one_or_none()
    if account is None:
        account = CanvaAccount(user_id=user_id)
        db.add(account)
    account.access_token = token.get("access_token") or ""
    # 회전식 — 새 refresh_token 이 오면 옛것은 못 쓴다.
    account.refresh_token = token.get("refresh_token") or account.refresh_token
    account.expires_at = datetime.now(UTC).replace(tzinfo=None) + timedelta(
        seconds=int(token.get("expires_in") or 3600)
    )
    db.commit()
    db.refresh(account)
    return account


async def exchange_code(db: Session, user_id: int, code: str, verifier: str, redirect: str) -> None:
    token = await _token_request(
        {
            "grant_type": "authorization_code",
            "code": code,
            "code_verifier": verifier,
            "redirect_uri": redirect,
        }
    )
    _save_token(db, user_id, token)


def account_of(db: Session, user_id: int) -> CanvaAccount | None:
    return db.execute(
        select(CanvaAccount).where(CanvaAccount.user_id == user_id)
    ).scalar_one_or_none()


async def _access_token(db: Session, account: CanvaAccount) -> str:
    """유효한 접근 토큰. 만료가 가까우면 갱신해 저장한다."""
    if account.expires_at > datetime.now(UTC).replace(tzinfo=None) + timedelta(minutes=1):
        return account.access_token
    token = await _token_request(
        {"grant_type": "refresh_token", "refresh_token": account.refresh_token}
    )
    return _save_token(db, account.user_id, token).access_token


async def _api(
    db: Session, account: CanvaAccount, method: str, path: str, json: dict | None = None
) -> dict[str, Any]:
    headers = {"Authorization": f"Bearer {await _access_token(db, account)}"}
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            response = await client.request(method, f"{API_BASE}{path}", headers=headers, json=json)
    except httpx.HTTPError as exc:
        raise CanvaError("Canva 에 연결할 수 없습니다.") from exc
    if response.status_code == 401:
        raise CanvaError("Canva 연결이 만료되었습니다. 다시 연결해 주세요.", 401)
    if response.status_code >= 400:
        raise CanvaError("Canva 요청에 실패했습니다.")
    return response.json()


async def list_designs(
    db: Session, account: CanvaAccount, query: str | None, continuation: str | None
) -> dict[str, Any]:
    """디자인 목록 — 편집기에서 고를 만큼만 추린 필드."""
    path = "/designs?limit=30"
    if query:
        path += f"&query={quote(query)}"
    if continuation:
        path += f"&continuation={quote(continuation)}"
    body = await _api(db, account, "GET", path)
    return {
        "items": [
            {
                "id": item.get("id"),
                "title": item.get("title") or "(제목 없음)",
                "thumbnail_url": (item.get("thumbnail") or {}).get("url"),
                "updated_at": item.get("updated_at"),
            }
            for item in body.get("items", [])
        ],
        "continuation": body.get("continuation"),
    }


async def export_design(db: Session, account: CanvaAccount, design_id: str) -> list[bytes]:
    """디자인을 PNG 로 내보내 장별 바이트를 돌려준다."""
    import asyncio

    status = await _api(
        db, account, "POST", "/exports",
        json={"design_id": design_id, "format": {"type": "png"}},
    )
    job_id = (status.get("job") or {}).get("id")
    if not job_id:
        raise CanvaError("내보내기 작업을 만들지 못했습니다.")

    deadline = datetime.now(UTC) + timedelta(seconds=EXPORT_TIMEOUT_SEC)
    while True:
        state = (status.get("job") or {}).get("status")
        if state == "success":
            break
        if state == "failed":
            raise CanvaError("Canva 내보내기가 실패했습니다.")
        if datetime.now(UTC) > deadline:
            raise CanvaError("Canva 내보내기가 시간 내에 끝나지 않았습니다.")
        await asyncio.sleep(1)
        status = await _api(db, account, "GET", f"/exports/{job_id}")

    urls = [url for url in (status.get("job") or {}).get("urls", []) if url][:MAX_PAGES]
    if not urls:
        raise CanvaError("내보낸 파일 주소가 없습니다.")

    pages: list[bytes] = []
    try:
        async with httpx.AsyncClient(timeout=60) as client:
            for url in urls:
                response = await client.get(url)
                if response.status_code >= 400:
                    raise CanvaError("내보낸 파일을 내려받지 못했습니다.")
                pages.append(response.content)
    except httpx.HTTPError as exc:
        raise CanvaError("내보낸 파일을 내려받지 못했습니다.") from exc
    return pages
