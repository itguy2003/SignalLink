/**
 * 플레이어 표출 선택 규칙 테스트.
 *
 * 시간이 개입하는 규칙은 전부 now 를 받는 순수 함수다 — 여기서 요일 규약
 * (0=월), 시간대 경계(시작 포함·종료 제외), 순환 순서를 못박는다.
 */
import { describe, expect, it } from 'vitest'

import { currentPlayback, pickTimedItem, rotationOrder, serverWeekday, timeToSeconds } from './playerSchedule'

const item = (over = {}) => ({
  id: 1,
  day_of_week: -1,
  start_time: null,
  end_time: null,
  sort_order: 0,
  duration_sec: 10,
  content: { elements: [] },
  ...over,
})

describe('serverWeekday', () => {
  it('JS(0=일)를 서버 규약(0=월)으로 바꾼다', () => {
    expect(serverWeekday(new Date('2026-09-14T10:00:00'))).toBe(0) // 월요일
    expect(serverWeekday(new Date('2026-09-20T10:00:00'))).toBe(6) // 일요일
  })
})

describe('timeToSeconds', () => {
  it('HH:MM:SS 와 HH:MM 둘 다 읽는다', () => {
    expect(timeToSeconds('09:30:15')).toBe(9 * 3600 + 30 * 60 + 15)
    expect(timeToSeconds('09:30')).toBe(9 * 3600 + 30 * 60)
  })

  it('형식이 어긋나면 null', () => {
    expect(timeToSeconds(null)).toBeNull()
    expect(timeToSeconds('아홉시')).toBeNull()
  })
})

describe('pickTimedItem', () => {
  const monday9to10 = item({ id: 1, day_of_week: 0, start_time: '09:00:00', end_time: '10:00:00' })
  const monday10to11 = item({ id: 2, day_of_week: 0, start_time: '10:00:00', end_time: '11:00:00' })

  it('요일과 시간대가 맞는 아이템을 고른다', () => {
    const picked = pickTimedItem([monday9to10, monday10to11], new Date('2026-09-14T09:30:00'))
    expect(picked.id).toBe(1)
  })

  it('경계는 시작 포함·종료 제외 — 정각에 두 칸이 겹치지 않는다', () => {
    const at10 = pickTimedItem([monday9to10, monday10to11], new Date('2026-09-14T10:00:00'))
    expect(at10.id).toBe(2)
  })

  it('다른 요일이면 고르지 않는다', () => {
    expect(pickTimedItem([monday9to10], new Date('2026-09-15T09:30:00'))).toBeNull()
  })

  it('맞는 칸이 없으면 null(대기 화면)', () => {
    expect(pickTimedItem([monday9to10], new Date('2026-09-14T12:00:00'))).toBeNull()
  })
})

describe('currentPlayback', () => {
  it('목록반복은 sort_order 순서로 순환한다', () => {
    const payload = {
      kind: '목록반복',
      is_demo: false,
      items: [item({ id: 2, sort_order: 1 }), item({ id: 1, sort_order: 0 })],
    }
    expect(currentPlayback(payload, new Date(), 0).item.id).toBe(1)
    expect(currentPlayback(payload, new Date(), 1).item.id).toBe(2)
    // 끝까지 돌면 처음으로.
    expect(currentPlayback(payload, new Date(), 2).item.id).toBe(1)
    expect(currentPlayback(payload, new Date(), 0).rotating).toBe(true)
  })

  it('데모 스케줄은 종류와 무관하게 순환한다', () => {
    const payload = { kind: '시간지정', is_demo: true, items: [item({ id: 9 })] }
    expect(currentPlayback(payload, new Date(), 0)).toMatchObject({ rotating: true })
  })

  it('시간지정은 지금 맞는 칸 하나 — 없으면 null', () => {
    const payload = {
      kind: '시간지정',
      is_demo: false,
      items: [item({ id: 1, day_of_week: 0, start_time: '09:00:00', end_time: '10:00:00' })],
    }
    const during = currentPlayback(payload, new Date('2026-09-14T09:10:00'), 0)
    expect(during.item.id).toBe(1)
    expect(during.rotating).toBe(false)

    const outside = currentPlayback(payload, new Date('2026-09-14T20:00:00'), 0)
    expect(outside.item).toBeNull()
  })

  it('시간지정에서 같은 시간대에 여러 장이 맞으면 순환한다 (공지 참조 펼침)', () => {
    const slot = { day_of_week: 0, start_time: '09:00:00', end_time: '10:00:00' }
    const payload = {
      kind: '시간지정',
      is_demo: false,
      items: [
        item({ id: 11, ...slot, sort_order: 1 }),
        item({ id: 10, ...slot, sort_order: 0 }),
        item({ id: 12, ...slot, sort_order: 2 }),
      ],
    }
    const now = new Date('2026-09-14T09:10:00')

    // sort_order 순으로 rotationIndex 를 따라 돈다.
    expect(currentPlayback(payload, now, 0)).toMatchObject({ item: { id: 10 }, rotating: true })
    expect(currentPlayback(payload, now, 1).item.id).toBe(11)
    expect(currentPlayback(payload, now, 3).item.id).toBe(10)

    // 시간대 밖이면 여전히 대기다.
    expect(currentPlayback(payload, new Date('2026-09-14T20:00:00'), 0).item).toBeNull()
  })

  it('아이템이 없으면 아무것도 틀지 않는다', () => {
    expect(currentPlayback({ kind: '목록반복', items: [] }, new Date(), 0).item).toBeNull()
  })

  it('rotationOrder 는 원본을 건드리지 않는다', () => {
    const items = [item({ id: 2, sort_order: 1 }), item({ id: 1, sort_order: 0 })]
    rotationOrder(items)
    expect(items[0].id).toBe(2)
  })
})
