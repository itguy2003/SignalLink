/**
 * 미리보기 슬롯 계산.
 *
 * 편집 중인 스케줄을 "장치에서 이 순서로 이렇게 나온다"는 목록으로 바꾼다.
 * 요일형은 요일마다 시간 순서, 목록반복은 재생 순서다.
 *
 * 슬롯은 화면에 그릴 때 필요한 최소 정보만 담는다. 실제 콘텐츠 문서는
 * 미리보기 컴포넌트가 필요할 때 서버에서 받아 온다(모든 문서를 미리 받으면
 * 편집기를 열 때마다 불필요한 요청이 쏟아진다).
 */

import { toLabel } from '@/utils/scheduleGrid'

export const DAY_COUNT = 7

/** 슬롯 하나. */
function makeSlot({ key, label, contentId, contentName, content, durationSec, lengthMinutes }) {
  return {
    key,
    label,
    contentId: contentId ?? null,
    contentName: contentName ?? null,
    // 라이브러리를 쓰지 않는 인라인 문서(단일 콘텐츠 편집기로 만든 것)
    content: content ?? null,
    durationSec: durationSec ?? 10,
    // 요일형에서 이 칸이 실제로 차지하는 시간(분). 미리보기가 이 값에
    // 비례해 머무는 시간을 정한다. 목록반복에는 없다.
    lengthMinutes: lengthMinutes ?? null,
  }
}

/**
 * 요일형 미리보기에서 한 칸을 몇 초 보여 줄 것인가.
 *
 * 편성 길이에 비례시킨다 — **10분을 5초로** 환산한다. 모든 칸을 같은 간격으로
 * 넘기면 3시간짜리와 10분짜리가 똑같이 지나가, 하루가 어떻게 짜였는지가
 * 미리보기에서 드러나지 않는다.
 *
 * 10분보다 짧은 칸(5분 분할로 잡은 것)도 비례로 줄지만, 눈으로 알아볼 수
 * 있어야 하므로 1초 밑으로는 내려가지 않는다.
 */
export const PREVIEW_UNIT_MINUTES = 10
export const PREVIEW_UNIT_SECONDS = 5

export function secondsForLength(minutes) {
  const value = Number(minutes)
  if (!Number.isFinite(value) || value <= 0) return PREVIEW_UNIT_SECONDS
  return Math.max(1, Math.round((value / PREVIEW_UNIT_MINUTES) * PREVIEW_UNIT_SECONDS))
}

/**
 * 슬롯 하나를 보여 줄 시간(초).
 *
 * 목록반복은 칸마다 정해 둔 표출 시간이 곧 실제 시간이라 그대로 쓴다.
 * 요일형은 위 환산을 따른다.
 */
export function slotSeconds(slot) {
  return slot?.lengthMinutes != null
    ? secondsForLength(slot.lengthMinutes)
    : Math.max(1, slot?.durationSec ?? 3)
}

/**
 * 요일형: 요일별로 시간 순서의 슬롯 묶음.
 *
 * 요일이 비어 있어도 자리를 남겨 둔다. 그래야 미리보기에서 "이 요일은 아무것도
 * 나오지 않는다"를 볼 수 있다.
 */
export function slotsByDay(blocks, dayLabels = []) {
  const groups = Array.from({ length: DAY_COUNT }, (_, day) => ({
    key: `day-${day}`,
    label: dayLabels[day] ?? String(day),
    slots: [],
  }))

  for (const block of blocks ?? []) {
    if (block.day < 0 || block.day >= DAY_COUNT) continue
    groups[block.day].slots.push(
      makeSlot({
        key: block.key,
        label: `${toLabel(block.start)}–${toLabel(block.end)}`,
        contentId: block.contentId,
        contentName: block.contentName,
        content: block.inlineContent,
        durationSec: block.durationSec,
        lengthMinutes: block.end - block.start,
      }),
    )
  }

  for (const group of groups) {
    group.slots.sort((a, b) => a.label.localeCompare(b.label))
  }
  return groups
}

/** 목록반복: 재생 순서 하나짜리 묶음. */
export function slotsFromPlaylist(items, label = '') {
  const slots = (items ?? []).map((item, index) =>
    makeSlot({
      key: `item-${index}`,
      label: `${index + 1}`,
      contentId: item.content_id,
      contentName: item.content_name,
      content: item.content && Object.keys(item.content).length ? item.content : null,
      durationSec: item.duration_sec,
    }),
  )
  return [{ key: 'loop', label, slots }]
}

/** 슬롯에 표출할 것이 있는가. 없으면 미리보기에서 '빈 화면'으로 알린다. */
export function slotHasContent(slot) {
  return Boolean(slot?.contentId) || Boolean(slot?.content?.elements?.length)
}

/** 한 묶음을 한 바퀴 도는 데 걸리는 시간(초). */
export function groupDuration(group) {
  return (group?.slots ?? []).reduce((sum, slot) => sum + (slot.durationSec || 0), 0)
}
