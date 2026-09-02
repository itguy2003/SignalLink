"""장치 WebSocket 연결 관리.

프로세스 로컬 레지스트리다. 서버를 여러 워커/인스턴스로 확장하면
(요구사항 제한사항 4의 증설 방안) Redis Pub/Sub 등 외부 브로커로
``push`` 를 중계해야 한다. 그 교체 지점을 좁히기 위해 라우터는
이 모듈의 함수만 호출한다.
"""

from __future__ import annotations

import asyncio
import logging
from datetime import UTC, datetime
from typing import Any

from fastapi import WebSocket

logger = logging.getLogger(__name__)


class DeviceConnection:
    def __init__(self, device_id: int, device_code: str, websocket: WebSocket) -> None:
        self.device_id = device_id
        self.device_code = device_code
        self.websocket = websocket
        self.connected_at = datetime.now(UTC)
        self.last_heartbeat_at: datetime | None = None


class ConnectionHub:
    def __init__(self) -> None:
        self._connections: dict[int, DeviceConnection] = {}
        self._lock = asyncio.Lock()

    async def connect(
        self, device_id: int, device_code: str, websocket: WebSocket
    ) -> DeviceConnection:
        async with self._lock:
            existing = self._connections.get(device_id)
            if existing is not None:
                # 같은 장치가 재접속하면 이전 연결을 정리한다.
                try:
                    await existing.websocket.close(code=4000, reason="다른 세션에서 재접속")
                except Exception:  # noqa: BLE001 - 이미 끊긴 소켓은 무시
                    logger.debug("이전 연결 종료 실패 device_id=%s", device_id)
            conn = DeviceConnection(device_id, device_code, websocket)
            self._connections[device_id] = conn
            return conn

    async def disconnect(self, device_id: int, websocket: WebSocket) -> None:
        async with self._lock:
            conn = self._connections.get(device_id)
            # 재접속으로 이미 교체된 경우 지우지 않는다.
            if conn is not None and conn.websocket is websocket:
                del self._connections[device_id]

    def is_online(self, device_id: int) -> bool:
        return device_id in self._connections

    def online_ids(self) -> set[int]:
        return set(self._connections)

    def get(self, device_id: int) -> DeviceConnection | None:
        return self._connections.get(device_id)

    async def push(self, device_id: int, envelope: str) -> bool:
        """암호화된 봉투 문자열을 장치로 전송한다. 미접속이면 False."""
        conn = self._connections.get(device_id)
        if conn is None:
            return False
        try:
            await conn.websocket.send_text(envelope)
            return True
        except Exception:  # noqa: BLE001
            logger.warning("장치 전송 실패 device_id=%s", device_id)
            await self.disconnect(device_id, conn.websocket)
            return False

    async def broadcast(self, envelopes: dict[int, str]) -> int:
        """{device_id: envelope} 를 각각 전송하고 성공 건수를 반환한다."""
        results = await asyncio.gather(
            *(self.push(device_id, env) for device_id, env in envelopes.items()),
            return_exceptions=True,
        )
        return sum(1 for r in results if r is True)

    def stats(self) -> dict[str, Any]:
        return {
            "online_count": len(self._connections),
            "devices": [
                {
                    "device_id": c.device_id,
                    "device_code": c.device_code,
                    "connected_at": c.connected_at.isoformat(),
                    "last_heartbeat_at": c.last_heartbeat_at.isoformat()
                    if c.last_heartbeat_at
                    else None,
                }
                for c in self._connections.values()
            ],
        }


hub = ConnectionHub()
