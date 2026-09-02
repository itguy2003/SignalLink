/**
 * 진행률 막대 테스트.
 *
 * 이 막대가 있는 이유는 하나다 — 아무 말 없이 기다리게 하면 사람은 멈춘 줄
 * 알고 다시 누른다. 그래서 확인할 것도 하나다: **어떤 상태에서도 '하는 중'
 * 으로 읽히는가.** 특히 얼마나 남았는지 모를 때 0% 짜리 빈 막대를 그리면
 * 고장으로 읽힌다.
 */
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import ProgressBar from './ProgressBar.vue'

const mountBar = (props = {}) => mount(ProgressBar, { props })

describe('아는 만큼 그린다', () => {
  it('비율을 폭으로 옮긴다', () => {
    const wrapper = mountBar({ value: 0.42 })
    expect(wrapper.find('.fill').attributes('style')).toContain('width: 42%')
  })

  it('퍼센트를 숫자로도 보여 준다', () => {
    // 막대만 있으면 80% 와 90% 가 구별되지 않는다.
    const wrapper = mountBar({ value: 0.8, label: '올리는 중' })
    expect(wrapper.text()).toContain('80%')
  })

  it('범위를 벗어난 값도 막대 안에 가둔다', () => {
    expect(mountBar({ value: 2 }).find('.fill').attributes('style')).toContain('width: 100%')
    expect(mountBar({ value: -1 }).find('.fill').attributes('style')).toContain('width: 0%')
  })

  it('읽어 주는 프로그램에도 값을 알린다', () => {
    const wrapper = mountBar({ value: 0.5 })
    expect(wrapper.find('[role="progressbar"]').attributes('aria-valuenow')).toBe('50')
  })
})

describe('모를 때', () => {
  it('멈춘 막대 대신 흐르는 띠를 그린다', () => {
    // 0% 에 멈춘 막대는 고장으로 읽힌다.
    const wrapper = mountBar({ label: '받는 중' })

    expect(wrapper.find('.flowing').exists()).toBe(true)
    expect(wrapper.text()).not.toContain('%')
  })

  it('값이 없으면 읽어 주는 프로그램에도 숫자를 주지 않는다', () => {
    const wrapper = mountBar({ label: '받는 중' })
    expect(wrapper.find('[role="progressbar"]').attributes('aria-valuenow')).toBeUndefined()
  })

  it('숫자가 아닌 값도 모르는 것으로 본다', () => {
    expect(mountBar({ value: Number.NaN }).find('.flowing').exists()).toBe(true)
  })
})

describe('무엇을 하는 중인지', () => {
  it('설명과 곁들인 정보를 함께 보여 준다', () => {
    const wrapper = mountBar({ value: 0.5, label: '가을 사진.jpg', detail: '3 / 12' })

    expect(wrapper.text()).toContain('가을 사진.jpg')
    expect(wrapper.text()).toContain('3 / 12')
  })

  it('설명이 없으면 막대만 그린다', () => {
    const wrapper = mountBar({ value: 0.5 })
    expect(wrapper.find('.line').exists()).toBe(false)
  })
})
