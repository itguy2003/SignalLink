/**
 * 주간 스케줄 그리드 계산.
 *
 * 화면(요일 × 시간 표)과 서버 모델(ScheduleItem)을 오가는 변환과 겹침 판정을
 * 순수 함수로 분리했다. 드래그 좌표 계산이 얽힌 컴포넌트에서 이 규칙만
 * 따로 검증할 수 있게 하려는 것이다.
 */

export const DAY_NAMES = ['월', '화', '수', '목', '금', '토', '일']

/**
 * 고를 수 있는 시간 분할(분).
 *
 * 학교 시간표는 45~50분 단위지만 방송은 쉬는 시간(10분)에 걸리는 일이 잦다.
 * 5분까지 내려갈 수 있어야 종례 방송 같은 짧은 편성을 잡을 수 있다.
 */
export const SLOT_CHOICES = [5, 10, 15, 30, 60]

export const DEFAULT_SLOT_MINUTES = 30

/**
 * 한 시간의 높이(px). 분할을 잘게 바꿔도 표 전체 높이는 그대로 두기 위한
 * 기준이다 — 5분 칸에 30분 칸과 같은 높이를 주면 표가 여섯 배로 길어져
 * 하루를 한눈에 볼 수 없다.
 */
export const HOUR_HEIGHT = 52

/** 분할에 맞는 한 칸 높이. */
export function slotHeightFor(slotMinutes) {
  return (HOUR_HEIGHT * slotMinutes) / 60
}

/** 그리드 기본 설정. 표출 시간대가 이른 아침~자정인 현장 특성을 반영했다. */
export const DEFAULT_GRID = {
  startHour: 6,
  endHour: 24,
  slotMinutes: DEFAULT_SLOT_MINUTES,
  slotHeight: slotHeightFor(DEFAULT_SLOT_MINUTES),
}

const MINUTES_PER_DAY = 24 * 60

/** "09:30:00" -> 570. 잘못된 값은 null. */
export function toMinutes(value) {
  if (typeof value !== 'string') return null
  const parts = value.split(':')
  if (parts.length < 2) return null
  const hours = Number(parts[0])
  const minutes = Number(parts[1])
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null
  return hours * 60 + minutes
}

/** 570 -> "09:30:00". 1440(자정)은 "23:59:59" 로 내보낸다. */
export function toTimeString(minutes) {
  const clamped = Math.max(0, Math.min(MINUTES_PER_DAY, Math.round(minutes)))
  if (clamped >= MINUTES_PER_DAY) return '23:59:59'
  const hours = Math.floor(clamped / 60)
  const mins = clamped % 60
  return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}:00`
}

/** 화면 표시용 "09:30". */
export function toLabel(minutes) {
  return toTimeString(minutes).slice(0, 5)
}

export function snap(minutes, step) {
  return Math.round(minutes / step) * step
}

/** 두 구간이 겹치는가. 끝나는 시각과 시작 시각이 같은 것은 겹침이 아니다. */
export function overlaps(a, b) {
  return a.start < b.end && b.start < a.end
}

/**
 * ``candidate`` 가 같은 요일의 다른 블록과 겹치는지.
 * 자기 자신은 ``candidate.key`` 로 제외한다.
 */
export function findConflict(blocks, candidate) {
  return (
    blocks.find(
      (block) =>
        block.key !== candidate.key &&
        block.day === candidate.day &&
        overlaps(block, candidate),
    ) ?? null
  )
}

/** 그리드가 표현할 수 있는 시간 범위로 잘라 낸다. */
export function clampToGrid(block, grid) {
  const min = grid.startHour * 60
  const max = grid.endHour * 60
  let start = Math.max(min, Math.min(block.start, max - grid.slotMinutes))
  let end = Math.min(max, Math.max(block.end, start + grid.slotMinutes))
  if (end <= start) end = Math.min(max, start + grid.slotMinutes)
  return { ...block, start, end }
}

let keySeed = 0

function nextKey() {
  keySeed += 1
  return `b${keySeed}`
}

/**
 * 실제로 표출할 것이 있는 인라인 문서인가.
 *
 * 저장된 문서는 참조 방식일 때 ``{}`` 이고, 편집기가 만든 빈 문서는
 * ``elements: []`` 다. 둘 다 화면에는 아무것도 나오지 않으므로 "콘텐츠 없음"
 * 으로 다뤄야 한다. 객체의 존재만으로 판단하면 ``{}`` 가 truthy 라서 잘못
 * "인라인 콘텐츠 있음"이 된다.
 */
export function hasInlineContent(document) {
  return Boolean(document && (document.elements?.length ?? 0) > 0)
}

/**
 * 서버 아이템 -> 그리드 블록.
 *
 * 요일이 지정되고 시작/종료 시각이 있는 것만 표에 놓을 수 있다. 나머지
 * (목록반복 아이템 등)는 ``loose`` 로 돌려주어 화면에서 따로 보여 준다.
 * 조용히 버리면 저장할 때 사라지기 때문이다.
 */
export function itemsToBlocks(items) {
  const blocks = []
  const loose = []

  for (const item of items ?? []) {
    const start = toMinutes(item.start_time)
    const end = toMinutes(item.end_time)
    const placeable = item.day_of_week >= 0 && start !== null && end !== null && end > start

    if (placeable) {
      // 인라인 문서는 저장 때 그대로 돌려보내야 하므로 원본을 보관하고,
      // 화면 표시 여부는 요소 유무로 따로 판단한다.
      const inline = item.content_id ? null : (item.content ?? null)
      blocks.push({
        key: nextKey(),
        id: item.id ?? null,
        day: item.day_of_week,
        start,
        end,
        contentId: item.content_id ?? null,
        contentName: item.content_name ?? null,
        durationSec: item.duration_sec ?? 10,
        transition: item.transition ?? 'none',
        transitionMs: item.transition_ms ?? 600,
        noticeId: item.org_notice_id ?? null,
        inlineContent: inline,
        hasInline: hasInlineContent(inline),
      })
    } else {
      loose.push({ ...item, key: nextKey() })
    }
  }

  return { blocks, loose }
}

/** 그리드 블록 + 표 밖 아이템 -> 서버 아이템 배열. */
export function blocksToItems(blocks, loose = []) {
  const fromBlocks = [...blocks]
    .sort((a, b) => a.day - b.day || a.start - b.start)
    .map((block, index) => ({
      day_of_week: block.day,
      start_time: toTimeString(block.start),
      end_time: toTimeString(block.end),
      sort_order: index,
      duration_sec: block.durationSec ?? 10,
      transition: block.transition ?? 'none',
      transition_ms: block.transitionMs ?? 600,
      org_notice_id: block.noticeId ?? null,
      content_id: block.noticeId ? null : (block.contentId ?? null),
      content: block.noticeId || block.contentId ? {} : (block.inlineContent ?? {}),
    }))

  const fromLoose = loose.map((item, index) => ({
    day_of_week: item.day_of_week ?? -1,
    start_time: item.start_time ?? null,
    end_time: item.end_time ?? null,
    sort_order: fromBlocks.length + index,
    duration_sec: item.duration_sec ?? 10,
    transition: item.transition ?? 'none',
    transition_ms: item.transition_ms ?? 600,
    org_notice_id: item.org_notice_id ?? null,
    content_id: item.org_notice_id ? null : (item.content_id ?? null),
    content: item.org_notice_id || item.content_id ? {} : (item.content ?? {}),
  }))

  return [...fromBlocks, ...fromLoose]
}

/** 그리드 세로 픽셀 -> 분. */
export function yToMinutes(y, grid) {
  return grid.startHour * 60 + (y / grid.slotHeight) * grid.slotMinutes
}

/** 분 -> 그리드 세로 픽셀. */
export function minutesToY(minutes, grid) {
  return ((minutes - grid.startHour * 60) / grid.slotMinutes) * grid.slotHeight
}

export function slotCount(grid) {
  return ((grid.endHour - grid.startHour) * 60) / grid.slotMinutes
}

/** 시간 눈금 라벨(정시마다). */
export function hourMarks(grid) {
  const marks = []
  for (let hour = grid.startHour; hour <= grid.endHour; hour += 1) {
    marks.push({ hour, minutes: hour * 60, y: minutesToY(hour * 60, grid) })
  }
  return marks
}

export function createBlock({ day, start, end, grid }) {
  return clampToGrid(
    {
      key: nextKey(),
      id: null,
      day,
      start,
      end,
      contentId: null,
      contentName: null,
      durationSec: 10,
      noticeId: null,
      inlineContent: null,
      hasInline: false,
    },
    grid,
  )
}

/** 이 블록이 표출할 것을 갖고 있는가(참조든 인라인이든). */
export function blockHasContent(block) {
  return Boolean(block.contentId) || Boolean(block.noticeId) || Boolean(block.hasInline)
}
