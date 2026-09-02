/**
 * 캔버스 화면 분할.
 *
 * 분할은 캔버스를 균등한 영역으로 나누고, 각 영역에 요소를 딱 맞게 배치하도록
 * 돕는 편집 보조 장치다.
 *
 * **플레이어 계약은 바뀌지 않는다.** 요소는 여전히 절대 좌표(rect)를 갖고,
 * 분할 정보(`layout.split`)와 요소의 `region` 은 부가 정보일 뿐이다. 이 필드를
 * 모르는 플레이어도 지금까지와 똑같이 렌더링한다. 분할을 요소의 위치를 결정하는
 * '구조'로 만들면 모든 플레이어를 함께 고쳐야 하므로 그렇게 하지 않았다.
 */

export const SPLIT_NONE = 'none'

/**
 * 분할 프리셋.
 *
 * 가로형은 넓으니 좌우로, 세로형은 기니 상하로 나누는 것이 자연스럽다.
 * 항목을 추가하려면 여기에 한 줄 넣으면 된다(화면과 계산이 모두 이 표를 따른다).
 */
export const SPLIT_PRESETS = [
  { key: SPLIT_NONE, orientation: 'any', cols: 1, rows: 1 },
  // 가로형
  { key: 'h2', orientation: 'landscape', cols: 2, rows: 1 },
  { key: 'grid4', orientation: 'landscape', cols: 2, rows: 2 },
  // 세로형
  { key: 'v2', orientation: 'portrait', cols: 1, rows: 2 },
  { key: 'v3', orientation: 'portrait', cols: 1, rows: 3 },
]

export const DEFAULT_GAP = 0

/** 세로가 더 길면 세로형. 정사각형은 가로형으로 본다. */
export function orientationOf(layout) {
  const width = layout?.width ?? 1920
  const height = layout?.height ?? 1080
  return height > width ? 'portrait' : 'landscape'
}

export function getPreset(key) {
  return SPLIT_PRESETS.find((preset) => preset.key === key) ?? null
}

/** 이 레이아웃에서 고를 수 있는 분할 목록(항상 '분할 없음'을 포함). */
export function availableSplits(layout) {
  const orientation = orientationOf(layout)
  return SPLIT_PRESETS.filter(
    (preset) => preset.orientation === 'any' || preset.orientation === orientation,
  )
}

export function isSplitAllowed(layout, key) {
  return availableSplits(layout).some((preset) => preset.key === key)
}

export const MIN_WEIGHT = 0.08

/**
 * 비율 배열을 합이 1 인 ``count`` 개로 정규화한다.
 *
 * 값이 없거나 개수가 맞지 않으면 균등 분할로 되돌린다. 저장된 문서가 손상돼도
 * 편집기가 깨지지 않아야 하기 때문이다.
 */
export function normalizeWeights(weights, count) {
  const equal = Array.from({ length: count }, () => 1 / count)
  if (!Array.isArray(weights) || weights.length !== count) return equal

  const numbers = weights.map((value) => Number(value))
  if (numbers.some((value) => !Number.isFinite(value) || value <= 0)) return equal

  const total = numbers.reduce((sum, value) => sum + value, 0)
  if (total <= 0) return equal
  return numbers.map((value) => value / total)
}

/** 저장된 값에서 분할 설정을 읽는다. 없거나 깨졌으면 '분할 없음'. */
export function readSplit(layout) {
  const split = layout?.split
  if (!split) return { key: SPLIT_NONE, gap: DEFAULT_GAP, cols: null, rows: null }
  // 예전 문서는 문자열로 저장했을 수 있다.
  if (typeof split === 'string') {
    return { key: split, gap: DEFAULT_GAP, cols: null, rows: null }
  }
  return {
    key: split.key ?? SPLIT_NONE,
    gap: Number(split.gap) || DEFAULT_GAP,
    cols: Array.isArray(split.cols) ? split.cols : null,
    rows: Array.isArray(split.rows) ? split.rows : null,
  }
}

/** 프리셋과 저장된 비율을 합쳐 실제로 쓸 열/행 비율을 만든다. */
export function resolveWeights(key, saved = {}) {
  const preset = getPreset(key)
  if (!preset) return { cols: [1], rows: [1] }
  return {
    cols: normalizeWeights(saved.cols, preset.cols),
    rows: normalizeWeights(saved.rows, preset.rows),
  }
}

export function regionCount(key) {
  const preset = getPreset(key)
  return preset ? preset.cols * preset.rows : 1
}

/**
 * 분할 영역의 절대 좌표를 계산한다.
 *
 * 영역 사이 간격(gap)은 영역을 안쪽으로 깎아 만든다. 바깥 테두리에는 여백을
 * 주지 않아, 분할해도 화면 가장자리까지 콘텐츠가 채워진다.
 */
export function computeRegions(layout, key, gap = DEFAULT_GAP, weights = null) {
  const preset = getPreset(key)
  const width = layout?.width ?? 1920
  const height = layout?.height ?? 1080

  if (!preset || preset.key === SPLIT_NONE) {
    return [{ index: 0, x: 0, y: 0, w: width, h: height }]
  }

  const { cols, rows } = resolveWeights(key, weights ?? {})
  const half = Math.max(0, gap) / 2

  // 누적 비율로 각 열/행의 시작 위치를 구한다(반올림 오차가 쌓이지 않게).
  const colEdges = [0]
  for (const weight of cols) colEdges.push(colEdges.at(-1) + weight)
  const rowEdges = [0]
  for (const weight of rows) rowEdges.push(rowEdges.at(-1) + weight)

  const regions = []
  for (let row = 0; row < preset.rows; row += 1) {
    for (let col = 0; col < preset.cols; col += 1) {
      // 바깥 모서리는 깎지 않는다.
      const left = col === 0 ? 0 : half
      const right = col === preset.cols - 1 ? 0 : half
      const top = row === 0 ? 0 : half
      const bottom = row === preset.rows - 1 ? 0 : half

      const x0 = Math.round(colEdges[col] * width)
      const x1 = Math.round(colEdges[col + 1] * width)
      const y0 = Math.round(rowEdges[row] * height)
      const y1 = Math.round(rowEdges[row + 1] * height)

      regions.push({
        index: row * preset.cols + col,
        x: x0 + left,
        y: y0 + top,
        w: x1 - x0 - left - right,
        h: y1 - y0 - top - bottom,
      })
    }
  }
  return regions
}

/**
 * 끌어서 크기를 바꿀 수 있는 분할선 목록.
 *
 * 열 사이 세로선과 행 사이 가로선. 격자형(2×2)에서는 열/행 비율이 전체에
 * 공통이므로 세로 1개 + 가로 1개가 나온다.
 */
export function computeDividers(layout, key, weights = null) {
  const preset = getPreset(key)
  if (!preset || preset.key === SPLIT_NONE) return []

  const width = layout?.width ?? 1920
  const height = layout?.height ?? 1080
  const { cols, rows } = resolveWeights(key, weights ?? {})
  const dividers = []

  let accumulated = 0
  for (let i = 0; i < cols.length - 1; i += 1) {
    accumulated += cols[i]
    dividers.push({ axis: 'x', index: i, position: Math.round(accumulated * width) })
  }

  accumulated = 0
  for (let i = 0; i < rows.length - 1; i += 1) {
    accumulated += rows[i]
    dividers.push({ axis: 'y', index: i, position: Math.round(accumulated * height) })
  }
  return dividers
}

/**
 * 분할선을 ``delta`` 비율만큼 옮긴 새 비율 배열.
 *
 * 이웃한 두 칸의 합을 유지하면서 경계만 움직인다. 어느 한 칸이 너무 얇아지면
 * (``MIN_WEIGHT``) 더 밀리지 않는다 — 폭 0 인 영역은 클릭도 안 되고 되돌릴 수도 없다.
 */
export function resizeWeights(weights, index, delta) {
  const next = [...weights]
  const pair = next[index] + next[index + 1]
  const first = Math.min(pair - MIN_WEIGHT, Math.max(MIN_WEIGHT, next[index] + delta))

  next[index] = first
  next[index + 1] = pair - first
  return next
}

/** 요소를 지정한 영역에 꽉 채운다. z 와 옵션은 건드리지 않는다. */
export function fitElementToRegion(element, region) {
  element.rect = {
    ...element.rect,
    x: region.x,
    y: region.y,
    w: region.w,
    h: region.h,
  }
  element.region = region.index
  return element
}

/**
 * 분할이 바뀌었을 때 영역에 묶인 요소들을 새 영역으로 다시 맞춘다.
 *
 * 영역 수가 줄어 자리가 없어진 요소는 위치를 그대로 두고 묶음만 푼다.
 * 조용히 지우면 사용자가 만든 것이 사라지기 때문이다.
 */
export function refitElements(elements, regions) {
  let refitted = 0
  let unbound = 0

  for (const element of elements) {
    if (element.region === undefined || element.region === null) continue
    const region = regions.find((r) => r.index === element.region)
    if (region) {
      fitElementToRegion(element, region)
      refitted += 1
    } else {
      delete element.region
      unbound += 1
    }
  }
  return { refitted, unbound }
}

/** 요소가 없는 영역 목록. 화면에서 '+' 를 보여 줄 곳을 정한다. */
export function emptyRegions(regions, elements) {
  const used = new Set(
    elements.map((el) => el.region).filter((index) => index !== undefined && index !== null),
  )
  return regions.filter((region) => !used.has(region.index))
}

/**
 * 캔버스를 주어진 공간에 꽉 채우는 배율.
 *
 * 잘리지 않도록 가로/세로 중 작은 비율을 쓴다(contain). 공간을 아직 측정하지
 * 못했을 때(0)는 1 을 돌려주어 0 으로 나누는 상황을 만들지 않는다.
 */
export function fitScale(layout, available, { max = 1 } = {}) {
  const width = layout?.width ?? 1920
  const height = layout?.height ?? 1080
  if (!available?.width || !available?.height || !width || !height) return 1

  const scale = Math.min(available.width / width, available.height / height)
  if (!Number.isFinite(scale) || scale <= 0) return 1
  return Math.min(scale, max)
}
