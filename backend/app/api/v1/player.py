"""플레이어(장치)용 엔드포인트.

인증 흐름 (요구사항 제한사항 3)
    1. 장치가 ``POST /player/provision`` 에 장치 고유번호를 보낸다.
    2. 서버가 장치를 확인하고 장치 세션 토큰과 WebSocket 주소를 돌려준다.
    3. 이후 요청은 ``X-Device-Token`` 헤더로 인증한다.

응답 시간 (요구사항 제한사항 4)
    ``/player/schedule`` 은 단일 인덱스 조회 + JSON 직렬화만 수행한다.
    장치 수가 늘어 200ms 를 넘기 시작하면 스케줄 페이로드를 버전 키로
    캐시(예: Redis ``schedule:{id}:{version}``)하는 것이 다음 단계다.
    페이로드가 버전으로 불변이므로 캐시 무효화가 단순하다.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Annotated

from fastapi import (
    APIRouter,
    Depends,
    File,
    Header,
    HTTPException,
    Request,
    UploadFile,
    status,
)
from pydantic import BaseModel, Field

from app.api.deps import DbSession
from app.core.config import settings
from app.models.device import Device, DeviceScreenshot
from app.schemas.common import Message
from app.schemas.device import DeviceProvisionRequest, DeviceProvisionResponse
from app.schemas.schedule import SchedulePayload
from app.services import schedule_service, storage
from app.services.device_auth import (
    DeviceAuthError,
    authenticate_by_code,
    create_device_token,
)
from app.services.device_auth import resolve_device as _resolve_device
from app.services.ws_hub import hub

router = APIRouter(prefix="/player", tags=["플레이어"])


def get_current_device(
    db: DbSession,
    x_device_token: Annotated[str | None, Header()] = None,
) -> Device:
    if not x_device_token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="장치 토큰이 없습니다."
        )
    try:
        return _resolve_device(db, x_device_token)
    except DeviceAuthError as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=str(exc)) from exc


CurrentDevice = Annotated[Device, Depends(get_current_device)]


@router.post("/provision", response_model=DeviceProvisionResponse, summary="장치 인증")
def provision(
    payload: DeviceProvisionRequest, request: Request, db: DbSession
) -> DeviceProvisionResponse:
    try:
        device = authenticate_by_code(db, payload.device_code)
    except DeviceAuthError as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=str(exc)) from exc

    # 장치가 보고한 하드웨어 정보로 등록 정보를 보완한다.
    for field in ("app_version", "cpu", "memory", "storage", "width", "height"):
        value = getattr(payload, field, None)
        if value:
            setattr(device, field, value)
    device.last_seen_at = datetime.now(UTC)
    db.commit()
    db.refresh(device)

    scheme = "wss" if request.url.scheme == "https" else "ws"
    ws_url = f"{scheme}://{request.url.netloc}{settings.API_V1_PREFIX}/player/ws"

    return DeviceProvisionResponse(
        device_id=device.id,
        device_code=device.device_code,
        name=device.name,
        org_id=device.org_id,
        panel_type=device.panel_type,
        width=device.width,
        height=device.height,
        schedule_version=schedule_service.current_version(db, device),
        heartbeat_interval_sec=settings.HEARTBEAT_INTERVAL_SEC,
        ws_url=ws_url,
        device_token=create_device_token(device),
    )


@router.get("/schedule", response_model=SchedulePayload, summary="스케줄 수신")
def get_schedule(device: CurrentDevice, db: DbSession) -> SchedulePayload:
    payload = schedule_service.build_payload(db, device)
    # 장치가 실제로 받아간 버전을 기록해 둔다. 하트비트 비교의 기준이 된다.
    device.version = payload.version
    device.last_seen_at = datetime.now(UTC)
    db.commit()
    return payload


class HeartbeatRequest(BaseModel):
    """REST 하트비트. WebSocket 을 쓸 수 없는 환경(프록시 제약 등)용 대체 경로.

    저장공간은 **바이트**로 보고한다. 단위를 문자열로 주고받으면 스택마다
    (JS/.NET/Flutter) GB 와 GiB 를 다르게 해석해 사용률이 어긋난다.
    보고하지 않으면 서버는 이전 값을 그대로 둔다.
    """

    schedule_version: int | None = None
    app_version: str | None = None
    status: str | None = None
    storage_total_bytes: int | None = Field(default=None, ge=0)
    storage_free_bytes: int | None = Field(default=None, ge=0)


class HeartbeatResponse(BaseModel):
    server_time: datetime
    schedule_version: int
    #: True 면 장치는 ``GET /player/schedule`` 로 스케줄을 다시 받아야 한다.
    schedule_changed: bool
    heartbeat_interval_sec: int


@router.post("/heartbeat", response_model=HeartbeatResponse, summary="하트비트")
def heartbeat(
    payload: HeartbeatRequest, device: CurrentDevice, db: DbSession
) -> HeartbeatResponse:
    server_version = schedule_service.current_version(db, device)
    reported = payload.schedule_version if payload.schedule_version is not None else device.version

    device.last_seen_at = datetime.now(UTC)
    if payload.app_version:
        device.app_version = payload.app_version
    storage.record_report(device, payload.storage_total_bytes, payload.storage_free_bytes)
    db.commit()

    return HeartbeatResponse(
        server_time=datetime.now(UTC),
        schedule_version=server_version,
        schedule_changed=reported != server_version,
        heartbeat_interval_sec=settings.HEARTBEAT_INTERVAL_SEC,
    )


#: 캡처 업로드 상한. 1920×1080 JPEG 이 보통 200KB 안팎이라 넉넉한 값이며,
#: 상한이 없으면 장치 하나가 무압축 PNG 로 DB 를 채울 수 있다.
MAX_SCREENSHOT_BYTES = 4 * 1024 * 1024

#: 브라우저가 <img> 로 바로 그릴 수 있는 형식만 받는다.
ALLOWED_SCREENSHOT_TYPES = {"image/jpeg", "image/png", "image/webp"}


@router.post("/screenshot", response_model=Message, summary="현재 화면 캡처 업로드")
async def upload_screenshot(
    device: CurrentDevice,
    db: DbSession,
    file: UploadFile = File(..., description="현재 화면 캡처(JPEG/PNG/WebP)"),
) -> Message:
    """장치가 ``screenshot`` 명령을 받고 찍은 화면을 올린다.

    장치당 한 장만 보관하고 덮어쓴다. CMS 의 장치 카드가 이 이미지를
    ``GET /devices/{id}/screenshot`` 으로 가져다 보여 준다.
    """
    if file.content_type not in ALLOWED_SCREENSHOT_TYPES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"지원하지 않는 이미지 형식입니다: {file.content_type}",
        )

    data = await file.read()
    if not data:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="빈 파일입니다.")
    if len(data) > MAX_SCREENSHOT_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"캡처는 {MAX_SCREENSHOT_BYTES // (1024 * 1024)}MB 이하여야 합니다.",
        )

    now = datetime.now(UTC)
    shot = db.get(DeviceScreenshot, device.id)
    if shot is None:
        db.add(
            DeviceScreenshot(
                device_id=device.id,
                image=data,
                content_type=file.content_type,
                captured_at=now,
            )
        )
    else:
        shot.image = data
        shot.content_type = file.content_type
        shot.captured_at = now

    # 캡처를 올렸다는 것은 살아 있다는 뜻이다. 하트비트와 같게 취급한다.
    device.last_seen_at = now
    db.commit()
    return Message(detail="화면 캡처를 저장했습니다.")


class ConnectionStats(BaseModel):
    online_count: int


@router.get("/stats", response_model=ConnectionStats, summary="접속 장치 수")
def stats() -> ConnectionStats:
    return ConnectionStats(online_count=hub.stats()["online_count"])
