"""화면 방향(가로형/세로형) 판정.

스케줄과 콘텐츠 모두 방향을 갖는다. 스케줄은 명시된 값을, 콘텐츠는 편집
해상도(``width``/``height``)에서 끌어낸다. 콘텐츠에 방향 컬럼을 따로 두지
않는 이유는 두 값이 어긋날 수 있기 때문이다 — 크기가 곧 방향이다.

판정 기준을 이 한 곳에 모은 이유: 기준이 갈라지면 편집기에서는 붙던 콘텐츠가
저장 단계에서 거부되는 식으로 어긋난다. 프론트엔드의 ``utils/orientation.js``
가 같은 규칙을 구현하며, 두 구현이 같은 답을 내야 한다.
"""

from __future__ import annotations

from typing import Any

from app.models.enums import PanelType

#: 오류 메시지에 쓸 한국어 이름. 열거형 값은 영어라 그대로 쓰면 읽기 어렵다.
LABELS: dict[PanelType, str] = {
    PanelType.LANDSCAPE: "가로형",
    PanelType.PORTRAIT: "세로형",
}


def label(value: PanelType | str) -> str:
    try:
        return LABELS[PanelType(value)]
    except ValueError:
        return str(value)


def of_size(width: float, height: float) -> PanelType:
    """크기로 방향을 정한다.

    정사각형은 가로형으로 본다 — ``Content.is_portrait`` 와 같은 기준이며,
    한쪽으로 정해 두지 않으면 1:1 콘텐츠가 어느 스케줄에도 못 붙는다.
    """
    return PanelType.PORTRAIT if height > width else PanelType.LANDSCAPE


def of_document(document: dict[str, Any] | None) -> PanelType | None:
    """콘텐츠 문서(``layout``)의 방향. 크기를 알 수 없으면 None.

    None 은 "방향을 따질 수 없다"는 뜻이지 "틀렸다"가 아니다. 아직 아무것도
    배치하지 않은 빈 아이템까지 막으면 편집을 시작할 수가 없다.
    """
    layout = (document or {}).get("layout")
    if not isinstance(layout, dict):
        return None
    width, height = layout.get("width"), layout.get("height")
    if not isinstance(width, int | float) or not isinstance(height, int | float):
        return None
    if width <= 0 or height <= 0:
        return None
    return of_size(width, height)


def default_size(value: PanelType | str) -> tuple[int, int]:
    """그 방향의 기본 편집 해상도. 새 콘텐츠를 만들 때 쓴다."""
    return (1080, 1920) if PanelType(value) is PanelType.PORTRAIT else (1920, 1080)
