/**
 * 위젯 재생목록 목록 화면 테스트.
 *
 * 이 화면은 목록만 맡는다 — 만들기·수정은 편집기 화면으로 넘어간다
 * (PlaylistEditorView.test.js). 여기서 확인할 것은 재생 순서가 눈에 보이는가,
 * 지워도 되는지 판단할 근거가 있는가, 그리고 편집기로 가는 길이 있는가다.
 */
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { i18n } from '@/i18n'

const WIDGETS = [
  { key: 'notice', name: '공지사항', category: '기능형', description: '', options: [] },
  { key: 'meal', name: '급식메뉴', category: '기능형', description: '', options: [] },
]

let playlists = []

const post = vi.fn(async () => ({}))
const put = vi.fn(async () => ({}))
const del = vi.fn(async () => ({ detail: '재생목록이 삭제되었습니다.' }))
const get = vi.fn(async (path) => {
  if (path === '/widgets') return WIDGETS
  if (path === '/playlists') {
    return { items: playlists, total: playlists.length, page: 1, size: 24 }
  }
  return {}
})

vi.mock('@/api/client', () => ({
  api: {
    get: (...args) => get(...args),
    post: (...args) => post(...args),
    put: (...args) => put(...args),
    delete: (...args) => del(...args),
  },
  TEST_MODE: false,
}))

vi.mock('@/stores/auth', () => ({
  useAuthStore: () => ({ user: { org_id: 3 } }),
}))

import PlaylistsView from './PlaylistsView.vue'

/** RouterLink 스텁. 어디로 가는 링크인지 확인할 수 있게 to 를 남긴다. */
const RouterLinkStub = {
  props: ['to'],
  template: '<a :href="to"><slot /></a>',
}

async function mountView() {
  setActivePinia(createPinia())
  const wrapper = mount(PlaylistsView, {
    global: {
      plugins: [createPinia(), i18n],
      stubs: { RouterLink: RouterLinkStub },
    },
  })
  await flushPromises()
  return wrapper
}

beforeEach(() => {
  playlists = [
    {
      id: 1,
      name: '현관 순환',
      description: '공지 → 급식',
      version: 2,
      usage_count: 0,
      total_duration_sec: 25,
      items: [
        { id: 1, sort_order: 0, widget_key: 'notice', duration_sec: 15, options: {} },
        { id: 2, sort_order: 1, widget_key: 'meal', duration_sec: 10, options: {} },
      ],
    },
  ]
  get.mockClear()
  post.mockClear()
  put.mockClear()
  del.mockClear()
  i18n.global.locale.value = 'ko'
})

describe('목록', () => {
  it('재생 순서를 그대로 늘어놓는다', async () => {
    // 순서가 곧 규칙이라 눈으로 보여야 한다.
    const wrapper = await mountView()
    expect(wrapper.findAll('.chain .chip').map((c) => c.text())).toEqual([
      '공지사항 15s',
      '급식메뉴 10s',
    ])
  })

  it('한 바퀴 도는 시간을 알려 준다', async () => {
    const wrapper = await mountView()
    expect(wrapper.text()).toContain('총 25초')
  })

  it('어디서 쓰는지 보여 준다', async () => {
    // 지워도 되는지 판단하려면 필요하다.
    playlists[0].usage_count = 3
    const wrapper = await mountView()
    expect(wrapper.text()).toContain('콘텐츠 3건에서 사용')
  })

  it('안 쓰이면 사용 배지를 달지 않는다', async () => {
    const wrapper = await mountView()
    expect(wrapper.text()).not.toContain('건에서 사용')
  })

  it('비어 있으면 그렇게 말한다', async () => {
    playlists = []
    const wrapper = await mountView()
    expect(wrapper.text()).toContain('만든 재생목록이 없습니다')
  })

  it('담긴 위젯이 없으면 알려 준다', async () => {
    playlists[0].items = []
    const wrapper = await mountView()
    expect(wrapper.text()).toContain('담긴 위젯이 없습니다')
  })
})

describe('편집기로 가기', () => {
  it('만들기는 새 편집기로 보낸다', async () => {
    // 좁은 모달에서는 위젯을 고르는 일과 순서를 바꾸는 일을 함께 못 한다.
    const wrapper = await mountView()
    const link = wrapper.findAll('a').find((a) => a.text().includes('재생목록 만들기'))
    expect(link.attributes('href')).toBe('/playlists/new')
  })

  it('이름을 누르면 그 재생목록 편집기로 간다', async () => {
    const wrapper = await mountView()
    expect(wrapper.find('.name').attributes('href')).toBe('/playlists/1/edit')
  })

  it('수정 버튼도 같은 곳으로 간다', async () => {
    const wrapper = await mountView()
    const link = wrapper.findAll('a').find((a) => a.text() === '수정')
    expect(link.attributes('href')).toBe('/playlists/1/edit')
  })

  it('목록 화면은 저장하지 않는다', async () => {
    // 편집은 전부 편집기 화면 몫이다.
    await mountView()
    expect(put).not.toHaveBeenCalled()
    expect(post).not.toHaveBeenCalled()
  })
})

describe('복제', () => {
  it('서버에 복제를 맡긴다', async () => {
    const wrapper = await mountView()
    const button = wrapper.findAll('.playlist .btn').find((b) => b.text() === '복제')
    await button.trigger('click')
    await flushPromises()

    expect(post).toHaveBeenCalledWith('/playlists/1/duplicate')
  })
})

describe('삭제', () => {
  it('확인을 받고 지운다', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    const wrapper = await mountView()

    const button = wrapper.findAll('.playlist .btn').find((b) => b.text() === '삭제')
    await button.trigger('click')
    await flushPromises()

    expect(del).toHaveBeenCalledWith('/playlists/1')
    confirmSpy.mockRestore()
  })

  it('취소하면 지우지 않는다', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)
    const wrapper = await mountView()

    const button = wrapper.findAll('.playlist .btn').find((b) => b.text() === '삭제')
    await button.trigger('click')
    await flushPromises()

    expect(del).not.toHaveBeenCalled()
    confirmSpy.mockRestore()
  })
})
