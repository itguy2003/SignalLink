/**
 * 위젯 샘플 테스트 — 시간표 한 주.
 *
 * 배치는 언어마다 따로 적지 않는다. 이름만 갈아 끼우고 자리는 하나로 둔다 —
 * 언어별로 적으면 번역할 때 어긋난다.
 */
import { describe, expect, it } from 'vitest'

import { timetableWeek, todayColumn, widgetSample } from './widgetSamples'

const sample = (locale) => widgetSample('timetable', locale)

describe('한 주 시간표 만들기', () => {
  it('줄은 교시, 칸은 요일이다', () => {
    const week = timetableWeek(sample('ko'))

    expect(week).toHaveLength(6)
    expect(week[0].period).toBe('1교시')
    expect(week[0].cells).toHaveLength(5)
  })

  it('모든 칸이 과목 이름으로 채워진다', () => {
    // 빈 칸이 있으면 시간표가 덜 만들어진 것처럼 보인다.
    const subjects = sample('ko').subjects
    for (const row of timetableWeek(sample('ko'))) {
      for (const cell of row.cells) {
        expect(subjects).toContain(cell)
      }
    }
  })

  it('언어가 달라도 배치는 같다', () => {
    const ko = timetableWeek(sample('ko'))
    const en = timetableWeek(sample('en'))

    const indexOf = (locale, week) =>
      week.map((row) => row.cells.map((cell) => sample(locale).subjects.indexOf(cell)))

    expect(indexOf('en', en)).toEqual(indexOf('ko', ko))
  })

  it('요일이나 과목이 없으면 빈 표', () => {
    expect(timetableWeek(null)).toEqual([])
    expect(timetableWeek({ periods: ['1교시'], days: [], subjects: ['국어'] })).toEqual([])
  })
})

describe('오늘이 몇 번째 칸인가', () => {
  // 요일 이름으로 맞추면 언어마다 다르게 적힌 이름을 다 알아야 한다.
  // 자리로 센다 — 첫 칸이 월요일이라는 것만 지키면 된다.
  const on = (iso) => todayColumn(new Date(`${iso}T09:00:00`))

  it('월요일이 첫 칸', () => {
    expect(on('2026-08-31')).toBe(0)
  })

  it('금요일이 마지막 칸', () => {
    expect(on('2026-09-04')).toBe(4)
  })

  it('주말은 표에 없다', () => {
    expect(on('2026-09-05')).toBe(-1) // 토
    expect(on('2026-09-06')).toBe(-1) // 일
  })

  it('요일 수가 다르면 그만큼만 센다', () => {
    // 토요일까지 여는 학교라면 칸이 여섯이다.
    expect(todayColumn(new Date('2026-09-05T09:00:00'), 6)).toBe(5)
  })
})
