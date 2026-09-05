/**
 * 상단 정보 표시줄 테스트.
 *
 * 확인할 것은 셋이다 — 시계가 실제로 가는가, 날씨 API 가 없을 때 샘플로
 * 떨어지며 그 사실을 밝히는가, 실데이터가 오면 그것을 쓰는가.
 */
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { i18n } from '@/i18n'
import { previewNow } from '@/utils/widgetSamples'

const get = vi.fn()

vi.mock('@/api/client', () => ({
  api: { get: (...args) => get(...args) },
  TEST_MODE: false,
}))

import InfoBar from './InfoBar.vue'

async function mountBar(props = {}) {
  const wrapper = mount(InfoBar, {
    props,
    global: { plugins: [i18n] },
  })
  await flushPromises()
  // 시계 구독이 '지금' 으로 되돌리므로, 고정 시각은 놓인 뒤에 넣는다.
  previewNow.value = new Date(2026, 8, 4, 14, 5, 9) // 금요일
  await wrapper.vm.$nextTick()
  return wrapper
}

beforeEach(() => {
  i18n.global.locale.value = 'ko'
  get.mockReset()
  // 지금 서버의 실제 상태: 날씨 API 미연동.
  get.mockResolvedValue({ data: { available: false, reason: '날씨 API 미연동' } })
})

describe('날짜와 시간', () => {
  it('오늘 날짜를 요일까지 보여 준다', async () => {
    const wrapper = await mountBar()

    expect(wrapper.find('.date').text()).toContain('2026')
    expect(wrapper.find('.date').text()).toContain('9월 4일')
    expect(wrapper.find('.date').text()).toContain('금')
  })

  it('시간은 초까지 그리고, 시계가 가면 따라간다', async () => {
    // 장치는 몇 달씩 켜 둔 채로 돈다. 멈춘 시계는 틀린 시계다.
    const wrapper = await mountBar()
    expect(wrapper.find('.time').text()).toBe('14:05:09')

    previewNow.value = new Date(2026, 8, 4, 14, 5, 10)
    await wrapper.vm.$nextTick()

    expect(wrapper.find('.time').text()).toBe('14:05:10')
  })
})

describe('날씨와 미세먼지', () => {
  it('API 미연동이면 샘플로 그리고 그 사실을 밝힌다', async () => {
    // 실제 데이터가 아니라는 것을 편집자가 알아야 한다.
    const wrapper = await mountBar()

    expect(wrapper.find('.weather').text()).toContain('24°')
    expect(wrapper.find('.dust').text()).toContain('미세먼지')
    expect(wrapper.find('.dust').text()).toContain('보통')
    expect(wrapper.find('.sample').exists()).toBe(true)
  })

  it('서버가 실데이터를 주면 그것을 쓴다', async () => {
    get.mockResolvedValue({
      data: {
        available: true,
        temp: '18°',
        condition: '흐림',
        icon: '☁',
        dust: '나쁨',
        pm10: 92,
      },
    })
    const wrapper = await mountBar()

    expect(wrapper.find('.weather').text()).toContain('18°')
    expect(wrapper.find('.dust').text()).toContain('나쁨')
    expect(wrapper.find('.dust').text()).toContain('92')
    expect(wrapper.find('.sample').exists()).toBe(false)
  })

  it('요청이 실패해도 표시줄은 그려진다', async () => {
    // 날씨가 없다고 날짜·시간까지 사라지면 안 된다.
    get.mockRejectedValue(new Error('down'))
    const wrapper = await mountBar()

    expect(wrapper.find('.time').exists()).toBe(true)
    expect(wrapper.find('.weather').exists()).toBe(true)
  })

  it('기관을 정해 묻는다', async () => {
    await mountBar({ orgId: 3 })

    expect(get).toHaveBeenCalledWith('/widgets/weather/data', { org_id: 3, options: '{}' })
  })
})

describe('배율', () => {
  it('배율에 맞춰 높이와 글자를 줄인다', async () => {
    // 안쪽은 문서 좌표로 그리고 바깥에서 한 번만 줄인다 — 글자 비율이
    // 실제 표출과 같아야 한다.
    const wrapper = await mountBar({ scale: 0.5 })
    const style = wrapper.attributes('style')

    expect(style).toContain('height: 36px')
    expect(style).toContain('font-size: 15px')
  })
})
