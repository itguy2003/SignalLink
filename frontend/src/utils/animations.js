/**
 * 요소 애니메이션 규약.
 *
 * 위젯 **전환**(`transitions.js`)이 재생목록의 칸이 바뀔 때의 효과라면,
 * 이것은 **한 화면 안의 요소**가 나타나거나 계속 움직이는 효과다. 둘을 한
 * 목록으로 합치지 않은 이유는 적용 대상과 시점이 다르기 때문이다 — 전환은
 * 칸과 칸 사이에 한 번, 애니메이션은 화면이 떠 있는 내내다.
 *
 * 전환의 이름은 서버(`services/transitions.py`)가 갖고 있지만 이쪽은
 * 프론트엔드에 둔다. 전환은 DB 컬럼이라 서버가 값을 검증하지만, 애니메이션은
 * 콘텐츠 문서(JSON) 안에 들어가고 서버는 문서 내부를 들여다보지 않는다.
 * 규약을 지키는 주체가 편집기와 플레이어뿐이므로, 여기가 그 자리다.
 *
 * **편집 중에는 돌리지 않는다.** 자리와 크기를 잡는 동안 요소가 움직이면
 * 잡을 수가 없다. 미리보기와 실제 표출에서만 돈다.
 */

/** 한 번만 하고 제자리에 서는 효과(등장). */
export const ENTRANCES = [
  'fade-in',
  'slide-left',
  'slide-right',
  'slide-up',
  'slide-down',
  'zoom-in',
  'zoom-out',
  'rotate-in',
  'flip-in',
]

/** 계속 반복하는 효과(강조). */
export const LOOPS = ['pulse', 'float', 'blink', 'shake', 'swing']

export const ANIMATIONS = ['none', ...ENTRANCES, ...LOOPS]

export const DEFAULT_ANIMATION = 'none'

export const DEFAULT_DURATION_MS = 800
export const MIN_DURATION_MS = 100
export const MAX_DURATION_MS = 10000
export const MAX_DELAY_MS = 30000

export function normalize(value) {
  return ANIMATIONS.includes(value) ? value : DEFAULT_ANIMATION
}

export function normalizeMs(value, { fallback = DEFAULT_DURATION_MS, min = MIN_DURATION_MS, max = MAX_DURATION_MS } = {}) {
  const ms = Number(value)
  if (!Number.isFinite(ms)) return fallback
  return Math.max(min, Math.min(max, Math.round(ms)))
}

/** 반복하는 효과인가. 등장 효과에 '무한 반복' 을 주면 화면이 계속 튄다. */
export function isLoop(value) {
  return LOOPS.includes(normalize(value))
}

export function labelKey(value) {
  return `animation.${normalize(value).replace(/-/g, '_')}`
}

export function groupKey(key) {
  return `animation.group.${key}`
}

export const ANIMATION_GROUPS = [
  { key: 'entrance', kinds: ENTRANCES },
  { key: 'loop', kinds: LOOPS },
]

/**
 * 요소에 입힐 CSS. 효과가 없으면 빈 객체다.
 *
 * 이름을 CSS 애니메이션 이름으로 그대로 쓴다(`ContentCanvas` 가 `@keyframes`
 * 를 갖고 있다). 다른 플레이어는 같은 이름을 제 방식대로 그리면 된다.
 */
export function animationStyle(animation) {
  const name = normalize(animation?.type)
  if (name === DEFAULT_ANIMATION) return {}

  const duration = normalizeMs(animation?.duration_ms)
  const delay = normalizeMs(animation?.delay_ms, { fallback: 0, min: 0, max: MAX_DELAY_MS })

  return {
    animationName: `sl-${name}`,
    animationDuration: `${duration}ms`,
    animationDelay: `${delay}ms`,
    animationIterationCount: isLoop(name) ? 'infinite' : '1',
    animationTimingFunction: 'ease',
    // 등장 효과는 끝난 자리에 머물러야 한다. 안 그러면 마지막 프레임에서
    // 처음 모습으로 되돌아가 깜빡인다.
    animationFillMode: 'both',
  }
}
