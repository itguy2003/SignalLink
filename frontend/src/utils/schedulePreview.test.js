import { describe, expect, it } from 'vitest'

import { moveItem } from './contentDnd'
import {
  DAY_COUNT,
  groupDuration,
  secondsForLength,
  slotHasContent,
  slotSeconds,
  slotsByDay,
  slotsFromPlaylist,
} from './schedulePreview'

const DAYS = ['월', '화', '수', '목', '금', '토', '일']

function block(day, start, end, extra = {}) {
  return {
    key: `b${day}-${start}`,
    day,
    start,
    end,
    contentId: 1,
    contentName: '아침 알림판',
    durationSec: 20,
    inlineContent: null,
    ...extra,
  }
}

describe('요일별 미리보기 슬롯', () => {
  it('요일 7개를 모두 만든다', () => {
    const groups = slotsByDay([], DAYS)
    expect(groups).toHaveLength(DAY_COUNT)
    expect(groups.map((g) => g.label)).toEqual(DAYS)
  })

  it('비어 있는 요일도 자리를 남긴다', () => {
    // 그래야 "이 요일은 아무것도 안 나온다"를 미리보기에서 볼 수 있다.
    const groups = slotsByDay([block(0, 540, 720)], DAYS)
    expect(groups[3].slots).toEqual([])
  })

  it('블록을 해당 요일에 넣는다', () => {
    const groups = slotsByDay([block(0, 540, 720), block(4, 540, 600)], DAYS)
    expect(groups[0].slots).toHaveLength(1)
    expect(groups[4].slots).toHaveLength(1)
  })

  it('같은 요일 안에서는 시간 순서로 정렬한다', () => {
    const groups = slotsByDay([block(1, 780, 900), block(1, 480, 540)], DAYS)
    expect(groups[1].slots.map((s) => s.label)).toEqual(['08:00–09:00', '13:00–15:00'])
  })

  it('시간 범위를 라벨로 만든다', () => {
    const groups = slotsByDay([block(2, 540, 720)], DAYS)
    expect(groups[2].slots[0].label).toBe('09:00–12:00')
  })

  it('요일 밖 값은 버린다', () => {
    // 목록반복에서 넘어온 -1 아이템이 섞여도 표에 끼워 넣지 않는다.
    const groups = slotsByDay([block(-1, 540, 720), block(9, 540, 720)], DAYS)
    expect(groups.every((g) => g.slots.length === 0)).toBe(true)
  })

  it('콘텐츠 이름과 참조를 옮긴다', () => {
    const groups = slotsByDay([block(0, 540, 720)], DAYS)
    expect(groups[0].slots[0]).toMatchObject({ contentId: 1, contentName: '아침 알림판' })
  })

  it('빈 입력도 안전하다', () => {
    expect(slotsByDay(undefined, DAYS)).toHaveLength(DAY_COUNT)
  })
})

describe('재생 목록 미리보기 슬롯', () => {
  const item = (id, name, duration = 15) => ({
    content_id: id,
    content_name: name,
    duration_sec: duration,
    content: {},
  })

  it('한 묶음으로 만든다', () => {
    const groups = slotsFromPlaylist([item(1, 'A'), item(2, 'B')], '행사 안내')
    expect(groups).toHaveLength(1)
    expect(groups[0].label).toBe('행사 안내')
    expect(groups[0].slots).toHaveLength(2)
  })

  it('순서 번호를 라벨로 쓴다', () => {
    const groups = slotsFromPlaylist([item(1, 'A'), item(2, 'B')])
    expect(groups[0].slots.map((s) => s.label)).toEqual(['1', '2'])
  })

  it('인라인 문서가 비어 있으면 null 로 둔다', () => {
    // 참조 방식 아이템의 content 는 {} 다. 이것을 문서로 착각하면 안 된다.
    expect(slotsFromPlaylist([item(1, 'A')])[0].slots[0].content).toBeNull()
  })

  it('실제 인라인 문서는 넘긴다', () => {
    const document = { version: 1, elements: [{ id: 'x' }] }
    const slots = slotsFromPlaylist([{ content_id: null, content: document, duration_sec: 10 }])
    expect(slots[0].slots[0].content).toEqual(document)
  })

  it('한 바퀴 도는 시간을 더한다', () => {
    const groups = slotsFromPlaylist([item(1, 'A', 30), item(2, 'B', 45)])
    expect(groupDuration(groups[0])).toBe(75)
  })
})

describe('표출할 것이 있는 슬롯', () => {
  it('참조가 있으면 있다', () => {
    expect(slotHasContent({ contentId: 3, content: null })).toBe(true)
  })

  it('요소가 있는 인라인 문서면 있다', () => {
    expect(slotHasContent({ contentId: null, content: { elements: [{ id: 'a' }] } })).toBe(true)
  })

  it('둘 다 없으면 빈 화면이다', () => {
    expect(slotHasContent({ contentId: null, content: null })).toBe(false)
    expect(slotHasContent({ contentId: null, content: { elements: [] } })).toBe(false)
    expect(slotHasContent(null)).toBe(false)
  })
})

describe('목록 항목 옮기기', () => {
  const list = ['a', 'b', 'c', 'd']

  it('위로 옮긴다', () => {
    expect(moveItem(list, 2, 0)).toEqual(['c', 'a', 'b', 'd'])
  })

  it('아래로 옮길 때 자리 보정을 한다', () => {
    // to 는 "이 항목 앞"이라 아래로 갈 때는 자기 자신이 빠진 만큼 당겨진다.
    expect(moveItem(list, 0, 2)).toEqual(['b', 'a', 'c', 'd'])
  })

  it('맨 끝으로 옮긴다', () => {
    expect(moveItem(list, 0, 4)).toEqual(['b', 'c', 'd', 'a'])
  })

  it('제자리면 원본을 그대로 돌려준다', () => {
    expect(moveItem(list, 1, 1)).toBe(list)
    expect(moveItem(list, 1, 2)).toBe(list)
  })

  it('원본을 변형하지 않는다', () => {
    moveItem(list, 0, 3)
    expect(list).toEqual(['a', 'b', 'c', 'd'])
  })
})


describe('편성 길이에 비례한 미리보기 시간', () => {
  it('10분을 5초로 환산한다', () => {
    expect(secondsForLength(10)).toBe(5)
  })

  it('길이에 비례한다', () => {
    // 3시간짜리와 10분짜리가 똑같이 지나가면 하루의 짜임이 드러나지 않는다.
    expect(secondsForLength(20)).toBe(10)
    expect(secondsForLength(60)).toBe(30)
    expect(secondsForLength(180)).toBe(90)
  })

  it('10분보다 짧아도 1초 밑으로는 내려가지 않는다', () => {
    // 눈으로 알아볼 수 없으면 미리보기가 아니다.
    expect(secondsForLength(5)).toBe(3)
    expect(secondsForLength(1)).toBe(1)
  })

  it('길이를 알 수 없으면 기본 단위를 쓴다', () => {
    expect(secondsForLength(0)).toBe(5)
    expect(secondsForLength(null)).toBe(5)
  })

  it('요일형 슬롯은 길이를 따른다', () => {
    expect(slotSeconds({ lengthMinutes: 30, durationSec: 15 })).toBe(15)
  })

  it('목록반복 슬롯은 정해 둔 표출 시간을 따른다', () => {
    // 그 값이 곧 실제 시간이라 환산할 이유가 없다.
    expect(slotSeconds({ lengthMinutes: null, durationSec: 7 })).toBe(7)
  })

  it('요일형 묶음이 칸 길이를 실어 준다', () => {
    const groups = slotsByDay([
      { key: 'a', day: 0, start: 540, end: 600, contentId: 1, contentName: 'A', durationSec: 15 },
    ])
    expect(groups[0].slots[0].lengthMinutes).toBe(60)
  })
})
