"""위젯 전환 효과 규약.

재생목록의 한 칸에서 다음 칸으로 넘어갈 때 쓰는 효과다. **서버가 규약의
주인**인 이유는, 이 값을 실제로 그리는 쪽이 브라우저 미리보기 하나가 아니라
플레이어 전부(JS / .NET WPF / Flutter)이기 때문이다. 각 플레이어가 제 나름의
이름을 쓰면 같은 재생목록이 장치마다 다르게 넘어간다.

효과 자체의 구현은 각 플레이어에 맡기고, 여기서는 **이름과 시간의 범위**만
못 박는다. 이름은 '무엇이 어떻게 들어오는가' 를 뜻한다.

일부 효과는 **두 장을 겹쳐** 그려야 한다(``CROSSFADE``). 앞 화면이 사라지면서
뒤 화면이 드러나는 것이 디졸브의 전부이고, 앞 화면이 밀려나야 밀기이며,
앞 화면 위를 덮어 가야 닦기다 — 들어오는 쪽만 그리면 셋 다 '가장자리에서
나타나기' 로 같아진다. 앞 화면이 어디로 빠지는지는 ``EXIT_MOTION`` 이 정한다.

겹쳐 그리는 동안에는 시계처럼 살아 있는 위젯이 두 벌 돌아가 값이 잠시
어긋난다. 겹치는 구간이 전환 시간(최대 5초)뿐이라 감수한다.
"""

from __future__ import annotations

from typing import Literal

#: 전환 효과 이름. 늘어날 수 있으므로 플레이어는 **모르는 값을 만나면**
#: ``none`` 으로 떨어뜨려야 한다(빈 화면이 나가는 것보다 낫다).
TransitionKind = Literal[
    "none",
    "fade",
    "dissolve",
    "blur",
    "slide-left",
    "slide-right",
    "slide-up",
    "slide-down",
    "wipe-left",
    "wipe-right",
    "zoom",
    "zoom-out",
    "flip",
    "rotate",
]

TRANSITIONS: tuple[str, ...] = (
    "none",
    "fade",
    "dissolve",
    "blur",
    "slide-left",
    "slide-right",
    "slide-up",
    "slide-down",
    "wipe-left",
    "wipe-right",
    "zoom",
    "zoom-out",
    "flip",
    "rotate",
)

DEFAULT_TRANSITION = "none"

#: 나가는 화면과 겹쳐 그려야 하는 효과. 플레이어는 이 목록에 있는 효과에서만
#: 앞 화면을 전환 시간 동안 남겨 두면 된다.
#:
#: 밀기(slide-*)가 여기 있는 이유는, 앞 화면이 그대로 있어야 **미는 것처럼
#: 보이기** 때문이다. 들어오는 쪽만 움직이면 새 화면이 가장자리에서 나타날
#: 뿐 밀려나는 느낌이 없다. 닦기(wipe-*)도 마찬가지로 앞 화면 위를 덮어
#: 가야 닦이는 것이지, 빈 바탕 위를 덮으면 그냥 나타나는 것이다.
#:
#: 겹쳐 그리는 동안에는 시계 같은 살아 있는 위젯이 두 벌 돌아간다. 겹치는
#: 구간이 전환 시간(최대 5초)뿐이라 감수한다.
CROSSFADE: frozenset[str] = frozenset(
    {
        "dissolve",
        "slide-left",
        "slide-right",
        "slide-up",
        "slide-down",
        "wipe-left",
        "wipe-right",
    }
)

#: 겹쳐 그릴 때 **앞 화면이 어디로 빠지는지**.
#:
#: 밀기는 들어오는 쪽과 같은 방향으로 함께 움직여야 두 화면이 붙어 밀린다.
#: 닦기는 앞 화면이 제자리에 있고 새 화면이 그 위를 덮어 간다(빈 값).
#: 디졸브는 자리를 지킨 채 사라진다.
EXIT_MOTION: dict[str, str] = {
    "dissolve": "fade-out",
    "slide-left": "to-left",
    "slide-right": "to-right",
    "slide-up": "to-up",
    "slide-down": "to-down",
    "wipe-left": "hold",
    "wipe-right": "hold",
}

#: 전환에 걸리는 시간(밀리초). 칸마다 정한다.
DEFAULT_TRANSITION_MS = 600
MIN_TRANSITION_MS = 100
MAX_TRANSITION_MS = 5000


def normalize(value: str | None) -> str:
    """모르는 이름은 ``none`` 으로. 저장된 값이 뒤에 사라질 수도 있다."""
    return value if value in TRANSITIONS else DEFAULT_TRANSITION


def normalize_ms(value: int | None) -> int:
    """범위를 벗어난 시간은 끌어다 맞춘다.

    플레이어가 저마다 방어하게 두면 장치마다 다르게 넘어간다. 여기서 한 번만
    잘라 두면 내려받는 값은 언제나 쓸 수 있는 범위 안이다.
    """
    if value is None:
        return DEFAULT_TRANSITION_MS
    return max(MIN_TRANSITION_MS, min(MAX_TRANSITION_MS, int(value)))


def fits_in(transition: str, transition_ms: int, duration_sec: int) -> bool:
    """전환이 그 칸의 표출 시간 안에 끝나는가.

    3초 머무는 칸에 5초짜리 전환을 걸면 효과가 끝나기 전에 다음으로 넘어가,
    화면이 영영 제자리에 놓이지 않는다. 저장은 됐는데 표출만 이상한 상태라
    원인을 찾기 어렵다 — 그래서 저장에서 막는다.
    """
    if normalize(transition) == DEFAULT_TRANSITION:
        return True
    return normalize_ms(transition_ms) <= duration_sec * 1000
