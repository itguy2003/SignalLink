/**
 * 위젯 전환 효과 규약 — 서버(`app/services/transitions.py`)의 짝.
 *
 * 이름과 시간 범위는 **서버가 정한다**. 이 값을 실제로 그리는 쪽이 브라우저
 * 미리보기 하나가 아니라 플레이어 전부(JS / .NET WPF / Flutter)여서,
 * 각자 제 이름을 쓰면 같은 재생목록이 장치마다 다르게 넘어간다.
 *
 * 여기 있는 CSS 는 브라우저 쪽 구현일 뿐이다. 다른 플레이어는 같은 이름을
 * 제 방식대로 그리면 된다.
 */

/**
 * 고를 수 있는 효과를 성격별로 묶는다.
 *
 * 열몇 개를 한 줄로 늘어놓으면 원하는 것을 찾는 데 시간이 걸린다. 묶어 두면
 * "미는 것 중에" 처럼 반쯤 정한 상태에서 좁혀 갈 수 있다.
 */
export const TRANSITION_GROUPS = [
  { key: 'basic', kinds: ['none', 'fade', 'dissolve', 'blur'] },
  { key: 'slide', kinds: ['slide-left', 'slide-right', 'slide-up', 'slide-down'] },
  { key: 'wipe', kinds: ['wipe-left', 'wipe-right'] },
  { key: 'scale', kinds: ['zoom', 'zoom-out', 'flip', 'rotate'] },
]

/** 전체 목록(순서는 묶음 순서를 따른다). */
export const TRANSITIONS = TRANSITION_GROUPS.flatMap((group) => group.kinds)

export const DEFAULT_TRANSITION = 'none'

/**
 * 나가는 화면과 겹쳐 그려야 하는 효과.
 *
 * 앞 화면이 사라지면서 뒤 화면이 드러나는 것이 디졸브의 전부이고, **앞 화면이
 * 밀려나야 밀기**이며, 앞 화면 위를 덮어 가야 닦기다. 들어오는 쪽만 그리면
 * 셋 다 '가장자리에서 나타나기' 로 같아진다.
 *
 * 겹쳐 그리는 동안에는 시계처럼 살아 있는 위젯이 두 벌 돌아간다. 겹치는
 * 구간이 전환 시간(최대 5초)뿐이라 감수한다. 확대·회전 계열을 넣지 않은
 * 이유는 그쪽은 들어오는 쪽만 움직여도 뜻이 통하기 때문이다.
 */
export const CROSSFADE = new Set([
  'dissolve',
  'slide-left',
  'slide-right',
  'slide-up',
  'slide-down',
  'wipe-left',
  'wipe-right',
])

/** 앞 화면을 전환 시간 동안 남겨 둬야 하는가. */
export function crossfades(value) {
  return CROSSFADE.has(normalize(value))
}

/** 전환에 걸리는 시간(ms). 칸마다 정하고, 범위는 서버와 같다. */
export const DEFAULT_TRANSITION_MS = 600
export const MIN_TRANSITION_MS = 100
export const MAX_TRANSITION_MS = 5000

/** 모르는 이름은 '없음'으로. 저장된 효과가 뒤에 사라질 수도 있다. */
export function normalize(value) {
  return TRANSITIONS.includes(value) ? value : DEFAULT_TRANSITION
}

/** 범위를 벗어난 시간은 끌어다 맞춘다(서버와 같은 규칙). */
export function normalizeMs(value) {
  const ms = Number(value)
  if (!Number.isFinite(ms)) return DEFAULT_TRANSITION_MS
  return Math.max(MIN_TRANSITION_MS, Math.min(MAX_TRANSITION_MS, Math.round(ms)))
}

/**
 * 전환이 그 칸의 표출 시간 안에 끝나는가.
 *
 * 3초 머무는 칸에 5초짜리 전환을 걸면 효과가 끝나기 전에 다음으로 넘어가,
 * 화면이 영영 제자리에 놓이지 않는다. 서버도 같은 규칙으로 저장을 막는다.
 */
export function fitsIn(transition, transitionMs, durationSec) {
  if (normalize(transition) === DEFAULT_TRANSITION) return true
  return normalizeMs(transitionMs) <= durationSec * 1000
}

/** 선택 상자에 쓸 i18n 키. */
export function labelKey(value) {
  return `transition.${normalize(value).replace('-', '_')}`
}

/** 묶음 이름의 i18n 키. */
export function groupKey(key) {
  return `transition.group.${key}`
}

/**
 * 들어오는 화면의 시작 모습(CSS).
 *
 * 대부분의 전환은 '새 화면이 이 모습에서 제자리로 온다'로만 표현한다. 나가는
 * 화면까지 겹쳐 그리는 것은 디졸브뿐이다(`CROSSFADE`) — 위젯은 시계처럼 살아
 * 있는 것이 있어 두 벌을 오래 돌리면 값이 어긋나기 때문이다.
 */
export function enterStyle(value) {
  switch (normalize(value)) {
    case 'fade':
    // 디졸브도 들어오는 쪽은 페이드와 같다. 다른 것은 나가는 화면을 겹쳐
    // 그린다는 점이다(`exitStyle`).
    case 'dissolve':
      return { opacity: 0 }
    case 'blur':
      return { opacity: 0, filter: 'blur(14px)' }
    case 'slide-left':
      return { transform: 'translateX(100%)' }
    case 'slide-right':
      return { transform: 'translateX(-100%)' }
    case 'slide-up':
      return { transform: 'translateY(100%)' }
    case 'slide-down':
      return { transform: 'translateY(-100%)' }
    // 닦기는 화면을 옮기지 않고 보이는 만큼만 넓힌다 — 밀기와 달리 내용이
    // 제자리에 있어, 글자가 많은 위젯이 흔들려 보이지 않는다.
    case 'wipe-left':
      return { clipPath: 'inset(0 0 0 100%)' }
    case 'wipe-right':
      return { clipPath: 'inset(0 100% 0 0)' }
    case 'zoom':
      return { opacity: 0, transform: 'scale(0.85)' }
    case 'zoom-out':
      return { opacity: 0, transform: 'scale(1.15)' }
    case 'flip':
      return { opacity: 0, transform: 'perspective(1200px) rotateY(90deg)' }
    case 'rotate':
      return { opacity: 0, transform: 'rotate(-8deg) scale(0.9)' }
    default:
      return {}
  }
}

/**
 * 나가는 화면의 끝 모습(겹쳐 그리는 효과에만 쓴다).
 *
 * 시작은 제자리(`restStyle`)이고, 전환 시간에 걸쳐 이 모습으로 빠진다.
 *
 * 밀기는 **들어오는 쪽과 같은 방향으로** 함께 움직인다 — 그래야 두 화면이
 * 맞붙어 하나가 다른 하나를 밀어내는 것처럼 보인다. 반대로 움직이면 둘이
 * 갈라지며 가운데가 비어 버린다.
 */
export function exitStyle(value) {
  switch (normalize(value)) {
    case 'dissolve':
      return { opacity: 0 }
    case 'slide-left':
      return { transform: 'translateX(-100%)' }
    case 'slide-right':
      return { transform: 'translateX(100%)' }
    case 'slide-up':
      return { transform: 'translateY(-100%)' }
    case 'slide-down':
      return { transform: 'translateY(100%)' }
    // 닦기는 앞 화면이 제자리에 있고 새 화면이 그 위를 덮어 간다.
    case 'wipe-left':
    case 'wipe-right':
      return {}
    default:
      return {}
  }
}

/** 제자리에 놓인 모습. 전환이 끝난 뒤의 상태다. */
export function restStyle() {
  return { opacity: 1, transform: 'none', filter: 'none', clipPath: 'inset(0 0 0 0)' }
}
