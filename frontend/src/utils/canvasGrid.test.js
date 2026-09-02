import { describe, expect, it } from 'vitest'

import { computeRegions } from './canvasSplit'
import {
  DEFAULT_GRID_SIZE,
  GRID_SIZES,
  isGridVisible,
  regionContaining,
  snapRect,
  snapTo,
} from './canvasGrid'

describe('격자 스냅', () => {
  it('가까운 격자선으로 반올림한다', () => {
    expect(snapTo(38, 40)).toBe(40)
    expect(snapTo(21, 40)).toBe(40)
    expect(snapTo(19, 40)).toBe(0)
  })

  it('정확히 중간이면 위쪽 격자로 붙는다', () => {
    expect(snapTo(20, 40)).toBe(40)
  })

  it('음수도 처리한다', () => {
    expect(snapTo(-38, 40)).toBe(-40)
  })

  it('격자 크기가 0 이거나 없으면 정수 반올림만 한다', () => {
    expect(snapTo(38.6, 0)).toBe(39)
    expect(snapTo(38.6, null)).toBe(39)
  })

  it('기본 격자 크기는 선택지 안에 있다', () => {
    expect(GRID_SIZES).toContain(DEFAULT_GRID_SIZE)
  })
})

describe('사각형 스냅', () => {
  const rect = { x: 38, y: 21, w: 133, h: 77, z: 3 }

  it('이동은 위치만 맞춘다', () => {
    const snapped = snapRect(rect, 40, 'move')
    expect(snapped).toMatchObject({ x: 40, y: 40, w: 133, h: 77 })
  })

  it('크기 조절은 크기만 맞춘다', () => {
    // 위치까지 같이 움직이면 모서리를 끌 때 요소가 튄다.
    const snapped = snapRect(rect, 40, 'resize')
    expect(snapped).toMatchObject({ x: 38, y: 21, w: 120, h: 80 })
  })

  it('한 칸보다 작아지지 않는다', () => {
    const tiny = { x: 0, y: 0, w: 5, h: 5, z: 1 }
    const snapped = snapRect(tiny, 40, 'resize')
    expect(snapped.w).toBe(40)
    expect(snapped.h).toBe(40)
  })

  it('겹침 순서 같은 다른 속성은 유지된다', () => {
    expect(snapRect(rect, 40, 'move').z).toBe(3)
  })

  it('격자 크기가 0 이면 원본을 그대로 돌려준다', () => {
    expect(snapRect(rect, 0, 'move')).toEqual({ ...rect })
  })
})

describe('격자 표시 여부', () => {
  it('화면에서 충분히 벌어져 있으면 표시한다', () => {
    expect(isGridVisible(40, 0.5)).toBe(true)
  })

  it('너무 촘촘하면 표시하지 않는다', () => {
    // 축소된 상태에서 10px 격자를 다 그리면 회색 덩어리가 된다.
    expect(isGridVisible(10, 0.2)).toBe(false)
  })

  it('격자 크기가 없으면 표시하지 않는다', () => {
    expect(isGridVisible(0, 1)).toBe(false)
  })
})

describe('요소가 속한 분할 영역', () => {
  const LANDSCAPE = { width: 1920, height: 1080 }
  const regions = computeRegions(LANDSCAPE, 'grid4')

  it('중심이 든 영역을 고른다', () => {
    const rect = { x: 1000, y: 600, w: 200, h: 100 }
    expect(regionContaining(regions, rect).index).toBe(3)
  })

  it('왼쪽 위 영역', () => {
    expect(regionContaining(regions, { x: 10, y: 10, w: 100, h: 100 }).index).toBe(0)
  })

  it('여러 영역에 걸쳐 있어도 중심 기준으로 정한다', () => {
    // 왼쪽 위에서 시작해 오른쪽까지 넓게 걸친 요소. 중심은 1번 영역에 있다.
    const rect = { x: 700, y: 100, w: 800, h: 200 }
    expect(regionContaining(regions, rect).index).toBe(1)
  })

  it('캔버스 밖으로 나간 요소는 가장 가까운 영역으로 본다', () => {
    const rect = { x: -500, y: -500, w: 100, h: 100 }
    expect(regionContaining(regions, rect).index).toBe(0)
  })

  it('영역이 없으면 null', () => {
    expect(regionContaining([], { x: 0, y: 0, w: 10, h: 10 })).toBeNull()
    expect(regionContaining(regions, null)).toBeNull()
  })

  it('분할 없음이면 항상 유일한 영역이다', () => {
    const single = computeRegions(LANDSCAPE, 'none')
    expect(regionContaining(single, { x: 500, y: 500, w: 10, h: 10 }).index).toBe(0)
  })
})
