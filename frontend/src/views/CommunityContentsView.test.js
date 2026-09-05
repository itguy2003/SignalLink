/**
 * 커뮤니티 콘텐츠 목록 테스트.
 *
 * 편집은 CMS 와 같은 전면 캔버스 편집기가 맡는다. 이 화면의 일은 셋이다 —
 * 목록을 보여 주고, 빈 캔버스를 만들어 편집기로 보내고, 지운다.
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
    delete: (...args) => del(...args),
    put: vi.fn(),
    upload: vi.fn(),
  },
  TEST_MODE: false,
  getToken: () => null,
  setToken: vi.fn(),
}))

const push = vi.fn()
vi.mock('vue-router', () => ({
  useRouter: () => ({ push }),
  useRoute: () => ({ params: {}, query: {} }),
}))

import CommunityContentsView from './CommunityContentsView.vue'

const CONTEXT = { org_id: 2, org_name: '인천광역시교육청', can_share: true }

let CONTENTS = []

function content(over = {}) {
  return {
    id: 7,
    org_id: 2,
    author_id: 8,
    author_name: '지역 주민',
    title: '시월 소식',
    version: 3,
    created_at: '2026-09-01T09:00:00',
    document: { version: 1, layout: {}, elements: [] },
    element_count: 2,
    can_remove: true,
    ...over,
  }
}

async function mountView() {
  setActivePinia(createPinia())
  const wrapper = mount(CommunityContentsView, {
    global: {
      plugins: [createPinia(), i18n],
      stubs: { RouterLink: { props: ['to'], template: '<a :href="to"><slot /></a>' } },
    },
  })
  await flushPromises()
  return wrapper
}

beforeEach(() => {
  i18n.global.locale.value = 'ko'
  CONTENTS = [content()]
  get.mockReset()
  post.mockReset()
  del.mockReset()
  push.mockReset()
  get.mockImplementation(async (path) => {
    if (path === '/community/list') return [CONTEXT]
    if (path === '/community/context') return CONTEXT
    if (path === '/community/contents')
      return { items: CONTENTS, total: CONTENTS.length, page: 1, size: 20 }
    return {}
  })
  post.mockImplementation(async () => content({ id: 9, title: '새 커뮤니티 콘텐츠' }))
})

describe('목록', () => {
  it('제목·규모·버전을 보여 준다', async () => {
    const wrapper = await mountView()

    expect(wrapper.text()).toContain('시월 소식')
    expect(wrapper.text()).toContain('요소 2개')
    expect(wrapper.text()).toContain('v3')
  })

  it('사용대상과 사용기간을 보여 준다', async () => {
    // 위젯이 이 값으로 무엇을 틀지 정한다 — 목록에서 보여야 관리가 된다.
    CONTENTS = [
      content({ audience: '초', start_date: '2026-09-01', end_date: '2026-09-30' }),
    ]
    const wrapper = await mountView()

    expect(wrapper.text()).toContain('초등')
    expect(wrapper.text()).toContain('2026-09-01 ~ 2026-09-30')
  })

  it('수정은 전면 편집기로 간다', async () => {
    // CMS 콘텐츠와 같은 캔버스라, 좁은 창이 아니라 화면 전체가 필요하다.
    const wrapper = await mountView()

    expect(wrapper.find('a.btn').attributes('href')).toBe('/community/contents/7/editor')
  })

  it('만들 수 없는 사람에게는 만들기가 없다', async () => {
    get.mockImplementation(async (path) => {
      if (path === '/community/list') return [{ ...CONTEXT, can_share: false }]
      if (path === '/community/context') return { ...CONTEXT, can_share: false }
      if (path === '/community/contents') return { items: [], total: 0, page: 1, size: 20 }
      return {}
    })
    const wrapper = await mountView()

    expect(wrapper.findAll('.btn').some((b) => b.text() === '콘텐츠 만들기')).toBe(false)
  })
})

describe('만들기', () => {
  it('빈 캔버스를 만들고 곧장 편집기로 간다', async () => {
    // 제목·내용은 편집기에서 다듬는다 — CMS 콘텐츠와 같은 흐름이다.
    const wrapper = await mountView()

    await wrapper.findAll('.btn').find((b) => b.text() === '콘텐츠 만들기').trigger('click')
    await flushPromises()

    expect(post).toHaveBeenCalledWith(
      '/community/contents',
      { title: '새 커뮤니티 콘텐츠' },
      { org_id: 2 },
    )
    expect(push).toHaveBeenCalledWith('/community/contents/9/editor')
  })
})

describe('지우기', () => {
  it('지우고 목록을 다시 받는다', async () => {
    const wrapper = await mountView()

    globalThis.confirm = () => true
    await wrapper.findAll('.btn').find((b) => b.text() === '삭제').trigger('click')
    await flushPromises()

    expect(del).toHaveBeenCalledWith('/community/contents/7')
    expect(get.mock.calls.filter(([p]) => p === '/community/contents')).toHaveLength(2)
  })
})
