/**
 * 콘텐츠 라이브러리 화면 테스트.
 *
 * 이 화면의 약속: 내 관리 범위의 콘텐츠만 다루고(share=mine — 공유받은
 * 것은 스케줄 편집기의 브라우저 몫), 각 타일에서 공유 구분을 바로 바꾸며,
 * 만들 때 공유 구분을 함께 정한다.
 */
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { i18n } from '@/i18n'

const get = vi.fn()
const post = vi.fn()
const put = vi.fn()

vi.mock('@/api/client', () => ({
  api: {
    get: (...args) => get(...args),
    post: (...args) => post(...args),
    put: (...args) => put(...args),
    delete: vi.fn(),
  },
  TEST_MODE: false,
  getToken: () => null,
  setToken: vi.fn(),
}))

vi.mock('@/stores/auth', () => ({
  useAuthStore: () => ({ user: { org_id: 3 } }),
}))

const push = vi.fn()
vi.mock('vue-router', () => ({
  useRouter: () => ({ push }),
  useRoute: () => ({ params: {}, query: {} }),
}))

import ContentsView from './ContentsView.vue'

const RouterLinkStub = {
  props: ['to'],
  template: '<a><slot /></a>',
}

function content_(over = {}) {
  return {
    id: 1,
    name: '아침 알림판',
    width: 1920,
    height: 1080,
    version: 1,
    usage_count: 0,
    element_count: 2,
    background: '#000000',
    share_scope: '없음',
    shared: false,
    updated_at: '2026-09-17T00:00:00Z',
    ...over,
  }
}

let CONTENTS = []

async function mountView() {
  setActivePinia(createPinia())
  const wrapper = mount(ContentsView, {
    global: {
      plugins: [createPinia(), i18n],
      stubs: { RouterLink: RouterLinkStub },
    },
  })
  await flushPromises()
  return wrapper
}

beforeEach(() => {
  i18n.global.locale.value = 'ko'
  CONTENTS = [content_(), content_({ id: 2, name: '급식 안내', share_scope: '소속기관' })]
  get.mockReset()
  post.mockReset()
  put.mockReset()
  push.mockReset()
  get.mockImplementation(async (path) => {
    if (path === '/organizations') return [{ id: 3, name: '가나초등학교' }]
    return { items: CONTENTS, total: CONTENTS.length, page: 1, size: 24 }
  })
})

describe('목록', () => {
  it('내 콘텐츠만 부른다(share=mine) — 공유받은 것은 브라우저의 몫', async () => {
    await mountView()

    const call = get.mock.calls.find(([path]) => path === '/contents')
    expect(call[1].share).toBe('mine')
  })

  it('타일마다 공유 구분이 현재 값으로 보인다', async () => {
    const wrapper = await mountView()

    const selects = wrapper.findAll('[data-test="share-select"]')
    expect(selects).toHaveLength(2)
    expect(selects[0].element.value).toBe('없음')
    expect(selects[1].element.value).toBe('소속기관')
  })
})

describe('공유 구분 변경', () => {
  it('고르면 그 자리에서 저장한다', async () => {
    put.mockResolvedValueOnce({})
    const wrapper = await mountView()

    await wrapper.find('[data-test="share-select"]').setValue('전체')
    await flushPromises()

    expect(put).toHaveBeenCalledWith('/contents/1', { share_scope: '전체' })
  })

  it('저장이 거부되면 원래 값으로 되돌린다', async () => {
    // 화면만 바뀌고 서버는 그대로면, 사용자는 공유된 줄 알고 방치한다.
    put.mockRejectedValueOnce({ detail: '해당 콘텐츠를 수정할 권한이 없습니다.' })
    const wrapper = await mountView()

    const select = wrapper.find('[data-test="share-select"]')
    await select.setValue('전체')
    await flushPromises()

    expect(select.element.value).toBe('없음')
  })
})

describe('만들기', () => {
  it('고른 공유 구분이 생성 요청에 실린다', async () => {
    post.mockResolvedValueOnce({ id: 9 })
    const wrapper = await mountView()

    await wrapper.find('.card-header .btn-primary').trigger('click')
    await wrapper.find('.dialog-body input').setValue('새 콘텐츠')
    await wrapper.find('[data-test="create-share"]').setValue('소속기관')
    await wrapper.find('.dialog-foot .btn-primary').trigger('click')
    await flushPromises()

    const [path, body] = post.mock.calls[0]
    expect(path).toBe('/contents')
    expect(body.share_scope).toBe('소속기관')
    // 만들고 나면 편집기로 간다.
    expect(push).toHaveBeenCalledWith({ name: 'content-editor', params: { id: 9 } })
  })

  it('기본값은 공유하지 않음이다', async () => {
    const wrapper = await mountView()

    await wrapper.find('.card-header .btn-primary').trigger('click')

    expect(wrapper.find('[data-test="create-share"]').element.value).toBe('없음')
  })
})
