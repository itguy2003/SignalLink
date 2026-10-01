/**
 * 소속기관 공지 편집기 테스트 — 좌(편집기)/우(재생목록) 분할.
 *
 * 약속: 오른쪽 목록에서 슬라이드를 추가·삭제·이동하고, 왼쪽 캔버스는 고른
 * 슬라이드의 문서를 편집한다. 저장은 아이템 전체를 순서대로 보낸다.
 */
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { i18n } from '@/i18n'

const get = vi.fn()
const put = vi.fn()

vi.mock('@/api/client', () => ({
  api: {
    get: (...args) => get(...args),
    post: vi.fn(),
    put: (...args) => put(...args),
    delete: vi.fn(),
  },
  TEST_MODE: false,
  getToken: () => null,
  setToken: vi.fn(),
}))

const push = vi.fn()
vi.mock('vue-router', () => ({
  useRouter: () => ({ push }),
  useRoute: () => ({ params: { id: '7' }, query: {} }),
}))

import OrgNoticeEditorView from './OrgNoticeEditorView.vue'

function doc(text) {
  return {
    version: 1,
    layout: { width: 1920, height: 1080, background: '#000000' },
    elements: [
      { id: 'e1', type: 'text', rect: { x: 0, y: 0, w: 100, h: 50, z: 1 }, options: { text } },
    ],
  }
}

let DETAIL = null

/** 캔버스는 무겁다 — 어떤 문서를 받았는지만 남기는 스텁으로 바꾼다. */
const CanvasStub = {
  props: ['document'],
  template: '<div class="canvas-stub">{{ document.elements[0]?.options.text ?? "빈 문서" }}</div>',
}

async function mountEditor() {
  setActivePinia(createPinia())
  const wrapper = mount(OrgNoticeEditorView, {
    global: {
      plugins: [createPinia(), i18n],
      stubs: { ContentCanvas: CanvasStub, ContentPreview: true },
    },
  })
  await flushPromises()
  return wrapper
}

beforeEach(() => {
  i18n.global.locale.value = 'ko'
  DETAIL = {
    id: 7,
    org_id: 2,
    name: '9월 공지',
    start_date: '2026-09-01',
    end_date: '2026-09-30',
    version: 2,
    item_count: 2,
    items: [
      { id: 11, sort_order: 0, duration_sec: 10, document: doc('첫 장') },
      { id: 12, sort_order: 1, duration_sec: 20, document: doc('둘째 장') },
    ],
  }
  get.mockReset()
  put.mockReset()
  push.mockReset()
  get.mockImplementation(async (path) => {
    if (path === '/org-notices/7') return JSON.parse(JSON.stringify(DETAIL))
    if (path === '/widgets') return []
    return []
  })
})

describe('분할 화면', () => {
  it('오른쪽에 재생목록, 왼쪽에 고른 슬라이드의 편집기가 선다', async () => {
    const wrapper = await mountEditor()

    expect(wrapper.findAll('[data-test="slide-row"]')).toHaveLength(2)
    // 처음에는 첫 슬라이드가 편집기에 올라 있다.
    expect(wrapper.find('.canvas-stub').text()).toBe('첫 장')
  })

  it('오른쪽에서 고르면 왼쪽 편집기가 그 슬라이드로 바뀐다', async () => {
    const wrapper = await mountEditor()

    await wrapper.findAll('[data-test="slide-row"]')[1].trigger('click')

    expect(wrapper.find('.canvas-stub').text()).toBe('둘째 장')
  })
})

describe('슬라이드 관리', () => {
  it('추가하면 빈 문서가 생기고 곧장 선택된다', async () => {
    const wrapper = await mountEditor()

    await wrapper.find('[data-test="add-slide"]').trigger('click')

    expect(wrapper.findAll('[data-test="slide-row"]')).toHaveLength(3)
    expect(wrapper.find('.canvas-stub').text()).toBe('빈 문서')
  })

  it('위치를 바꾸면 저장 순서도 그대로 바뀐다', async () => {
    put.mockResolvedValueOnce({ version: 3 })
    const wrapper = await mountEditor()

    // 둘째 장을 위로 — 재생 순서가 곧 저장 순서다.
    await wrapper.findAll('[data-test="move-up"]')[1].trigger('click')
    await wrapper.find('[data-test="save"]').trigger('click')
    await flushPromises()

    const body = put.mock.calls[0][1]
    const texts = body.items.map((item) => item.document.elements[0].options.text)
    expect(texts).toEqual(['둘째 장', '첫 장'])
  })

  it('유지 시간을 바꿔 저장한다(한계 밖은 끌어다 맞춘다)', async () => {
    put.mockResolvedValueOnce({ version: 3 })
    const wrapper = await mountEditor()

    await wrapper.findAll('[data-test="duration-input"]')[0].setValue('0')
    await wrapper.find('[data-test="save"]').trigger('click')
    await flushPromises()

    expect(put.mock.calls[0][1].items[0].duration_sec).toBe(1)
  })

  it('빼면 목록과 저장에서 함께 빠진다', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    put.mockResolvedValueOnce({ version: 3 })
    const wrapper = await mountEditor()

    await wrapper.findAll('[data-test="remove-slide"]')[0].trigger('click')
    await wrapper.find('[data-test="save"]').trigger('click')
    await flushPromises()

    expect(wrapper.findAll('[data-test="slide-row"]')).toHaveLength(1)
    expect(put.mock.calls[0][1].items).toHaveLength(1)
  })
})

describe('저장', () => {
  it('이름·기간·아이템 전체를 보낸다', async () => {
    put.mockResolvedValueOnce({ version: 3 })
    const wrapper = await mountEditor()

    await wrapper.find('[data-test="save"]').trigger('click')
    await flushPromises()

    const [path, body] = put.mock.calls[0]
    expect(path).toBe('/org-notices/7')
    expect(body.name).toBe('9월 공지')
    // 날짜만 있던 옛 값은 분 단위로 넓혀 보낸다(시작 00:00).
    expect(body.start_date).toBe('2026-09-01T00:00')
    expect(body.items).toHaveLength(2)
    // 서버 id 는 보내지 않는다 — 전체 교체 계약이다.
    expect(body.items[0].id).toBeUndefined()
  })

  it('저장이 끝나면 목록 화면으로 돌아간다', async () => {
    put.mockResolvedValueOnce({ version: 3 })
    const wrapper = await mountEditor()

    await wrapper.find('[data-test="save"]').trigger('click')
    await flushPromises()

    expect(push).toHaveBeenCalledWith('/org-notices')
  })

  it('저장이 실패하면 화면에 머문다', async () => {
    // 실패했는데 떠나면 고친 내용이 사라진 줄 안다.
    put.mockRejectedValueOnce({ detail: '저장 실패' })
    const wrapper = await mountEditor()

    await wrapper.find('[data-test="save"]').trigger('click')
    await flushPromises()

    expect(push).not.toHaveBeenCalled()
  })
})
