import { describe, expect, it } from 'vitest'

import {
  MAX_ZOOM,
  MIN_ZOOM,
  ZOOM_LEVELS,
  clampZoom,
  zoomByWheel,
  zoomIn,
  zoomOut,
  zoomPercent,
} from './canvasZoom'

describe('배율 제한', () => {
  it('범위 안 값은 그대로 둔다', () => {
    expect(clampZoom(1.5)).toBe(1.5)
  })

  it('너무 크거나 작으면 한계로 자른다', () => {
    expect(clampZoom(99)).toBe(MAX_ZOOM)
    expect(clampZoom(0.01)).toBe(MIN_ZOOM)
  })

  it('숫자가 아니면 1 로 본다', () => {
    expect(clampZoom('abc')).toBe(1)
    expect(clampZoom(undefined)).toBe(1)
    expect(clampZoom(NaN)).toBe(1)
  })
})

describe('한 단계 확대', () => {
  it('다음 단계로 올라간다', () => {
    expect(zoomIn(1)).toBe(1.5)
    expect(zoomIn(0.5)).toBe(0.75)
  })

  it('단계 사이의 값에서는 바로 위 단계로 간다', () => {
    // 자동 맞춤 배율은 대개 어중간한 값이다. 확대를 눌렀는데 작아지면 안 된다.
    expect(zoomIn(0.42)).toBe(0.5)
    expect(zoomIn(1.2)).toBe(1.5)
  })

  it('최대에서는 더 커지지 않는다', () => {
    expect(zoomIn(MAX_ZOOM)).toBe(MAX_ZOOM)
  })
})

describe('한 단계 축소', () => {
  it('이전 단계로 내려간다', () => {
    expect(zoomOut(1)).toBe(0.75)
    expect(zoomOut(1.5)).toBe(1)
  })

  it('단계 사이의 값에서는 바로 아래 단계로 간다', () => {
    expect(zoomOut(0.42)).toBe(0.25)
    expect(zoomOut(1.2)).toBe(1)
  })

  it('최소에서는 더 작아지지 않는다', () => {
    expect(zoomOut(MIN_ZOOM)).toBe(MIN_ZOOM)
  })

  it('확대와 축소를 번갈아 해도 제자리로 돌아온다', () => {
    expect(zoomOut(zoomIn(1))).toBe(1)
  })
})

describe('휠 확대', () => {
  it('위로 굴리면 커진다', () => {
    expect(zoomByWheel(1, -100)).toBe(1.5)
  })

  it('아래로 굴리면 작아진다', () => {
    expect(zoomByWheel(1, 100)).toBe(0.75)
  })

  it('한 번에 한 단계씩만 움직인다', () => {
    // 손이 미끄러져 큰 값이 와도 두 단계 뛰지 않는다.
    expect(zoomByWheel(1, -3000)).toBe(1.5)
  })
})

describe('표시', () => {
  it('퍼센트로 반올림한다', () => {
    expect(zoomPercent(0.5)).toBe(50)
    expect(zoomPercent(0.4237)).toBe(42)
  })

  it('단계는 오름차순이다', () => {
    const sorted = [...ZOOM_LEVELS].sort((a, b) => a - b)
    expect(ZOOM_LEVELS).toEqual(sorted)
  })

  it('100% 가 단계에 포함된다', () => {
    // 원본 크기로 보는 것은 자주 쓰므로 반드시 있어야 한다.
    expect(ZOOM_LEVELS).toContain(1)
  })
})
