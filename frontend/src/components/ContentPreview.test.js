/**
 * 콘텐츠 미리보기 테스트.
 *
 * 편집 캔버스와 다른 점은 **편집 장치가 없다**는 것이다 — 점선 테두리,
 * 크기 손잡이, 레일, 레이어 목록이 사라져야 "장치에서 보이는 그대로" 가 된다.
 * 그것을 확인하는 것이 이 화면의 전부다.
 */
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { i18n } from '@/i18n'

vi.mock('@/api/client', () => ({
  api: {
    get: vi.fn(async (path) => {
      if (path === '/images/status') return { configured: false }
      if (path === '/playlists') return { items: [], total: 0, page: 1, size: 100 }
      if (path.startsWith('/playlists/')) return { id: 1, name: '순환', items: [] }
      return {}
    }),
  },
  TEST_MODE: false,
}))

import ContentPreview from './ContentPreview.vue'

const WIDGETS = [{ key: 'clock', name: '시계', category: '기능형', description: '', options: [] }]

function makeDocument(elements = [], layout = {}) {
  return {
    version: 1,
    layout: { width: 1920, height: 1080, background: '#000000', ...layout },
    elements,
  }
}

/** 4분할이 걸린 문서. 편집기에서는 안내선과 분할선이 그려진다. */
const splitDocument = () =>
  makeDocument([textElement], { split: { key: 'grid4', gap: 8 } })

const textElement = {
  id: 'a',
  type: 'text',
  rect: { x: 0, y: 0, w: 600, h: 200, z: 1 },
  opacity: 1,
  options: { text: '안내', fontSize: 64, color: '#ffffff', align: 'center' },
  src: null,
}

function mountPreview(document) {
  const pinia = createPinia()
  setActivePinia(pinia)
  return mount(ContentPreview, {
    props: { document, widgets: WIDGETS },
    global: {
      plugins: [pinia, i18n],
      // 캔버스 안에 재생목록 편집기로 가는 링크가 있다. 앱에는 라우터가
      // 있지만 여기엔 없다.
      stubs: { RouterLink: { props: ['to'], template: '<a :href="to"><slot /></a>' } },
    },
    attachTo: window.document.body,
  })
}

beforeEach(() => {
  i18n.global.locale.value = 'ko'
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
    const wrapper = mountPreview(makeDocument([textElement]))
    await flushPromises()

    const names = wrapper.find('.size select').findAll('option').map((o) => o.text())
    expect(names).toEqual(['작게', '보통', '크게', '최대'])
  })

  it('고른 크기로 창이 커진다', async () => {
    const wrapper = mountPreview(makeDocument([textElement]))
    await flushPromises()

    await wrapper.find('.size select').setValue('xl')
    await flushPromises()

    expect(wrapper.find('.dialog').attributes('style')).toContain('96vw')
  })

  it('크기는 세 미리보기가 함께 쓴다', async () => {
    // 설정에 남는 값이라 다른 미리보기에서 고른 것이 여기에도 적용된다.
    localStorage.setItem('signallink.preview.size', 'l')
    const wrapper = mountPreview(makeDocument([textElement]))
    await flushPromises()

    expect(wrapper.find('.dialog').attributes('style')).toContain('1280px')
  })

  it('전체화면 버튼을 둔다', async () => {
    const wrapper = mountPreview(makeDocument([textElement]))
    await flushPromises()

    const button = wrapper.findAll('.btn').find((b) => b.text().includes('전체화면'))
    expect(button).toBeTruthy()
  })

  it('누르면 전체화면을 요청한다', async () => {
    const request = vi.fn(() => Promise.resolve())
    const wrapper = mountPreview(makeDocument([textElement]))
    await flushPromises()

    wrapper.find('.frame').element.requestFullscreen = request
    const button = wrapper.findAll('.btn').find((b) => b.text().includes('전체화면'))
    await button.trigger('click')

    expect(request).toHaveBeenCalled()
  })

  it('나갈 때 전체화면을 풀어 준다', async () => {
    // 창을 닫는데 전체화면으로 남으면 빠져나갈 길이 없다.
    const exit = vi.fn(() => Promise.resolve())
    const wrapper = mountPreview(makeDocument([textElement]))
    await flushPromises()

    Object.defineProperty(globalThis.document, 'fullscreenElement', {
      value: wrapper.find('.frame').element,
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

describe('편집 장치 없이 그린다', () => {
  it('레일을 내놓지 않는다', async () => {
    // 아이콘 레일이 보이면 장치 화면이 아니라 편집 화면이다.
    const wrapper = mountPreview(makeDocument([textElement]))
    await flushPromises()

    expect(wrapper.find('.rail').exists()).toBe(false)
  })

  it('레이어 목록과 배율 조절도 내놓지 않는다', async () => {
    const wrapper = mountPreview(makeDocument([textElement]))
    await flushPromises()

    expect(wrapper.find('.zoom').exists()).toBe(false)
  })

  it('요소는 읽기 전용으로 놓인다', async () => {
    // 끌어 옮기거나 크기를 바꿀 수 있으면 미리보기가 아니다.
    const wrapper = mountPreview(makeDocument([textElement]))
    await flushPromises()

    expect(wrapper.find('.element').classes()).toContain('readonly')
  })

  it('분할 안내선을 그리지 않는다', async () => {
    // 장치에는 없는 선이다. 미리보기에 남으면 실제 화면과 달라진다.
    const wrapper = mountPreview(splitDocument())
    await flushPromises()

    expect(wrapper.find('.region').exists()).toBe(false)
  })

  it('분할선 손잡이도 그리지 않는다', async () => {
    // 이 선이 모달 위로 떠 오르던 것이 문제였다(겹침 순서가 화면 전체와
    // 겨루고 있었다). 애초에 그리지 않는 것이 첫 번째 방어선이다.
    const wrapper = mountPreview(splitDocument())
    await flushPromises()

    expect(wrapper.find('.divider').exists()).toBe(false)
  })

  it('격자도 그리지 않는다', async () => {
    const wrapper = mountPreview(splitDocument())
    await flushPromises()

    expect(wrapper.find('.grid-overlay').exists()).toBe(false)
  })

  it('분할된 콘텐츠도 그대로 보여 준다', async () => {
    const wrapper = mountPreview(splitDocument())
    await flushPromises()

    expect(wrapper.text()).toContain('안내')
  })

  it('내용은 그대로 보여 준다', async () => {
    const wrapper = mountPreview(makeDocument([textElement]))
    await flushPromises()

    expect(wrapper.text()).toContain('안내')
  })
})

describe('무대', () => {
  it('콘텐츠 비율을 따라간다', async () => {
    // 가로형 무대에 세로형을 넣으면 위아래가 잘리거나 여백이 생긴다.
    const wrapper = mountPreview(makeDocument([textElement]))
    await flushPromises()

    expect(wrapper.find('.stage').attributes('style')).toContain('1920 / 1080')
  })

  it('세로형도 그 비율로 잡는다', async () => {
    const portrait = makeDocument([textElement])
    portrait.layout = { width: 1080, height: 1920, background: '#000000' }
    const wrapper = mountPreview(portrait)
    await flushPromises()

    expect(wrapper.find('.stage').attributes('style')).toContain('1080 / 1920')
  })

  it('크기와 요소 수를 알려 준다', async () => {
    const wrapper = mountPreview(makeDocument([textElement]))
    await flushPromises()

    expect(wrapper.find('.preview-meta').text()).toContain('1920×1080')
    expect(wrapper.find('.preview-meta').text()).toContain('1개 요소')
  })

  it('요소가 없어도 열린다', async () => {
    // 빈 콘텐츠를 만들고 바로 눌러 보는 흐름을 막을 이유가 없다.
    const wrapper = mountPreview(makeDocument())
    await flushPromises()

    expect(wrapper.find('.stage').exists()).toBe(true)
  })
})

describe('닫기', () => {
  it('닫으면 알린다', async () => {
    const wrapper = mountPreview(makeDocument([textElement]))
    await flushPromises()

    await wrapper.find('.dialog-head .close').trigger('click')
    expect(wrapper.emitted('close')).toHaveLength(1)
  })
})
