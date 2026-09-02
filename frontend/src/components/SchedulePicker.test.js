/**
 * 스케줄 배정 고르기 테스트.
 *
 * 한 장치에 여러 개를 걸 수 있고 **순서가 곧 우선순위**다. 그리고 사용 기간이
 * 지난 스케줄은 걸려 있어도 표출되지 않는다 — 그 상태를 구분해 보여 주지
 * 않으면 "왜 안 나오지" 를 화면에서 알 수 없다.
 */
import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it } from 'vitest'

import { i18n } from '@/i18n'
import SchedulePicker from './SchedulePicker.vue'

const assigned = (id, name, extra = {}) => ({
  id,
  name,
  kind: '시간지정',
  orientation: 'LANDSCAPE',
  start_at: null,
  end_at: null,
  active: true,
  ...extra,
})

const SCHEDULES = [
  { id: 1, name: '평일 기본' },
  { id: 2, name: '행사 안내' },
  { id: 3, name: '방학' },
]

function mountPicker(props = {}) {
  return mount(SchedulePicker, {
    props: { assigned: [], schedules: SCHEDULES, ...props },
    global: { plugins: [i18n] },
  })
}

const names = (wrapper) => wrapper.findAll('.row .name').map((n) => n.text())

const rowButtons = (wrapper, index) => wrapper.findAll('.row')[index].findAll('.btn')

beforeEach(() => {
  i18n.global.locale.value = 'ko'
})

describe('배정 목록', () => {
  it('아무것도 없으면 데모라고 알려 준다', () => {
    const wrapper = mountPicker()
    expect(wrapper.text()).toContain('데모')
  })

  it('배정된 순서대로 보여 준다', () => {
    const wrapper = mountPicker({ assigned: [assigned(2, '행사 안내'), assigned(1, '평일 기본')] })
    expect(names(wrapper)).toEqual(['행사 안내', '평일 기본'])
  })

  it('우선순위를 번호로 못 박는다', () => {
    // 순서가 곧 규칙이라 눈으로 확인돼야 한다.
    const wrapper = mountPicker({ assigned: [assigned(1, 'A'), assigned(2, 'B')] })
    expect(wrapper.findAll('.order').map((o) => o.text())).toEqual(['1', '2'])
  })

  it('기간 밖이면 그렇게 표시한다', () => {
    const wrapper = mountPicker({
      assigned: [assigned(1, '지난 행사', { active: false, end_at: '2020-01-01T00:00:00Z' })],
    })
    expect(wrapper.text()).toContain('기간 밖')
  })

  it('사용 기간을 함께 보여 준다', () => {
    const wrapper = mountPicker({
      assigned: [
        assigned(1, '행사', { start_at: '2026-10-01T00:00:00Z', end_at: '2026-10-31T00:00:00Z' }),
      ],
    })
    expect(wrapper.find('.period').text()).toContain('~')
  })

  it('기간이 없으면 기간 표시를 하지 않는다', () => {
    const wrapper = mountPicker({ assigned: [assigned(1, '평상시')] })
    expect(wrapper.find('.period').exists()).toBe(false)
  })
})

describe('추가', () => {
  it('고르면 목록 끝에 붙인 전체를 올린다', async () => {
    const wrapper = mountPicker({ assigned: [assigned(1, 'A')] })
    await wrapper.find('select').setValue(2)

    expect(wrapper.emitted('change')[0][0]).toEqual([1, 2])
  })

  it('이미 건 것은 후보에서 뺀다', () => {
    // 같은 스케줄을 두 번 걸 수는 없다.
    const wrapper = mountPicker({ assigned: [assigned(1, 'A')] })
    const options = wrapper.findAll('option').map((o) => o.text())
    expect(options).not.toContain('평일 기본')
    expect(options).toContain('행사 안내')
  })

  it('더 걸 것이 없으면 그렇게 말한다', () => {
    const wrapper = mountPicker({
      assigned: SCHEDULES.map((s) => assigned(s.id, s.name)),
    })
    expect(wrapper.find('select').attributes('disabled')).toBeDefined()
    expect(wrapper.text()).toContain('더 추가할 스케줄이 없습니다')
  })
})

describe('순서 바꾸기', () => {
  it('위로 올린다', async () => {
    const wrapper = mountPicker({ assigned: [assigned(1, 'A'), assigned(2, 'B')] })
    await rowButtons(wrapper, 1)[0].trigger('click')

    expect(wrapper.emitted('change')[0][0]).toEqual([2, 1])
  })

  it('아래로 내린다', async () => {
    const wrapper = mountPicker({ assigned: [assigned(1, 'A'), assigned(2, 'B')] })
    await rowButtons(wrapper, 0)[1].trigger('click')

    expect(wrapper.emitted('change')[0][0]).toEqual([2, 1])
  })

  it('맨 위에서는 더 올릴 수 없다', () => {
    const wrapper = mountPicker({ assigned: [assigned(1, 'A'), assigned(2, 'B')] })
    expect(rowButtons(wrapper, 0)[0].attributes('disabled')).toBeDefined()
  })

  it('맨 아래에서는 더 내릴 수 없다', () => {
    const wrapper = mountPicker({ assigned: [assigned(1, 'A'), assigned(2, 'B')] })
    expect(rowButtons(wrapper, 1)[1].attributes('disabled')).toBeDefined()
  })

  it('둘 이상이면 우선순위 규칙을 알려 준다', () => {
    const wrapper = mountPicker({ assigned: [assigned(1, 'A'), assigned(2, 'B')] })
    expect(wrapper.text()).toContain('위에 있을수록 먼저')
  })
})

describe('빼기', () => {
  it('뺀 나머지 전체를 올린다', async () => {
    const wrapper = mountPicker({ assigned: [assigned(1, 'A'), assigned(2, 'B')] })
    await rowButtons(wrapper, 0)[2].trigger('click')

    expect(wrapper.emitted('change')[0][0]).toEqual([2])
  })
})

describe('권한', () => {
  it('제어 권한이 없으면 전부 잠근다', () => {
    const wrapper = mountPicker({ assigned: [assigned(1, 'A')], disabled: true })
    expect(wrapper.findAll('.row .btn').every((b) => b.attributes('disabled') !== undefined)).toBe(
      true,
    )
    expect(wrapper.find('select').attributes('disabled')).toBeDefined()
  })
})
