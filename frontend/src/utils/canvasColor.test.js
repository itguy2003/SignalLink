import { describe, expect, it } from 'vitest'

import {
  canvasLineColors,
  isLightBackground,
  parseColor,
  relativeLuminance,
} from './canvasColor'

describe('색 파싱', () => {
  it('6자리 hex 를 읽는다', () => {
    expect(parseColor('#0f172a')).toEqual({ r: 15, g: 23, b: 42 })
  })

  it('3자리 hex 를 읽는다', () => {
    expect(parseColor('#fff')).toEqual({ r: 255, g: 255, b: 255 })
  })

  it('대문자와 공백을 허용한다', () => {
    expect(parseColor('  #FF8800 ')).toEqual({ r: 255, g: 136, b: 0 })
  })

  it('rgb()/rgba() 를 읽는다', () => {
    expect(parseColor('rgb(10, 20, 30)')).toEqual({ r: 10, g: 20, b: 30 })
    expect(parseColor('rgba(10 20 30 / 50%)')).toEqual({ r: 10, g: 20, b: 30 })
  })

  it('black/white 를 읽는다', () => {
    expect(parseColor('black')).toEqual({ r: 0, g: 0, b: 0 })
    expect(parseColor('white')).toEqual({ r: 255, g: 255, b: 255 })
  })

  it('읽을 수 없는 값은 null', () => {
    expect(parseColor('linear-gradient(#000, #fff)')).toBeNull()
    expect(parseColor('')).toBeNull()
    expect(parseColor(undefined)).toBeNull()
    expect(parseColor(123)).toBeNull()
  })
})

describe('휘도', () => {
  it('검정은 0, 흰색은 1', () => {
    expect(relativeLuminance({ r: 0, g: 0, b: 0 })).toBe(0)
    expect(relativeLuminance({ r: 255, g: 255, b: 255 })).toBeCloseTo(1, 5)
  })

  it('초록이 파랑보다 밝게 계산된다', () => {
    // 사람 눈의 감도를 반영한 가중치.
    expect(relativeLuminance({ r: 0, g: 255, b: 0 })).toBeGreaterThan(
      relativeLuminance({ r: 0, g: 0, b: 255 }),
    )
  })

  it('읽을 수 없는 색은 0(어두움)으로 본다', () => {
    expect(relativeLuminance(null)).toBe(0)
  })
})

describe('밝은 배경 판정', () => {
  it('흰 배경은 밝다', () => {
    expect(isLightBackground('#ffffff')).toBe(true)
  })

  it('기본 캔버스 배경(검정)은 어둡다', () => {
    expect(isLightBackground('#000000')).toBe(false)
  })

  it('시드 콘텐츠의 남색 배경은 어둡다', () => {
    // 이 조합에서 라이트 테마 격자가 안 보이던 것이 원래 문제였다.
    expect(isLightBackground('#0f172a')).toBe(false)
    expect(isLightBackground('#1e1b4b')).toBe(false)
  })

  it('연한 파스텔 배경은 밝다', () => {
    expect(isLightBackground('#e2e8f0')).toBe(true)
    expect(isLightBackground('#fde68a')).toBe(true)
  })

  it('중간 회색은 어두움으로 본다', () => {
    // 애매한 배경에서는 밝은 선이 더 잘 보인다.
    expect(isLightBackground('#808080')).toBe(false)
  })

  it('그라디언트처럼 읽을 수 없는 값은 어두움으로 본다', () => {
    expect(isLightBackground('linear-gradient(#fff, #000)')).toBe(false)
    expect(isLightBackground(undefined)).toBe(false)
  })
})

describe('캔버스 선 색', () => {
  it('어두운 배경에는 밝은 격자를 쓴다', () => {
    const colors = canvasLineColors('#0f172a')
    expect(colors.onLight).toBe(false)
    expect(colors.grid).toContain('255, 255, 255')
    expect(colors.gridStrong).toContain('255, 255, 255')
  })

  it('밝은 배경에는 어두운 격자를 쓴다', () => {
    const colors = canvasLineColors('#ffffff')
    expect(colors.onLight).toBe(true)
    expect(colors.grid).toContain('15, 23, 42')
  })

  it('굵은 선이 보통 선보다 진하다', () => {
    const colors = canvasLineColors('#000000')
    const alpha = (css) => Number(css.match(/,\s*([\d.]+)\)$/)[1])
    expect(alpha(colors.gridStrong)).toBeGreaterThan(alpha(colors.grid))
  })

  it('분할선은 배경에 따라 다른 강조색을 쓴다', () => {
    expect(canvasLineColors('#ffffff').region).toContain('29, 78, 216')
    expect(canvasLineColors('#000000').region).toContain('56, 189, 248')
  })

  it('영역 채움은 선보다 옅다', () => {
    const colors = canvasLineColors('#000000')
    const alpha = (css) => Number(css.match(/,\s*([\d.]+)\)$/)[1])
    expect(alpha(colors.regionFill)).toBeLessThan(alpha(colors.region))
  })

  it('이름표 칩은 배경과 반대 명도를 쓴다', () => {
    expect(canvasLineColors('#ffffff').chipText).toBe('#f8fafc')
    expect(canvasLineColors('#000000').chipText).toBe('#0f172a')
  })

  it('배경이 없어도 색을 돌려준다', () => {
    const colors = canvasLineColors(undefined)
    expect(colors.grid).toBeTruthy()
    expect(colors.region).toBeTruthy()
  })
})
