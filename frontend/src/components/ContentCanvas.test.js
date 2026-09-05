/**
 * 캔버스 편집기 렌더링 테스트.
 *
 * 화면 채우기, 분할 영역, 격자, 스냅, 영역 전체 채우기가 실제로 그려지고
 * 동작하는지 마운트해서 확인한다.
 */
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { reactive } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// 이미지 검색 창이 서버 상태를 물어본다. 캔버스 테스트가 네트워크에 기대지 않도록 막는다.
let PLAYLISTS = []

const post = vi.fn(async (path, body) => ({ id: 9, name: body.name, items: [], total_duration_sec: 0 }))

vi.mock('@/api/client', () => ({
  api: {
    get: vi.fn(async (path) => {
      if (path === '/stock/status') return { configured: true, provider: 'pixabay' }
      if (path === '/images/search') return { items: [], total: 0, page: 1, per_page: 24 }
      if (path === '/playlists') {
        return { items: PLAYLISTS, total: PLAYLISTS.length, page: 1, size: 100 }
      }
      return {}
    }),
    post: (...args) => post(...args),
  },
  TEST_MODE: false,
}))

import { i18n } from '@/i18n'
import ContentCanvas from './ContentCanvas.vue'
import { useSettingsStore } from '@/stores/settings'

const STAGE = { width: 960, height: 540 }

function makeDocument(overrides = {}) {
  return {
    version: 1,
    layout: { width: 1920, height: 1080, background: '#000000', ...(overrides.layout ?? {}) },
    elements: overrides.elements ?? [],
  }
}

function mountCanvas(document, props = {}) {
  const pinia = createPinia()
  setActivePinia(pinia)

  const wrapper = mount(ContentCanvas, {
    props: { document, widgets: [], ...props },
    global: {
      plugins: [pinia, i18n],
      // 재생목록 편집기로 가는 링크가 있다. 앱에는 라우터가 있지만 여기엔 없다.
      stubs: { RouterLink: { props: ['to'], template: '<a :href="to"><slot /></a>' } },
    },
    attachTo: window.document.body,
  })

  // jsdom 은 레이아웃을 계산하지 않으므로 무대 크기를 직접 주입한다.
  // 배율은 여백을 뺀 안쪽 상자(.stage-inner)를 기준으로 정해진다.
  const stage = wrapper.find('.stage-inner').element
  Object.defineProperty(stage, 'clientWidth', { value: STAGE.width, configurable: true })
  Object.defineProperty(stage, 'clientHeight', { value: STAGE.height, configurable: true })
  window.dispatchEvent(new Event('resize'))
  return wrapper
}

beforeEach(() => {
  localStorage.clear()
  i18n.global.locale.value = 'ko'
  PLAYLISTS = [
    {
      id: 1,
      name: '현관 순환',
      total_duration_sec: 25,
      items: [
        { id: 1, widget_key: 'notice', duration_sec: 15, options: {} },
        { id: 2, widget_key: 'clock', duration_sec: 10, options: {} },
      ],
    },
  ]
  post.mockClear()
  // jsdom 에는 ResizeObserver 가 없다. 컴포넌트는 resize 이벤트로 폴백한다.
  delete window.ResizeObserver
  window.matchMedia = vi.fn().mockImplementation((query) => ({
    matches: false,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }))
})

describe('화면 채우기', () => {
  it('무대 크기에 맞춰 캔버스 배율을 정한다', async () => {
    const wrapper = mountCanvas(makeDocument())
    await flushPromises()

    // 1920×1080 을 960×540 무대에 넣으면 0.5 배 -> 960×540px
    const canvas = wrapper.find('.canvas')
    expect(canvas.attributes('style')).toContain('width: 960px')
    expect(canvas.attributes('style')).toContain('height: 540px')
  })

  it('배율을 화면에 알려 준다', async () => {
    const wrapper = mountCanvas(makeDocument())
    await flushPromises()
    expect(wrapper.find('.stage-bar').text()).toContain('50%')
  })

  it('세로형도 잘리지 않게 맞춘다', async () => {
    const wrapper = mountCanvas(makeDocument({ layout: { width: 1080, height: 1920 } }))
    await flushPromises()

    // 세로가 병목이므로 540/1920 배율. 폭은 1080 * 0.28125 = 303.75px
    const style = wrapper.find('.canvas').attributes('style')
    expect(style).toContain('height: 540px')
    expect(style).toContain('width: 303.75px')
  })
})

describe('화면 분할', () => {
  it('가로형에서는 2분할과 4분할을 제시한다', async () => {
    const wrapper = mountCanvas(makeDocument())
    await flushPromises()
    const labels = wrapper.findAll('.split-btn').map((b) => b.text())
    expect(labels).toEqual(['분할 없음', '좌우 2분할', '4분할 (2×2)'])
  })

  it('세로형에서는 2분할과 3분할을 제시한다', async () => {
    const wrapper = mountCanvas(makeDocument({ layout: { width: 1080, height: 1920 } }))
    await flushPromises()
    const labels = wrapper.findAll('.split-btn').map((b) => b.text())
    expect(labels).toEqual(['분할 없음', '상하 2분할', '상하 3분할'])
  })

  it('4분할을 고르면 영역 4개를 그린다', async () => {
    const document = makeDocument()
    const wrapper = mountCanvas(document)
    await flushPromises()

    await wrapper.findAll('.split-btn')[2].trigger('click')
    await flushPromises()

    expect(wrapper.findAll('.region')).toHaveLength(4)
    expect(document.layout.split).toMatchObject({ key: 'grid4', gap: 0 })
  })

  it('분할 없음으로 되돌리면 영역이 사라진다', async () => {
    const document = makeDocument()
    const wrapper = mountCanvas(document)
    await flushPromises()

    await wrapper.findAll('.split-btn')[1].trigger('click')
    await flushPromises()
    expect(wrapper.findAll('.region')).toHaveLength(2)

    await wrapper.findAll('.split-btn')[0].trigger('click')
    await flushPromises()
    expect(wrapper.findAll('.region')).toHaveLength(0)
    expect(document.layout.split).toBeNull()
  })

  it('영역을 고른 뒤 요소를 추가하면 그 자리를 꽉 채운다', async () => {
    const document = makeDocument()
    const wrapper = mountCanvas(document)
    await flushPromises()

    await wrapper.findAll('.split-btn')[1].trigger('click') // 좌우 2분할
    await flushPromises()

    await wrapper.findAll('.region')[1].trigger('click') // 오른쪽 영역
    await flushPromises()

    await wrapper.findAll('.rail-btn')[0].trigger('click') // 레일의 첫 아이콘 = 텍스트
    await flushPromises()

    expect(document.elements).toHaveLength(1)
    expect(document.elements[0].rect).toMatchObject({ x: 960, y: 0, w: 960, h: 1080 })
    expect(document.elements[0].region).toBe(1)
  })

  it('요소가 없는 영역에만 추가 안내를 띄운다', async () => {
    const document = makeDocument({
      elements: [
        {
          id: 'a',
          type: 'text',
          region: 0,
          rect: { x: 0, y: 0, w: 960, h: 1080, z: 1 },
          options: {},
        },
      ],
    })
    const wrapper = mountCanvas(document)
    await flushPromises()

    await wrapper.findAll('.split-btn')[1].trigger('click')
    await flushPromises()

    // 빈 영역에만 '+ 여기에 추가' 안내가 붙는다(영역 배경도 함께 밝아진다).
    expect(wrapper.findAll('.region-add')).toHaveLength(1)
  })

  it('세로형으로 바꾸면 쓸 수 없게 된 분할을 해제한다', async () => {
    const document = makeDocument()
    const wrapper = mountCanvas(document)
    await flushPromises()

    await wrapper.findAll('.split-btn')[2].trigger('click') // 가로 전용 4분할
    await flushPromises()
    expect(document.layout.split.key).toBe('grid4')

    // 팔레트의 '세로' 버튼
    await wrapper.findAll('.palette-group .btn')[1].trigger('click')
    await flushPromises()

    expect(document.layout.split).toBeNull()
    expect(wrapper.findAll('.region')).toHaveLength(0)
  })
})

describe('격자', () => {
  it('기본으로 격자를 그린다', async () => {
    const wrapper = mountCanvas(makeDocument())
    await flushPromises()
    expect(wrapper.find('.grid-overlay').exists()).toBe(true)
  })

  it('어두운 캔버스 배경에서는 밝은 격자를 그린다', async () => {
    const wrapper = mountCanvas(makeDocument({ layout: { background: '#0f172a' } }))
    await flushPromises()
    expect(wrapper.find('.grid-overlay').attributes('style')).toContain('255, 255, 255')
  })

  it('밝은 캔버스 배경에서는 어두운 격자를 그린다', async () => {
    // 라이트 테마에서 격자가 안 보이던 원인이 여기였다. 색은 앱 테마가 아니라
    // 캔버스 배경에서 뽑아야 어떤 조합에서도 보인다.
    const wrapper = mountCanvas(makeDocument({ layout: { background: '#ffffff' } }))
    await flushPromises()
    expect(wrapper.find('.grid-overlay').attributes('style')).toContain('15, 23, 42')
  })

  it('앱 테마를 다크로 바꿔도 격자 색은 캔버스 배경을 따른다', async () => {
    const wrapper = mountCanvas(makeDocument({ layout: { background: '#ffffff' } }))
    await flushPromises()

    useSettingsStore().setTheme('dark')
    await flushPromises()

    // 흰 캔버스 위에서는 여전히 어두운 격자여야 보인다.
    expect(wrapper.find('.grid-overlay').attributes('style')).toContain('15, 23, 42')
  })

  it('끄면 사라지고 설정이 저장된다', async () => {
    const wrapper = mountCanvas(makeDocument())
    await flushPromises()

    const checkbox = wrapper.findAll('.stage-bar input[type="checkbox"]')[0]
    await checkbox.setValue(false)
    await flushPromises()

    expect(wrapper.find('.grid-overlay').exists()).toBe(false)
    expect(localStorage.getItem('signallink.grid.show')).toBe('false')
  })

  it('배율이 낮아 격자가 뭉개지면 그리지 않는다', async () => {
    // 4K 문서를 작은 무대에 넣으면 40px 격자가 화면에서 5px 미만이 된다.
    const wrapper = mountCanvas(makeDocument({ layout: { width: 7680, height: 4320 } }))
    await flushPromises()
    expect(wrapper.find('.grid-overlay').exists()).toBe(false)
  })

  it('격자 크기를 바꿀 수 있다', async () => {
    const wrapper = mountCanvas(makeDocument())
    await flushPromises()

    await wrapper.find('.stage-bar .grid-size').setValue('80')
    await flushPromises()

    expect(useSettingsStore().gridSize).toBe(80)
    expect(localStorage.getItem('signallink.grid.size')).toBe('80')
  })
})

describe('격자에 붙이기', () => {
  const element = () => ({
    id: 'a',
    type: 'text',
    rect: { x: 100, y: 100, w: 400, h: 200, z: 1 },
    options: { text: 'hi' },
    opacity: 1,
  })

  async function dragBy(wrapper, dx, dy) {
    await wrapper.find('.element').trigger('mousedown', { clientX: 0, clientY: 0 })
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: dx, clientY: dy }))
    window.dispatchEvent(new MouseEvent('mouseup'))
    await flushPromises()
  }

  it('드래그가 격자에 맞춰 떨어진다', async () => {
    const document = makeDocument({ elements: [element()] })
    const wrapper = mountCanvas(document)
    await flushPromises()

    // 화면 11px = 캔버스 22px. 100 + 22 = 122 -> 40 격자에서 120 으로 붙는다.
    await dragBy(wrapper, 11, 11)
    expect(document.elements[0].rect.x).toBe(120)
    expect(document.elements[0].rect.y).toBe(120)
  })

  it('스냅을 끄면 정확한 위치로 움직인다', async () => {
    const document = makeDocument({ elements: [element()] })
    const wrapper = mountCanvas(document)
    await flushPromises()

    await wrapper.findAll('.stage-bar input[type="checkbox"]')[1].setValue(false)
    await flushPromises()

    await dragBy(wrapper, 11, 11)
    expect(document.elements[0].rect.x).toBe(122)
  })

  it('손으로 옮긴 요소는 영역 묶음이 풀린다', async () => {
    // 묶음이 남아 있으면 분할을 바꿀 때 옮긴 위치가 되돌아가 버린다.
    const bound = { ...element(), region: 0 }
    const document = makeDocument({ elements: [bound] })
    const wrapper = mountCanvas(document)
    await flushPromises()

    await dragBy(wrapper, 40, 40)
    expect(document.elements[0].region).toBeUndefined()
  })
})

describe('영역 전체 채우기', () => {
  it('선택한 위젯을 지금 놓인 영역에 꽉 채운다', async () => {
    const document = makeDocument({
      elements: [
        {
          id: 'w1',
          type: 'widget',
          widget_key: 'clock',
          rect: { x: 1200, y: 700, w: 300, h: 200, z: 1 },
          options: {},
          opacity: 1,
        },
      ],
    })
    const wrapper = mountCanvas(document)
    await flushPromises()

    await wrapper.findAll('.split-btn')[2].trigger('click') // 4분할
    await flushPromises()

    await wrapper.find('.element').trigger('mousedown', { clientX: 0, clientY: 0 })
    window.dispatchEvent(new MouseEvent('mouseup'))
    await flushPromises()

    const fillButton = wrapper
      .findAll('.element-section .btn')
      .find((b) => b.text() === '영역 전체 채우기')
    await fillButton.trigger('click')
    await flushPromises()

    // 중심(1350, 800)은 오른쪽 아래 영역이다.
    expect(document.elements[0].rect).toMatchObject({ x: 960, y: 540, w: 960, h: 540 })
    expect(document.elements[0].region).toBe(3)
  })

  it('분할이 없으면 화면 가득 채우기로 바뀐다', async () => {
    const document = makeDocument({
      elements: [
        { id: 'w1', type: 'text', rect: { x: 0, y: 0, w: 100, h: 100, z: 1 }, options: {}, opacity: 1 },
      ],
    })
    const wrapper = mountCanvas(document)
    await flushPromises()

    await wrapper.find('.element').trigger('mousedown', { clientX: 0, clientY: 0 })
    window.dispatchEvent(new MouseEvent('mouseup'))
    await flushPromises()

    expect(wrapper.find('.fill-btn').text()).toBe('화면 가득 채우기')
    expect(wrapper.text()).not.toContain('영역 전체 채우기')
  })
})


describe('분할 크기 조절', () => {
  it('좌우 2분할에는 세로 분할선이 하나 생긴다', async () => {
    const wrapper = mountCanvas(makeDocument())
    await flushPromises()

    await wrapper.findAll('.split-btn')[1].trigger('click')
    await flushPromises()

    const dividers = wrapper.findAll('.divider')
    expect(dividers).toHaveLength(1)
    expect(dividers[0].classes()).toContain('vertical')
  })

  it('2×2 격자는 세로선과 가로선이 하나씩 생긴다', async () => {
    const wrapper = mountCanvas(makeDocument())
    await flushPromises()

    await wrapper.findAll('.split-btn')[2].trigger('click')
    await flushPromises()

    const dividers = wrapper.findAll('.divider')
    expect(dividers.map((d) => (d.classes().includes('vertical') ? 'x' : 'y'))).toEqual(['x', 'y'])
  })

  it('분할선을 끌면 영역 크기가 바뀐다', async () => {
    const document = makeDocument()
    const wrapper = mountCanvas(document)
    await flushPromises()

    await wrapper.findAll('.split-btn')[1].trigger('click')
    await flushPromises()

    // 화면 96px 이동 = 캔버스 192px = 폭의 10%
    await wrapper.find('.divider').trigger('mousedown', { clientX: 0, clientY: 0 })
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: 96, clientY: 0 }))
    window.dispatchEvent(new MouseEvent('mouseup'))
    await flushPromises()

    expect(document.layout.split.cols[0]).toBeCloseTo(0.6, 5)
    expect(document.layout.split.cols[1]).toBeCloseTo(0.4, 5)
  })

  it('크기를 바꾸면 영역에 묶인 요소도 따라온다', async () => {
    const document = makeDocument()
    const wrapper = mountCanvas(document)
    await flushPromises()

    await wrapper.findAll('.split-btn')[1].trigger('click')
    await flushPromises()
    await wrapper.findAll('.region')[0].trigger('click')
    await flushPromises()
    await wrapper.findAll('.rail-btn')[0].trigger('click') // 왼쪽 영역을 채우는 텍스트
    await flushPromises()
    expect(document.elements[0].rect.w).toBe(960)

    await wrapper.find('.divider').trigger('mousedown', { clientX: 0, clientY: 0 })
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: 96, clientY: 0 }))
    window.dispatchEvent(new MouseEvent('mouseup'))
    await flushPromises()

    expect(document.elements[0].rect.w).toBe(1152)
  })

  it('퍼센트를 직접 입력해도 바뀐다', async () => {
    const document = makeDocument()
    const wrapper = mountCanvas(document)
    await flushPromises()

    await wrapper.findAll('.split-btn')[1].trigger('click')
    await flushPromises()

    await wrapper.findAll('.size-input .input')[0].setValue('70')
    await wrapper.findAll('.size-input .input')[0].trigger('change')
    await flushPromises()

    expect(document.layout.split.cols[0]).toBeCloseTo(0.7, 5)
    expect(document.layout.split.cols[1]).toBeCloseTo(0.3, 5)
  })

  it("'균등' 을 누르면 원래대로 돌아온다", async () => {
    const document = makeDocument()
    const wrapper = mountCanvas(document)
    await flushPromises()

    await wrapper.findAll('.split-btn')[1].trigger('click')
    await flushPromises()
    await wrapper.findAll('.size-input .input')[0].setValue('70')
    await wrapper.findAll('.size-input .input')[0].trigger('change')
    await flushPromises()

    const resetButton = wrapper.findAll('.size-head .btn')[0]
    await resetButton.trigger('click')
    await flushPromises()

    expect(document.layout.split.cols).toBeNull()
    expect(wrapper.findAll('.region')[0].attributes('style')).toContain('width: 480px')
  })

  it('다른 분할로 바꾸면 비율은 균등으로 되돌아간다', async () => {
    // 칸 수가 달라져 이전 비율을 그대로 쓸 수 없다.
    const document = makeDocument()
    const wrapper = mountCanvas(document)
    await flushPromises()

    await wrapper.findAll('.split-btn')[1].trigger('click')
    await flushPromises()
    await wrapper.findAll('.size-input .input')[0].setValue('70')
    await wrapper.findAll('.size-input .input')[0].trigger('change')
    await flushPromises()

    await wrapper.findAll('.split-btn')[2].trigger('click')
    await flushPromises()

    expect(document.layout.split.key).toBe('grid4')
    expect(document.layout.split.cols).toBeNull()
  })

  it('분할이 없으면 분할선도 없다', async () => {
    const wrapper = mountCanvas(makeDocument())
    await flushPromises()
    expect(wrapper.findAll('.divider')).toHaveLength(0)
  })

  it('영역 이름표에 실제 크기를 함께 보여 준다', async () => {
    const wrapper = mountCanvas(makeDocument())
    await flushPromises()

    await wrapper.findAll('.split-btn')[1].trigger('click')
    await flushPromises()

    expect(wrapper.find('.region-tag').text()).toContain('960×1080')
  })
})

/** 요소 몇 개가 놓인 문서. */
function docWithElements() {
  return makeDocument({
    elements: [
      { id: 'a', type: 'text', rect: { x: 0, y: 0, w: 400, h: 200, z: 1 }, options: { text: '뒤쪽' }, opacity: 1 },
      { id: 'b', type: 'widget', widget_key: 'clock', rect: { x: 100, y: 100, w: 400, h: 200, z: 2 }, options: {}, opacity: 1 },
      { id: 'c', type: 'text', rect: { x: 200, y: 200, w: 400, h: 200, z: 3 }, options: { text: '앞쪽' }, opacity: 1 },
    ],
  })
}

const WIDGETS = [
  { key: 'clock', name: '시계', category: '기능형', description: '현재 시각', default_size: { w: 400, h: 200 }, options: [] },
]

describe('패널 구성', () => {
  it('캔버스 / 레이어 / 요소 세 단으로 나뉜다', async () => {
    const wrapper = mountCanvas(makeDocument())
    await flushPromises()

    expect(wrapper.find('.canvas-section').exists()).toBe(true)
    expect(wrapper.find('.layer-section').exists()).toBe(true)
    expect(wrapper.find('.element-section').exists()).toBe(true)
  })

  it('캔버스 단에 분할과 요소 추가가 함께 있다', async () => {
    const wrapper = mountCanvas(makeDocument())
    await flushPromises()

    // 요소 추가는 왼쪽 레일로 옮겼고, 캔버스 단에는 화면 설정만 남는다.
    const canvasSection = wrapper.find('.canvas-section')
    expect(canvasSection.findAll('.split-btn').length).toBeGreaterThan(0)
    expect(canvasSection.findAll('.chip')).toHaveLength(0)
    expect(wrapper.find('.rail').exists()).toBe(true)
  })

  it('선택하지 않아도 캔버스 명령이 계속 보인다', async () => {
    // 예전에는 요소를 고르면 팔레트가 사라져 분할을 바꾸려면 선택을 풀어야 했다.
    const wrapper = mountCanvas(docWithElements())
    await flushPromises()

    await wrapper.findAll('.element')[0].trigger('mousedown', { clientX: 0, clientY: 0 })
    window.dispatchEvent(new MouseEvent('mouseup'))
    await flushPromises()

    expect(wrapper.findAll('.split-btn').length).toBeGreaterThan(0)
    expect(wrapper.find('.element-section .field').exists()).toBe(true)
  })

  it('선택 전에는 요소 단이 안내를 보여 준다', async () => {
    const wrapper = mountCanvas(docWithElements())
    await flushPromises()
    expect(wrapper.find('.element-section').text()).toContain('요소를 선택하세요')
  })
})

describe('레이어 목록', () => {
  it('앞에 있는 요소가 위에 온다', async () => {
    const wrapper = mountCanvas(docWithElements(), { widgets: WIDGETS })
    await flushPromises()

    const names = wrapper.findAll('.layer-name').map((n) => n.text())
    expect(names).toEqual(['앞쪽', '시계', '뒤쪽'])
  })

  it('레이어 수를 보여 준다', async () => {
    const wrapper = mountCanvas(docWithElements())
    await flushPromises()
    expect(wrapper.find('.layer-section .count').text()).toBe('3')
  })

  it('레이어를 누르면 그 요소가 선택된다', async () => {
    const wrapper = mountCanvas(docWithElements(), { widgets: WIDGETS })
    await flushPromises()

    await wrapper.findAll('.layer')[1].trigger('click')
    await flushPromises()

    expect(wrapper.findAll('.layer')[1].classes()).toContain('active')
    expect(wrapper.find('.element-section').text()).toContain('시계')
  })

  it('요소가 없으면 안내한다', async () => {
    const wrapper = mountCanvas(makeDocument())
    await flushPromises()
    expect(wrapper.find('.layer-section').text()).toContain('아직 요소가 없습니다')
  })
})

describe('레이어 표시와 잠금', () => {
  it('숨기면 캔버스에서 사라진다', async () => {
    const document = docWithElements()
    const wrapper = mountCanvas(document)
    await flushPromises()
    expect(wrapper.findAll('.element')).toHaveLength(3)

    // 첫 레이어(앞쪽)의 눈 버튼
    await wrapper.findAll('.layer')[0].findAll('.icon-btn')[0].trigger('click')
    await flushPromises()

    expect(wrapper.findAll('.element')).toHaveLength(2)
    expect(document.elements.find((e) => e.id === 'c').visible).toBe(false)
  })

  it('숨긴 레이어는 목록에 남아 다시 켤 수 있다', async () => {
    const wrapper = mountCanvas(docWithElements())
    await flushPromises()

    const eye = () => wrapper.findAll('.layer')[0].findAll('.icon-btn')[0]
    await eye().trigger('click')
    await flushPromises()
    expect(wrapper.findAll('.layer')[0].classes()).toContain('hidden')

    await eye().trigger('click')
    await flushPromises()
    expect(wrapper.findAll('.element')).toHaveLength(3)
  })

  it('잠근 요소는 끌어도 움직이지 않는다', async () => {
    const document = docWithElements()
    const wrapper = mountCanvas(document)
    await flushPromises()

    // 첫 레이어(앞쪽 = id c)의 자물쇠
    await wrapper.findAll('.layer')[0].findAll('.icon-btn')[1].trigger('click')
    await flushPromises()

    const target = document.elements.find((e) => e.id === 'c')
    const before = { ...target.rect }

    const locked = wrapper.findAll('.element').find((el) => el.classes().includes('locked'))
    await locked.trigger('mousedown', { clientX: 0, clientY: 0 })
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: 100, clientY: 100 }))
    window.dispatchEvent(new MouseEvent('mouseup'))
    await flushPromises()

    expect(target.rect).toEqual(before)
  })

  it('잠금은 표출에 영향이 없다', async () => {
    const document = docWithElements()
    const wrapper = mountCanvas(document)
    await flushPromises()

    await wrapper.findAll('.layer')[0].findAll('.icon-btn')[1].trigger('click')
    await flushPromises()

    // 여전히 캔버스에 그려진다.
    expect(wrapper.findAll('.element')).toHaveLength(3)
  })
})

describe('레이어 순서 바꾸기', () => {
  it('한 칸 앞으로 옮긴다', async () => {
    const wrapper = mountCanvas(docWithElements(), { widgets: WIDGETS })
    await flushPromises()

    // 맨 아래(뒤쪽)를 한 칸 위로
    const actions = wrapper.findAll('.layer')[2].findAll('.layer-actions .icon-btn')
    await actions[0].trigger('click')
    await flushPromises()

    expect(wrapper.findAll('.layer-name').map((n) => n.text())).toEqual(['앞쪽', '뒤쪽', '시계'])
  })

  it('맨 위에서는 더 앞으로 보낼 수 없다', async () => {
    const wrapper = mountCanvas(docWithElements())
    await flushPromises()

    const up = wrapper.findAll('.layer')[0].findAll('.layer-actions .icon-btn')[0]
    expect(up.attributes('disabled')).toBeDefined()
  })

  it('맨 앞 / 맨 뒤 버튼이 동작한다', async () => {
    const wrapper = mountCanvas(docWithElements(), { widgets: WIDGETS })
    await flushPromises()

    await wrapper.findAll('.layer')[2].trigger('click') // 뒤쪽 선택
    await flushPromises()

    const toFront = wrapper
      .findAll('.element-section .btn')
      .find((b) => b.text() === '맨 앞으로')
    await toFront.trigger('click')
    await flushPromises()

    expect(wrapper.findAll('.layer-name')[0].text()).toBe('뒤쪽')
  })

  it('레이어를 끌어 순서를 바꾼다', async () => {
    const wrapper = mountCanvas(docWithElements(), { widgets: WIDGETS })
    await flushPromises()

    const dnd = {
      dataTransfer: { types: ['text/plain'], getData: () => '2', setData: () => {}, dropEffect: '', effectAllowed: '' },
      preventDefault: () => {},
    }
    await wrapper.findAll('.layer')[2].trigger('dragstart', dnd)
    await wrapper.findAll('.layer')[0].trigger('drop', dnd)
    await flushPromises()

    expect(wrapper.findAll('.layer-name').map((n) => n.text())).toEqual(['뒤쪽', '앞쪽', '시계'])
  })

  it('겹침 순서가 1..n 으로 정리된다', async () => {
    // 손으로 넣은 z 가 겹쳐 있어도 목록 순서와 화면 순서가 어긋나지 않아야 한다.
    const document = makeDocument({
      elements: [
        { id: 'a', type: 'text', rect: { x: 0, y: 0, w: 10, h: 10, z: 5 }, options: {}, opacity: 1 },
        { id: 'b', type: 'text', rect: { x: 0, y: 0, w: 10, h: 10, z: 5 }, options: {}, opacity: 1 },
      ],
    })
    const wrapper = mountCanvas(document)
    await flushPromises()

    await wrapper.findAll('.layer')[1].findAll('.layer-actions .icon-btn')[0].trigger('click')
    await flushPromises()

    expect(document.elements.map((e) => e.rect.z).sort()).toEqual([1, 2])
  })
})

describe('레일에서 캔버스로 끌어 놓기', () => {
  /** 레일 드래그를 흉내 낸다. */
  function elementDrag(payload, clientX, clientY) {
    return {
      dataTransfer: {
        types: ['application/x-signallink-element'],
        getData: () => JSON.stringify(payload),
        dropEffect: '',
      },
      preventDefault: () => {},
      clientX,
      clientY,
    }
  }

  it('떨어뜨린 자리를 가운데로 요소를 만든다', async () => {
    const document = makeDocument()
    const wrapper = mountCanvas(document)
    await flushPromises()

    // 무대 배율 0.5. 화면 (240, 135) -> 캔버스 (480, 270).
    await wrapper.find('.canvas').trigger('drop', elementDrag({ type: 'text' }, 240, 135))
    await flushPromises()

    expect(document.elements).toHaveLength(1)
    const rect = document.elements[0].rect
    expect(rect.x + rect.w / 2).toBe(480)
    expect(rect.y + rect.h / 2).toBe(270)
  })

  it('위젯도 기본 크기로 만들어진다', async () => {
    const document = makeDocument()
    const wrapper = mountCanvas(document, {
      widgets: [
        { key: 'clock', name: '시계', category: '기능형', description: '', default_size: { w: 400, h: 200 }, options: [] },
      ],
    })
    await flushPromises()

    await wrapper
      .find('.canvas')
      .trigger('drop', elementDrag({ type: 'widget', widgetKey: 'clock' }, 100, 100))
    await flushPromises()

    expect(document.elements[0]).toMatchObject({ type: 'widget', widget_key: 'clock' })
    expect(document.elements[0].rect).toMatchObject({ w: 400, h: 200 })
  })

  it('레일 드래그가 아니면 무시한다', async () => {
    const document = makeDocument()
    const wrapper = mountCanvas(document)
    await flushPromises()

    await wrapper.find('.canvas').trigger('drop', {
      dataTransfer: { types: ['Files'], getData: () => '' },
      preventDefault: () => {},
      clientX: 10,
      clientY: 10,
    })
    await flushPromises()

    expect(document.elements).toHaveLength(0)
  })

  it('누르면 화면 가운데에 만들어진다', async () => {
    // 끌지 않고 눌렀을 때의 자리는 예전과 같아야 한다.
    const document = makeDocument()
    const wrapper = mountCanvas(document)
    await flushPromises()

    await wrapper.findAll('.rail-btn')[0].trigger('click')
    await flushPromises()

    const rect = document.elements[0].rect
    expect(rect.x + rect.w / 2).toBe(960)
    expect(rect.y + rect.h / 2).toBe(540)
  })
})

describe('키보드로 삭제', () => {
  /** window 로 keydown 을 보낸다(컴포넌트가 거기에 붙어 있다). */
  function press(key, target = window.document.body) {
    const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })
    Object.defineProperty(event, 'target', { value: target, configurable: true })
    window.dispatchEvent(event)
  }

  async function selectFirst(wrapper) {
    await wrapper.findAll('.element')[0].trigger('mousedown', { clientX: 0, clientY: 0 })
    window.dispatchEvent(new MouseEvent('mouseup'))
    await flushPromises()
  }

  it('Delete 로 선택한 요소를 지운다', async () => {
    const document = docWithElements()
    const wrapper = mountCanvas(document)
    await flushPromises()

    await selectFirst(wrapper)
    press('Delete')
    await flushPromises()

    expect(document.elements).toHaveLength(2)
  })

  it('Backspace 로도 지운다', async () => {
    const document = docWithElements()
    const wrapper = mountCanvas(document)
    await flushPromises()

    await selectFirst(wrapper)
    press('Backspace')
    await flushPromises()

    expect(document.elements).toHaveLength(2)
  })

  it('선택한 것이 없으면 아무 일도 없다', async () => {
    const document = docWithElements()
    mountCanvas(document)
    await flushPromises()

    press('Delete')
    await flushPromises()

    expect(document.elements).toHaveLength(3)
  })

  it('입력 중에는 지우지 않는다', async () => {
    // 속성 패널에서 글자를 지우려던 것이 요소 삭제가 되면 안 된다.
    const document = docWithElements()
    const wrapper = mountCanvas(document)
    await flushPromises()
    await selectFirst(wrapper)

    const input = wrapper.find('.element-section input').element
    press('Backspace', input)
    await flushPromises()

    expect(document.elements).toHaveLength(3)
  })

  it('textarea 안에서도 지우지 않는다', async () => {
    const document = docWithElements()
    const wrapper = mountCanvas(document)
    await flushPromises()
    await selectFirst(wrapper)

    const textarea = wrapper.find('.element-section textarea')
    if (textarea.exists()) {
      press('Delete', textarea.element)
      await flushPromises()
      expect(document.elements).toHaveLength(3)
    }
  })

  it('잠근 요소는 지우지 않는다', async () => {
    const document = docWithElements()
    const wrapper = mountCanvas(document)
    await flushPromises()

    // 첫 레이어를 잠그고 선택한다.
    await wrapper.findAll('.layer')[0].findAll('.icon-btn')[1].trigger('click')
    await wrapper.findAll('.layer')[0].trigger('click')
    await flushPromises()

    press('Delete')
    await flushPromises()

    expect(document.elements).toHaveLength(3)
  })

  it('Esc 로 선택을 푼다', async () => {
    const wrapper = mountCanvas(docWithElements())
    await flushPromises()
    await selectFirst(wrapper)
    expect(wrapper.find('.element.selected').exists()).toBe(true)

    press('Escape')
    await flushPromises()

    expect(wrapper.find('.element.selected').exists()).toBe(false)
  })

  it('미리보기에서는 단축키가 동작하지 않는다', async () => {
    const document = docWithElements()
    mountCanvas(document, { readonly: true })
    await flushPromises()

    press('Delete')
    await flushPromises()

    expect(document.elements).toHaveLength(3)
  })
})

describe('캔버스 여백', () => {
  it('무대 바깥 상자와 측정용 안쪽 상자를 나눈다', async () => {
    // 여백을 준 바깥 상자를 재면 padding 이 clientWidth 에 포함돼 캔버스가 넘친다.
    const wrapper = mountCanvas(makeDocument())
    await flushPromises()

    expect(wrapper.find('.stage').exists()).toBe(true)
    expect(wrapper.find('.stage-inner').exists()).toBe(true)
    expect(wrapper.find('.stage .stage-inner .canvas').exists()).toBe(true)
  })
})

describe('줌', () => {
  it('기본은 화면 맞춤이다', async () => {
    const wrapper = mountCanvas(makeDocument())
    await flushPromises()

    // 1920×1080 을 960×540 에 맞추면 50%
    expect(wrapper.find('.zoom select').element.value).toBe('')
    expect(wrapper.find('.zoom select').text()).toContain('50%')
  })

  it('확대 버튼이 한 단계 올린다', async () => {
    const wrapper = mountCanvas(makeDocument())
    await flushPromises()

    await wrapper.findAll('.zoom .btn')[1].trigger('click') // +
    await flushPromises()

    // 맞춤 50% -> 다음 단계 75%
    expect(wrapper.find('.canvas').attributes('style')).toContain('width: 1440px')
  })

  it('축소 버튼이 한 단계 내린다', async () => {
    const wrapper = mountCanvas(makeDocument())
    await flushPromises()

    await wrapper.findAll('.zoom .btn')[0].trigger('click') // −
    await flushPromises()

    // 맞춤 50% -> 아래 단계 25%
    expect(wrapper.find('.canvas').attributes('style')).toContain('width: 480px')
  })

  it('배율을 직접 고를 수 있다', async () => {
    const wrapper = mountCanvas(makeDocument())
    await flushPromises()

    await wrapper.find('.zoom select').setValue('1')
    await flushPromises()

    expect(wrapper.find('.canvas').attributes('style')).toContain('width: 1920px')
  })

  it('화면 맞춤으로 되돌린다', async () => {
    const wrapper = mountCanvas(makeDocument())
    await flushPromises()

    await wrapper.find('.zoom select').setValue('1')
    await flushPromises()
    await wrapper.find('.zoom select').setValue('')
    await flushPromises()

    expect(wrapper.find('.canvas').attributes('style')).toContain('width: 960px')
  })

  it('Ctrl + 휠로 확대한다', async () => {
    const wrapper = mountCanvas(makeDocument())
    await flushPromises()

    // ctrlKey 는 읽기 전용이라 trigger 옵션으로 넣을 수 없다. 실제 이벤트를 만든다.
    wrapper
      .find('.stage')
      .element.dispatchEvent(new WheelEvent('wheel', { ctrlKey: true, deltaY: -100, bubbles: true }))
    await flushPromises()

    expect(wrapper.find('.canvas').attributes('style')).toContain('width: 1440px')
  })

  it('그냥 휠은 배율을 바꾸지 않는다', async () => {
    // 세로 스크롤을 하려던 것이 확대가 되면 안 된다.
    const wrapper = mountCanvas(makeDocument())
    await flushPromises()

    wrapper
      .find('.stage')
      .element.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, bubbles: true }))
    await flushPromises()

    expect(wrapper.find('.canvas').attributes('style')).toContain('width: 960px')
  })

  it('고정 배율은 창 크기가 바뀌어도 유지된다', async () => {
    // 편집 중에 배율이 저 혼자 바뀌면 보던 자리를 잃는다.
    const wrapper = mountCanvas(makeDocument())
    await flushPromises()

    await wrapper.find('.zoom select').setValue('1')
    await flushPromises()

    const stage = wrapper.find('.stage-inner').element
    Object.defineProperty(stage, 'clientWidth', { value: 480, configurable: true })
    Object.defineProperty(stage, 'clientHeight', { value: 270, configurable: true })
    window.dispatchEvent(new Event('resize'))
    await flushPromises()

    expect(wrapper.find('.canvas').attributes('style')).toContain('width: 1920px')
  })

  it('미리보기에는 줌 컨트롤이 없다', async () => {
    const wrapper = mountCanvas(makeDocument(), { readonly: true })
    await flushPromises()
    expect(wrapper.find('.zoom').exists()).toBe(false)
  })
})


describe('분할 없이 화면 채우기', () => {
  function docWithOne(type = 'text', extra = {}) {
    return makeDocument({
      elements: [
        {
          id: 'e1',
          type,
          rect: { x: 300, y: 200, w: 400, h: 300, z: 1 },
          options: {},
          opacity: 1,
          ...extra,
        },
      ],
    })
  }

  async function select(wrapper) {
    await wrapper.find('.element').trigger('mousedown', { clientX: 0, clientY: 0 })
    window.dispatchEvent(new MouseEvent('mouseup'))
    await flushPromises()
  }

  it('분할이 없어도 채우기 버튼이 있다', async () => {
    const wrapper = mountCanvas(docWithOne())
    await flushPromises()
    await select(wrapper)

    expect(wrapper.find('.fill-btn').exists()).toBe(true)
  })

  it('누르면 캔버스 전체를 채운다', async () => {
    const document = docWithOne()
    const wrapper = mountCanvas(document)
    await flushPromises()
    await select(wrapper)

    await wrapper.find('.fill-btn').trigger('click')
    await flushPromises()

    expect(document.elements[0].rect).toMatchObject({ x: 0, y: 0, w: 1920, h: 1080 })
  })

  it('세로형에서도 전체를 채운다', async () => {
    const document = makeDocument({
      layout: { width: 1080, height: 1920 },
      elements: [
        { id: 'e1', type: 'text', rect: { x: 10, y: 10, w: 100, h: 100, z: 1 }, options: {}, opacity: 1 },
      ],
    })
    const wrapper = mountCanvas(document)
    await flushPromises()
    await select(wrapper)

    await wrapper.find('.fill-btn').trigger('click')
    await flushPromises()

    expect(document.elements[0].rect).toMatchObject({ w: 1080, h: 1920 })
  })

  it('분할이 없으면 영역에 묶지 않는다', async () => {
    // 묶어 두면 나중에 분할을 켰을 때 화면을 채워 둔 요소가 첫 칸으로 쪼그라든다.
    const document = docWithOne()
    const wrapper = mountCanvas(document)
    await flushPromises()
    await select(wrapper)

    await wrapper.find('.fill-btn').trigger('click')
    await flushPromises()

    expect(document.elements[0].region).toBeUndefined()
  })

  it('화면을 채운 뒤 분할을 켜도 크기가 유지된다', async () => {
    const document = docWithOne()
    const wrapper = mountCanvas(document)
    await flushPromises()
    await select(wrapper)

    await wrapper.find('.fill-btn').trigger('click')
    await flushPromises()

    // 팔레트로 돌아가 4분할을 적용한다.
    await wrapper.findAll('.split-btn')[2].trigger('click')
    await flushPromises()

    expect(document.elements[0].rect).toMatchObject({ w: 1920, h: 1080 })
  })

  it('분할이 있으면 영역 채우기로 바뀌고 영역 선택이 나온다', async () => {
    const wrapper = mountCanvas(docWithOne())
    await flushPromises()

    await wrapper.findAll('.split-btn')[1].trigger('click') // 좌우 2분할
    await flushPromises()
    await select(wrapper)

    expect(wrapper.find('.fill-btn').text()).toBe('영역 전체 채우기')
    expect(wrapper.find('.element-section select').exists()).toBe(true)
  })

  it('위젯도 화면을 가득 채울 수 있다', async () => {
    const document = docWithOne('widget', { widget_key: 'clock' })
    const wrapper = mountCanvas(document, {
      widgets: [
        { key: 'clock', name: '시계', category: '기능형', description: '', default_size: { w: 400, h: 200 }, options: [] },
      ],
    })
    await flushPromises()
    await select(wrapper)

    await wrapper.find('.fill-btn').trigger('click')
    await flushPromises()

    expect(document.elements[0].rect).toMatchObject({ x: 0, y: 0, w: 1920, h: 1080 })
  })
})

describe('웹페이지 미리보기', () => {
  function webDoc(src) {
    return makeDocument({
      elements: [
        {
          id: 'w1',
          type: 'web',
          src,
          rect: { x: 0, y: 0, w: 800, h: 600, z: 1 },
          options: {},
          opacity: 1,
        },
      ],
    })
  }

  it('주소가 있으면 그 페이지를 불러온다', async () => {
    const wrapper = mountCanvas(webDoc('https://example.com/notice'))
    await flushPromises()

    const frame = wrapper.find('.web-frame')
    expect(frame.exists()).toBe(true)
    expect(frame.attributes('src')).toBe('https://example.com/notice')
  })

  it('주소 표시줄에 주소를 보여 준다', async () => {
    const wrapper = mountCanvas(webDoc('https://example.com/notice'))
    await flushPromises()
    expect(wrapper.find('.web-url').text()).toBe('https://example.com/notice')
  })

  it('주소가 없으면 입력을 안내한다', async () => {
    const wrapper = mountCanvas(webDoc(null))
    await flushPromises()

    expect(wrapper.find('.web-frame').exists()).toBe(false)
    expect(wrapper.find('.web-empty').text()).toContain('주소를 입력하면')
    expect(wrapper.find('.web-url').text()).toBe('주소 없음')
  })

  it('sandbox 로 가둬 불러온다', async () => {
    // 주소는 사용자가 넣는 값이다. same-origin 을 주면 그 페이지가
    // 자기 저장소와 쿠키에 접근한다.
    const wrapper = mountCanvas(webDoc('https://example.com'))
    await flushPromises()

    const frame = wrapper.find('.web-frame')
    expect(frame.attributes('sandbox')).toBe('allow-scripts')
    expect(frame.attributes('referrerpolicy')).toBe('no-referrer')
  })

  it('안쪽은 문서 크기로 그리고 바깥에서 축소한다', async () => {
    // 작은 상자에 넣으면 모바일 레이아웃으로 그려져 실제 표출과 달라진다.
    const wrapper = mountCanvas(webDoc('https://example.com'))
    await flushPromises()

    const style = wrapper.find('.el-web').attributes('style')
    expect(style).toContain('width: 800px')
    expect(style).toContain('scale(0.5)')
  })

  it('더 이상 이름만 있는 자리표시자가 아니다', async () => {
    const wrapper = mountCanvas(webDoc('https://example.com'))
    await flushPromises()
    expect(wrapper.find('.el-placeholder').exists()).toBe(false)
  })

  it('주소를 바꾸면 미리보기도 따라간다', async () => {
    // 실제 화면은 문서를 반응형 상태로 들고 있다(ContentEditorView 의 ref).
    // 평범한 객체를 넘기면 바깥에서 고쳐도 다시 그리지 않는다.
    const document = reactive(webDoc('https://example.com'))
    const wrapper = mountCanvas(document)
    await flushPromises()

    document.elements[0].src = 'https://school.example.kr'
    await flushPromises()

    expect(wrapper.find('.web-frame').attributes('src')).toBe('https://school.example.kr')
  })
})


describe('동영상 요소', () => {
  function videoDocument(src = '/api/v1/assets/3/abcdef/file') {
    return makeDocument({
      elements: [
        {
          id: 'v1',
          type: 'video',
          rect: { x: 0, y: 0, w: 960, h: 540, z: 1 },
          opacity: 1,
          options: {},
          src,
        },
      ],
    })
  }

  it('영상을 그린다', async () => {
    // 분기가 없으면 회색 자리표시자만 남아 '안 보인다' 로 보인다.
    const wrapper = mountCanvas(videoDocument())
    await flushPromises()

    expect(wrapper.find('video.el-video').attributes('src')).toBe(
      '/api/v1/assets/3/abcdef/file',
    )
    expect(wrapper.find('.el-placeholder').exists()).toBe(false)
  })

  it('편집 중에는 돌리지 않는다', async () => {
    // 자리를 잡는 동안 영상이 돌면 눈이 그쪽으로 끌린다.
    const wrapper = mountCanvas(videoDocument())
    await flushPromises()

    expect(wrapper.find('video.el-video').attributes('autoplay')).toBeUndefined()
  })

  it('미리보기에서는 돌린다', async () => {
    const wrapper = mountCanvas(videoDocument(), { readonly: true })
    await flushPromises()

    const video = wrapper.find('video.el-video')
    expect(video.attributes('autoplay')).toBeDefined()
    expect(video.attributes('loop')).toBeDefined()
  })

  it('소리는 끈 채로 튼다', async () => {
    // 소리가 있는 자동재생은 브라우저가 막아, 켜 두면 아예 시작되지 않는다.
    const wrapper = mountCanvas(videoDocument(), { readonly: true })
    await flushPromises()

    // 속성이 아니라 DOM 값을 본다 — 자동재생을 허락할지 정하는 것은 그쪽이다.
    expect(wrapper.find('video.el-video').element.muted).toBe(true)
    expect(wrapper.find('video.el-video').attributes('playsinline')).toBeDefined()
  })

  it('주소가 없으면 자리표시자를 둔다', async () => {
    // 무엇이 놓였는지는 보여야 크기를 잡을 수 있다.
    const wrapper = mountCanvas(videoDocument(null))
    await flushPromises()

    expect(wrapper.find('video.el-video').exists()).toBe(false)
    expect(wrapper.find('.el-placeholder').text()).toContain('video')
  })

  it('소리는 기본으로 꺼져 있다', async () => {
    // 여러 개를 놓았을 때 소리가 겹쳐 나오면 자리조차 잡을 수 없다.
    const wrapper = mountCanvas(videoDocument(), { readonly: true })
    await flushPromises()

    expect(wrapper.find('video.el-video').element.muted).toBe(true)
  })

  it('소리를 켜면 문서에 적는다', async () => {
    const document = videoDocument()
    const wrapper = mountCanvas(document)
    await wrapper.find('.element').trigger('mousedown')
    await flushPromises()

    const toggle = wrapper
      .findAll('.element-section .check')
      .find((l) => l.text().includes('소리 켜기'))
    await toggle.find('input').setValue(true)

    expect(document.elements[0].options.muted).toBe(false)
  })

  it('소리를 켜야 음량을 묻는다', async () => {
    // 꺼 둔 상태에서 음량을 고르게 하면 쓰이지 않는 값을 정하게 된다.
    const wrapper = mountCanvas(videoDocument())
    await wrapper.find('.element').trigger('mousedown')
    await flushPromises()

    const labels = () => wrapper.findAll('.element-section label').map((l) => l.text())
    expect(labels()).not.toContain('음량')

    const toggle = wrapper
      .findAll('.element-section .check')
      .find((l) => l.text().includes('소리 켜기'))
    await toggle.find('input').setValue(true)
    await flushPromises()

    expect(labels()).toContain('음량')
  })

  it('음량을 문서에 적는다', async () => {
    const document = videoDocument()
    document.elements[0].options = { muted: false }
    const wrapper = mountCanvas(document)
    await wrapper.find('.element').trigger('mousedown')
    await flushPromises()

    const range = wrapper.find('.element-section input[type="range"]')
    range.element.value = '40'
    await range.trigger('change')

    expect(document.elements[0].options.volume).toBe(0.4)
  })

  it('편집 중에는 소리를 켜 두어도 끈다', async () => {
    // 자리를 잡는 동안 소리가 나면 방해만 된다.
    const document = videoDocument()
    document.elements[0].options = { muted: false }
    const wrapper = mountCanvas(document)
    await flushPromises()

    expect(wrapper.find('video.el-video').element.muted).toBe(true)
  })

  it('반복 재생을 끌 수 있다', async () => {
    const document = videoDocument()
    document.elements[0].options = { loop: false }
    const wrapper = mountCanvas(document, { readonly: true })
    await flushPromises()

    expect(wrapper.find('video.el-video').attributes('loop')).toBeUndefined()
  })

  it('속성 패널에서 다른 파일로 바꿀 수 있다', async () => {
    const wrapper = mountCanvas(videoDocument())
    await wrapper.find('.element').trigger('mousedown')
    await flushPromises()

    const change = wrapper.findAll('.element-section .btn').find((b) => b.text().includes('바꾸기'))
    expect(change).toBeTruthy()
  })
})

describe('미리보기 레이아웃', () => {
  it('읽기 전용이면 한 칸으로 둔다', async () => {
    // 레일도 오른쪽 패널도 없는데 그 자리를 잡고 있으면 캔버스가 주어진
    // 영역을 다 쓰지 못한다.
    const wrapper = mountCanvas(makeDocument(), { readonly: true })
    await flushPromises()

    expect(wrapper.find('.canvas-editor').classes()).toContain('readonly')
  })

  it('편집 중에는 그 표시를 달지 않는다', async () => {
    const wrapper = mountCanvas(makeDocument())
    await flushPromises()

    expect(wrapper.find('.canvas-editor').classes()).not.toContain('readonly')
  })

  it('읽기 전용에는 오른쪽 패널이 없다', async () => {
    const wrapper = mountCanvas(makeDocument(), { readonly: true })
    await flushPromises()

    expect(wrapper.find('.side').exists()).toBe(false)
    expect(wrapper.find('.rail').exists()).toBe(false)
  })
})

describe('텍스트 꾸미기', () => {
  function textDocument(options = {}) {
    return makeDocument({
      elements: [
        {
          id: 't1',
          type: 'text',
          rect: { x: 0, y: 0, w: 600, h: 200, z: 1 },
          opacity: 1,
          options: { text: '안내', fontSize: 64, color: '#ffffff', align: 'center', ...options },
          src: null,
        },
      ],
    })
  }

  async function select(wrapper) {
    await wrapper.find('.element').trigger('mousedown')
    await flushPromises()
  }

  it('글꼴을 고를 수 있다', async () => {
    const wrapper = mountCanvas(textDocument())
    await select(wrapper)

    const labels = wrapper.findAll('.element-section .field label').map((l) => l.text())
    expect(labels).toContain('글꼴')
  })

  it('고른 글꼴이 화면에 입혀진다', async () => {
    const document = textDocument({ fontFamily: 'myeongjo' })
    const wrapper = mountCanvas(document)
    await flushPromises()

    expect(wrapper.find('.el-text').attributes('style')).toContain('Nanum Myeongjo')
  })

  it('글꼴을 정하지 않으면 물려받는다', async () => {
    // 빈 값을 넣으면 상위에서 물려받는 글꼴까지 지워진다.
    const wrapper = mountCanvas(textDocument())
    await flushPromises()

    expect(wrapper.find('.el-text').attributes('style')).not.toContain('font-family')
  })

  it('기울임·밑줄·취소선을 함께 걸 수 있다', async () => {
    const wrapper = mountCanvas(textDocument({ italic: true, underline: true, strike: true }))
    await flushPromises()

    const style = wrapper.find('.el-text').attributes('style')
    expect(style).toContain('italic')
    expect(style).toContain('underline')
    expect(style).toContain('line-through')
  })

  it('줄 간격과 자간을 반영한다', async () => {
    const wrapper = mountCanvas(textDocument({ lineHeight: 1.8, letterSpacing: 0.05 }))
    await flushPromises()

    const style = wrapper.find('.el-text').attributes('style')
    expect(style).toContain('line-height: 1.8')
    expect(style).toContain('letter-spacing: 0.05em')
  })

  it('그림자로 밝은 배경에서도 읽히게 한다', async () => {
    const wrapper = mountCanvas(textDocument({ shadow: true }))
    await flushPromises()

    expect(wrapper.find('.el-text').attributes('style')).toContain('text-shadow')
  })

  it('글자 크기만 배율을 따라간다', async () => {
    // 무대 배율 0.5. 64px 글자는 32px 로 그려진다.
    const wrapper = mountCanvas(textDocument())
    await flushPromises()

    expect(wrapper.find('.el-text').attributes('style')).toContain('font-size: 32px')
  })

  it('담아 둔 글꼴을 모두 고를 수 있다', async () => {
    // 폐쇄망에서도 같게 나오도록 서체 파일을 저장소에 넣어 배포한다.
    const wrapper = mountCanvas(textDocument())
    await select(wrapper)

    const fontSelect = wrapper
      .findAll('.element-section select')
      .find((sel) => sel.findAll('option').some((o) => o.text() === '나눔고딕'))
    const names = fontSelect.findAll('option').map((o) => o.text())
    expect(names).toContain('주아체')
    expect(names).toContain('본고딕(Noto Sans KR)')
    expect(names).toContain('검은고딕')
    expect(names).toHaveLength(11)
  })

  it('제목용 서체는 굵게가 합성된다고 알려 준다', async () => {
    const wrapper = mountCanvas(textDocument({ fontFamily: 'jua' }))
    await select(wrapper)

    expect(wrapper.find('.element-section').text()).toContain('굵기가 한 벌뿐')
  })

  it('꾸미기 체크상자를 모두 내놓는다', async () => {
    const wrapper = mountCanvas(textDocument())
    await select(wrapper)

    const labels = wrapper.findAll('.deco .check').map((l) => l.text())
    expect(labels).toEqual(['굵게', '기울임', '밑줄', '취소선', '그림자'])
  })
})

describe('요소 애니메이션', () => {
  function animatedDocument(animation) {
    return makeDocument({
      elements: [
        {
          id: 'a1',
          type: 'text',
          rect: { x: 0, y: 0, w: 600, h: 200, z: 1 },
          opacity: 1,
          options: { text: '안내' },
          src: null,
          ...(animation ? { animation } : {}),
        },
      ],
    })
  }

  async function select(wrapper) {
    await wrapper.find('.element').trigger('mousedown')
    await flushPromises()
  }

  const animationSelect = (wrapper) =>
    wrapper
      .findAll('.element-section select')
      .find((s) => s.findAll('optgroup').some((g) => g.attributes('label') === '등장'))

  it('종류를 가리지 않고 걸 수 있다', async () => {
    // 글자만 움직이게 하면 사진과 위젯은 늘 가만히 있어야 한다.
    const wrapper = mountCanvas(animatedDocument())
    await select(wrapper)

    expect(animationSelect(wrapper)).toBeTruthy()
  })

  it('등장과 반복을 묶어 보여 준다', async () => {
    const wrapper = mountCanvas(animatedDocument())
    await select(wrapper)

    const groups = animationSelect(wrapper).findAll('optgroup').map((g) => g.attributes('label'))
    expect(groups).toEqual(['등장', '강조(반복)'])
  })

  it('고르면 문서에 적는다', async () => {
    const document = animatedDocument()
    const wrapper = mountCanvas(document)
    await select(wrapper)

    await animationSelect(wrapper).setValue('fade-in')
    expect(document.elements[0].animation).toMatchObject({
      type: 'fade-in',
      duration_ms: 800,
      delay_ms: 0,
    })
  })

  it("'없음' 으로 되돌리면 통째로 지운다", async () => {
    // 쓰지 않는 값이 남으면 문서를 읽는 사람이 의미 있는 설정이라고 믿는다.
    const document = animatedDocument({ type: 'fade-in', duration_ms: 800, delay_ms: 0 })
    const wrapper = mountCanvas(document)
    await select(wrapper)

    await animationSelect(wrapper).setValue('none')
    expect(document.elements[0].animation).toBeUndefined()
  })

  it('효과가 없으면 길이·지연을 묻지 않는다', async () => {
    const wrapper = mountCanvas(animatedDocument())
    await select(wrapper)

    const labels = wrapper.findAll('.element-section label').map((l) => l.text())
    expect(labels).not.toContain('길이(ms)')
  })

  it('편집 중에는 돌리지 않는다', async () => {
    // 움직이는 요소는 끌어 옮길 수가 없다.
    const wrapper = mountCanvas(animatedDocument({ type: 'pulse', duration_ms: 1000 }))
    await flushPromises()

    expect(wrapper.find('.element').attributes('style')).not.toContain('animation-name')
  })

  it('미리보기에서는 돈다', async () => {
    const wrapper = mountCanvas(animatedDocument({ type: 'pulse', duration_ms: 1000 }), {
      readonly: true,
    })
    await flushPromises()

    const style = wrapper.find('.element').attributes('style')
    expect(style).toContain('sl-pulse')
    expect(style).toContain('1000ms')
  })

  it('반복 효과는 끝없이 돈다', async () => {
    const wrapper = mountCanvas(animatedDocument({ type: 'float' }), { readonly: true })
    await flushPromises()

    expect(wrapper.find('.element').attributes('style')).toContain('infinite')
  })

  it('등장 효과는 한 번만 하고 제자리에 선다', async () => {
    const wrapper = mountCanvas(animatedDocument({ type: 'fade-in' }), { readonly: true })
    await flushPromises()

    const style = wrapper.find('.element').attributes('style')
    expect(style).toContain('animation-iteration-count: 1')
    expect(style).toContain('both')
  })
})

describe('이미지 넣기', () => {
  const PICKED = {
    src: '/api/v1/assets/9/key/file',
    credit: { source: 'pixabay', source_page: 'https://pixabay.com/photos/1/', author: '촬영자' },
    size: { width: 1600, height: 800 },
  }

  /** 레일의 이미지 버튼. */
  const imageButton = (wrapper) =>
    wrapper.findAll('.rail button').find((b) => b.attributes('title')?.includes('이미지'))

  /** 고르기 창을 열고, 거기서 하나 고른 것으로 친다. */
  async function pickImage(wrapper, picked = PICKED) {
    await imageButton(wrapper).trigger('click')
    await flushPromises()
    wrapper.findComponent({ name: 'MediaPicker' }).vm.$emit('select', picked)
    await flushPromises()
  }

  it('이미지 버튼은 주소를 묻지 않고 고르기 레이어를 연다', async () => {
    // 사진 주소를 손으로 적어 넣는 것은 사실상 불가능하다. 올리거나,
    // 올려 둔 것에서 고르거나, 검색해서 고른다.
    const wrapper = mountCanvas(makeDocument())
    await imageButton(wrapper).trigger('click')
    await flushPromises()

    expect(wrapper.findComponent({ name: 'MediaPicker' }).exists()).toBe(true)
    // 아직 아무것도 만들지 않는다. 고른 뒤에 만든다.
    expect(wrapper.props('document').elements).toHaveLength(0)
  })

  it('끌어다 놓아도 고르기 레이어를 먼저 연다', async () => {
    // 이미지도 '무엇을' 넣을지 정해야 의미가 있다. 재생목록과 같은 흐름이다.
    const document = makeDocument()
    const wrapper = mountCanvas(document)
    await wrapper.find('.canvas').trigger('drop', {
      dataTransfer: {
        types: ['application/x-signallink-element'],
        getData: () => JSON.stringify({ type: 'image' }),
        dropEffect: '',
      },
      preventDefault: () => {},
      clientX: 240,
      clientY: 135,
    })
    await flushPromises()

    expect(wrapper.findComponent({ name: 'MediaPicker' }).exists()).toBe(true)
    expect(document.elements).toHaveLength(0)

    wrapper.findComponent({ name: 'MediaPicker' }).vm.$emit('select', { src: PICKED.src })
    await flushPromises()

    // 놓은 자리(캔버스 480, 270)를 가운데로 삼는다.
    const rect = document.elements[0].rect
    expect(rect.x + rect.w / 2).toBe(480)
    expect(rect.y + rect.h / 2).toBe(270)
  })

  it('고르면 그 주소로 이미지 요소를 만든다', async () => {
    const document = makeDocument()
    const wrapper = mountCanvas(document)
    await pickImage(wrapper)

    expect(document.elements).toHaveLength(1)
    expect(document.elements[0].type).toBe('image')
    expect(document.elements[0].src).toBe(PICKED.src)
  })

  it('원본 비율을 지켜 놓는다', async () => {
    // 기본 상자(600x400)에 넣으면 세로 사진이 눌려 보인다.
    const document = makeDocument()
    const wrapper = mountCanvas(document)
    await pickImage(wrapper)

    const { w, h } = document.elements[0].rect
    expect(w / h).toBeCloseTo(PICKED.size.width / PICKED.size.height, 2)
  })

  it('비율을 맞춰도 가운데는 움직이지 않는다', async () => {
    const document = makeDocument()
    const wrapper = mountCanvas(document)
    await pickImage(wrapper)

    const { y, h } = document.elements[0].rect
    expect(y + h / 2).toBe(540)
  })

  it('출처를 콘텐츠에 남긴다', async () => {
    // 이용 약관이 표시를 요구하고, 어디서 가져왔는지 추적할 수단이 이것뿐이다.
    const document = makeDocument()
    const wrapper = mountCanvas(document)
    await pickImage(wrapper)

    expect(document.elements[0].options).toMatchObject(PICKED.credit)
  })

  it('올린 파일에는 출처를 붙이지 않는다', async () => {
    // 우리가 올린 것에 남의 출처가 붙으면 잘못된 표기가 된다.
    const document = makeDocument()
    const wrapper = mountCanvas(document)
    await pickImage(wrapper, { src: '/api/v1/assets/3/key/file' })

    expect(document.elements[0].options.source).toBeUndefined()
  })

  it('고르고 나면 창을 닫는다', async () => {
    const wrapper = mountCanvas(makeDocument())
    await pickImage(wrapper)

    expect(wrapper.findComponent({ name: 'MediaPicker' }).exists()).toBe(false)
  })

  it('세로 콘텐츠면 세로 소재를 찾게 한다', async () => {
    const wrapper = mountCanvas(makeDocument({ layout: { width: 1080, height: 1920 } }))
    await imageButton(wrapper).trigger('click')
    await flushPromises()

    expect(wrapper.findComponent({ name: 'MediaPicker' }).props('orientation')).toBe('PORTRAIT')
  })

  it('바꾸기로 열면 크기와 자리를 그대로 둔다', async () => {
    // 다른 그림으로 갈아 끼우려고 지웠다 다시 만들게 하면 안 된다.
    const document = makeDocument()
    const wrapper = mountCanvas(document)
    await pickImage(wrapper)
    const before = { ...document.elements[0].rect }

    await wrapper.find('.layer').trigger('click')
    await wrapper
      .findAll('.btn')
      .find((b) => b.text().includes('바꾸기'))
      .trigger('click')
    await flushPromises()
    wrapper
      .findComponent({ name: 'MediaPicker' })
      .vm.$emit('select', { src: '/api/v1/assets/12/key/file', size: { width: 100, height: 900 } })
    await flushPromises()

    expect(document.elements).toHaveLength(1)
    expect(document.elements[0].src).toBe('/api/v1/assets/12/key/file')
    expect(document.elements[0].rect).toEqual(before)
  })
})


describe('재생목록 요소', () => {
  /** 레일의 재생목록 고르기 칸. */
  const playlistButton = (wrapper) => wrapper.find('.rail-btn.pick')

  it('버튼을 누르면 어느 목록인지 먼저 고르게 한다', async () => {
    // 빈 요소를 만들어 두면 캔버스에 아무것도 안 그려진 채 남는다.
    const document = makeDocument()
    const wrapper = mountCanvas(document)
    await playlistButton(wrapper).trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('현관 순환')
    expect(document.elements).toHaveLength(0)
  })

  it('고르면 참조만 담은 요소를 만든다', async () => {
    // 문서에는 참조만 남아야 재생목록을 고쳤을 때 다음 표출에 반영된다.
    const document = makeDocument()
    const wrapper = mountCanvas(document)
    await playlistButton(wrapper).trigger('click')
    await flushPromises()

    await wrapper.find('.pl-row').trigger('click')
    await flushPromises()

    expect(document.elements).toHaveLength(1)
    expect(document.elements[0].type).toBe('playlist')
    expect(document.elements[0].options.playlist_id).toBe(1)
    // 칸 목록은 서버가 채운다. 편집기가 박아 넣으면 고쳐도 반영되지 않는다.
    expect(document.elements[0].options.items).toBeUndefined()
  })

  it('캔버스에 이름을 보여 준다', async () => {
    const document = makeDocument()
    const wrapper = mountCanvas(document)
    await playlistButton(wrapper).trigger('click')
    await flushPromises()
    await wrapper.find('.pl-row').trigger('click')
    await flushPromises()

    expect(wrapper.find('.el-playlist').text()).toContain('현관 순환')
  })

  it('고르고 나면 창을 닫는다', async () => {
    const wrapper = mountCanvas(makeDocument())
    await playlistButton(wrapper).trigger('click')
    await flushPromises()
    await wrapper.find('.pl-row').trigger('click')
    await flushPromises()

    expect(wrapper.find('.pl-row').exists()).toBe(false)
  })

  it('열 때마다 목록을 다시 받는다', async () => {
    // 한 번 받아 두면 다른 탭에서 만든 목록이 이 화면에서는 영영 안 보인다.
    const wrapper = mountCanvas(makeDocument())
    await playlistButton(wrapper).trigger('click')
    await flushPromises()
    await wrapper.find('.dialog-head .close').trigger('click')

    PLAYLISTS = [...PLAYLISTS, { id: 2, name: '새 목록', total_duration_sec: 5, items: [] }]
    await playlistButton(wrapper).trigger('click')
    await flushPromises()

    expect(wrapper.findAll('.pl-row')).toHaveLength(2)
  })

  it('이름으로 좁혀 찾는다', async () => {
    PLAYLISTS = [
      { id: 1, name: '현관 순환', total_duration_sec: 5, items: [] },
      { id: 2, name: '급식 안내', total_duration_sec: 5, items: [] },
    ]
    const wrapper = mountCanvas(makeDocument())
    await playlistButton(wrapper).trigger('click')
    await flushPromises()

    await wrapper.find('.pl-filter .input').setValue('급식')
    expect(wrapper.findAll('.pl-row').map((r) => r.text())).toHaveLength(1)
    expect(wrapper.find('.pl-row').text()).toContain('급식 안내')
  })

  it('하나도 없어도 막다른 길이 아니다', async () => {
    // 나가서 만들어 오라고만 하면 편집 중인 내용을 두고 나가야 한다.
    PLAYLISTS = []
    const wrapper = mountCanvas(makeDocument())
    await playlistButton(wrapper).trigger('click')
    await flushPromises()

    expect(wrapper.find('.pl-create').exists()).toBe(true)
  })

  it('편집기 안에서 만들어 바로 놓는다', async () => {
    const document = makeDocument()
    const wrapper = mountCanvas(document, { orgId: 3 })
    await playlistButton(wrapper).trigger('click')
    await flushPromises()

    await wrapper.find('.pl-create .input').setValue('아침 순환')
    await wrapper.find('.pl-create .btn').trigger('click')
    await flushPromises()

    expect(post).toHaveBeenCalledWith('/playlists', {
      name: '아침 순환',
      org_id: 3,
      items: [],
    })
    expect(document.elements[0].options.playlist_id).toBe(9)
  })

  it('이름이 비면 만들지 않는다', async () => {
    const wrapper = mountCanvas(makeDocument())
    await playlistButton(wrapper).trigger('click')
    await flushPromises()

    expect(wrapper.find('.pl-create .btn').attributes('disabled')).toBeDefined()
  })

  it('레일 버튼을 누르면 고르기 레이어를 연다', async () => {
    // 아이콘만으로는 재생목록끼리 구분되지 않는다. 어느 목록인지는
    // 첫 화면을 보며 고른다.
    const document = makeDocument()
    const wrapper = mountCanvas(document)
    await playlistButton(wrapper).trigger('click')
    await flushPromises()

    expect(wrapper.findAll('.pl-row')).toHaveLength(1)
    expect(document.elements).toHaveLength(0)
  })

  it('목록에 첫 위젯 화면을 함께 보여 준다', async () => {
    // 이름만으로는 어떤 화면이 도는 목록인지 알 수 없다.
    const wrapper = mountCanvas(makeDocument())
    await playlistButton(wrapper).trigger('click')
    await flushPromises()

    const thumb = wrapper.find('.pl-row .pl-thumb')
    expect(thumb.findComponent({ name: 'WidgetPreview' }).props('widgetKey')).toBe('notice')
  })

  it('첫 위젯 이름도 적어 준다', async () => {
    const wrapper = mountCanvas(makeDocument(), {
      widgets: [{ key: 'notice', name: '공지사항', category: '기능형', description: '', options: [] }],
    })
    await playlistButton(wrapper).trigger('click')
    await flushPromises()

    expect(wrapper.find('.pl-row-first').text()).toContain('공지사항')
  })

  it('첫 화면은 실제 해상도로 그려 줄인다', async () => {
    // 작은 상자에 그대로 그리면 글자 크기가 실제와 달라져 다른 화면이 된다.
    const wrapper = mountCanvas(makeDocument())
    await playlistButton(wrapper).trigger('click')
    await flushPromises()

    const preview = wrapper.find('.pl-thumb').findComponent({ name: 'WidgetPreview' })
    expect(preview.props()).toMatchObject({ width: 1920, height: 1080 })
  })

  it('담긴 위젯이 없으면 자리표시자를 둔다', async () => {
    PLAYLISTS = [{ id: 1, name: '빈 목록', total_duration_sec: 0, items: [] }]
    const wrapper = mountCanvas(makeDocument())
    await playlistButton(wrapper).trigger('click')
    await flushPromises()

    expect(wrapper.find('.pl-thumb-empty').exists()).toBe(true)
  })

  it('레이어에서 고르면 그때 놓는다', async () => {
    const document = makeDocument()
    const wrapper = mountCanvas(document)
    await playlistButton(wrapper).trigger('click')
    await flushPromises()

    await wrapper.find('.pl-row').trigger('click')
    await flushPromises()

    expect(document.elements[0].options.playlist_id).toBe(1)
    expect(wrapper.find('.pl-row').exists()).toBe(false)
  })

  it('끌어다 놓으면 그 자리를 기억한 채 레이어를 연다', async () => {
    const document = makeDocument()
    const wrapper = mountCanvas(document)
    await wrapper.find('.canvas').trigger('drop', {
      dataTransfer: {
        types: ['application/x-signallink-element'],
        getData: () => JSON.stringify({ type: 'playlist' }),
        dropEffect: '',
      },
      preventDefault: () => {},
      clientX: 240,
      clientY: 135,
    })
    await flushPromises()

    expect(document.elements).toHaveLength(0)
    await wrapper.find('.pl-row').trigger('click')
    await flushPromises()

    // 놓은 자리(캔버스 480, 270)를 가운데로 삼는다.
    const rect = document.elements[0].rect
    expect(rect.x + rect.w / 2).toBe(480)
    expect(rect.y + rect.h / 2).toBe(270)
  })

  /** 재생목록 요소 하나가 놓인 문서. */  /** 재생목록 요소 하나가 놓인 문서. */
  function placedDocument() {
    return makeDocument({
      elements: [
        {
          id: 'p1',
          type: 'playlist',
          rect: { x: 100, y: 100, w: 600, h: 400, z: 1 },
          opacity: 1,
          options: { playlist_id: 1, playlist_name: '현관 순환', playlist_item_count: 2 },
        },
      ],
    })
  }

  it('놓은 뒤에도 어느 목록인지 보여 준다', async () => {
    // 없으면 한번 놓은 요소는 지웠다 다시 만드는 수밖에 없다.
    const wrapper = mountCanvas(placedDocument())
    await wrapper.find('.element').trigger('mousedown')
    await flushPromises()

    expect(wrapper.find('.pl-current').text()).toContain('현관 순환')
  })

  it('놓은 요소의 목록만 갈아 끼운다', async () => {
    PLAYLISTS = [
      { id: 1, name: '현관 순환', total_duration_sec: 5, items: [] },
      { id: 2, name: '급식 안내', total_duration_sec: 5, items: [{ id: 7 }] },
    ]
    const document = placedDocument()
    const wrapper = mountCanvas(document)
    await wrapper.find('.element').trigger('mousedown')
    await flushPromises()

    const change = wrapper.findAll('.element-section .btn').find((b) => b.text().includes('바꾸기'))
    await change.trigger('click')
    await flushPromises()
    await wrapper.findAll('.pl-row')[1].trigger('click')
    await flushPromises()

    // 요소는 늘지 않고, 크기와 자리도 그대로다.
    expect(document.elements).toHaveLength(1)
    expect(document.elements[0].options.playlist_id).toBe(2)
    expect(document.elements[0].rect).toMatchObject({ x: 100, y: 100, w: 600, h: 400 })
  })

  it('재생목록 편집기로 가는 길을 둔다', async () => {
    const wrapper = mountCanvas(placedDocument())
    await wrapper.find('.element').trigger('mousedown')
    await flushPromises()

    const link = wrapper.findAll('.element-section a').find((a) => a.text().includes('편집기'))
    expect(link.attributes('href')).toBe('/playlists/1/edit')
  })

  /** 레일에서 캔버스로 끄는 드래그. */
  function railDrag(type, clientX, clientY) {
    return {
      dataTransfer: {
        types: ['application/x-signallink-element'],
        getData: () => JSON.stringify({ type }),
        dropEffect: '',
      },
      preventDefault: () => {},
      clientX,
      clientY,
    }
  }

  it('끌어다 놓아도 고르기 창을 먼저 연다', async () => {
    // 누를 때만 창이 열리면 끌어다 놓은 사람은 빈 요소를 얻는다.
    const document = makeDocument()
    const wrapper = mountCanvas(document)
    await wrapper.find('.canvas').trigger('drop', railDrag('playlist', 240, 135))
    await flushPromises()

    expect(document.elements).toHaveLength(0)
    expect(wrapper.find('.pl-row').exists()).toBe(true)
  })

  it('끌어다 놓은 자리에 만들어진다', async () => {
    // 고르는 동안에도 놓은 자리는 기억하고 있어야 한다.
    const document = makeDocument()
    const wrapper = mountCanvas(document)
    await wrapper.find('.canvas').trigger('drop', railDrag('playlist', 240, 135))
    await flushPromises()
    await wrapper.find('.pl-row').trigger('click')
    await flushPromises()

    const rect = document.elements[0].rect
    expect(rect.x + rect.w / 2).toBe(480)
    expect(rect.y + rect.h / 2).toBe(270)
  })

  it('고르지 않고 닫으면 놓은 자리를 잊는다', async () => {
    // 남겨 두면 그다음 '버튼으로 추가' 가 엉뚱한 자리에 생긴다.
    const document = makeDocument()
    const wrapper = mountCanvas(document)
    await wrapper.find('.canvas').trigger('drop', railDrag('playlist', 40, 20))
    await flushPromises()
    await wrapper.find('.dialog-head .close').trigger('click')
    await flushPromises()

    await playlistButton(wrapper).trigger('click')
    await flushPromises()
    await wrapper.find('.pl-row').trigger('click')
    await flushPromises()

    const rect = document.elements[0].rect
    expect(rect.x + rect.w / 2).toBe(960)
    expect(rect.y + rect.h / 2).toBe(540)
  })
})

describe('이미지앨범 추가', () => {
  // 빈 앨범을 먼저 놓고 나중에 채우게 하면, 채우지 않고 넘어갔을 때 빈 칸이
  // 그대로 저장되어 장치에서 빈 화면이 나간다. 그래서 이미지·재생목록과 같은
  // 흐름을 탄다 — 고르는 것이 먼저고, 요소는 고른 뒤에 만든다.
  const ALBUM = {
    key: 'album',
    name: '이미지앨범',
    category: '콘텐츠형',
    description: '여러 이미지를 정한 간격으로 넘겨 표출',
    default_size: { w: 800, h: 600 },
    options: [
      { key: 'images', label: '이미지', type: 'image_list', default: [], choices: [] },
      { key: 'interval_sec', label: '넘김 간격(초)', type: 'number', default: 8, choices: [] },
      { key: 'transition', label: '전환 효과', type: 'transition', default: 'none', choices: [] },
    ],
  }

  const IMAGES = [{ src: '/api/v1/assets/1/k/file' }, { src: '/api/v1/assets/2/k/file' }]

  const editor = (wrapper) => wrapper.findComponent({ name: 'AlbumEditorDialog' })

  /** 레일의 이미지앨범 칸. */
  const albumButton = (wrapper) =>
    wrapper.findAll('.rail button').find((b) => b.attributes('title')?.includes('이미지앨범'))

  /** 창을 열고, 사진을 담고, 닫는다. */
  async function makeAlbum(wrapper, images = IMAGES) {
    await albumButton(wrapper).trigger('click')
    await flushPromises()
    if (images.length) editor(wrapper).vm.$emit('update:modelValue', images)
    await flushPromises()
    editor(wrapper).vm.$emit('close')
    await flushPromises()
  }

  it('레일에 이미지앨범이 선다', async () => {
    const wrapper = mountCanvas(makeDocument(), { widgets: [ALBUM] })
    await flushPromises()

    expect(albumButton(wrapper)).toBeDefined()
  })

  it('누르면 요소를 만들기 전에 사진부터 고르게 한다', async () => {
    const document = makeDocument()
    const wrapper = mountCanvas(document, { widgets: [ALBUM] })
    await flushPromises()

    await albumButton(wrapper).trigger('click')
    await flushPromises()

    expect(editor(wrapper).exists()).toBe(true)
    // 아직 아무것도 만들지 않는다.
    expect(document.elements).toHaveLength(0)
  })

  it('담고 닫으면 그때 앨범이 생긴다', async () => {
    const document = makeDocument()
    const wrapper = mountCanvas(document, { widgets: [ALBUM] })
    await flushPromises()

    await makeAlbum(wrapper)

    expect(document.elements).toHaveLength(1)
    expect(document.elements[0].widget_key).toBe('album')
    expect(document.elements[0].options.images).toEqual(IMAGES)
  })

  it('한 장도 안 담고 닫으면 아무것도 안 만든다', async () => {
    // 넣으려다 마음을 바꾼 것이지, 빈 앨범을 놓아 달라는 뜻이 아니다.
    const document = makeDocument()
    const wrapper = mountCanvas(document, { widgets: [ALBUM] })
    await flushPromises()

    await makeAlbum(wrapper, [])

    expect(document.elements).toHaveLength(0)
  })

  it('명세의 기본 크기로 만든다', async () => {
    const document = makeDocument()
    const wrapper = mountCanvas(document, { widgets: [ALBUM] })
    await flushPromises()

    await makeAlbum(wrapper)

    expect(document.elements[0].rect.w).toBe(800)
    expect(document.elements[0].rect.h).toBe(600)
  })

  it('다시 열면 앞서 담던 것이 남아 있지 않다', async () => {
    // 지난번에 고르다 만 사진이 딸려 오면 엉뚱한 앨범이 생긴다.
    const document = makeDocument()
    const wrapper = mountCanvas(document, { widgets: [ALBUM] })
    await flushPromises()

    await makeAlbum(wrapper)
    await albumButton(wrapper).trigger('click')
    await flushPromises()

    expect(editor(wrapper).props('modelValue')).toEqual([])
  })

  it('끌어다 놓아도 사진부터 고르게 하고, 놓은 자리에 만든다', async () => {
    const document = makeDocument()
    const wrapper = mountCanvas(document, { widgets: [ALBUM] })
    await flushPromises()

    await wrapper.find('.canvas').trigger('drop', {
      dataTransfer: {
        types: ['application/x-signallink-element'],
        getData: () => JSON.stringify({ type: 'widget', widgetKey: 'album' }),
        dropEffect: '',
      },
      preventDefault: () => {},
      clientX: 240,
      clientY: 135,
    })
    await flushPromises()

    expect(editor(wrapper).exists()).toBe(true)
    expect(document.elements).toHaveLength(0)

    editor(wrapper).vm.$emit('update:modelValue', IMAGES)
    await flushPromises()
    editor(wrapper).vm.$emit('close')
    await flushPromises()

    // 놓은 자리(캔버스 480, 270)를 가운데로 삼는다.
    const rect = document.elements[0].rect
    expect(rect.x + rect.w / 2).toBe(480)
    expect(rect.y + rect.h / 2).toBe(270)
  })

  it('올릴 기관을 창에 넘긴다', async () => {
    // 기관을 안 넘기면 남의 기관 라이브러리에 파일이 올라간다.
    const wrapper = mountCanvas(makeDocument(), { widgets: [ALBUM], orgId: 3 })
    await flushPromises()

    await albumButton(wrapper).trigger('click')
    await flushPromises()

    expect(editor(wrapper).props('orgId')).toBe(3)
  })
})

describe('놓인 이미지앨범', () => {
  const ALBUM = {
    key: 'album',
    name: '이미지앨범',
    category: '콘텐츠형',
    description: '여러 이미지를 정한 간격으로 넘겨 표출',
    default_size: { w: 800, h: 600 },
    options: [
      { key: 'images', label: '이미지', type: 'image_list', default: [], choices: [] },
      { key: 'interval_sec', label: '넘김 간격(초)', type: 'number', default: 8, choices: [] },
    ],
  }

  /** 사진이 든 앨범 하나가 놓인 문서. */
  function albumDocument() {
    const document = makeDocument()
    document.elements.push({
      id: 'a1',
      type: 'widget',
      widget_key: 'album',
      rect: { x: 0, y: 0, w: 800, h: 600, z: 1 },
      options: { images: [{ src: '/api/v1/assets/1/k/file' }] },
    })
    return document
  }

  it('고르면 속성 단에 사진 칸이 나온다', async () => {
    const wrapper = mountCanvas(albumDocument(), { widgets: [ALBUM] })
    await flushPromises()

    await wrapper.find('.layer').trigger('click')
    await flushPromises()

    expect(wrapper.findComponent({ name: 'ImageListEditor' }).exists()).toBe(true)
  })

  it('올릴 기관을 사진 칸까지 넘긴다', async () => {
    const wrapper = mountCanvas(albumDocument(), { widgets: [ALBUM], orgId: 3 })
    await flushPromises()

    await wrapper.find('.layer').trigger('click')
    await flushPromises()

    expect(wrapper.findComponent({ name: 'ImageListEditor' }).props('orgId')).toBe(3)
  })

  it('편집 중에는 사진을 넘기지 않는다', async () => {
    // 자리를 잡는 동안 사진이 계속 바뀌면 눈이 붙잡힌다.
    const wrapper = mountCanvas(albumDocument(), { widgets: [ALBUM] })
    await flushPromises()

    expect(wrapper.findComponent({ name: 'AlbumSlides' }).props('playing')).toBe(false)
  })

  it('미리보기에서는 넘긴다', async () => {
    const wrapper = mountCanvas(albumDocument(), { widgets: [ALBUM], readonly: true })
    await flushPromises()

    expect(wrapper.findComponent({ name: 'AlbumSlides' }).props('playing')).toBe(true)
  })
})


describe('속성 패널이 잘리지 않는다', () => {
  // `flex: 1` 은 flex-basis 가 0 이라, 남는 공간이 없으면 그 단의 높이도 0 이
  // 된다. 위 두 단이 34vh + 26vh 를 차지하므로 화면이 낮으면 요소 설정 단이
  // 사라졌고, 패널은 overflow: hidden 이라 굴려서 닿을 수도 없었다.

  it('요소 설정 단은 자리를 지킨다', async () => {
    const wrapper = mountCanvas(makeDocument())
    await flushPromises()

    expect(wrapper.find('.element-section').exists()).toBe(true)
    expect(wrapper.find('.element-section .section-body').exists()).toBe(true)
  })

  it('세 단이 모두 패널 안에 있다', async () => {
    const wrapper = mountCanvas(makeDocument())
    await flushPromises()

    const side = wrapper.find('.side')
    for (const name of ['canvas-section', 'layer-section', 'element-section']) {
      expect(side.find(`.${name}`).exists(), name).toBe(true)
    }
  })

  it('각 단은 제 안에서 굴러간다', async () => {
    // 패널 전체가 굴러가면 안 된다 — 굴려야 닿는 설정은 있으나 마나다.
    const wrapper = mountCanvas(makeDocument())
    await flushPromises()

    expect(wrapper.findAll('.section-body').length).toBe(3)
  })
})

describe('상단 정보 표시줄', () => {
  // 문서 설정(layout.info_bar)이다 — 편집기 장식이 아니라 표출 화면의 일부라,
  // 편집·미리보기·장치가 같은 줄을 그린다.

  const toggle = (wrapper) => wrapper.find('.info-toggle input')

  it('기본은 꺼져 있다', async () => {
    const wrapper = mountCanvas(makeDocument())
    await flushPromises()

    expect(toggle(wrapper).element.checked).toBe(false)
    expect(wrapper.findComponent({ name: 'InfoBar' }).exists()).toBe(false)
  })

  it('켜면 문서에 적히고 캔버스 위에 줄이 선다', async () => {
    const document = makeDocument()
    const wrapper = mountCanvas(document)
    await flushPromises()

    await toggle(wrapper).setValue(true)

    expect(document.layout.info_bar).toBe(true)
    expect(wrapper.findComponent({ name: 'InfoBar' }).exists()).toBe(true)
  })

  it('끄면 키 자체를 지운다', async () => {
    // 안 쓰는 값이 문서에 남으면 나중에 읽는 사람이 의미 있는 설정이라 믿는다.
    const document = makeDocument()
    document.layout.info_bar = true
    const wrapper = mountCanvas(document)
    await flushPromises()

    await toggle(wrapper).setValue(false)

    expect('info_bar' in document.layout).toBe(false)
  })

  it('미리보기에서도 그려진다', async () => {
    // 커뮤니티 위젯·스케줄 미리보기가 이 경로로 문서를 그린다 — 장치와 같은 모습.
    const document = makeDocument()
    document.layout.info_bar = true
    const wrapper = mountCanvas(document, { readonly: true })
    await flushPromises()

    expect(wrapper.findComponent({ name: 'InfoBar' }).exists()).toBe(true)
  })

  it('기관을 표시줄에 넘긴다', async () => {
    // 날씨는 기관 좌표 기준이다.
    const document = makeDocument()
    document.layout.info_bar = true
    const wrapper = mountCanvas(document, { orgId: 3 })
    await flushPromises()

    expect(wrapper.findComponent({ name: 'InfoBar' }).props('orgId')).toBe(3)
  })
})

describe('정보 표시줄 자리는 배치 영역이 아니다', () => {
  // 요소를 표시줄 밑에 깔아 두면 가려 보이지 않는 채 저장된다.

  function barDocument() {
    const document = makeDocument()
    document.layout.info_bar = true
    return document
  }

  it('켜는 순간 그 자리에 있던 요소를 아래로 내린다', async () => {
    const document = makeDocument()
    document.elements.push({
      id: 'e1',
      type: 'text',
      rect: { x: 0, y: 10, w: 400, h: 100, z: 1 },
      options: { text: '위에 깔림' },
    })
    const wrapper = mountCanvas(document)
    await flushPromises()

    await wrapper.find('.info-toggle input').setValue(true)

    expect(document.elements[0].rect.y).toBe(72)
  })

  it('새 요소는 표시줄 아래에서 시작한다', async () => {
    const document = barDocument()
    const wrapper = mountCanvas(document)
    await flushPromises()

    // 위쪽(캔버스 y=30 근처)에 끌어다 놓아도 선 아래로 밀린다.
    await wrapper.find('.canvas').trigger('drop', {
      dataTransfer: {
        types: ['application/x-signallink-element'],
        getData: () => JSON.stringify({ type: 'text' }),
        dropEffect: '',
      },
      preventDefault: () => {},
      clientX: 240,
      clientY: 10,
    })
    await flushPromises()

    expect(document.elements[0].rect.y).toBeGreaterThanOrEqual(72)
  })

  it('켜면 분할 영역이 표시줄 밑으로 다시 계산되고 묶인 요소가 따라간다', async () => {
    // 분할된 문서에서 표시줄을 켰을 때 첫 행 요소가 그대로면 표시줄에 깔린다.
    const document = makeDocument({
      layout: { split: { key: 'grid4', gap: 0, cols: null, rows: null } },
      elements: [
        {
          id: 'e1',
          type: 'text',
          region: 0,
          rect: { x: 0, y: 0, w: 960, h: 540, z: 1 },
          options: { text: '첫 칸' },
        },
      ],
    })
    const wrapper = mountCanvas(document)
    await flushPromises()

    await wrapper.find('.info-toggle input').setValue(true)

    // 첫 행은 y=72 에서 시작하고 높이는 (1080-72)/2 로 줄어든다.
    expect(document.elements[0].rect).toMatchObject({ y: 72, h: 504 })
    expect(document.elements[0].region).toBe(0)
  })

  it('끄면 묶인 요소가 전체 높이 영역으로 되돌아간다', async () => {
    const document = makeDocument({
      layout: {
        info_bar: true,
        split: { key: 'grid4', gap: 0, cols: null, rows: null },
      },
      elements: [
        {
          id: 'e1',
          type: 'text',
          region: 0,
          rect: { x: 0, y: 72, w: 960, h: 504, z: 1 },
          options: { text: '첫 칸' },
        },
      ],
    })
    const wrapper = mountCanvas(document)
    await flushPromises()

    await wrapper.find('.info-toggle input').setValue(false)

    expect(document.elements[0].rect).toMatchObject({ y: 0, h: 540 })
  })

  it('꺼져 있으면 예전대로 위 밖까지 허용한다', async () => {
    // 요소를 일부러 캔버스 위 밖으로 걸치는 연출은 원래 허용된다.
    const document = makeDocument()
    const wrapper = mountCanvas(document)
    await flushPromises()

    await wrapper.find('.canvas').trigger('drop', {
      dataTransfer: {
        types: ['application/x-signallink-element'],
        getData: () => JSON.stringify({ type: 'text' }),
        dropEffect: '',
      },
      preventDefault: () => {},
      clientX: 240,
      clientY: 10,
    })
    await flushPromises()

    expect(document.elements[0].rect.y).toBeLessThan(0)
  })
})
