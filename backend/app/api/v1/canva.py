"""Canva Connect 연동 — .NET(Controllers/CanvaController.cs)의 거울.

흐름: [연결] → authorize 주소로 팝업 → Canva 동의 → callback(비인증,
state 로 사용자 연결) → 이후 디자인 목록/가져오기. 가져오기는 PNG 로
내보내 자산 라이브러리에 저장한다 — 편집기가 여느 이미지처럼 쓴다.
"""

from __future__ import annotations

from fastapi import APIRouter, Query, Request, status
from fastapi.responses import HTMLResponse
from pydantic import BaseModel

from app.api.deps import CurrentUser, DbSession, bad_request, forbid
from app.models.asset import Asset
from app.schemas.asset import AssetOut
from app.schemas.common import Message
from app.services import assets as asset_service
from app.services import canva_connect as canva
from app.services import permissions

router = APIRouter(prefix="/canva", tags=["Canva 연동"])

_NOT_CONFIGURED = "Canva 연동이 설정되지 않았습니다. 서버의 CANVA_CLIENT_ID/SECRET 을 지정하세요."
_NOT_CONNECTED = "Canva 계정이 연결되지 않았습니다. 먼저 연결해 주세요."


class CanvaStatusOut(BaseModel):
    configured: bool
    connected: bool


class CanvaImportIn(BaseModel):
    design_id: str
    org_id: int | None = None
    title: str | None = None


def _request_base(request: Request) -> str:
    return f"{request.url.scheme}://{request.url.netloc}"


@router.get("/status", response_model=CanvaStatusOut, summary="Canva 연결 상태")
def canva_status(actor: CurrentUser, db: DbSession) -> CanvaStatusOut:
    configured = canva.is_configured()
    connected = configured and canva.account_of(db, actor.id) is not None
    return CanvaStatusOut(configured=configured, connected=connected)


@router.post("/authorize", summary="Canva 연결 시작(인가 주소)")
def authorize(actor: CurrentUser, request: Request) -> dict:
    if not canva.is_configured():
        raise bad_request(_NOT_CONFIGURED)
    url = canva.create_authorize_url(actor.id, canva.redirect_uri(_request_base(request)))
    return {"url": url}


@router.get("/callback", response_class=HTMLResponse, summary="Canva 인가 콜백")
async def callback(
    request: Request,
    db: DbSession,
    code: str | None = Query(default=None),
    state: str | None = Query(default=None),
) -> HTMLResponse:
    """Canva 가 사용자를 돌려보내는 자리 — 팝업 안이라 짧은 안내만 그린다."""
    if not code or not state:
        message = "연결이 취소되었습니다. 창을 닫아 주세요."
    elif (pending := canva.take_state(state)) is None:
        message = "연결 요청이 만료되었습니다. 창을 닫고 다시 시도해 주세요."
    else:
        verifier, user_id = pending
        try:
            await canva.exchange_code(
                db, user_id, code, verifier, canva.redirect_uri(_request_base(request))
            )
            message = "Canva 계정이 연결되었습니다. 창을 닫아 주세요."
        except canva.CanvaError as exc:
            message = str(exc)
    html = (
        '<!doctype html><meta charset="utf-8"><body style="font-family:sans-serif;'
        "display:grid;place-items:center;height:100vh;margin:0;background:#0b1120;color:#e2e8f0\">"
        f"<div><p>{message}</p></div><script>setTimeout(() => window.close(), 1500)</script></body>"
    )
    return HTMLResponse(html)


@router.delete("/connection", response_model=Message, summary="Canva 연결 해제")
def disconnect(actor: CurrentUser, db: DbSession) -> Message:
    account = canva.account_of(db, actor.id)
    if account is not None:
        db.delete(account)
        db.commit()
    return Message(detail="Canva 연결을 해제했습니다.")


@router.get("/designs", summary="내 Canva 디자인 목록")
async def designs(
    actor: CurrentUser,
    db: DbSession,
    query: str | None = Query(default=None),
    continuation: str | None = Query(default=None),
) -> dict:
    if not canva.is_configured():
        raise bad_request(_NOT_CONFIGURED)
    account = canva.account_of(db, actor.id)
    if account is None:
        raise bad_request(_NOT_CONNECTED)
    try:
        return await canva.list_designs(db, account, query, continuation)
    except canva.CanvaError as exc:
        from fastapi import HTTPException

        raise HTTPException(status_code=exc.status, detail=str(exc)) from exc


@router.post(
    "/import",
    response_model=list[AssetOut],
    status_code=status.HTTP_201_CREATED,
    summary="Canva 디자인을 자산으로 가져오기",
)
async def import_design(
    payload: CanvaImportIn, actor: CurrentUser, db: DbSession
) -> list[AssetOut]:
    """디자인을 PNG 로 내보내 자산으로 저장한다. 여러 장이면 장마다 하나."""
    if not canva.is_configured():
        raise bad_request(_NOT_CONFIGURED)
    account = canva.account_of(db, actor.id)
    if account is None:
        raise bad_request(_NOT_CONNECTED)

    target_org = payload.org_id if payload.org_id is not None else actor.org_id
    if not permissions.can_manage_org(db, actor, target_org):
        raise forbid("해당 기관에 파일을 올릴 권한이 없습니다.")

    try:
        pages = await canva.export_design(db, account, payload.design_id)
    except canva.CanvaError as exc:
        from fastapi import HTTPException

        raise HTTPException(status_code=exc.status, detail=str(exc)) from exc

    title = (payload.title or "").strip() or "canva"
    created: list[Asset] = []
    for index, data in enumerate(pages):
        stored = asset_service.store(data, "image", "image/png")
        asset = Asset(
            org_id=target_org,
            uploaded_by=actor.id,
            kind="image",
            filename=f"{title}-{index + 1}.png" if len(pages) > 1 else f"{title}.png",
            content_type="image/png",
            size_bytes=len(data),
            storage_path=stored,
        )
        asset_service.attach_thumbnail(asset)
        db.add(asset)
        created.append(asset)
    db.commit()

    results: list[AssetOut] = []
    for asset in created:
        db.refresh(asset)
        out = AssetOut.model_validate(asset)
        out.url = asset_service.public_url(asset)
        out.thumb_url = asset_service.thumb_url(asset)
        results.append(out)
    return results
