/**
 * 플레이어 표출 선택 규칙.
 *
 * 서버 페이로드(SchedulePayload)를 받아 "지금 무엇을 틀 것인가"를 정한다.
 * 순수 함수로 둔다 — 시간이 개입하는 로직은 now 를 밖에서 받아야 검증할 수
 * 있다.
 *
 * 규칙(요구사항):
 *   시간지정  요일(0=월 ~ 6=일)과 시작/종료 시각이 맞는 아이템 하나
 *   목록반복  sort_order 순서로 duration_sec 씩 순환 (데모도 이 방식)
 */

/** JS 의 getDay()(0=일)를 서버 규약(0=월)으로 바꾼다. */
export function serverWeekday(date) {
  return (date.getDay() + 6) % 7
}

/** "HH:MM[:SS]" 를 자정 기준 초로. 형식이 어긋나면 null. */
export function timeToSeconds(text) {
  if (typeof text !== 'string') return null
  const parts = text.split(':').map(Number)
  if (parts.length < 2 || parts.some((n) => !Number.isFinite(n))) return null
  const [hour, minute, second = 0] = parts
  return hour * 3600 + minute * 60 + second
}

/**
 * 시간지정 스케줄에서 지금 틀 아이템. 없으면 null(대기 화면).
 *
 * 종료 시각은 포함하지 않는다(시작 <= 지금 < 종료) — 09:00~10:00 과
 * 10:00~11:00 이 맞닿아 있을 때 10:00 정각에 둘 다 맞으면 안 된다.
 */
export function pickTimedItems(items, now) {
  const weekday = serverWeekday(now)
  const seconds = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds()

  return items
    .filter((item) => {
      if (item.day_of_week !== weekday) return false
      const start = timeToSeconds(item.start_time)
      const end = timeToSeconds(item.end_time)
      if (start === null || end === null) return false
      return start <= seconds && seconds < end
    })
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
}

export function pickTimedItem(items, now) {
  return pickTimedItems(items, now)[0] ?? null
}

/** 목록반복 순서. sort_order 로 정렬한 사본을 준다(원본은 그대로). */
export function rotationOrder(items) {
  return [...items].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
}

/**
 * 지금 표출할 것을 정한다.
 *
 * @returns {{ item: object|null, rotating: boolean }}
 *   rotating 이 true 면 duration_sec 순환(다음 장 전환은 플레이어 몫),
 *   false 면 시간지정 — 매초 다시 물어야 한다.
 */
export function currentPlayback(payload, now, rotationIndex = 0) {
  const items = payload?.items ?? []
  if (items.length === 0) return { item: null, rotating: false }

  if (payload.kind === '시간지정' && !payload.is_demo) {
    // 같은 시간대에 여러 장이 맞으면(공지 참조가 펼쳐진 경우) 순환한다.
    const matched = pickTimedItems(items, now)
    if (matched.length <= 1) return { item: matched[0] ?? null, rotating: false }
    return { item: matched[rotationIndex % matched.length], rotating: true }
  }

  const order = rotationOrder(items)
  return { item: order[rotationIndex % order.length], rotating: true }
}
