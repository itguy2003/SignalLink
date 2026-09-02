"""장치로의 서버 푸시.

CMS 에서 스케줄을 바꾸면 다음 하트비트를 기다리지 않고 즉시 알린다.
하트비트 기반 동기화(요구사항 제한사항 5)가 정본이고, 이 푸시는 지연을
줄이기 위한 보조 수단이다. 푸시가 유실돼도 다음 하트비트에서 복구된다.
"""

from __future__ import annotations

import logging

from app.core.crypto import encrypt_for_device
from app.services.ws_hub import hub

logger = logging.getLogger(__name__)


async def push_schedule_changed(targets: list[tuple[int, str, int]]) -> int:
    """``(device_id, device_code, version)`` 목록에 스케줄 변경을 통지한다."""
    envelopes = {
        device_id: encrypt_for_device(
            device_code, {"type": "schedule_changed", "version": version}
        )
        for device_id, device_code, version in targets
    }
    sent = await hub.broadcast(envelopes)
    logger.info("스케줄 변경 푸시 %d/%d", sent, len(envelopes))
    return sent


async def push_command(
    device_id: int, device_code: str, command: str, params: dict | None = None
) -> bool:
    """개별 장치 제어 명령(재시작, 새로고침, 스크린샷 등)."""
    envelope = encrypt_for_device(
        device_code, {"type": "command", "command": command, "params": params or {}}
    )
    return await hub.push(device_id, envelope)
