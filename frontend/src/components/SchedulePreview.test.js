/**
 * 스케줄 미리보기 테스트.
 *
 * 요일별로 무엇이 언제 나오는지, 콘텐츠 문서를 제때 받아 그리는지 확인한다.
 */
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { i18n } from '@/i18n'

const DOC = {
  version: 1,
  layout: { width: 1920, height: 1080, background: '#0f172a' },
  elements: [
    { id: 'e1', type: 'text', rect: { x: 0, y: 0, w: 1920, h: 200, z: 1 }, options: { text: '안녕' }, opacity: 1 },
  ],
}

const get = vi.fn(async (path) => {
  if (path.startsWith('/contents/')) return { id: Number(path.split('/')[2]), document: DOC }
  return {}
})

vi.mock('@/api/client', () => ({
  api: { get: (...args) => get(...args), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
  TEST_MODE: true,
  getToken: () => null,
  setToken: vi.fn(),
}))

import SchedulePreview from './SchedulePreview.vue'

function slot(key, label, contentId, name, extra = {}) {
  return { key, label, contentId, contentName: name, content: null, durationSec: 15, ...extra }
}

/** 요일형 슬롯. 미리보기가 머무는 시간은 이 길이에 비례한다(10분 = 5초). */
function daySlot(key, label, contentId, name, lengthMinutes) {
  return slot(key, label, contentId, name, { lengthMinutes })
}

function mountPreview(groups, showGroups = true) {
  setActivePinia(createPinia())
  return mount(SchedulePreview, {
    props: { groups, widgets: [], showGroups },
    global: { plugins: [createPinia(), i18n] },
    attachTo: window.document.body,
  })
}

const WEEK = () => [
  {
    key: 'day-0',
    label: '월',
    slots: [
      // 20분 → 10초, 10분 → 5초.
      daySlot('a', '08:00–08:20', 1, '아침 알림판', 20),
      daySlot('b', '12:00–12:10', 2, '오후 화면', 10),
    ],
  },
  { key: 'day-1', label: '화', slots: [] },
  { key: 'day-2', label: '수', slots: [daySlot('c', '09:00–10:00', 1, '아침 알림판', 60)] },
  { key: 'day-3', label: '목', slots: [] },
  { key: 'day-4', label: '금', slots: [] },
  { key: 'day-5', label: '토', slots: [] },
  { key: 'day-6', label: '일', slots: [] },
]

beforeEach(() => {
  get.mockClear()
  i18n.global.locale.value = 'ko'
  delete window.ResizeObserver
  window.matchMedia = vi.fn().mockImplementation((query) => ({
    matches: false,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }))
})

describe('요일별 미리보기', () => {
  it('요일 탭 7개를 보여 준다', () => {
    const wrapper = mountPreview(WEEK())
    expect(wrapper.findAll('.day-tab').map((b) => b.text().replace(/\s+/g, ''))).toEqual([
      '월2', '화0', '수1', '목0', '금0', '토0', '일0',
    ])
  })

  it('처음에는 내용이 있는 요일을 연다', async () => {
    // 빈 요일이 먼저 열리면 미리보기를 열자마자 아무것도 안 보인다.
    const groups = WEEK()
    groups[0].slots = []
    const wrapper = mountPreview(groups)
    await flushPromises()

    expect(wrapper.findAll('.day-tab')[2].classes()).toContain('active')
  })

  it('요일을 바꾸면 그 요일의 시간대를 보여 준다', async () => {
    const wrapper = mountPreview(WEEK())
    await flushPromises()

    expect(wrapper.findAll('.slot')).toHaveLength(2)

    await wrapper.findAll('.day-tab')[2].trigger('click')
    await flushPromises()

    expect(wrapper.findAll('.slot')).toHaveLength(1)
    expect(wrapper.find('.slot-label').text()).toBe('09:00–10:00')
  })

  it('비어 있는 요일은 그렇다고 알려 준다', async () => {
    const wrapper = mountPreview(WEEK())
    await wrapper.findAll('.day-tab')[1].trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('이 요일에는 표출할 것이 없습니다')
  })

  it('요일을 바꾸면 첫 시간대부터 다시 본다', async () => {
    const wrapper = mountPreview(WEEK())
    await flushPromises()

    await wrapper.findAll('.slot')[1].trigger('click')
    await flushPromises()
    expect(wrapper.find('.position').text()).toContain('2 / 2')

    await wrapper.findAll('.day-tab')[2].trigger('click')
    await flushPromises()
    expect(wrapper.find('.position').text()).toContain('1 / 1')
  })
})

describe('콘텐츠 렌더링', () => {
  it('선택한 시간대의 콘텐츠 문서를 받아 그린다', async () => {
    const wrapper = mountPreview(WEEK())
    await flushPromises()

    expect(get).toHaveBeenCalledWith('/contents/1')
    expect(wrapper.find('.canvas').exists()).toBe(true)
    expect(wrapper.text()).toContain('안녕')
  })

  it('같은 콘텐츠는 한 번만 받는다', async () => {
    const wrapper = mountPreview(WEEK())
    await flushPromises()
    get.mockClear()

    // 수요일도 1번 콘텐츠를 쓴다.
    await wrapper.findAll('.day-tab')[2].trigger('click')
    await flushPromises()

    expect(get).not.toHaveBeenCalled()
  })

  it('편집 보조물(격자·분할선)은 미리보기에 나오지 않는다', async () => {
    // 실제 장치 화면에는 없는 선이다.
    const wrapper = mountPreview(WEEK())
    await flushPromises()

    expect(wrapper.find('.grid-overlay').exists()).toBe(false)
    expect(wrapper.find('.region').exists()).toBe(false)
    expect(wrapper.find('.side').exists()).toBe(false)
  })

  it('콘텐츠가 없는 시간대는 빈 화면이라고 알려 준다', async () => {
    const groups = [{ key: 'day-0', label: '월', slots: [slot('a', '08:00–09:00', null, null)] }]
    const wrapper = mountPreview(groups)
    await flushPromises()

    expect(wrapper.text()).toContain('빈 화면이 표출됩니다')
    expect(wrapper.find('.canvas').exists()).toBe(false)
  })

  it('인라인 콘텐츠는 서버를 부르지 않고 바로 그린다', async () => {
    const groups = [
      { key: 'day-0', label: '월', slots: [slot('a', '08:00–09:00', null, null, { content: DOC })] },
    ]
    const wrapper = mountPreview(groups)
    await flushPromises()

    expect(get).not.toHaveBeenCalled()
    expect(wrapper.find('.canvas').exists()).toBe(true)
  })

  it('문서를 못 받으면 오류를 보여 준다', async () => {
    get.mockImplementationOnce(async () => {
      throw { detail: '권한이 없습니다.' }
    })
    const wrapper = mountPreview(WEEK())
    await flushPromises()

    expect(wrapper.find('.error-text').text()).toBe('권한이 없습니다.')
  })
})

describe('넘겨 보기', () => {
  it('다음/이전으로 시간대를 옮긴다', async () => {
    const wrapper = mountPreview(WEEK())
    await flushPromises()

    const [prev, , next] = wrapper.findAll('.controls .btn')
    await next.trigger('click')
    await flushPromises()
    expect(wrapper.find('.position').text()).toContain('2 / 2')

    await prev.trigger('click')
    await flushPromises()
    expect(wrapper.find('.position').text()).toContain('1 / 2')
  })

  it('마지막에서 다음을 누르면 처음으로 돌아온다', async () => {
    const wrapper = mountPreview(WEEK())
    await flushPromises()

    const next = wrapper.findAll('.controls .btn')[2]
    await next.trigger('click')
    await next.trigger('click')
    await flushPromises()

    expect(wrapper.find('.position').text()).toContain('1 / 2')
  })

  it('시간대가 하나뿐이면 이동 버튼이 비활성이다', async () => {
    const wrapper = mountPreview([{ key: 'g', label: '월', slots: [slot('a', '1', 1, 'A')] }])
    await flushPromises()

    const buttons = wrapper.findAll('.controls .btn')
    expect(buttons[0].attributes('disabled')).toBeDefined()
    expect(buttons[2].attributes('disabled')).toBeDefined()
  })

  it('열자마자 돌고, 누르면 멈춘다', async () => {
    // 미리보기의 목적이 '실제로 어떻게 흘러가는가' 라 한 번 더 누르게 할
    // 이유가 없다.
    vi.useFakeTimers()
    const wrapper = mountPreview(WEEK())
    await flushPromises()

    const play = wrapper.findAll('.controls .btn')[1]
    expect(play.text()).toBe('일시정지')

    // 20분짜리 첫 칸은 10초.
    vi.advanceTimersByTime(10000)
    await flushPromises()
    expect(wrapper.find('.position').text()).toContain('2 / 2')

    await wrapper.findAll('.controls .btn')[1].trigger('click')
    expect(wrapper.findAll('.controls .btn')[1].text()).toBe('재생')

    vi.advanceTimersByTime(30000)
    await flushPromises()
    expect(wrapper.find('.position').text()).toContain('2 / 2')

    vi.useRealTimers()
  })
})

/** 목록반복 미리보기용 묶음. 여러 곳에서 쓰므로 위에 둔다. */
const LOOP = () => [
  {
    key: 'loop',
    label: '행사 안내',
    slots: [slot('a', '1', 1, 'A', { durationSec: 5 }), slot('b', '2', 2, 'B', { durationSec: 7 })],
  },
]

describe('남은 시간', () => {
  it('1초씩 세어 보여 준다', async () => {
    // 한 번에 통째로 기다리면 얼마나 남았는지 알 수 없다.
    vi.useFakeTimers()
    const wrapper = mountPreview(WEEK())
    await flushPromises()

    // 20분 → 10초.
    expect(wrapper.find('.position').text()).toContain('10초 남음')
    vi.advanceTimersByTime(1000)
    await flushPromises()
    expect(wrapper.find('.position').text()).toContain('9초 남음')

    vi.useRealTimers()
  })

  it('진행 막대로도 보여 준다', async () => {
    vi.useFakeTimers()
    const wrapper = mountPreview(WEEK())
    await flushPromises()

    expect(wrapper.find('.bar .fill').exists()).toBe(true)
    vi.useRealTimers()
  })

  it('넘어가면 다음 칸의 시간으로 되돌린다', async () => {
    vi.useFakeTimers()
    const wrapper = mountPreview(LOOP(), false)
    await flushPromises()

    // 첫 항목 5초가 끝나면 두 번째 항목의 시간으로 바뀐다.
    vi.advanceTimersByTime(5000)
    await flushPromises()
    expect(wrapper.find('.position').text()).toContain('2 / 2')

    vi.useRealTimers()
  })
})

describe('창 크기', () => {
  // 크기는 설정에 남는다. 앞 테스트가 고른 값이 다음으로 새면 안 된다.
  beforeEach(() => localStorage.removeItem('signallink.preview.size'))

  it('네 단계로 고를 수 있다', async () => {
    const wrapper = mountPreview(WEEK())
    await flushPromises()

    const names = wrapper.find('.size select').findAll('option').map((o) => o.text())
    expect(names).toEqual(['작게', '보통', '크게', '최대'])
  })

  it('고른 크기로 창과 무대가 함께 커진다', async () => {
    // 폭만 키우면 위아래가 남고, 높이만 키우면 좌우가 남는다.
    const wrapper = mountPreview(WEEK())
    await flushPromises()

    await wrapper.find('.size select').setValue('xl')
    await flushPromises()

    expect(wrapper.find('.dialog').attributes('style')).toContain('96vw')
    expect(wrapper.find('.screen-stage').attributes('style')).toContain('74vh')
  })

  it('기본은 보통이다', async () => {
    const wrapper = mountPreview(WEEK())
    await flushPromises()

    expect(wrapper.find('.dialog').attributes('style')).toContain('1040px')
  })
})

describe('전체화면', () => {
  // jsdom 에는 Fullscreen API 가 없다. 지원하는 브라우저를 흉내 낸다.
  beforeEach(() => {
    Object.defineProperty(globalThis.document, 'fullscreenEnabled', {
      value: true,
      configurable: true,
    })
  })

  it('지원하면 버튼을 둔다', async () => {
    const wrapper = mountPreview(WEEK())
    await flushPromises()

    const button = wrapper.findAll('.controls .btn').find((b) => b.text().includes('전체화면'))
    expect(button).toBeTruthy()
  })

  it('누르면 무대를 전체화면으로 요청한다', async () => {
    // 모달을 늘리는 것과 다르다 — 주소창까지 사라져야 실제 크기에 가깝다.
    const request = vi.fn(() => Promise.resolve())
    const wrapper = mountPreview(WEEK())
    await flushPromises()

    wrapper.find('.screen-stage').element.requestFullscreen = request
    const button = wrapper.findAll('.controls .btn').find((b) => b.text().includes('전체화면'))
    await button.trigger('click')

    expect(request).toHaveBeenCalled()
  })

  it('나갈 때 전체화면을 풀어 준다', async () => {
    // 창을 닫는데 전체화면으로 남으면 빠져나갈 길이 없다.
    const exit = vi.fn(() => Promise.resolve())
    const wrapper = mountPreview(WEEK())
    await flushPromises()

    Object.defineProperty(globalThis.document, 'fullscreenElement', {
      value: wrapper.find('.screen-stage').element,
      configurable: true,
    })
    globalThis.document.exitFullscreen = exit
    wrapper.unmount()

    expect(exit).toHaveBeenCalled()
    Object.defineProperty(globalThis.document, 'fullscreenElement', {
      value: null,
      configurable: true,
    })
  })
})

describe('편성 길이에 비례한 시간', () => {
  it('10분을 5초로 환산한다', async () => {
    // 모든 칸을 같은 간격으로 넘기면 3시간짜리와 10분짜리가 똑같이 지나가,
    // 하루가 어떻게 짜였는지 미리보기에서 드러나지 않는다.
    vi.useFakeTimers()
    const wrapper = mountPreview(WEEK())
    await flushPromises()

    // 첫 칸 20분 → 10초.
    expect(wrapper.find('.position').text()).toContain('10초 남음')

    vi.advanceTimersByTime(10000)
    await flushPromises()
    // 다음 칸 10분 → 5초.
    expect(wrapper.find('.position').text()).toContain('5초 남음')

    vi.useRealTimers()
  })

  it('한 시간짜리는 30초 머문다', async () => {
    vi.useFakeTimers()
    const wrapper = mountPreview(WEEK())
    await flushPromises()

    // '수' 요일의 60분짜리 한 칸.
    await wrapper.findAll('.day-tab')[2].trigger('click')
    await flushPromises()

    expect(wrapper.find('.position').text()).toContain('30초 남음')
    vi.useRealTimers()
  })

  it('목록반복은 칸마다 정해 둔 시간을 그대로 쓴다', async () => {
    vi.useFakeTimers()
    const wrapper = mountPreview(LOOP(), false)
    await flushPromises()

    expect(wrapper.find('.position').text()).toContain('5초 남음')
    vi.useRealTimers()
  })

  it('배속으로 빨리 훑을 수 있다', async () => {
    // 3시간짜리 칸이 90초가 되므로 빠져나갈 수단이 있어야 한다.
    vi.useFakeTimers()
    const wrapper = mountPreview(WEEK())
    await flushPromises()

    await wrapper.find('.step select').setValue(2)
    await flushPromises()

    // 20분 → 10초, 2배속이면 5초.
    expect(wrapper.find('.position').text()).toContain('5초 남음')
    vi.advanceTimersByTime(5000)
    await flushPromises()
    expect(wrapper.find('.position').text()).toContain('2 / 2')

    vi.useRealTimers()
  })

  it('목록반복에도 배속이 있다', async () => {
    const wrapper = mountPreview(LOOP(), false)
    await flushPromises()

    expect(wrapper.find('.step select').exists()).toBe(true)
  })
})

describe('목록반복 미리보기', () => {
  it('요일 탭을 보여 주지 않는다', () => {
    const wrapper = mountPreview(LOOP(), false)
    expect(wrapper.find('.day-tabs').exists()).toBe(false)
  })

  it('한 바퀴 도는 시간을 보여 준다', () => {
    const wrapper = mountPreview(LOOP(), false)
    expect(wrapper.find('.slots-head').text()).toContain('12')
  })

  it('항목별 표출 시간대로 넘어간다', async () => {
    vi.useFakeTimers()
    const wrapper = mountPreview(LOOP(), false)
    await flushPromises()

    // 첫 항목은 5초. 3초에서는 아직 그대로다.
    vi.advanceTimersByTime(3000)
    await flushPromises()
    expect(wrapper.find('.position').text()).toContain('1 / 2')

    vi.advanceTimersByTime(2000)
    await flushPromises()
    expect(wrapper.find('.position').text()).toContain('2 / 2')

    vi.useRealTimers()
  })
})
