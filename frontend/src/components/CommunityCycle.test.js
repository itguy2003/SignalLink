/**
 * 커뮤니티 위젯 표출 테스트.
 *
 * 무엇을 틀지는 언제나 서버가 판정한다 — 이 컴포넌트의 약속은 두 가지다.
 * 편집자가 집은 재생목록(playlist_id)을 서버에 그대로 전하는 것, 그리고
 * 서버의 판정(active/items)을 말 그대로 따르는 것.
 */
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { i18n } from '@/i18n'

const get = vi.fn()

vi.mock('@/api/client', () => ({
  api: { get: (...args) => get(...args) },
  TEST_MODE: false,
}))

import CommunityCycle from './CommunityCycle.vue'

const ITEMS = [
  { kind: 'image', asset_id: 1, duration_sec: 8, url: '/a/1', title: '사진1' },
  { kind: 'video', asset_id: 2, duration_sec: 30, url: '/a/2', title: '영상1' },
]

async function mountCycle(options = {}) {
  const wrapper = mount(CommunityCycle, {
    props: { options, orgId: 3 },
    global: { plugins: [i18n] },
  })
  await flushPromises()
  return wrapper
}

beforeEach(() => {
  i18n.global.locale.value = 'ko'
  get.mockReset()
  get.mockResolvedValue({
    key: 'community',
    data: {
      active: true,
      title: '가을 축제 홍보',
      version: 1,
      items: ITEMS,
      total_duration_sec: 38,
    },
  })
})

describe('서버에 판정을 맡긴다', () => {
  it('집은 재생목록(playlist_id)을 옵션으로 그대로 전한다', async () => {
    await mountCycle({ playlist_id: 12 })

    const [path, params] = get.mock.calls[0]
    expect(path).toBe('/widgets/community/data')
    expect(JSON.parse(params.options)).toEqual({ playlist_id: 12 })
    expect(params.org_id).toBe(3)
  })

  it('집은 것이 없으면 빈 옵션 — 서버의 자동 선택에 맡긴다', async () => {
    await mountCycle({})

    const [, params] = get.mock.calls[0]
    expect(JSON.parse(params.options)).toEqual({})
  })
})

describe('판정을 말 그대로 따른다', () => {
  it('active 면 첫 칸부터 튼다', async () => {
    const wrapper = await mountCycle()
    const image = wrapper.find('[data-test="slide-image"]')
    expect(image.exists()).toBe(true)
    expect(image.attributes('src')).toBe('/a/1')
  })

  it('표출 시간이 지나면 다음 칸으로 넘어간다', async () => {
    vi.useFakeTimers()
    try {
      const wrapper = await mountCycle()
      // 첫 칸(이미지, 8초)이 끝나면 두 번째 칸(동영상)으로.
      vi.advanceTimersByTime(8000)
      await flushPromises()
      expect(wrapper.find('[data-test="slide-video"]').exists()).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  it('전체 재생시간 대비 진행률을 아래 막대로 보여 준다', async () => {
    vi.useFakeTimers()
    try {
      const wrapper = await mountCycle()
      // 총 38초 중 4초 ≈ 10.5%.
      vi.advanceTimersByTime(4000)
      await flushPromises()

      const style = wrapper.find('[data-test="cycle-progress"]').attributes('style')
      const pct = Number(/width:\s*([\d.]+)%/.exec(style)?.[1])
      expect(pct).toBeGreaterThan(9)
      expect(pct).toBeLessThan(12)
    } finally {
      vi.useRealTimers()
    }
  })

  it('active=false 면 아무것도 틀지 않고 그 사실만 알린다', async () => {
    // 게시 전 판정은 서버 몫 — 화면이 제멋대로 틀면 안 된다.
    get.mockResolvedValueOnce({
      key: 'community',
      data: { active: false, title: null, version: 0, items: [], total_duration_sec: 0 },
    })
    const wrapper = await mountCycle()

    expect(wrapper.find('[data-test="slide-image"]').exists()).toBe(false)
    expect(wrapper.text()).toContain(i18n.global.t('community.inactive'))
  })

  it('문서 칸은 콘텐츠 캔버스로 그리고, 안에 든 커뮤니티 위젯은 뺀다', async () => {
    // 2026-10: 칸은 소속기관 공지와 같은 콘텐츠 문서다.
    get.mockResolvedValueOnce({
      key: 'community',
      data: {
        active: true,
        title: '문서 확인',
        version: 1,
        items: [
          {
            duration_sec: 12,
            document: {
              version: 1,
              layout: { width: 1920, height: 1080, background: '#000' },
              elements: [
                { id: 'e1', type: 'text', rect: { x: 0, y: 0, w: 100, h: 50, z: 1 }, options: { text: '안내' } },
                { id: 'e2', type: 'widget', widget_key: 'community', rect: { x: 0, y: 0, w: 100, h: 50, z: 1 }, options: {} },
              ],
            },
          },
        ],
        total_duration_sec: 12,
      },
    })
    const wrapper = mount(CommunityCycle, {
      props: { options: {}, orgId: 3 },
      global: {
        plugins: [i18n],
        stubs: {
          ContentCanvas: {
            props: ['document'],
            template: '<div class="canvas-stub">{{ document.elements.map((e) => e.type).join(",") }}</div>',
          },
        },
      },
    })
    await flushPromises()

    expect(wrapper.find('[data-test="slide-document"]').exists()).toBe(true)
    // 커뮤니티 위젯 요소는 걸러지고 글자 요소만 남는다.
    expect(wrapper.find('.canvas-stub').text()).toBe('text')
  })

  it('QR 칸은 화면 중앙 QR 과 메시지로 그린다', async () => {
    get.mockResolvedValueOnce({
      key: 'community',
      data: {
        active: true,
        title: 'QR 안내',
        version: 1,
        items: [
          { kind: 'qr', qr_text: 'https://school.example.org', message: 'QR 로 확인하세요', duration_sec: 10 },
        ],
        total_duration_sec: 10,
      },
    })
    const wrapper = await mountCycle()

    const stage = wrapper.find('[data-test="slide-qr"]')
    expect(stage.exists()).toBe(true)
    // 순수 JS 생성 — 데이터 주소가 그 자리에서 만들어진다.
    expect(stage.find('img').attributes('src')).toMatch(/^data:image\//)
    expect(wrapper.find('[data-test="qr-message"]').text()).toBe('QR 로 확인하세요')
  })

  it('소리를 켠 동영상 칸은 음소거 없이 튼다', async () => {
    get.mockResolvedValueOnce({
      key: 'community',
      data: {
        active: true,
        title: '소리 확인',
        version: 1,
        items: [{ kind: 'video', asset_id: 2, duration_sec: 20, muted: false, url: '/a/2' }],
        total_duration_sec: 20,
      },
    })
    const wrapper = await mountCycle()

    expect(wrapper.find('[data-test="slide-video"]').element.muted).toBe(false)
  })

  it('요청이 실패해도 조용히 빈 상태로 남는다', async () => {
    get.mockRejectedValueOnce(new Error('down'))
    const wrapper = await mountCycle()

    expect(wrapper.find('[data-test="slide-image"]').exists()).toBe(false)
  })
})
