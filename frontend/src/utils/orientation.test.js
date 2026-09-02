/**
 * 방향 판정은 백엔드 `app/services/orientation.py` 와 **같은 답**을 내야 한다.
 * 어긋나면 화면에서는 붙던 콘텐츠가 저장에서 거부된다. 여기 있는 기대값은
 * 백엔드 `tests/test_schedule_orientation.py` 의 것과 짝을 이룬다.
 */
import { describe, expect, it } from 'vitest'

import {
  LANDSCAPE,
  PORTRAIT,
  defaultSize,
  labelKey,
  matches,
  ofContent,
  ofDocument,
  ofSize,
  toQuery,
} from './orientation'

describe('ofSize', () => {
  it('세로가 더 길면 세로형', () => {
    expect(ofSize(1080, 1920)).toBe(PORTRAIT)
  })

  it('가로가 더 길면 가로형', () => {
    expect(ofSize(1920, 1080)).toBe(LANDSCAPE)
  })

  it('정사각형은 가로형으로 본다', () => {
    // 한쪽으로 정해 두지 않으면 1:1 콘텐츠가 어느 스케줄에도 못 붙는다.
    expect(ofSize(1000, 1000)).toBe(LANDSCAPE)
  })
})

describe('ofContent', () => {
  it('목록 항목의 크기를 본다', () => {
    expect(ofContent({ width: 1080, height: 1920 })).toBe(PORTRAIT)
  })

  it('크기가 없으면 가로형으로 떨어진다', () => {
    expect(ofContent(null)).toBe(LANDSCAPE)
  })
})

describe('ofDocument', () => {
  it('layout 의 크기를 본다', () => {
    expect(ofDocument({ layout: { width: 1080, height: 1920 } })).toBe(PORTRAIT)
  })

  it.each([
    ['없음', null],
    ['빈 문서', {}],
    ['빈 layout', { layout: {} }],
    ['한쪽만', { layout: { width: 1920 } }],
    ['0', { layout: { width: 0, height: 0 } }],
    ['숫자가 아님', { layout: { width: '1920', height: '1080' } }],
  ])('크기를 알 수 없으면 null: %s', (_label, document) => {
    // null 은 '틀렸다'가 아니라 '따질 수 없다'. 빈 아이템까지 막으면 편집을 시작할 수 없다.
    expect(ofDocument(document)).toBeNull()
  })
})

describe('defaultSize', () => {
  it('방향별 기본 해상도', () => {
    expect(defaultSize(LANDSCAPE)).toEqual({ width: 1920, height: 1080 })
    expect(defaultSize(PORTRAIT)).toEqual({ width: 1080, height: 1920 })
  })
})

describe('matches', () => {
  it('같은 방향이면 통과', () => {
    expect(matches({ width: 1080, height: 1920 }, PORTRAIT)).toBe(true)
  })

  it('다른 방향이면 거부', () => {
    expect(matches({ width: 1920, height: 1080 }, PORTRAIT)).toBe(false)
  })
})

describe('toQuery', () => {
  it('콘텐츠 API 질의값으로 바꾼다', () => {
    expect(toQuery(LANDSCAPE)).toBe('landscape')
    expect(toQuery(PORTRAIT)).toBe('portrait')
  })

  it('방향이 없으면 빈 문자열(전체)', () => {
    expect(toQuery(null)).toBe('')
    expect(toQuery('알 수 없음')).toBe('')
  })
})

describe('labelKey', () => {
  it('기존 콘텐츠 화면의 번역 키를 재사용한다', () => {
    expect(labelKey(PORTRAIT)).toBe('content.portrait')
    expect(labelKey(LANDSCAPE)).toBe('content.landscape')
  })
})
