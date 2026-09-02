/**
 * 편집기 그리드(모눈)와 스냅.
 *
 * 그리드는 **편집 보조 장치**이지 콘텐츠가 아니다. 그래서 문서에 저장하지 않고
 * 사용자 환경설정(settings 스토어)에 둔다. 문서에 넣으면 플레이어가 무시해야 할
 * 필드가 늘고, 같은 콘텐츠를 다른 사람이 열 때 남의 편집 취향이 따라온다.
 *
 * 좌표 단위는 모두 캔버스 좌표(문서 기준 절대 픽셀)다. 화면 배율은 렌더링할
 * 때만 곱한다.
 */

export const GRID_SIZES = [10, 20, 40, 60, 80, 120]
export const DEFAULT_GRID_SIZE = 40

/** 격자 한 칸의 크기로 반올림한다. */
export function snapTo(value, size) {
  if (!size || size <= 0) return Math.round(value)
  return Math.round(value / size) * size
}

/**
 * 사각형을 격자에 맞춘다.
 *
 * 이동(move)은 위치만, 크기 조절(resize)은 크기만 맞춘다. 둘 다 맞추면
 * 크기를 조절할 때 위치가 같이 튀어 손맛이 나빠진다.
 */
export function snapRect(rect, size, mode = 'move') {
  if (!size || size <= 0) return { ...rect }

  if (mode === 'resize') {
    return {
      ...rect,
      // 한 칸보다 작아지지 않게 한다.
      w: Math.max(size, snapTo(rect.w, size)),
      h: Math.max(size, snapTo(rect.h, size)),
    }
  }

  return { ...rect, x: snapTo(rect.x, size), y: snapTo(rect.y, size) }
}

/** 격자 선이 너무 촘촘해 뭉개지지 않을 만큼의 화면 간격인가. */
export function isGridVisible(size, scale, minPixels = 6) {
  return Boolean(size) && size * scale >= minPixels
}

/**
 * 사각형의 중심이 들어 있는 영역.
 *
 * '영역 전체 채우기'가 어느 영역을 뜻하는지 정할 때 쓴다. 겹침 넓이 대신
 * 중심점을 쓰는 이유는, 요소가 여러 영역에 걸쳐 있어도 사용자가 "지금 여기"라고
 * 느끼는 곳과 일치하기 때문이다.
 */
export function regionContaining(regions, rect) {
  if (!regions?.length || !rect) return null
  const cx = rect.x + rect.w / 2
  const cy = rect.y + rect.h / 2

  const hit = regions.find(
    (region) =>
      cx >= region.x && cx < region.x + region.w && cy >= region.y && cy < region.y + region.h,
  )
  if (hit) return hit

  // 캔버스 밖으로 밀려난 요소는 가장 가까운 영역으로 본다.
  let best = null
  let bestDistance = Infinity
  for (const region of regions) {
    const dx = cx - (region.x + region.w / 2)
    const dy = cy - (region.y + region.h / 2)
    const distance = dx * dx + dy * dy
    if (distance < bestDistance) {
      bestDistance = distance
      best = region
    }
  }
  return best
}
