/**
 * 소속기관 공지 목록 테스트.
 *
 * 공지는 기간이 정해진 재생목록이다. 이 화면의 약속: 목록을 보여 주고,
 * 이름·기간으로 만들어 곧장 편집기로 보내며, 삭제는 슬라이드도 함께
 * 사라진다는 사실을 물은 뒤 지운다.
 */
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { i18n } from '@/i18n'

const get = vi.fn()
const post = vi.fn()
const del = vi.fn()

vi.mock('@/api/client', () => ({
  api: {
    get: (...args) => get(...args),
    post: (...args) => post(...args),
    put: vi.fn(),
    delete: (...args) => del(...args),
  },
  TEST_MODE: false,
  getToken: () => null,
  setToken: vi.fn(),
}))

vi.mock('@/stores/auth', () => ({
  useAuthStore: () => ({ user: { org_id: 2 } }),
}))

const push = vi.fn()
vi.mock('vue-router', () => ({
  useRouter: () => ({ push }),
  useRoute: () => ({ params: {}, query: {} }),
}))

import OrgNoticesView from './OrgNoticesView.vue'

let NOTICES = []

async function mountView() {
  setActivePinia(createPinia())
  const wrapper = mount(OrgNoticesView, {
    global: {
      plugins: [createPinia(), i18n],
      stubs: {
        RouterLink: { props: ['to'], template: '<a><slot /></a>' },
        ContentPreview: {
          name: 'ContentPreview',
          props: ['document', 'widgets', 'pageIndex', 'pageTotal'],
          emits: ['close', 'page'],
          template: '<div class="preview-stub" />',
        },
      },
    },
  })
  await flushPromises()
  return wrapper
}

beforeEach(() => {
  i18n.global.locale.value = 'ko'
  NOTICES = [
    {
      id: 1,
      org_id: 2,
      name: '9월 공지',
      start_date: '2026-09-01',
      end_date: '2026-09-30',
      version: 3,
      item_count: 4,
      updated_at: '2026-09-17T00:00:00Z',
    },
    {
      id: 2,
      org_id: 2,
      name: '상시 안내',
      start_date: null,
      end_date: null,
      version: 1,
      item_count: 1,
      updated_at: '2026-09-01T00:00:00Z',
    },
  ]
  get.mockReset()
  post.mockReset()
  del.mockReset()
  push.mockReset()
  get.mockImplementation(async (path) => {
    if (path === '/organizations') return [{ id: 2, name: '서울시교육청' }]
    if (path === '/org-notices') return NOTICES
    return []
  })
})

describe('목록', () => {
  it('이름·기간·슬라이드 수를 보여 준다', async () => {
    const wrapper = await mountView()

    const rows = wrapper.findAll('[data-test="notice-row"]')
    expect(rows).toHaveLength(2)
    expect(rows[0].text()).toContain('9월 공지')
    expect(rows[0].text()).toContain('2026-09-01 ~ 2026-09-30')
    expect(rows[0].text()).toContain('4장')
    // 기간이 없으면 상시로 읽힌다.
    expect(rows[1].text()).toContain('상시')
  })
})

describe('만들기', () => {
  it('이름·기간으로 만들고 곧장 편집기로 간다', async () => {
    post.mockResolvedValueOnce({ id: 9 })
    const wrapper = await mountView()

    await wrapper.find('[data-test="add-notice"]').trigger('click')
    await wrapper.find('[data-test="name-input"]').setValue('10월 공지')
    // datetime-local 입력은 시각까지 있어야 값이 잡힌다.
    await wrapper.find('[data-test="start-input"]').setValue('2026-10-01T09:00')
    await wrapper.find('[data-test="end-input"]').setValue('2026-10-31T18:00')
    await wrapper.find('.dialog-foot .btn-primary').trigger('click')
    await flushPromises()

    expect(post).toHaveBeenCalledWith('/org-notices', {
      org_id: 2,
      name: '10월 공지',
      start_date: '2026-10-01T09:00',
      end_date: '2026-10-31T18:00',
    })
    // 빈 공지는 아무것도 못 튼다 — 슬라이드를 채우러 바로 보낸다.
    expect(push).toHaveBeenCalledWith({ name: 'org-notice-editor', params: { id: 9 } })
  })

  it('이름 없이는 보내지 않는다', async () => {
    const wrapper = await mountView()

    await wrapper.find('[data-test="add-notice"]').trigger('click')
    await wrapper.find('.dialog-foot .btn-primary').trigger('click')
    await flushPromises()

    expect(post).not.toHaveBeenCalled()
  })
})

describe('미리보기', () => {
  const DOC = (text) => ({
    version: 1,
    layout: { width: 1920, height: 1080, background: '#000000' },
    elements: [
      { id: 'e1', type: 'text', rect: { x: 0, y: 0, w: 100, h: 50, z: 1 }, options: { text } },
    ],
  })

  it('상세를 받아 첫 장을 열고, 장을 넘길 수 있다', async () => {
    get.mockImplementation(async (path) => {
      if (path === '/organizations') return [{ id: 2, name: '서울시교육청' }]
      if (path === '/org-notices') return NOTICES
      if (path === '/org-notices/1')
        return {
          ...NOTICES[0],
          items: [
            { id: 11, sort_order: 0, duration_sec: 10, document: DOC('첫 장') },
            { id: 12, sort_order: 1, duration_sec: 10, document: DOC('둘째 장') },
          ],
        }
      if (path === '/widgets') return []
      return []
    })
    const wrapper = await mountView()

    await wrapper.find('[data-test="preview-notice"]').trigger('click')
    await flushPromises()

    const preview = wrapper.findComponent({ name: 'ContentPreview' })
    expect(preview.exists()).toBe(true)
    expect(preview.props('document').elements[0].options.text).toBe('첫 장')
    expect(preview.props('pageTotal')).toBe(2)

    // 장 넘김은 미리보기가 알리고, 어느 장인지는 목록 화면이 쥔다.
    preview.vm.$emit('page', 1)
    await flushPromises()
    expect(preview.props('document').elements[0].options.text).toBe('둘째 장')
  })

  it('슬라이드가 없으면 열지 않고 그렇게 말한다', async () => {
    get.mockImplementation(async (path) => {
      if (path === '/organizations') return [{ id: 2, name: '서울시교육청' }]
      if (path === '/org-notices') return NOTICES
      if (path === '/org-notices/1') return { ...NOTICES[0], items: [] }
      return []
    })
    const wrapper = await mountView()

    await wrapper.find('[data-test="preview-notice"]').trigger('click')
    await flushPromises()

    expect(wrapper.findComponent({ name: 'ContentPreview' }).exists()).toBe(false)
  })
})

describe('삭제', () => {
  it('확인을 물은 뒤 지운다', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    del.mockResolvedValueOnce({ detail: '공지가 삭제되었습니다.' })
    const wrapper = await mountView()

    await wrapper.find('[data-test="remove-notice"]').trigger('click')
    await flushPromises()

    expect(del).toHaveBeenCalledWith('/org-notices/1')
  })
})
