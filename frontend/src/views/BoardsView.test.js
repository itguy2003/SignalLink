/**
 * 기관게시판 화면 테스트.
 *
 * 두 종류의 사람이 함께 쓴다. 관리자는 수집원(어디서 긁어 올지)을 다루고,
 * 커뮤니티 유저는 글을 올린다 — 게시판이 그 사람에게 열려 있는 유일한
 * 창구다. 그래서 확인할 것은 "누가 무엇을 볼 수 있는가"와 "붙인 파일이
 * 실제로 보이는가"다.
 */
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { i18n } from '@/i18n'

const get = vi.fn()
const post = vi.fn()
const upload = vi.fn()
const del = vi.fn()

vi.mock('@/api/client', () => ({
  api: {
    get: (...args) => get(...args),
    post: (...args) => post(...args),
    upload: (...args) => upload(...args),
    delete: (...args) => del(...args),
  },
  TEST_MODE: false,
  getToken: () => null,
  setToken: vi.fn(),
}))

import { useAuthStore } from '@/stores/auth'
import BoardsView from './BoardsView.vue'

const ORGS = [{ id: 3, name: '가나초등학교' }]
const BOARDS = [
  {
    id: 1,
    org_id: 3,
    kind: '게시판',
    url: 'https://school.example/notice',
    scrape_method: null,
    scrape_result: null,
    scrape_count: 2,
    last_scraped_at: null,
  },
]

function post_(over = {}) {
  return {
    id: 10,
    board_id: 1,
    title: '가을 운동회 안내',
    author: '교무실',
    posted_on: '2026-10-01',
    term: null,
    content: null,
    attachments: [],
    ...over,
  }
}

let POSTS = []

async function mountView(...roles) {
  setActivePinia(createPinia())
  const auth = useAuthStore()
  auth.user = { id: 1, user_id: 'tester', name: '테스터', org_id: 3, roles: [...roles, 'MEMBER'] }

  const wrapper = mount(BoardsView, {
    global: {
      plugins: [i18n],
      stubs: { RouterLink: { template: '<a><slot /></a>' } },
    },
  })
  await flushPromises()
  return wrapper
}

/** 수집원 줄을 눌러 글 목록을 연다. */
async function openBoard(wrapper) {
  await wrapper.find('.clickable').trigger('click')
  await flushPromises()
}

const writeButton = (wrapper) => wrapper.findAll('.btn').find((b) => b.text() === '글쓰기')

beforeEach(() => {
  i18n.global.locale.value = 'ko'
  POSTS = [post_()]
  get.mockReset()
  post.mockReset()
  upload.mockReset()
  del.mockReset()
  get.mockImplementation(async (path) => {
    if (path === '/organizations') return ORGS
    if (path === '/boards') return BOARDS
    if (path.endsWith('/posts')) return { items: POSTS, total: POSTS.length, page: 1, size: 20 }
    return {}
  })
  post.mockImplementation(async () => post_({ id: 11, attachments: [] }))
  upload.mockImplementation(async () => ({ id: 5, kind: 'image', filename: 'a.png', url: '/f' }))
})

describe('누가 무엇을 보는가', () => {
  it('관리자에게는 기관 고르기가 보인다', async () => {
    const wrapper = await mountView('ORG_ADMIN')
    expect(wrapper.find('.org-picker').exists()).toBe(true)
  })

  it('커뮤니티 유저에게는 기관 고르기를 두지 않는다', async () => {
    // 기관 목록 자체를 못 받아 온다. 빈 선택 상자는 고장으로 보인다.
    get.mockImplementation(async (path) => {
      if (path === '/organizations') throw { status: 403 }
      if (path === '/boards') return BOARDS
      if (path.endsWith('/posts')) return { items: POSTS, total: 1, page: 1, size: 20 }
      return {}
    })
    const wrapper = await mountView('COMMUNITY_USER')

    expect(wrapper.find('.org-picker').exists()).toBe(false)
    expect(wrapper.findAll('.clickable')).toHaveLength(1)
  })

  it('글을 쓸 수 있는 사람에게만 글쓰기가 보인다', async () => {
    const admin = await mountView('ORG_ADMIN')
    await openBoard(admin)
    expect(writeButton(admin)).toBeDefined()

    const member = await mountView()
    await openBoard(member)
    expect(writeButton(member)).toBeUndefined()
  })

  it('커뮤니티 유저도 글쓰기를 쓸 수 있다', async () => {
    const wrapper = await mountView('COMMUNITY_USER')
    await openBoard(wrapper)

    expect(writeButton(wrapper)).toBeDefined()
  })
})

describe('첨부파일 보이기', () => {
  it('붙인 사진을 그려 준다', async () => {
    // 이름만 늘어놓으면 무엇이 붙었는지 열어 봐야 안다.
    POSTS = [
      post_({
        attachments: [{ id: 5, kind: 'image', filename: '운동회.png', url: '/api/v1/assets/5/k/file' }],
      }),
    ]
    const wrapper = await mountView('ORG_ADMIN')
    await openBoard(wrapper)

    expect(wrapper.find('img.thumb').attributes('src')).toBe('/api/v1/assets/5/k/file')
  })

  it('동영상은 그림 대신 표시를 둔다', async () => {
    POSTS = [post_({ attachments: [{ id: 6, kind: 'video', filename: '영상.mp4', url: '/v' }] })]
    const wrapper = await mountView('ORG_ADMIN')
    await openBoard(wrapper)

    expect(wrapper.find('img.thumb').exists()).toBe(false)
    expect(wrapper.find('.thumb.video').exists()).toBe(true)
  })

  it('붙일 수 없는 사람에게는 떼기 단추를 두지 않는다', async () => {
    POSTS = [post_({ attachments: [{ id: 5, kind: 'image', filename: 'a.png', url: '/f' }] })]
    const wrapper = await mountView()
    await openBoard(wrapper)

    expect(wrapper.find('.file .drop').exists()).toBe(false)
  })

  it('뗀 뒤에는 목록을 다시 받아 온다', async () => {
    // 화면에서만 지우면 새로고침했을 때 되살아난 것처럼 보인다.
    POSTS = [post_({ attachments: [{ id: 5, kind: 'image', filename: 'a.png', url: '/f' }] })]
    const wrapper = await mountView('ORG_ADMIN')
    await openBoard(wrapper)

    await wrapper.find('.file .drop').trigger('click')
    await flushPromises()

    expect(del).toHaveBeenCalledWith('/boards/1/posts/10/attachments/5')
    expect(get.mock.calls.filter(([path]) => path.endsWith('/posts'))).toHaveLength(2)
  })
})

describe('글쓰기', () => {
  async function openWriter(wrapper) {
    await openBoard(wrapper)
    await writeButton(wrapper).trigger('click')
    await flushPromises()
  }

  /** 창 안에서 파일을 고른 셈 친다. */
  async function pick(wrapper, names) {
    const input = wrapper.find('.dialog-body input[type="file"]')
    const files = names.map((name) => new File(['x'], name, { type: 'image/png' }))
    Object.defineProperty(input.element, 'files', { value: files, configurable: true })
    await input.trigger('change')
  }

  const confirm = (wrapper) => wrapper.find('.dialog-foot .btn-primary')

  it('제목이 비면 올리지 않는다', async () => {
    const wrapper = await mountView('COMMUNITY_USER')
    await openWriter(wrapper)

    await confirm(wrapper).trigger('click')
    await flushPromises()

    expect(post).not.toHaveBeenCalled()
    expect(wrapper.find('.error-text').exists()).toBe(true)
  })

  it('글을 올린다', async () => {
    const wrapper = await mountView('COMMUNITY_USER')
    await openWriter(wrapper)

    await wrapper.findAll('.dialog-body .input')[0].setValue('학부모 모임 안내')
    await confirm(wrapper).trigger('click')
    await flushPromises()

    expect(post).toHaveBeenCalledWith('/boards/1/posts', expect.objectContaining({
      title: '학부모 모임 안내',
    }))
  })

  it('고른 파일은 글을 만든 뒤에 붙인다', async () => {
    // 첨부는 글에 붙는 것이라 붙일 글이 있어야 한다.
    const wrapper = await mountView('COMMUNITY_USER')
    await openWriter(wrapper)

    await wrapper.findAll('.dialog-body .input')[0].setValue('사진 올립니다')
    await pick(wrapper, ['하나.png', '둘.png'])
    await confirm(wrapper).trigger('click')
    await flushPromises()

    expect(upload).toHaveBeenCalledTimes(2)
    expect(upload.mock.calls[0][0]).toBe('/boards/1/posts/11/attachments')
  })

  it('고른 파일을 창에서 뺄 수 있다', async () => {
    const wrapper = await mountView('COMMUNITY_USER')
    await openWriter(wrapper)

    await pick(wrapper, ['하나.png', '둘.png'])
    expect(wrapper.findAll('.picked li')).toHaveLength(2)

    await wrapper.findAll('.picked .drop')[0].trigger('click')
    expect(wrapper.findAll('.picked li')).toHaveLength(1)
  })

  it('파일이 막혀도 글은 살린다', async () => {
    // 사진 한 장 때문에 쓴 글을 통째로 잃으면 안 된다.
    upload.mockRejectedValue({ detail: '파일은 20MB 이하여야 합니다.' })
    const wrapper = await mountView('COMMUNITY_USER')
    await openWriter(wrapper)

    await wrapper.findAll('.dialog-body .input')[0].setValue('사진 올립니다')
    await pick(wrapper, ['큰.png'])
    await confirm(wrapper).trigger('click')
    await flushPromises()

    expect(post).toHaveBeenCalled()
    // 창은 닫힌다 — 글은 올라갔기 때문이다.
    expect(wrapper.find('.dialog-body').exists()).toBe(false)
  })
})
