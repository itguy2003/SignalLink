import { describe, expect, it } from 'vitest'

import {
  MIN_WEIGHT,
  SPLIT_NONE,
  availableSplits,
  computeDividers,
  normalizeWeights,
  resizeWeights,
  resolveWeights,
  computeRegions,
  emptyRegions,
  fitElementToRegion,
  fitScale,
  getPreset,
  isSplitAllowed,
  orientationOf,
  readSplit,
  refitElements,
  regionCount,
} from './canvasSplit'

const LANDSCAPE = { width: 1920, height: 1080 }
const PORTRAIT = { width: 1080, height: 1920 }

describe('방향 판정', () => {
  it('가로가 더 길면 가로형', () => {
    expect(orientationOf(LANDSCAPE)).toBe('landscape')
  })

  it('세로가 더 길면 세로형', () => {
    expect(orientationOf(PORTRAIT)).toBe('portrait')
  })

  it('정사각형은 가로형으로 본다', () => {
    expect(orientationOf({ width: 1080, height: 1080 })).toBe('landscape')
  })

  it('레이아웃이 없어도 기본값으로 판정한다', () => {
    expect(orientationOf(undefined)).toBe('landscape')
  })
})

describe('선택 가능한 분할', () => {
  it('가로형은 2분할과 4분할을 제공한다', () => {
    const keys = availableSplits(LANDSCAPE).map((p) => p.key)
    expect(keys).toEqual([SPLIT_NONE, 'h2', 'grid4'])
  })

  it('세로형은 2분할과 3분할을 제공한다', () => {
    const keys = availableSplits(PORTRAIT).map((p) => p.key)
    expect(keys).toEqual([SPLIT_NONE, 'v2', 'v3'])
  })

  it('가로형 전용 분할은 세로형에서 허용하지 않는다', () => {
    expect(isSplitAllowed(PORTRAIT, 'grid4')).toBe(false)
    expect(isSplitAllowed(LANDSCAPE, 'grid4')).toBe(true)
  })

  it('분할 없음은 어느 방향에서나 허용한다', () => {
    expect(isSplitAllowed(LANDSCAPE, SPLIT_NONE)).toBe(true)
    expect(isSplitAllowed(PORTRAIT, SPLIT_NONE)).toBe(true)
  })

  it('영역 수는 프리셋의 행×열이다', () => {
    expect(regionCount(SPLIT_NONE)).toBe(1)
    expect(regionCount('h2')).toBe(2)
    expect(regionCount('grid4')).toBe(4)
    expect(regionCount('v3')).toBe(3)
  })

  it('알 수 없는 키는 단일 영역으로 취급한다', () => {
    expect(getPreset('없는키')).toBeNull()
    expect(regionCount('없는키')).toBe(1)
  })
})

describe('영역 계산', () => {
  it('분할 없음은 캔버스 전체가 한 영역이다', () => {
    expect(computeRegions(LANDSCAPE, SPLIT_NONE)).toEqual([
      { index: 0, x: 0, y: 0, w: 1920, h: 1080 },
    ])
  })

  it('가로형 2분할은 좌우로 나눈다', () => {
    const regions = computeRegions(LANDSCAPE, 'h2')
    expect(regions).toEqual([
      { index: 0, x: 0, y: 0, w: 960, h: 1080 },
      { index: 1, x: 960, y: 0, w: 960, h: 1080 },
    ])
  })

  it('가로형 4분할은 2×2 격자다', () => {
    const regions = computeRegions(LANDSCAPE, 'grid4')
    expect(regions).toHaveLength(4)
    expect(regions[0]).toEqual({ index: 0, x: 0, y: 0, w: 960, h: 540 })
    expect(regions[3]).toEqual({ index: 3, x: 960, y: 540, w: 960, h: 540 })
  })

  it('세로형 2분할은 상하로 나눈다', () => {
    const regions = computeRegions(PORTRAIT, 'v2')
    expect(regions).toEqual([
      { index: 0, x: 0, y: 0, w: 1080, h: 960 },
      { index: 1, x: 0, y: 960, w: 1080, h: 960 },
    ])
  })

  it('세로형 3분할은 상하 3등분이다', () => {
    const regions = computeRegions(PORTRAIT, 'v3')
    expect(regions).toHaveLength(3)
    expect(regions.map((r) => r.y)).toEqual([0, 640, 1280])
    expect(regions.every((r) => r.h === 640 && r.w === 1080)).toBe(true)
  })

  it('영역을 모두 합치면 캔버스를 빈틈없이 덮는다', () => {
    const regions = computeRegions(LANDSCAPE, 'grid4')
    const area = regions.reduce((sum, r) => sum + r.w * r.h, 0)
    expect(area).toBe(1920 * 1080)
  })

  it('간격을 주면 안쪽만 깎고 바깥 테두리는 유지한다', () => {
    // 화면 가장자리에 여백이 생기면 사이니지에서 검은 띠로 보인다.
    const regions = computeRegions(LANDSCAPE, 'h2', 20)
    expect(regions[0]).toEqual({ index: 0, x: 0, y: 0, w: 950, h: 1080 })
    expect(regions[1]).toEqual({ index: 1, x: 970, y: 0, w: 950, h: 1080 })
    expect(regions[0].x).toBe(0)
    expect(regions[1].x + regions[1].w).toBe(1920)
  })

  it('음수 간격은 0 으로 취급한다', () => {
    expect(computeRegions(LANDSCAPE, 'h2', -50)).toEqual(computeRegions(LANDSCAPE, 'h2', 0))
  })
})

describe('정보 표시줄과 분할', () => {
  // 표시줄(72px)이 켜져 있으면 그 띠는 배치 영역이 아니다 — 분할 영역과
  // 분할선이 모두 그 밑에서 계산돼야 첫 행이 표시줄에 깔리지 않는다.

  const BAR_LANDSCAPE = { ...LANDSCAPE, info_bar: true }
  const BAR_PORTRAIT = { ...PORTRAIT, info_bar: true }

  it('분할 없음도 표시줄을 뺀 나머지가 한 영역이다', () => {
    expect(computeRegions(BAR_LANDSCAPE, SPLIT_NONE)).toEqual([
      { index: 0, x: 0, y: 72, w: 1920, h: 1008 },
    ])
  })

  it('행 나눔은 표시줄 아래 높이를 나눈다', () => {
    const regions = computeRegions(BAR_LANDSCAPE, 'grid4')
    expect(regions[0]).toEqual({ index: 0, x: 0, y: 72, w: 960, h: 504 })
    expect(regions[3]).toEqual({ index: 3, x: 960, y: 576, w: 960, h: 504 })
  })

  it('세로형 3분할도 표시줄 밑에서 3등분한다', () => {
    const regions = computeRegions(BAR_PORTRAIT, 'v3')
    expect(regions.map((r) => r.y)).toEqual([72, 688, 1304])
    expect(regions.every((r) => r.h === 616)).toBe(true)
  })

  it('영역을 합치면 표시줄 아래를 빈틈없이 덮는다', () => {
    const regions = computeRegions(BAR_LANDSCAPE, 'grid4')
    const area = regions.reduce((sum, r) => sum + r.w * r.h, 0)
    expect(area).toBe(1920 * (1080 - 72))
  })

  it('가로 분할선도 표시줄만큼 내려온다', () => {
    const dividers = computeDividers(BAR_LANDSCAPE, 'grid4')
    const horizontal = dividers.find((d) => d.axis === 'y')
    expect(horizontal.position).toBe(72 + 504)
    // 세로선의 x 는 표시줄과 무관하다.
    expect(dividers.find((d) => d.axis === 'x').position).toBe(960)
  })

  it('표시줄이 꺼져 있으면 예전 계산 그대로다', () => {
    expect(computeRegions({ ...LANDSCAPE, info_bar: false }, 'h2')).toEqual(
      computeRegions(LANDSCAPE, 'h2'),
    )
  })
})

describe('저장된 분할 읽기', () => {
  it('없으면 분할 없음이다', () => {
    expect(readSplit({ width: 1920, height: 1080 })).toMatchObject({ key: SPLIT_NONE, gap: 0 })
  })

  it('객체 형태를 읽는다', () => {
    expect(readSplit({ split: { key: 'h2', gap: 12 } })).toMatchObject({ key: 'h2', gap: 12 })
  })

  it('예전 문자열 형태도 읽는다', () => {
    // 형식을 바꾸기 전에 저장된 문서가 깨지지 않아야 한다.
    expect(readSplit({ split: 'grid4' })).toMatchObject({ key: 'grid4', gap: 0 })
  })

  it('비율이 저장돼 있지 않으면 null 이다(균등 분할)', () => {
    const split = readSplit({ split: { key: 'h2' } })
    expect(split.cols).toBeNull()
    expect(split.rows).toBeNull()
  })

  it('간격이 숫자가 아니면 0 으로 본다', () => {
    expect(readSplit({ split: { key: 'h2', gap: 'abc' } })).toMatchObject({ key: 'h2', gap: 0 })
  })
})

describe('요소를 영역에 맞추기', () => {
  const makeElement = () => ({
    id: 'e1',
    type: 'text',
    rect: { x: 10, y: 20, w: 30, h: 40, z: 5, rotation: 0 },
  })

  it('요소가 영역을 꽉 채운다', () => {
    const element = makeElement()
    fitElementToRegion(element, { index: 1, x: 960, y: 0, w: 960, h: 1080 })
    expect(element.rect).toMatchObject({ x: 960, y: 0, w: 960, h: 1080 })
  })

  it('겹침 순서는 유지된다', () => {
    const element = makeElement()
    fitElementToRegion(element, { index: 0, x: 0, y: 0, w: 100, h: 100 })
    expect(element.rect.z).toBe(5)
  })

  it('어느 영역에 묶였는지 기록한다', () => {
    const element = makeElement()
    fitElementToRegion(element, { index: 2, x: 0, y: 0, w: 100, h: 100 })
    expect(element.region).toBe(2)
  })
})

describe('분할 변경 시 재배치', () => {
  const bound = (id, region) => ({
    id,
    type: 'text',
    region,
    rect: { x: 0, y: 0, w: 10, h: 10, z: 1 },
  })

  it('묶인 요소를 새 영역에 다시 맞춘다', () => {
    const elements = [bound('a', 0), bound('b', 1)]
    const regions = computeRegions(LANDSCAPE, 'h2')
    const result = refitElements(elements, regions)

    expect(result.refitted).toBe(2)
    expect(elements[1].rect).toMatchObject({ x: 960, w: 960 })
  })

  it('영역이 줄어 자리가 없어진 요소는 지우지 않고 묶음만 푼다', () => {
    // 사용자가 만든 것이 조용히 사라지면 안 된다.
    const elements = [bound('a', 0), bound('b', 3)]
    const regions = computeRegions(LANDSCAPE, 'h2') // 영역 2개뿐
    const result = refitElements(elements, regions)

    expect(result.refitted).toBe(1)
    expect(result.unbound).toBe(1)
    expect(elements).toHaveLength(2)
    expect(elements[1].region).toBeUndefined()
  })

  it('영역에 묶이지 않은 요소는 건드리지 않는다', () => {
    const free = { id: 'free', type: 'text', rect: { x: 5, y: 5, w: 10, h: 10, z: 1 } }
    const elements = [free]
    refitElements(elements, computeRegions(LANDSCAPE, 'grid4'))
    expect(free.rect).toEqual({ x: 5, y: 5, w: 10, h: 10, z: 1 })
  })

  it('빈 영역을 찾아낸다', () => {
    const regions = computeRegions(LANDSCAPE, 'grid4')
    const elements = [bound('a', 0), bound('b', 2)]
    expect(emptyRegions(regions, elements).map((r) => r.index)).toEqual([1, 3])
  })

  it('모든 영역이 차면 빈 영역이 없다', () => {
    const regions = computeRegions(LANDSCAPE, 'h2')
    expect(emptyRegions(regions, [bound('a', 0), bound('b', 1)])).toEqual([])
  })
})

describe('화면 채우기 배율', () => {
  it('공간에 맞춰 확대한다', () => {
    // 1920×1080 을 960 폭 공간에 넣으면 0.5 배.
    expect(fitScale(LANDSCAPE, { width: 960, height: 1000 })).toBe(0.5)
  })

  it('잘리지 않도록 작은 쪽 비율을 쓴다', () => {
    // 세로가 모자라면 세로 기준으로 줄인다.
    expect(fitScale(LANDSCAPE, { width: 1920, height: 540 })).toBe(0.5)
  })

  it('기본적으로 원본 크기를 넘지 않는다', () => {
    expect(fitScale(LANDSCAPE, { width: 3840, height: 2160 })).toBe(1)
  })

  it('상한을 올리면 확대도 허용한다', () => {
    expect(fitScale(LANDSCAPE, { width: 3840, height: 2160 }, { max: 2 })).toBe(2)
  })

  it('아직 측정하지 못한 공간(0)에서는 1 을 돌려준다', () => {
    // 0 으로 나눠 NaN 이 되면 캔버스가 사라진다.
    expect(fitScale(LANDSCAPE, { width: 0, height: 0 })).toBe(1)
    expect(fitScale(LANDSCAPE, null)).toBe(1)
  })
})


describe('분할 비율 정규화', () => {
  it('없으면 균등 분할이다', () => {
    expect(normalizeWeights(null, 2)).toEqual([0.5, 0.5])
  })

  it('합이 1 이 되도록 맞춘다', () => {
    expect(normalizeWeights([3, 1], 2)).toEqual([0.75, 0.25])
  })

  it('개수가 맞지 않으면 균등으로 되돌린다', () => {
    // 저장된 문서가 손상돼도 편집기가 깨지면 안 된다.
    expect(normalizeWeights([0.5, 0.5], 3)).toEqual([1 / 3, 1 / 3, 1 / 3])
  })

  it('0 이나 음수, NaN 이 섞이면 균등으로 되돌린다', () => {
    expect(normalizeWeights([0, 1], 2)).toEqual([0.5, 0.5])
    expect(normalizeWeights([-1, 2], 2)).toEqual([0.5, 0.5])
    expect(normalizeWeights(['x', 1], 2)).toEqual([0.5, 0.5])
  })

  it('프리셋에 맞춰 열/행 비율을 만든다', () => {
    expect(resolveWeights('grid4', {})).toEqual({ cols: [0.5, 0.5], rows: [0.5, 0.5] })
    expect(resolveWeights('v3', {}).rows).toHaveLength(3)
  })

  it('저장된 비율을 읽어 온다', () => {
    expect(readSplit({ split: { key: 'h2', cols: [0.7, 0.3] } }).cols).toEqual([0.7, 0.3])
  })
})

describe('비율을 반영한 영역 계산', () => {
  it('7:3 으로 나누면 폭이 그대로 반영된다', () => {
    const regions = computeRegions(LANDSCAPE, 'h2', 0, { cols: [0.7, 0.3] })
    expect(regions[0]).toEqual({ index: 0, x: 0, y: 0, w: 1344, h: 1080 })
    expect(regions[1]).toEqual({ index: 1, x: 1344, y: 0, w: 576, h: 1080 })
  })

  it('비율을 바꿔도 빈틈이나 겹침이 없다', () => {
    const regions = computeRegions(LANDSCAPE, 'grid4', 0, {
      cols: [0.62, 0.38],
      rows: [0.3, 0.7],
    })
    const area = regions.reduce((sum, r) => sum + r.w * r.h, 0)
    expect(area).toBe(1920 * 1080)
    expect(regions[0].x + regions[0].w).toBe(regions[1].x)
    expect(regions[0].y + regions[0].h).toBe(regions[2].y)
  })

  it('세로 3분할 비율도 반영한다', () => {
    const regions = computeRegions(PORTRAIT, 'v3', 0, { rows: [0.5, 0.25, 0.25] })
    expect(regions.map((r) => r.h)).toEqual([960, 480, 480])
  })

  it('비율과 간격을 함께 써도 바깥 테두리는 유지된다', () => {
    const regions = computeRegions(LANDSCAPE, 'h2', 20, { cols: [0.7, 0.3] })
    expect(regions[0].x).toBe(0)
    expect(regions[1].x + regions[1].w).toBe(1920)
  })
})

describe('분할선', () => {
  it('분할이 없으면 분할선도 없다', () => {
    expect(computeDividers(LANDSCAPE, SPLIT_NONE)).toEqual([])
  })

  it('좌우 2분할은 세로선 하나다', () => {
    expect(computeDividers(LANDSCAPE, 'h2')).toEqual([{ axis: 'x', index: 0, position: 960 }])
  })

  it('2×2 격자는 세로 1개 + 가로 1개다', () => {
    const dividers = computeDividers(LANDSCAPE, 'grid4')
    expect(dividers).toHaveLength(2)
    expect(dividers.map((d) => d.axis)).toEqual(['x', 'y'])
  })

  it('세로 3분할은 가로선 2개다', () => {
    const dividers = computeDividers(PORTRAIT, 'v3')
    expect(dividers.map((d) => d.position)).toEqual([640, 1280])
  })

  it('비율을 바꾸면 분할선 위치가 따라간다', () => {
    const dividers = computeDividers(LANDSCAPE, 'h2', { cols: [0.25, 0.75] })
    expect(dividers[0].position).toBe(480)
  })
})

describe('분할선 끌기', () => {
  it('경계를 옮기면 두 칸의 합은 유지된다', () => {
    const next = resizeWeights([0.5, 0.5], 0, 0.2)
    expect(next).toEqual([0.7, 0.30000000000000004])
    expect(next[0] + next[1]).toBeCloseTo(1, 10)
  })

  it('반대 방향으로도 움직인다', () => {
    expect(resizeWeights([0.5, 0.5], 0, -0.2)[0]).toBeCloseTo(0.3, 10)
  })

  it('한 칸이 사라질 만큼은 밀리지 않는다', () => {
    // 폭 0 인 영역은 클릭도 안 되고 되돌릴 수도 없다.
    const next = resizeWeights([0.5, 0.5], 0, 5)
    expect(next[1]).toBeCloseTo(MIN_WEIGHT, 10)
    expect(next[0]).toBeCloseTo(1 - MIN_WEIGHT, 10)
  })

  it('반대쪽 한계도 지킨다', () => {
    const next = resizeWeights([0.5, 0.5], 0, -5)
    expect(next[0]).toBeCloseTo(MIN_WEIGHT, 10)
  })

  it('3칸 중 가운데 경계만 움직이고 나머지는 그대로다', () => {
    const next = resizeWeights([1 / 3, 1 / 3, 1 / 3], 1, 0.1)
    expect(next[0]).toBeCloseTo(1 / 3, 10)
    expect(next[1] + next[2]).toBeCloseTo(2 / 3, 10)
    expect(next[1]).toBeGreaterThan(next[2])
  })
})
