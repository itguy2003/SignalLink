/**
 * 장치 스케줄 배정 창(분할 화면) 테스트.
 *
 * 왼쪽에서 배정/해제/순서변경한 결과가 저장 시 '아이디 목록 전체'로 나가고,
 * 오른쪽은 고른 스케줄의 구분에 따라 주간(시간지정) 또는 목록(목록반복)으로
 * 그려지는지를 본다. 상세는 GET /schedules/{id} 로 받아 캐시한다.
 */
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { i18n } from '@/i18n'

const get = vi.fn()

vi.mock('@/api/client', () => ({
  api: { get: (...args) => get(...args) },
}))

import DeviceScheduleDialog from './DeviceScheduleDialog.vue'

const SCHEDULES = [
  { id: 1, name: '평일 기본', kind: '시간지정', active: true },
  { id: 2, name: '점심 안내', kind: '목록반복', active: true },
  { id: 3, name: '행사 특별', kind: '시간지정', active: false },
]

const DETAILS = {
  1: {
    id: 1,
    name: '평일 기본',
    kind: '시간지정',
    items: [
      // 월(0) 오후가 먼저 오게 넣어 정렬(시각순)도 같이 확인한다.
      { id: 11, day_of_week: 0, start_time: '13:00:00', end_time: '15:00:00', content_name: '오후 안내' },
      { id: 12, day_of_week: 0, start_time: '09:00:00', end_time: '12:00:00', content_name: '아침 안내' },
      { id: 13, day_of_week: 4, start_time: '09:00:00', end_time: '10:00:00', content_name: null },
    ],
  },
  2: {
    id: 2,
    name: '점심 안내',
    kind: '목록반복',
    items: [
      { id: 21, day_of_week: -1, sort_order: 1, duration_sec: 20, content_name: '식단표' },
      { id: 22, day_of_week: -1, sort_order: 0, duration_sec: 10, content_name: '공지' },
    ],
  },
  3: { id: 3, name: '행사 특별', kind: '시간지정', items: [] },
}

function mountDialog(assigned = [SCHEDULES[0]]) {
  return mount(DeviceScheduleDialog, {
    props: {
      device: { id: 7, name: '본관 로비', schedules: assigned },
      schedules: SCHEDULES,
    },
    global: { plugins: [i18n] },
  })
}

const assignedNames = (wrapper) =>
  wrapper.findAll('[data-test="assigned-row"] .name').map((n) => n.text())

const saveButton = (wrapper) =>
  wrapper.findAll('.btn-primary').find((b) => b.text() === '저장')

beforeEach(() => {
  i18n.global.locale.value = 'ko'
  get.mockReset()
  get.mockImplementation(async (path) => {
    const id = Number(path.split('/').pop())
    if (DETAILS[id]) return JSON.parse(JSON.stringify(DETAILS[id]))
    throw { detail: '없음' }
  })
})

describe('배정 목록', () => {
  it('배정된 것과 후보를 나눠 보여 준다', async () => {
    const wrapper = mountDialog()
    await flushPromises()

    expect(assignedNames(wrapper)).toEqual(['평일 기본'])
    expect(wrapper.findAll('[data-test="candidate-row"] .name').map((n) => n.text())).toEqual([
      '점심 안내',
      '행사 특별',
    ])
  })

  it('배정·해제·순서변경이 저장 아이디 목록에 그대로 반영된다', async () => {
    const wrapper = mountDialog()
    await flushPromises()

    // 후보 둘 다 배정 → [1, 2, 3]
    await wrapper.find('[data-test="candidate-row"] [data-test="assign"]').trigger('click')
    await wrapper.find('[data-test="candidate-row"] [data-test="assign"]').trigger('click')
    // 마지막(3)을 한 칸 위로 → [1, 3, 2]
    await wrapper.findAll('[data-test="move-up"]')[2].trigger('click')
    // 맨 앞(1)을 해제 → [3, 2]
    await wrapper.find('[data-test="unassign"]').trigger('click')

    await saveButton(wrapper).trigger('click')
    expect(wrapper.emitted('save')[0][0]).toEqual([3, 2])
  })

  it('모두 해제하면 빈 목록을 저장한다 (데모 콘텐츠 표출)', async () => {
    const wrapper = mountDialog()
    await flushPromises()

    await wrapper.find('[data-test="unassign"]').trigger('click')
    await saveButton(wrapper).trigger('click')

    expect(wrapper.emitted('save')[0][0]).toEqual([])
  })
})

describe('구성 미리보기', () => {
  it('처음 열면 첫 배정 스케줄의 상세를 받아 주간으로 그린다', async () => {
    const wrapper = mountDialog()
    await flushPromises()

    expect(get).toHaveBeenCalledWith('/schedules/1')
    const week = wrapper.find('[data-test="weekly-view"]')
    expect(week.exists()).toBe(true)

    // 월요일 칸에 시간대 두 개가 시각순으로.
    const monday = week.findAll('.day')[0]
    expect(monday.findAll('.slot-time').map((s) => s.text())).toEqual([
      '09:00~12:00',
      '13:00~15:00',
    ])
    expect(monday.findAll('.slot-name').map((s) => s.text())).toEqual(['아침 안내', '오후 안내'])
    // 콘텐츠 이름이 없으면(인라인 문서) 대체 문구.
    expect(week.findAll('.day')[4].find('.slot-name').text()).toBe('인라인 콘텐츠')
  })

  it('목록반복 스케줄을 고르면 재생 순서 목록으로 그린다', async () => {
    const wrapper = mountDialog()
    await flushPromises()

    await wrapper.find('[data-test="candidate-row"]').trigger('click')
    await flushPromises()

    expect(get).toHaveBeenCalledWith('/schedules/2')
    const list = wrapper.find('[data-test="list-view"]')
    expect(list.exists()).toBe(true)
    // sort_order 순: 공지(0) → 식단표(1)
    expect(list.findAll('.rot-row .name').map((n) => n.text())).toEqual(['공지', '식단표'])
  })

  it('상세는 캐시한다 — 같은 스케줄을 다시 골라도 재요청하지 않는다', async () => {
    const wrapper = mountDialog()
    await flushPromises()

    await wrapper.findAll('[data-test="candidate-row"]')[0].trigger('click')
    await flushPromises()
    await wrapper.find('[data-test="assigned-row"]').trigger('click')
    await flushPromises()

    expect(get.mock.calls.filter(([path]) => path === '/schedules/1')).toHaveLength(1)
  })

  it('아이템이 없는 스케줄은 안내 문구를 보인다', async () => {
    const wrapper = mountDialog([])
    await flushPromises()

    // 배정이 없으면 아무것도 고르지 않은 상태 — 안내 문구부터.
    expect(wrapper.text()).toContain('왼쪽에서 스케줄을 고르면')

    await wrapper.findAll('[data-test="candidate-row"]')[2].trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('아이템이 없는 스케줄입니다.')
  })
})
