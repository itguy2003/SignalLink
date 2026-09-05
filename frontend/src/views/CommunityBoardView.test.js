/**
 * 커뮤니티 공유 게시판 테스트.
 *
 * 어느 커뮤니티를 보는지, 올릴 수 있는지는 전부 **서버가 답한다**
 * (`/community/context`). 화면은 그 답대로 제목을 그리고 버튼을 켤 뿐이다 —
 * 역할 계산을 화면에서 다시 하면 서버와 어긋난 날 화면만 다르게 군다.
 */
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { i18n } from '@/i18n'

const get = vi.fn()
const post = vi.fn()
const upload = vi.fn()
const del = vi.fn()
const put = vi.fn()

vi.mock('@/api/client', () => ({
  api: {
    get: (...args) => get(...args),
    post: (...args) => post(...args),
    upload: (...args) => upload(...args),
    delete: (...args) => del(...args),
    put: (...args) => put(...args),
  },
  TEST_MODE: false,
  getToken: () => null,
  setToken: vi.fn(),
}))

import CommunityBoardView from './CommunityBoardView.vue'

let CONTEXT = null
let POSTS = []

function post_(over = {}) {
  return {
    id: 10,
    org_id: 2,
    author_id: 8,
    author_name: '지역 주민',
    title: '주말 독서 모임',
    content: '토요일 10시',
    created_at: '2026-09-01T09:00:00',
    attachments: [],
    publish_status: '대기중',
    can_remove: false,
    can_publish: false,
    ...over,
  }
}

async function mountView() {
  setActivePinia(createPinia())
  const wrapper = mount(CommunityBoardView, {
    global: { plugins: [createPinia(), i18n] },
  })
  await flushPromises()
  return wrapper
}

beforeEach(() => {
  i18n.global.locale.value = 'ko'
  CONTEXT = { org_id: 2, org_name: '인천광역시교육청', can_share: true }
  POSTS = [post_()]
  get.mockReset()
  put.mockReset()
  post.mockReset()
  upload.mockReset()
  del.mockReset()
  get.mockImplementation(async (path) => {
    if (path === '/community/list') return [CONTEXT]
    if (path === '/community/context') return CONTEXT
    if (path === '/community/posts') return { items: POSTS, total: POSTS.length, page: 1, size: 20 }
    return {}
  })
  post.mockImplementation(async () => post_({ id: 11 }))
  upload.mockImplementation(async () => ({ id: 5, kind: 'image', filename: 'a.png', url: '/f' }))
})

describe('서버가 정한 커뮤니티를 그린다', () => {
  it('어느 기관의 커뮤니티인지 제목에 밝힌다', async () => {
    const wrapper = await mountView()
    expect(wrapper.text()).toContain('인천광역시교육청 커뮤니티')
  })

  it('글과 쓴 사람을 보여 준다', async () => {
    const wrapper = await mountView()

    expect(wrapper.text()).toContain('주말 독서 모임')
    expect(wrapper.text()).toContain('지역 주민')
  })

  it('올릴 수 있는 사람에게만 글쓰기가 보인다', async () => {
    const sharer = await mountView()
    expect(sharer.findAll('.btn').some((b) => b.text() === '글쓰기')).toBe(true)

    CONTEXT = { ...CONTEXT, can_share: false }
    const viewer = await mountView()
    expect(viewer.findAll('.btn').some((b) => b.text() === '글쓰기')).toBe(false)
  })

  it('커뮤니티가 없으면 그렇게 말한다', async () => {
    get.mockImplementation(async (path) => {
      if (path === '/community/context') throw { status: 404, detail: '커뮤니티을(를) 찾을 수 없습니다.' }
      return {}
    })
    const wrapper = await mountView()

    expect(wrapper.find('.table-empty').exists()).toBe(true)
  })

  it('목록은 표 형식이고 첨부는 개수로 표시한다', async () => {
    POSTS = [
      post_({ attachments: [{ id: 5, kind: 'image', filename: '모임.png', url: '/api/v1/assets/5/k/file' }] }),
    ]
    const wrapper = await mountView()

    expect(wrapper.find('table.board-table').exists()).toBe(true)
    expect(wrapper.find('.attach-count').text()).toContain('1')
    // 내용·첨부 원본은 읽기 창의 몫이다.
    expect(wrapper.find('.reader-body').exists()).toBe(false)
  })
})

describe('읽기', () => {
  it('줄을 누르면 읽기 창에 내용과 첨부가 열린다', async () => {
    POSTS = [
      post_({ attachments: [{ id: 5, kind: 'image', filename: '모임.png', url: '/api/v1/assets/5/k/file' }] }),
    ]
    const wrapper = await mountView()

    await wrapper.find('[data-test="post-row"]').trigger('click')

    expect(wrapper.find('[data-test="reader-body"]').text()).toBe('토요일 10시')
    expect(wrapper.find('img.reader-media').attributes('src')).toBe('/api/v1/assets/5/k/file')
  })

  it('동영상 첨부는 읽기에서 바로 튼다', async () => {
    POSTS = [
      post_({ attachments: [{ id: 6, kind: 'video', filename: '행사.mp4', url: '/v/6' }] }),
    ]
    const wrapper = await mountView()
    await wrapper.find('[data-test="post-row"]').trigger('click')

    const video = wrapper.find('video.reader-media')
    expect(video.exists()).toBe(true)
    expect(video.attributes('controls')).toBeDefined()
  })

  it('지울 수 있다고 서버가 답한 글에만 지우기가 붙는다', async () => {
    POSTS = [post_({ can_remove: false })]
    const wrapper = await mountView()
    await wrapper.find('[data-test="post-row"]').trigger('click')

    expect(wrapper.findAll('.reader-meta .btn').some((b) => b.text() === '삭제')).toBe(false)
  })
})

describe('게시 결과', () => {
  // 글은 대기중으로 시작한다. 작성자는 손대지 못하고 커뮤니티 소유 기관의
  // 관리자만 대기중·게시·게시보류를 정한다 — 서버의 can_publish 가 근거다.

  it('보통 사람에게는 목록과 읽기 모두 배지로만 보인다', async () => {
    POSTS = [post_({ publish_status: '게시보류' })]
    const wrapper = await mountView()

    expect(wrapper.find('[data-test="status-badge"]').text()).toBe('게시 보류')

    await wrapper.find('[data-test="post-row"]').trigger('click')
    expect(wrapper.find('[data-test="reader-status"]').text()).toBe('게시 보류')
    expect(wrapper.find('[data-test="status-select"]').exists()).toBe(false)
  })

  it('관리자는 읽기 창에서 골라 바꾸고 목록에도 반영된다', async () => {
    POSTS = [post_({ can_publish: true })]
    put.mockImplementation(async () => post_({ publish_status: '게시', can_publish: true }))
    const wrapper = await mountView()

    await wrapper.find('[data-test="post-row"]').trigger('click')
    const select = wrapper.find('[data-test="status-select"]')
    expect(select.exists()).toBe(true)
    await select.setValue('게시')
    await flushPromises()

    expect(put).toHaveBeenCalledWith('/community/posts/10/status', { status: '게시' })
    // 같은 객체라 목록 배지도 함께 바뀐다.
    expect(wrapper.find('[data-test="status-badge"]').text()).toBe('게시')
  })
})

describe('글쓰기', () => {
  async function openWriter(wrapper) {
    await wrapper.findAll('.btn').find((b) => b.text() === '글쓰기').trigger('click')
    await flushPromises()
  }

  const confirm = (wrapper) => wrapper.find('.dialog-foot .btn-primary')

  it('제목이 비면 올리지 않는다', async () => {
    const wrapper = await mountView()
    await openWriter(wrapper)

    await confirm(wrapper).trigger('click')
    await flushPromises()

    expect(post).not.toHaveBeenCalled()
    expect(wrapper.find('.error-text').exists()).toBe(true)
  })

  it('글을 올리고 목록을 다시 받는다', async () => {
    const wrapper = await mountView()
    await openWriter(wrapper)

    await wrapper.find('.dialog-body .input').setValue('나눔 장터 엽니다')
    await confirm(wrapper).trigger('click')
    await flushPromises()

    expect(post).toHaveBeenCalledWith(
      '/community/posts',
      { title: '나눔 장터 엽니다', content: null },
      { org_id: 2 },
    )
    expect(get.mock.calls.filter(([p]) => p === '/community/posts')).toHaveLength(2)
  })

  it('고른 파일은 글을 만든 뒤에 붙인다', async () => {
    // 첨부는 글에 붙는 것이라 붙일 글이 먼저다.
    const wrapper = await mountView()
    await openWriter(wrapper)
    await wrapper.find('.dialog-body .input').setValue('사진 나눔')

    const input = wrapper.find('.dialog-body input[type="file"]')
    const files = ['하나.png', '둘.png'].map((n) => new File(['x'], n, { type: 'image/png' }))
    Object.defineProperty(input.element, 'files', { value: files, configurable: true })
    await input.trigger('change')

    await confirm(wrapper).trigger('click')
    await flushPromises()

    expect(upload).toHaveBeenCalledTimes(2)
    expect(upload.mock.calls[0][0]).toBe('/community/posts/11/attachments')
  })

  it('파일이 막혀도 글은 살린다', async () => {
    // 사진 한 장 때문에 쓴 글을 통째로 잃으면 안 된다.
    upload.mockRejectedValue({ detail: '파일은 20MB 이하여야 합니다.' })
    const wrapper = await mountView()
    await openWriter(wrapper)
    await wrapper.find('.dialog-body .input').setValue('사진 나눔')

    const input = wrapper.find('.dialog-body input[type="file"]')
    Object.defineProperty(input.element, 'files', {
      value: [new File(['x'], '큰.png', { type: 'image/png' })],
      configurable: true,
    })
    await input.trigger('change')
    await confirm(wrapper).trigger('click')
    await flushPromises()

    expect(post).toHaveBeenCalled()
    expect(wrapper.find('.dialog-body').exists()).toBe(false)
  })
})
