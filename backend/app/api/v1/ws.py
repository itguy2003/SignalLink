"""장치 제어용 WebSocket 채널.

접속:  ``/api/v1/player/ws?token=<device_token>``

핸드셰이크 이후 **모든 메시지는 AES-256-GCM 봉투(base64 문자열)** 다
(요구사항 제한사항 2). 평문 JSON 은 주고받지 않는다. 키는 장치 고유번호로부터
유도되므로 서버와 장치가 같은 키를 계산한다(``core/crypto.py``).

메시지 타입
    서버 -> 장치   welcome | heartbeat_ack | schedule_changed | command | error
    장치 -> 서버   heartbeat | status | ack

하트비트마다 서버 스케줄 버전을 비교해 변경 시 ``schedule_changed`` 를 실어
보낸다(요구사항 제한사항 5). 장치는 이를 받으면 REST 로 스케줄을 다시 받는다.
"""

from __future__ import annotations

import logging
from datetime import UTC, datetime

from fastapi import APIRouter, Query, WebSocket, WebSocketDisconnect
from starlette.concurrency import run_in_threadpool

from app.core.config import settings
from app.core.crypto import DecryptError, decrypt_from_device, encrypt_for_device
from app.db.session import SessionLocal
from app.models.device import Device
from app.services import schedule_service, storage
from app.services.device_auth import DeviceAuthError, resolve_device
from app.services.ws_hub import hub

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/player", tags=["플레이어"])

WS_UNAUTHORIZED = 4401
WS_BAD_MESSAGE = 4400


def _load_device(token: str) -> tuple[int, str, int]:
    """토큰에서 (device_id, device_code, 서버 스케줄 버전)을 얻는다."""
    with SessionLocal() as db:
        device = resolve_device(db, token)
        return device.id, device.device_code, schedule_service.current_version(db, device)


def _touch_device(device_id: int, message: dict) -> int:
    """하트비트 내용을 반영하고 현재 서버 스케줄 버전을 돌려준다.

    저장공간 보고를 REST 하트비트와 같은 방식으로 처리한다. 두 경로가 갈라지면
    WebSocket 을 쓰는 장치만 사용률이 비는 식으로 어긋난다.
    """
    with SessionLocal() as db:
        device = db.get(Device, device_id)
        if device is None:
            return schedule_service.DEMO_VERSION
        device.last_seen_at = datetime.now(UTC)
        app_version = message.get("app_version")
        if app_version:
            device.app_version = app_version
        storage.record_report(
            device,
            _as_bytes(message.get("storage_total_bytes")),
            _as_bytes(message.get("storage_free_bytes")),
        )
        version = schedule_service.current_version(db, device)
        db.commit()
        return version


def _as_bytes(value: object) -> int | None:
    """장치가 보낸 값을 바이트 정수로. 형식이 어긋나면 None(무시).

    WebSocket 메시지는 Pydantic 검증을 거치지 않는다. 문자열이나 음수가
    들어와도 하트비트 전체가 죽지 않아야 한다 — 저장공간은 부가 정보다.
    """
    if isinstance(value, bool) or not isinstance(value, int | float):
        return None
    return int(value) if value >= 0 else None


@router.websocket("/ws")
async def device_channel(websocket: WebSocket, token: str = Query(...)) -> None:
    try:
        device_id, device_code, version = await run_in_threadpool(_load_device, token)
    except DeviceAuthError as exc:
        # accept 전에는 close 코드만 전달할 수 있다.
        await websocket.close(code=WS_UNAUTHORIZED, reason=str(exc))
        return

    await websocket.accept()
    conn = await hub.connect(device_id, device_code, websocket)

    await websocket.send_text(
        encrypt_for_device(
            device_code,
            {
                "type": "welcome",
                "device_id": device_id,
                "schedule_version": version,
                "heartbeat_interval_sec": settings.HEARTBEAT_INTERVAL_SEC,
                "server_time": datetime.now(UTC).isoformat(),
            },
        )
    )

    try:
        while True:
            raw = await websocket.receive_text()
            try:
                message = decrypt_from_device(device_code, raw)
            except DecryptError as exc:
                logger.warning("복호화 실패 device_code=%s: %s", device_code, exc)
                await websocket.close(code=WS_BAD_MESSAGE, reason="복호화 실패")
                return

            await _handle_message(websocket, conn, device_id, device_code, message)
    except WebSocketDisconnect:
        logger.info("장치 접속 종료 device_code=%s", device_code)
    except Exception:  # noqa: BLE001
        logger.exception("WebSocket 처리 중 오류 device_code=%s", device_code)
    finally:
        await hub.disconnect(device_id, websocket)


async def _handle_message(
    websocket: WebSocket,
    conn,  # noqa: ANN001 - DeviceConnection
    device_id: int,
    device_code: str,
    message: dict,
) -> None:
    msg_type = message.get("type")

    if msg_type == "heartbeat":
        conn.last_heartbeat_at = datetime.now(UTC)
        server_version = await run_in_threadpool(_touch_device, device_id, message)
        reported = message.get("schedule_version")
        await websocket.send_text(
            encrypt_for_device(
                device_code,
                {
                    "type": "heartbeat_ack",
                    "server_time": datetime.now(UTC).isoformat(),
                    "schedule_version": server_version,
                    # 장치는 이 값이 True 면 REST 로 스케줄을 다시 받는다.
                    "schedule_changed": reported != server_version,
                },
            )
        )
        return

    if msg_type in ("status", "ack"):
        # 재생 상태 보고. 현재는 접속 시각 갱신만 한다.
        conn.last_heartbeat_at = datetime.now(UTC)
        return

    await websocket.send_text(
        encrypt_for_device(
            device_code, {"type": "error", "detail": f"알 수 없는 메시지 타입: {msg_type}"}
        )
    )
