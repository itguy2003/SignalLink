/**
 * 위젯 재생목록 미리보기 테스트.
 *
 * 이 화면의 값어치는 **시간이 실제와 같은가**에 있다. 15초짜리가 15초 머물러야
 * 길이를 가늠할 수 있고, 아니면 미리보기를 믿을 수 없다. 그래서 가짜 타이머로
 * 초를 밀어 가며 언제 넘어가는지를 확인한다.
 */
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { i18n } from '@/i18n'
import PlaylistPreview from './PlaylistPreview.vue'

const WIDGETS = [
  { key: 'notice', name: '공지사항', category: '기능형', description: '', options: [] },
  { key: 'meal', name: '급식메뉴', category: '기능형', description: '', options: [] },
  { key: 'clock', name: '시계', category: '기능형', description: '', options: [] },
]

const item = (widget_key, duration_sec, transition = 'none', transition_ms = 600) => ({
  widget_key,
  duration_sec,
  options: {},
  transition,
  transition_ms,
})

function mountPreview(items) {
  // 미리보기 크기가 설정 저장소에 남는다.
  setActivePinia(createPinia())
  return mount(PlaylistPreview, {
    props: { items, widgets: WIDGETS },
    global: {
      plugins: [createPinia(), i18n],
      // 어느 위젯이 어떤 배율로 그려졌는지 확인할 수 있게 남긴다.
      stubs: {
        WidgetPreview: {
          props: ['widgetKey', 'scale'],
          template: '<div class="wp" :data-scale="scale">{{ widgetKey }}</div>',
        },
      },
    },
  })
}

/** 초를 밀고 화면을 다시 그린다. */
async function advance(wrapper, seconds) {
  vi.advanceTimersByTime(seconds * 1000)
  await wrapper.vm.$nextTick()
}

const activeSlot = (wrapper) => wrapper.find('.slot.active .slot-name').text()

const position = (wrapper) => wrapper.find('.position').text()

const playButton = (wrapper) => wrapper.find('.controls .btn-primary')

beforeEach(() => {
  vi.useFakeTimers()
  i18n.global.locale.value = 'ko'
})

afterEach(() => {
  vi.useRealTimers()
})

describe('창 크기와 전체화면', () => {
  beforeEach(() => {
    localStorage.removeItem('signallink.preview.size')
    // jsdom 에는 Fullscreen API 가 없다. 지원하는 브라우저를 흉내 낸다.
    Object.defineProperty(globalThis.document, 'fullscreenEnabled', {
      value: true,
      configurable: true,
    })
  })

  it('네 단계로 고를 수 있다', async () => {
    const wrapper = mountPreview([item('notice', 10)])
    await flushPromises()

    const names = wrapper.find('.size select').findAll('option').map((o) => o.text())
    expect(names).toEqual(['작게', '보통', '크게', '최대'])
  })

  it('고른 크기로 창이 커진다', async () => {
    const wrapper = mountPreview([item('notice', 10)])
    await flushPromises()

    await wrapper.find('.size select').setValue('xl')
    await flushPromises()

    expect(wrapper.find('.dialog').attributes('style')).toContain('96vw')
  })

  it('크기는 세 미리보기가 함께 쓴다', async () => {
    // 설정에 남는 값이라 다른 미리보기에서 고른 것이 여기에도 적용된다.
    localStorage.setItem('signallink.preview.size', 'l')
    const wrapper = mountPreview([item('notice', 10)])
    await flushPromises()

    expect(wrapper.find('.dialog').attributes('style')).toContain('1280px')
  })

  it('전체화면 버튼을 둔다', async () => {
    const wrapper = mountPreview([item('notice', 10)])
    await flushPromises()

    const button = wrapper.findAll('.btn').find((b) => b.text().includes('전체화면'))
    expect(button).toBeTruthy()
  })

  it('누르면 전체화면을 요청한다', async () => {
    const request = vi.fn(() => Promise.resolve())
    const wrapper = mountPreview([item('notice', 10)])
    await flushPromises()

    wrapper.find('.screen').element.requestFullscreen = request
    const button = wrapper.findAll('.btn').find((b) => b.text().includes('전체화면'))
    await button.trigger('click')

    expect(request).toHaveBeenCalled()
  })

  it('나갈 때 전체화면을 풀어 준다', async () => {
    // 창을 닫는데 전체화면으로 남으면 빠져나갈 길이 없다.
    const exit = vi.fn(() => Promise.resolve())
    const wrapper = mountPreview([item('notice', 10)])
    await flushPromises()

    Object.defineProperty(globalThis.document, 'fullscreenElement', {
      value: wrapper.find('.screen').element,
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

describe('재생 순서', () => {
  it('순서와 표출 시간을 늘어놓는다', () => {
    const wrapper = mountPreview([item('notice', 15), item('meal', 10)])
    expect(wrapper.findAll('.slot .slot-name').map((n) => n.text())).toEqual([
      '공지사항',
      '급식메뉴',
    ])
    expect(wrapper.findAll('.slot .slot-sec').map((n) => n.text())).toEqual(['15s', '10s'])
  })

  it('한 바퀴 도는 시간을 알려 준다', () => {
    const wrapper = mountPreview([item('notice', 15), item('meal', 10)])
    expect(wrapper.text()).toContain('한 바퀴 25초')
  })

  it('첫 항목부터 시작한다', () => {
    const wrapper = mountPreview([item('notice', 15), item('meal', 10)])
    expect(activeSlot(wrapper)).toBe('공지사항')
  })

  it('담긴 위젯이 없으면 그렇게 말한다', () => {
    const wrapper = mountPreview([])
    expect(wrapper.text()).toContain('표출할 것이 없습니다')
    expect(playButton(wrapper).attributes('disabled')).toBeDefined()
  })
})

describe('실제 시간대로 재생', () => {
  it('정한 시간만큼 머문다', async () => {
    // 15초짜리는 14초에는 아직 그대로여야 한다.
    const wrapper = mountPreview([item('notice', 15), item('meal', 10)])
    await advance(wrapper, 14)
    expect(activeSlot(wrapper)).toBe('공지사항')
  })

  it('시간이 다 되면 다음으로 넘어간다', async () => {
    const wrapper = mountPreview([item('notice', 15), item('meal', 10)])
    await advance(wrapper, 15)
    expect(activeSlot(wrapper)).toBe('급식메뉴')
  })

  it('항목마다 제 시간을 쓴다', async () => {
    // 두 번째는 10초짜리다. 첫 항목의 15초를 물려받으면 안 된다.
    const wrapper = mountPreview([item('notice', 15), item('meal', 10), item('clock', 5)])
    await advance(wrapper, 15)
    await advance(wrapper, 10)
    expect(activeSlot(wrapper)).toBe('시계')
  })

  it('끝나면 처음으로 돌아간다', async () => {
    const wrapper = mountPreview([item('notice', 3), item('meal', 2)])
    await advance(wrapper, 5)
    expect(activeSlot(wrapper)).toBe('공지사항')
  })

  it('하나뿐이어도 제자리에서 돈다', async () => {
    const wrapper = mountPreview([item('notice', 3)])
    await advance(wrapper, 6)
    expect(activeSlot(wrapper)).toBe('공지사항')
    expect(position(wrapper)).toContain('1 / 1')
  })

  it('남은 시간을 세어 보여 준다', async () => {
    const wrapper = mountPreview([item('notice', 15), item('meal', 10)])
    expect(position(wrapper)).toContain('15초 남음')
    await advance(wrapper, 4)
    expect(position(wrapper)).toContain('11초 남음')
  })

  it('넘어가면 남은 시간도 그 항목 것으로 바뀐다', async () => {
    const wrapper = mountPreview([item('notice', 15), item('meal', 10)])
    await advance(wrapper, 15)
    expect(position(wrapper)).toContain('10초 남음')
  })

  it('0초로 적어 두어도 폭주하지 않는다', async () => {
    // 타이머가 0 이면 한 틱에 목록을 다 돌아 화면이 깜빡인다.
    const wrapper = mountPreview([item('notice', 0), item('meal', 5)])
    expect(position(wrapper)).toContain('1초 남음')
    await advance(wrapper, 1)
    expect(activeSlot(wrapper)).toBe('급식메뉴')
  })
})

describe('무대 크기', () => {
  it('놓인 폭에 맞춰 배율을 정한다', async () => {
    // 배율을 상수로 박아 두면 그 값이 맞는 창 크기가 하나뿐이다.
    const wrapper = mountPreview([item('notice', 10)])
    const wrap = wrapper.find('.stage-wrap').element
    Object.defineProperty(wrap, 'clientWidth', { value: 480, configurable: true })
    wrapper.vm.remeasure()
    await wrapper.vm.$nextTick()

    // 480 / 1920 = 0.25
    expect(wrapper.find('.wp').attributes('data-scale')).toBe('0.25')
  })

  it('무대에 고정 폭을 박지 않는다', () => {
    // 고정 폭이면 좁은 창에서 왼쪽 목록 위로 넘친다.
    const wrapper = mountPreview([item('notice', 10)])
    expect(wrapper.find('.stage-wrap').attributes('style')).toBeUndefined()
  })

  it('재기 전에도 화면이 사라지지 않는다', () => {
    // 아직 놓이지 않아 폭이 0 이면 배율도 0 이 되어 아무것도 안 보인다.
    const wrapper = mountPreview([item('notice', 10)])
    expect(Number(wrapper.find('.wp').attributes('data-scale'))).toBeGreaterThan(0)
  })
})

describe('전환 효과', () => {
  const stage = (wrapper) => wrapper.find('.stage')

  it('걸린 효과와 시간을 목록에 표시한다', () => {
    // 어느 칸에 무엇이 얼마나 걸렸는지 재생 중에도 보여야 한다.
    const wrapper = mountPreview([item('notice', 3, 'fade'), item('meal', 3)])
    expect(wrapper.findAll('.slot-fx').map((n) => n.text())).toEqual(['페이드 600ms'])
  })

  it('효과가 없으면 제자리에 그대로 그린다', async () => {
    const wrapper = mountPreview([item('notice', 3), item('meal', 3)])
    await advance(wrapper, 3)
    expect(stage(wrapper).classes()).not.toContain('entering')
  })

  it('넘어올 때 시작 모습에 놓았다가 제자리로 보낸다', async () => {
    // 처음부터 제자리에 그리면 브라우저가 사이를 채울 것이 없어 아무 일도
    // 일어나지 않는다.
    const raf = vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation(() => 0)
    const wrapper = mountPreview([item('notice', 3), item('meal', 3, 'fade')])
    await advance(wrapper, 3)

    expect(stage(wrapper).classes()).toContain('entering')
    expect(stage(wrapper).attributes('style')).toContain('opacity: 0')
    raf.mockRestore()
  })

  it('다음 프레임에 제자리로 온다', async () => {
    const wrapper = mountPreview([item('notice', 3), item('meal', 3, 'fade')])
    await advance(wrapper, 3)
    // 한 프레임(약 16ms) 뒤에 제자리로 보낸다. 그 사이를 브라우저가 채운다.
    vi.advanceTimersByTime(16)
    await wrapper.vm.$nextTick()

    expect(stage(wrapper).classes()).not.toContain('entering')
    expect(stage(wrapper).attributes('style')).toContain('opacity: 1')
  })

  it('미는 효과는 화면 밖에서 들어온다', async () => {
    const raf = vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation(() => 0)
    const wrapper = mountPreview([item('notice', 3), item('meal', 3, 'slide-left')])
    await advance(wrapper, 3)

    expect(stage(wrapper).attributes('style')).toContain('translateX(100%)')
    raf.mockRestore()
  })

  it('손으로 넘길 때도 효과를 준다', async () => {
    // 효과를 고르는 목적이 어떻게 보이는지 확인하는 것이다.
    const raf = vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation(() => 0)
    const wrapper = mountPreview([item('notice', 3), item('meal', 3, 'zoom')])
    await wrapper.findAll('.controls .btn')[2].trigger('click') // ›

    expect(stage(wrapper).classes()).toContain('entering')
    raf.mockRestore()
  })

  it('모르는 이름은 없음으로 떨어뜨린다', async () => {
    // 효과가 사라져도 빈 화면이 나가면 안 된다.
    const raf = vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation(() => 0)
    const wrapper = mountPreview([item('notice', 3), item('meal', 3, '사라진효과')])
    await advance(wrapper, 3)

    expect(stage(wrapper).classes()).not.toContain('entering')
    expect(wrapper.findAll('.slot-fx')).toHaveLength(0)
    raf.mockRestore()
  })

  it('디졸브는 앞 화면을 겹쳐 그린다', async () => {
    // 앞 화면이 사라지면서 뒤 화면이 드러나는 것이 디졸브의 전부다. 들어오는
    // 쪽만 그리면 페이드와 구별되지 않는다.
    const raf = vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation(() => 0)
    const wrapper = mountPreview([item('notice', 3), item('meal', 3, 'dissolve')])
    await advance(wrapper, 3)

    expect(wrapper.find('.stage-out').exists()).toBe(true)
    raf.mockRestore()
  })

  it('겹쳐 놓은 앞 화면은 앞 칸의 위젯이다', async () => {
    const raf = vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation(() => 0)
    const wrapper = mountPreview([item('notice', 3), item('meal', 3, 'dissolve')])
    await advance(wrapper, 3)

    // 위가 들어오는 화면, 아래가 앞 화면이다.
    expect(wrapper.findAll('.wp').map((w) => w.text())).toEqual(['meal', 'notice'])
    raf.mockRestore()
  })

  it('앞 화면은 제자리에서 사라진다', async () => {
    // 시작은 제자리이고 전환 시간에 걸쳐 투명해진다.
    const wrapper = mountPreview([item('notice', 3), item('meal', 3, 'dissolve')])
    await advance(wrapper, 3)
    vi.advanceTimersByTime(16)
    await wrapper.vm.$nextTick()

    expect(wrapper.find('.stage-out').attributes('style')).toContain('opacity: 0')
  })

  it('전환이 끝나면 앞 화면을 치운다', async () => {
    // 남겨 두면 살아 있는 위젯이 두 벌 계속 돌아간다.
    const wrapper = mountPreview([item('notice', 3), item('meal', 3, 'dissolve', 600)])
    await advance(wrapper, 3)
    expect(wrapper.find('.stage-out').exists()).toBe(true)

    await advance(wrapper, 1)
    expect(wrapper.find('.stage-out').exists()).toBe(false)
  })

  it('겹치지 않는 효과는 앞 화면을 남기지 않는다', async () => {
    const raf = vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation(() => 0)
    const wrapper = mountPreview([item('notice', 3), item('meal', 3, 'fade')])
    await advance(wrapper, 3)

    expect(wrapper.find('.stage-out').exists()).toBe(false)
    raf.mockRestore()
  })

  it('손으로 넘길 때도 겹쳐 준다', async () => {
    const raf = vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation(() => 0)
    const wrapper = mountPreview([item('notice', 3), item('meal', 3, 'dissolve')])
    await wrapper.findAll('.controls .btn')[2].trigger('click') // ›

    expect(wrapper.find('.stage-out').exists()).toBe(true)
    raf.mockRestore()
  })

  it('연달아 넘어가면 앞 화면이 쌓이지 않는다', async () => {
    // 매번 새로 깔고 앞의 것은 걷어낸다.
    const wrapper = mountPreview([
      item('notice', 3),
      item('meal', 3, 'dissolve', 2000),
      item('clock', 3, 'dissolve', 2000),
    ])
    await advance(wrapper, 3)
    await advance(wrapper, 3)

    expect(wrapper.findAll('.stage-out')).toHaveLength(1)
    expect(wrapper.findAll('.wp').map((w) => w.text())).toEqual(['clock', 'meal'])
  })

  it('칸마다 정한 전환 시간을 쓴다', () => {
    // 사진은 느긋하게, 공지는 빠르게 — 내용에 따라 호흡이 다르다.
    const wrapper = mountPreview([item('notice', 3, 'fade', 1500)])
    expect(stage(wrapper).attributes('style')).toContain('1500ms')
  })

  it('넘어가면 그 칸의 전환 시간으로 바뀐다', async () => {
    const wrapper = mountPreview([item('notice', 3, 'fade', 300), item('meal', 3, 'zoom', 1200)])
    await advance(wrapper, 3)
    expect(stage(wrapper).attributes('style')).toContain('1200ms')
  })

  it('범위를 벗어난 시간은 끌어다 맞춘다', () => {
    // 저장된 값이 어떻든 미리보기는 쓸 수 있는 범위 안에서 돈다.
    const wrapper = mountPreview([item('notice', 30, 'fade', 99999)])
    expect(stage(wrapper).attributes('style')).toContain('5000ms')
  })

  it('닦기는 화면을 옮기지 않고 보이는 만큼만 넓힌다', async () => {
    // 글자가 많은 위젯이 밀기처럼 흔들려 보이지 않는다.
    const raf = vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation(() => 0)
    const wrapper = mountPreview([item('notice', 3), item('meal', 3, 'wipe-left')])
    await advance(wrapper, 3)

    expect(stage(wrapper).attributes('style')).toContain('inset(0 0 0 100%)')
    raf.mockRestore()
  })

  it('흐림은 초점이 맞아 들어온다', async () => {
    const raf = vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation(() => 0)
    const wrapper = mountPreview([item('notice', 3), item('meal', 3, 'blur')])
    await advance(wrapper, 3)

    expect(stage(wrapper).attributes('style')).toContain('blur(14px)')
    raf.mockRestore()
  })

  it('뒤집기는 모로 서서 들어온다', async () => {
    const raf = vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation(() => 0)
    const wrapper = mountPreview([item('notice', 3), item('meal', 3, 'flip')])
    await advance(wrapper, 3)

    expect(stage(wrapper).attributes('style')).toContain('rotateY(90deg)')
    raf.mockRestore()
  })
})

describe('손으로 넘기기', () => {
  it('멈추면 시간이 흐르지 않는다', async () => {
    // 한 항목을 들여다보려는 조작이다.
    const wrapper = mountPreview([item('notice', 3), item('meal', 3)])
    await playButton(wrapper).trigger('click')
    await advance(wrapper, 10)

    expect(activeSlot(wrapper)).toBe('공지사항')
  })

  it('다시 누르면 이어서 센다', async () => {
    const wrapper = mountPreview([item('notice', 10), item('meal', 3)])
    await advance(wrapper, 4)
    await playButton(wrapper).trigger('click') // 멈춤
    await playButton(wrapper).trigger('click') // 다시 재생

    // 남은 6초를 이어 센다. 처음부터 다시 세면 보던 자리를 잃는다.
    await advance(wrapper, 5)
    expect(activeSlot(wrapper)).toBe('공지사항')
    await advance(wrapper, 1)
    expect(activeSlot(wrapper)).toBe('급식메뉴')
  })

  it('다음으로 넘기면 재생이 멈춘다', async () => {
    const wrapper = mountPreview([item('notice', 3), item('meal', 3)])
    await wrapper.findAll('.controls .btn')[2].trigger('click') // ›
    expect(activeSlot(wrapper)).toBe('급식메뉴')

    await advance(wrapper, 10)
    expect(activeSlot(wrapper)).toBe('급식메뉴')
  })

  it('앞으로 넘기면 뒤에서부터 돈다', async () => {
    const wrapper = mountPreview([item('notice', 3), item('meal', 3)])
    await wrapper.findAll('.controls .btn')[0].trigger('click') // ‹
    expect(activeSlot(wrapper)).toBe('급식메뉴')
  })

  it('목록에서 골라 볼 수 있다', async () => {
    const wrapper = mountPreview([item('notice', 3), item('meal', 3), item('clock', 3)])
    await wrapper.findAll('.slot')[2].trigger('click')

    expect(activeSlot(wrapper)).toBe('시계')
    // 고른 자리에 머문다.
    await advance(wrapper, 10)
    expect(activeSlot(wrapper)).toBe('시계')
  })

  it('하나뿐이면 넘기기 버튼을 잠근다', () => {
    const wrapper = mountPreview([item('notice', 3)])
    const buttons = wrapper.findAll('.controls .btn')
    expect(buttons[0].attributes('disabled')).toBeDefined()
    expect(buttons[2].attributes('disabled')).toBeDefined()
  })
})

describe('뒷정리', () => {
  it('닫으면 타이머를 멈춘다', async () => {
    // 남겨 두면 화면을 나가도 계속 돌면서 배터리를 먹는다.
    const clear = vi.spyOn(globalThis, 'clearInterval')
    const wrapper = mountPreview([item('notice', 3)])
    wrapper.unmount()

    expect(clear).toHaveBeenCalled()
    clear.mockRestore()
  })

  it('항목이 지워져 자리가 비면 처음으로 되돌린다', async () => {
    // 편집기에서 보던 항목을 빼면 미리보기가 빈 자리를 가리키게 된다.
    const wrapper = mountPreview([item('notice', 3), item('meal', 3)])
    await wrapper.findAll('.slot')[1].trigger('click')
    expect(activeSlot(wrapper)).toBe('급식메뉴')

    await wrapper.setProps({ items: [item('notice', 3)] })
    expect(activeSlot(wrapper)).toBe('공지사항')
  })

  it('자리가 남아 있으면 보던 항목을 지킨다', async () => {
    const wrapper = mountPreview([item('notice', 3), item('meal', 3), item('clock', 3)])
    await wrapper.findAll('.slot')[1].trigger('click')

    await wrapper.setProps({ items: [item('notice', 3), item('meal', 3)] })
    expect(activeSlot(wrapper)).toBe('급식메뉴')
  })
})
