"""장치 저장공간 사용률.

장치가 하트비트로 보고한 전체/여유 용량으로 사용률을 계산하고, 임계치를
넘었는지 판정한다.

``Device.storage`` 는 등록 시 사람이 적어 넣는 사양 문자열("256GB")이라
계산에 쓸 수 없다. 실제 용량은 장치가 보고하는 바이트 값만 믿는다.

임계 판정을 **서버에서** 해서 ``DeviceOut.storage_warning`` 으로 내려주는
이유: 임계치가 화면마다 흩어지면 CMS·플레이어·알림이 서로 다른 기준으로
경고하게 된다. 기준은 여기 한 곳에만 둔다.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from app.models.device import Device

#: 이 비율 이상이면 경고한다. 콘텐츠 내려받기와 로그가 쌓일 여유를 남기려면
#: 20% 정도는 비어 있어야 한다는 운영 경험에 따른 값이다.
WARN_THRESHOLD = 0.8


def usage_ratio(total_bytes: int | None, free_bytes: int | None) -> float | None:
    """사용률(0~1). 계산할 수 없으면 None.

    None 은 "아직 보고받지 못했다"는 뜻이지 "여유롭다"가 아니다. 호출부는
    0 으로 갈음하지 말고 '미보고'로 표시해야 한다 — 0% 로 보이면 저장공간이
    넉넉한 장치와 구분되지 않는다.

    여유 용량이 전체보다 큰 값처럼 앞뒤가 안 맞는 보고는 버린다. 잘못된 값으로
    계산한 음수 사용률을 보여 주느니 미보고가 낫다.
    """
    if total_bytes is None or free_bytes is None:
        return None
    if total_bytes <= 0 or free_bytes < 0 or free_bytes > total_bytes:
        return None
    return (total_bytes - free_bytes) / total_bytes


def used_bytes(total_bytes: int | None, free_bytes: int | None) -> int | None:
    """사용 중인 바이트. 계산할 수 없으면 None."""
    if usage_ratio(total_bytes, free_bytes) is None:
        return None
    return total_bytes - free_bytes


def is_warning(ratio: float | None) -> bool:
    """경고 상태인가. 미보고(None)는 경고하지 않는다 — 모르는 것은 나쁜 것이 아니다."""
    return ratio is not None and ratio >= WARN_THRESHOLD


def record_report(device: Device, total_bytes: int | None, free_bytes: int | None) -> bool:
    """하트비트로 받은 저장공간을 장치에 기록한다. 커밋은 호출자가 한다.

    둘 중 하나만 오면 아무것도 바꾸지 않는다. 반쪽만 갱신하면 이전 보고의
    나머지 절반과 섞여 있지도 않은 사용률이 나온다.

    보고 시각을 함께 남기는 이유는 ``Device.storage_reported_at`` 주석 참조.
    """
    if total_bytes is None or free_bytes is None:
        return False
    device.storage_total_bytes = total_bytes
    device.storage_free_bytes = free_bytes
    device.storage_reported_at = datetime.now(UTC)
    return True
