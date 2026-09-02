"""위젯 목록과 위젯 데이터 조회.

위젯은 DB 에 저장되지 않고 서버가 동적으로 제공한다(요구사항 #위젯).
편집기는 ``GET /widgets`` 로 팔레트를 구성하고,
플레이어는 ``GET /widgets/{key}/data`` 를 주기적으로 호출한다.
"""

from __future__ import annotations

import json
from datetime import UTC, datetime

from fastapi import APIRouter, Header, Query

from app.api.deps import CurrentUser, DbSession, bad_request, forbid, not_found
from app.schemas.widget import WidgetDataResponse, WidgetSpec
from app.services import permissions, widgets
from app.services.device_auth import DeviceAuthError, resolve_device

router = APIRouter(prefix="/widgets", tags=["위젯"])


@router.get("", response_model=list[WidgetSpec], summary="위젯 목록")
def list_widgets(_: CurrentUser) -> list[WidgetSpec]:
    return widgets.list_widgets()


@router.get("/{key}/data", response_model=WidgetDataResponse, summary="위젯 데이터")
def widget_data(
    key: str,
    db: DbSession,
    org_id: int | None = Query(default=None, description="기준 기관. 장치 토큰 사용 시 무시된다."),
    options: str | None = Query(default=None, description="위젯 옵션 JSON"),
    authorization: str | None = Header(default=None),
    x_device_token: str | None = Header(default=None),
) -> WidgetDataResponse:
    """CMS 사용자(미리보기)와 장치(플레이어) 양쪽에서 호출된다.

    장치는 ``X-Device-Token`` 을 보내며, 이 경우 기관은 장치 소속으로 고정된다.
    """
    spec = widgets.get_widget(key)
    if spec is None:
        raise not_found("위젯")

    parsed_options: dict = {}
    if options:
        try:
            parsed_options = json.loads(options)
        except json.JSONDecodeError:
            raise bad_request("options 는 JSON 이어야 합니다.") from None
        if not isinstance(parsed_options, dict):
            raise bad_request("options 는 JSON 객체여야 합니다.")

    resolved_org_id = _resolve_org(db, org_id, authorization, x_device_token)
    data = widgets.fetch_data(db, key, resolved_org_id, parsed_options)
    return WidgetDataResponse(
        key=key, fetched_at=datetime.now(UTC).isoformat(), data=data
    )


def _resolve_org(
    db: DbSession, org_id: int | None, authorization: str | None, device_token: str | None
) -> int:
    if device_token:
        try:
            device = resolve_device(db, device_token)
        except DeviceAuthError as exc:
            raise forbid(str(exc)) from exc
        return device.org_id

    # 장치 토큰이 없으면 CMS 사용자 토큰이어야 한다.
    from app.core.security import decode_access_token
    from app.models.user import User

    if not authorization or not authorization.lower().startswith("bearer "):
        raise forbid("인증 정보가 없습니다.")
    payload = decode_access_token(authorization.split(" ", 1)[1])
    if payload is None or payload.get("typ") != "access":
        raise forbid("토큰이 유효하지 않습니다.")

    user = db.get(User, int(payload["sub"]))
    if user is None:
        raise forbid("사용자를 찾을 수 없습니다.")

    target = org_id if org_id is not None else user.org_id
    if not permissions.can_view_org(db, user, target):
        raise forbid("해당 기관의 위젯 데이터를 조회할 권한이 없습니다.")
    return target
