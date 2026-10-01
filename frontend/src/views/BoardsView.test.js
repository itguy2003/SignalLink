/**
 * 기관게시판 화면 테스트 — 소스 등록/수정/삭제.
 *
 * 게시판은 수집(스크래핑)의 소스 정의다. 약속: 종류·주소·수집 방법을 넣어
 * 등록하고, 행에서 바로 고치고, 지울 때는 수집 데이터도 함께 사라진다는
 * 사실을 물은 뒤 지운다.
 */
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { i18n } from '@/i18n'

const get = vi.fn()
const post = vi.fn()
const put = vi.fn()
const del = vi.fn()

vi.mock('@/api/client', () => ({
  api: {
    get: (...args) => get(...args),
    post: (...args) => post(...args),
    put: (...args) => put(...args),
    delete: (...args) => del(...args),
  },
  TEST_MODE: false,
  getToken: () => null,
  setToken: vi.fn(),
}))

vi.mock('@/stores/auth', () => ({
  useAuthStore: () => ({ user: { org_id: 3 } }),
}))

import BoardsView from './BoardsView.vue'

let BOARDS = []

function board_(over = {}) {
  return {
    id: 1,
    org_id: 3,
    name: '본관 공지',
    kind: '게시판',
    url: 'https://school.example.kr/board',
    scrape_method: 'rss',
    scrape_result: '성공',
    scrape_count: 12,
    last_scraped_at: '2026-09-17T00:00:00Z',
    ...over,
  }
}

async function mountView() {
  setActivePinia(createPinia())
  const wrapper = mount(BoardsView, {
    global: { plugins: [createPinia(), i18n] },
  })
  await flushPromises()
  return wrapper
}

beforeEach(() => {
  i18n.global.locale.value = 'ko'
  BOARDS = [board_(), board_({ id: 2, kind: '급식메뉴', url: 'https://school.example.kr/meal' })]
  get.mockReset()
  post.mockReset()
  put.mockReset()
  del.mockReset()
  get.mockImplementation(async (path) => {
    if (path === '/organizations') return [{ id: 3, name: '가나초등학교' }]
    if (path === '/boards') return BOARDS
    return { items: [], total: 0, page: 1, size: 20 }
  })
})

describe('등록', () => {
  it('종류·주소·수집 방법을 담아 보낸다', async () => {
    post.mockResolvedValueOnce({})
    const wrapper = await mountView()

    await wrapper.find('[data-test="add-board"]').trigger('click')
    await wrapper.find('[data-test="name-input"]').setValue('학사 일정판')
    await wrapper.find('[data-test="kind-select"]').setValue('일정')
    await wrapper.find('[data-test="url-input"]').setValue('https://school.example.kr/cal')
    await wrapper.find('[data-test="method-input"]').setValue('table#cal')
    await wrapper.find('.dialog-foot .btn-primary').trigger('click')
    await flushPromises()

    expect(post).toHaveBeenCalledWith('/boards', {
      name: '학사 일정판',
      kind: '일정',
      url: 'https://school.example.kr/cal',
      scrape_method: 'table#cal',
      org_id: 3,
    })
  })

  it('주소 없이는 보내지 않는다', async () => {
    const wrapper = await mountView()

    await wrapper.find('[data-test="add-board"]').trigger('click')
    await wrapper.find('.dialog-foot .btn-primary').trigger('click')
    await flushPromises()

    expect(post).not.toHaveBeenCalled()
    expect(wrapper.find('.error-text').text()).toContain('주소')
  })

  it('수집 방법은 비워도 된다 — null 로 보낸다', async () => {
    post.mockResolvedValueOnce({})
    const wrapper = await mountView()

    await wrapper.find('[data-test="add-board"]').trigger('click')
    await wrapper.find('[data-test="url-input"]').setValue('https://x.example.kr')
    await wrapper.find('.dialog-foot .btn-primary').trigger('click')
    await flushPromises()

    expect(post.mock.calls[0][1].scrape_method).toBeNull()
  })
})

describe('수정', () => {
  it('행의 값을 채워 열고, 고친 값을 보낸다', async () => {
    put.mockResolvedValueOnce({})
    const wrapper = await mountView()

    await wrapper.find('[data-test="edit-board"]').trigger('click')
    expect(wrapper.find('[data-test="url-input"]').element.value).toBe(
      'https://school.example.kr/board',
    )

    await wrapper.find('[data-test="url-input"]').setValue('https://school.example.kr/notice')
    await wrapper.find('.dialog-foot .btn-primary').trigger('click')
    await flushPromises()

    expect(put).toHaveBeenCalledWith('/boards/1', {
      name: '본관 공지',
      kind: '게시판',
      url: 'https://school.example.kr/notice',
      scrape_method: 'rss',
    })
  })

  it('수정 버튼이 행 선택(수집 데이터 열기)을 끌고 가지 않는다', async () => {
    const wrapper = await mountView()

    await wrapper.find('[data-test="edit-board"]').trigger('click')

    // 수집 데이터 표가 열리지 않고 수정 창만 뜬다.
    expect(get.mock.calls.some(([path]) => path.includes('/posts'))).toBe(false)
    expect(wrapper.find('.dialog').exists()).toBe(true)
  })
})

describe('삭제', () => {
  it('확인을 물은 뒤 지우고 목록을 다시 받는다', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    del.mockResolvedValueOnce({ detail: '게시판이 삭제되었습니다.' })
    const wrapper = await mountView()

    await wrapper.find('[data-test="remove-board"]').trigger('click')
    await flushPromises()

    expect(del).toHaveBeenCalledWith('/boards/1')
  })

  it('취소하면 아무것도 하지 않는다', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    const wrapper = await mountView()

    await wrapper.find('[data-test="remove-board"]').trigger('click')
    await flushPromises()

    expect(del).not.toHaveBeenCalled()
  })
})

describe('이름', () => {
  it('목록에 이름이 보이고, 수정 창에 채워진다', async () => {
    const wrapper = await mountView()

    expect(wrapper.find('.board-name').text()).toBe('본관 공지')
    await wrapper.find('[data-test="edit-board"]').trigger('click')
    expect(wrapper.find('[data-test="name-input"]').element.value).toBe('본관 공지')
  })
})
