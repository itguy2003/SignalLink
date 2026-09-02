/**
 * 캔버스 확대/축소.
 *
 * 배율은 두 가지 방식으로 정해진다.
 *   'fit'    남은 공간에 맞춰 자동으로(기본값)
 *   숫자      사용자가 고른 고정 배율
 *
 * 고정 배율로 두면 창 크기가 바뀌어도 그대로 유지된다. 편집 중에 배율이
 * 저 혼자 바뀌면 작업하던 위치를 잃기 때문이다.
 */

export const ZOOM_LEVELS = [0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4]
export const MIN_ZOOM = ZOOM_LEVELS[0]
export const MAX_ZOOM = ZOOM_LEVELS.at(-1)

export function clampZoom(value) {
  const zoom = Number(value)
  if (!Number.isFinite(zoom)) return 1
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom))
}

/**
 * 지금 배율보다 한 단계 큰 값.
 *
 * 자동 맞춤 배율은 대개 단계 사이의 어중간한 값(예: 0.42)이라, 그보다 큰
 * 첫 단계로 올라간다. 그래야 확대를 눌렀는데 더 작아지는 일이 없다.
 */
export function zoomIn(current) {
  const zoom = clampZoom(current)
  const next = ZOOM_LEVELS.find((level) => level > zoom + 1e-6)
  return next ?? MAX_ZOOM
}

export function zoomOut(current) {
  const zoom = clampZoom(current)
  const previous = [...ZOOM_LEVELS].reverse().find((level) => level < zoom - 1e-6)
  return previous ?? MIN_ZOOM
}

/** 휠 확대. 한 번에 한 단계씩만 움직여 손이 미끄러져도 크게 튀지 않는다. */
export function zoomByWheel(current, deltaY) {
  return deltaY < 0 ? zoomIn(current) : zoomOut(current)
}

/** 화면에 보여 줄 퍼센트. */
export function zoomPercent(scale) {
  return Math.round(scale * 100)
}
