import { describe, expect, it } from 'vitest'

import {
  DEFAULT_GRID,
  blockHasContent,
  blocksToItems,
  clampToGrid,
  createBlock,
  findConflict,
  hasInlineContent,
  itemsToBlocks,
  minutesToY,
  overlaps,
  slotCount,
  snap,
  toLabel,
  toMinutes,
  toTimeString,
  yToMinutes,
} from './scheduleGrid'

describe('시간 변환', () => {
  it('시각 문자열을 분으로 바꾼다', () => {
    expect(toMinutes('00:00:00')).toBe(0)
    expect(toMinutes('09:30:00')).toBe(570)
    expect(toMinutes('23:59:59')).toBe(1439)
  })

  it('잘못된 값은 null 이다', () => {
    expect(toMinutes(null)).toBeNull()
    expect(toMinutes('아홉시')).toBeNull()
    expect(toMinutes('09')).toBeNull()
  })

  it('분을 시각 문자열로 바꾼다', () => {
    expect(toTimeString(0)).toBe('00:00:00')
    expect(toTimeString(570)).toBe('09:30:00')
  })

  it('자정(1440)은 23:59:59 로 표현한다', () => {
    // 종료 시각을 다음 날로 넘기지 않기 위한 처리다.
    expect(toTimeString(1440)).toBe('23:59:59')
    expect(toTimeString(2000)).toBe('23:59:59')
  })

  it('음수는 0 으로 잘린다', () => {
    expect(toTimeString(-30)).toBe('00:00:00')
  })

  it('표시용 라벨은 분까지만 보여 준다', () => {
    expect(toLabel(570)).toBe('09:30')
  })

  it('스냅은 지정한 단위로 반올림한다', () => {
    expect(snap(571, 30)).toBe(570)
    expect(snap(586, 30)).toBe(600)
  })
})

describe('겹침 판정', () => {
  it('구간이 실제로 겹치면 true', () => {
    expect(overlaps({ start: 540, end: 720 }, { start: 660, end: 780 })).toBe(true)
  })

  it('맞닿은 구간은 겹침이 아니다', () => {
    expect(overlaps({ start: 540, end: 720 }, { start: 720, end: 780 })).toBe(false)
  })

  it('떨어진 구간은 겹침이 아니다', () => {
    expect(overlaps({ start: 540, end: 600 }, { start: 660, end: 720 })).toBe(false)
  })

  it('같은 요일의 다른 블록과만 충돌한다', () => {
    const blocks = [
      { key: 'a', day: 0, start: 540, end: 720 },
      { key: 'b', day: 1, start: 540, end: 720 },
    ]
    expect(findConflict(blocks, { key: 'c', day: 0, start: 600, end: 660 })?.key).toBe('a')
    expect(findConflict(blocks, { key: 'c', day: 2, start: 600, end: 660 })).toBeNull()
  })

  it('자기 자신과는 충돌하지 않는다', () => {
    const blocks = [{ key: 'a', day: 0, start: 540, end: 720 }]
    expect(findConflict(blocks, { key: 'a', day: 0, start: 550, end: 700 })).toBeNull()
  })
})

describe('그리드 범위 제한', () => {
  it('시작 시각이 그리드 위쪽 밖이면 끌어올린다', () => {
    const block = clampToGrid({ start: 60, end: 480 }, DEFAULT_GRID)
    expect(block.start).toBe(DEFAULT_GRID.startHour * 60)
  })

  it('종료 시각이 그리드 아래쪽 밖이면 잘린다', () => {
    const block = clampToGrid({ start: 1380, end: 1600 }, DEFAULT_GRID)
    expect(block.end).toBe(DEFAULT_GRID.endHour * 60)
  })

  it('최소 한 칸 길이는 보장한다', () => {
    const block = clampToGrid({ start: 600, end: 600 }, DEFAULT_GRID)
    expect(block.end - block.start).toBeGreaterThanOrEqual(DEFAULT_GRID.slotMinutes)
  })
})

describe('좌표 변환', () => {
  it('픽셀과 분이 서로 되돌아온다', () => {
    const minutes = 13 * 60
    expect(yToMinutes(minutesToY(minutes, DEFAULT_GRID), DEFAULT_GRID)).toBe(minutes)
  })

  it('그리드 맨 위는 y=0 이다', () => {
    expect(minutesToY(DEFAULT_GRID.startHour * 60, DEFAULT_GRID)).toBe(0)
  })

  it('슬롯 수는 시간 범위와 간격으로 결정된다', () => {
    expect(slotCount({ startHour: 6, endHour: 24, slotMinutes: 30 })).toBe(36)
  })
})

describe('아이템 <-> 블록 변환', () => {
  const items = [
    {
      id: 1,
      day_of_week: 0,
      start_time: '09:00:00',
      end_time: '12:00:00',
      duration_sec: 15,
      content_id: 7,
      content_name: '아침 알림판',
      content: {},
    },
    {
      id: 2,
      day_of_week: -1,
      start_time: null,
      end_time: null,
      duration_sec: 20,
      content_id: null,
      content: { version: 1, elements: [] },
    },
  ]

  it('요일과 시간이 있는 아이템만 표에 놓는다', () => {
    const { blocks, loose } = itemsToBlocks(items)
    expect(blocks).toHaveLength(1)
    expect(blocks[0]).toMatchObject({ day: 0, start: 540, end: 720, contentId: 7, contentName: '아침 알림판' })
    expect(loose).toHaveLength(1)
  })

  it('표에 놓을 수 없는 아이템을 버리지 않는다', () => {
    // 조용히 사라지면 저장할 때 데이터가 유실된다.
    const { blocks, loose } = itemsToBlocks(items)
    const restored = blocksToItems(blocks, loose)
    expect(restored).toHaveLength(2)
    expect(restored.find((i) => i.day_of_week === -1)).toBeTruthy()
  })

  it('블록을 아이템으로 되돌리면 시각이 보존된다', () => {
    const { blocks, loose } = itemsToBlocks(items)
    const restored = blocksToItems(blocks, loose)
    expect(restored[0]).toMatchObject({
      day_of_week: 0,
      start_time: '09:00:00',
      end_time: '12:00:00',
      content_id: 7,
    })
  })

  it('참조 콘텐츠가 있으면 인라인 문서를 비워 보낸다', () => {
    const { blocks } = itemsToBlocks([
      { day_of_week: 1, start_time: '09:00:00', end_time: '10:00:00', content_id: 3, content: { elements: [1] } },
    ])
    expect(blocksToItems(blocks)[0].content).toEqual({})
  })

  it('인라인 콘텐츠는 그대로 왕복한다', () => {
    const document = { version: 1, layout: { width: 1920 }, elements: [{ id: 'x' }] }
    const { blocks } = itemsToBlocks([
      { day_of_week: 2, start_time: '09:00:00', end_time: '10:00:00', content_id: null, content: document },
    ])
    expect(blocksToItems(blocks)[0].content).toEqual(document)
  })

  it('저장 순서는 요일 -> 시각 순이다', () => {
    const { blocks } = itemsToBlocks([
      { day_of_week: 3, start_time: '09:00:00', end_time: '10:00:00' },
      { day_of_week: 0, start_time: '14:00:00', end_time: '15:00:00' },
      { day_of_week: 0, start_time: '09:00:00', end_time: '10:00:00' },
    ])
    const restored = blocksToItems(blocks)
    expect(restored.map((i) => [i.day_of_week, i.start_time])).toEqual([
      [0, '09:00:00'],
      [0, '14:00:00'],
      [3, '09:00:00'],
    ])
  })

  it('빈 입력도 안전하게 처리한다', () => {
    expect(itemsToBlocks(undefined).blocks).toEqual([])
    expect(blocksToItems([])).toEqual([])
  })
})

describe('인라인 콘텐츠 유무 판정', () => {
  it('빈 객체는 콘텐츠가 아니다', () => {
    // 참조 방식 아이템의 content 는 {} 다. 객체 존재만으로 판단하면
    // truthy 라서 "인라인 콘텐츠 있음"으로 잘못 표시된다.
    expect(hasInlineContent({})).toBe(false)
  })

  it('요소가 없는 문서도 콘텐츠가 아니다', () => {
    expect(hasInlineContent({ version: 1, layout: {}, elements: [] })).toBe(false)
  })

  it('요소가 있으면 콘텐츠다', () => {
    expect(hasInlineContent({ elements: [{ id: 'a' }] })).toBe(true)
  })

  it('null/undefined 를 안전하게 처리한다', () => {
    expect(hasInlineContent(null)).toBe(false)
    expect(hasInlineContent(undefined)).toBe(false)
  })

  it('블록 라벨용 판정은 참조와 인라인을 모두 본다', () => {
    expect(blockHasContent({ contentId: 5, hasInline: false })).toBe(true)
    expect(blockHasContent({ contentId: null, hasInline: true })).toBe(true)
    expect(blockHasContent({ contentId: null, hasInline: false })).toBe(false)
  })

  it('빈 content 를 가진 아이템은 hasInline 이 false 다', () => {
    const { blocks } = itemsToBlocks([
      { day_of_week: 0, start_time: '09:00:00', end_time: '10:00:00', content_id: null, content: {} },
    ])
    expect(blocks[0].hasInline).toBe(false)
    expect(blockHasContent(blocks[0])).toBe(false)
  })
})

describe('블록 생성', () => {
  it('새 블록은 그리드 범위 안으로 맞춰진다', () => {
    const block = createBlock({ day: 0, start: 0, end: 60, grid: DEFAULT_GRID })
    expect(block.start).toBeGreaterThanOrEqual(DEFAULT_GRID.startHour * 60)
    expect(block.contentId).toBeNull()
  })

  it('블록마다 고유한 key 를 받는다', () => {
    const a = createBlock({ day: 0, start: 600, end: 660, grid: DEFAULT_GRID })
    const b = createBlock({ day: 0, start: 600, end: 660, grid: DEFAULT_GRID })
    expect(a.key).not.toBe(b.key)
  })
})
