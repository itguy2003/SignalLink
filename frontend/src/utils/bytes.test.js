import { describe, expect, it } from 'vitest'

import { formatBytes, formatPercent } from './bytes'

const GB = 1000 ** 3

describe('formatBytes', () => {
  it('1000 진법으로 보여 준다', () => {
    // 장치 등록 시 적어 넣는 사양 문자열이 제조사 표기("256GB")를 따르므로,
    // 1024 진법이면 같은 디스크가 "238GB" 로 나와 어긋나 보인다.
    expect(formatBytes(256 * GB)).toBe('256GB')
  })

  it('1000 미만은 바이트로', () => {
    expect(formatBytes(0)).toBe('0B')
    expect(formatBytes(999)).toBe('999B')
  })

  it('단위를 올려 간다', () => {
    expect(formatBytes(1000)).toBe('1KB')
    expect(formatBytes(1500 * 1000)).toBe('1.5MB')
    expect(formatBytes(2 * 1000 ** 4)).toBe('2TB')
  })

  it('100 이상은 소수점을 버린다', () => {
    // 256.0GB 는 자릿수만 늘릴 뿐 아무것도 알려 주지 않는다.
    expect(formatBytes(128 * GB)).toBe('128GB')
    expect(formatBytes(1.5 * GB)).toBe('1.5GB')
  })

  it.each([[null], [undefined], ['256GB'], [NaN], [Infinity], [-1]])(
    '값을 알 수 없으면 null: %s',
    (value) => {
      // null 은 '미보고'다. 0B 로 갈음하면 저장공간이 없는 장치처럼 읽힌다.
      expect(formatBytes(value)).toBeNull()
    },
  )
})

describe('formatPercent', () => {
  it('백분율 정수로 바꾼다', () => {
    expect(formatPercent(0.845)).toBe(85)
    expect(formatPercent(0)).toBe(0)
    expect(formatPercent(1)).toBe(100)
  })

  it('값을 알 수 없으면 null', () => {
    expect(formatPercent(null)).toBeNull()
    expect(formatPercent(NaN)).toBeNull()
  })
})
