/**
 * 커뮤니티 재생목록 화면 테스트 (2026-09 개편판).
 *
 * 약속: 외부 사용자가 제목·설명으로 등록하면 '대기중'으로 시작하고, 파일을
 * 올리면 곧바로 칸이 된다. 게시 여부는 서버가 can_publish 로 답한 사람만
 * 바꾸고, 전체 재생시간은 칸 시간의 합으로 표시한다.
 */
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { i18n } from '@/i18n'

const get = vi.fn()
const post = vi.fn()
const put = vi.fn()
const del = vi.fn()
const upload = vi.fn()

const push = vi.fn()

vi.mock('vue-router', () => ({
  useRouter: () => ({ push }),
  RouterLink: { props: ['to'], template: '<a :href="to"><slot /></a>' },
}))

vi.mock('@/api/client', () => ({
  api: {
    get: (...args) => get(...args),
    post: (...args) => post(...args),
    put: (...args) => put(...args),
    delete: (...args) => del(...args),
    upload: (...args) => upload(...args),
  },
  TEST_MODE: false,
  getToken: () => null,
  setToken: vi.fn(),
}))

import CommunityPlaylistsView from './CommunityPlaylistsView.vue'

let CONTEXT = null
let PLAYLISTS = []
let SETTINGS = null

function playlist_(over = {}) {
  return {
    id: 10,
    org_id: 2,
    author_id: 8,
    author_name: '지역 주민',
    title: '가을 축제 홍보',
    description: '가을 축제를 알리고 싶어요',
    publish_status: '대기중',
    version: 1,
    created_at: '2026-09-01T09:00:00',
    items: [],
    total_duration_sec: 0,
    can_edit: false,
    can_remove: false,
    can_publish: false,
    ...over,
  }
}

async function mountView() {
  setActivePinia(createPinia())
  const wrapper = mount(CommunityPlaylistsView, {
    global: {
      plugins: [createPinia(), i18n],
      stubs: {
        RouterLink: {
          props: ['to'],
          template: '<a :href="to" v-bind="$attrs"><slot /></a>',
        },
      },
    },
  })
  await flushPromises()
  return wrapper
}

beforeEach(() => {
  i18n.global.locale.value = 'ko'
  CONTEXT = { org_id: 2, org_name: '가나교육청', can_share: true }
  PLAYLISTS = [playlist_()]
  SETTINGS = { auto_publish: false, can_manage: false }
  get.mockReset()
  post.mockReset()
  put.mockReset()
  del.mockReset()
  upload.mockReset()
  push.mockReset()
  get.mockImplementation(async (path) => {
    if (path === '/community/list') return [{ ...CONTEXT }]
    if (path === '/community/context') return { ...CONTEXT }
    if (path === '/community/playlists') {
      return { items: PLAYLISTS, total: PLAYLISTS.length, page: 1, size: 20 }
    }
    if (path === '/community/settings') return { ...SETTINGS }
    throw new Error(`unexpected GET ${path}`)
  })
})

describe('목록', () => {
  it('제목·게시자·게시 여부·전체 재생시간을 함께 보여 준다', async () => {
    PLAYLISTS = [
      playlist_({
        items: [
          { kind: 'image', asset_id: 1, duration_sec: 8, url: '/a/1', title: '사진1' },
          { kind: 'image', asset_id: 2, duration_sec: 12, url: '/a/2', title: '사진2' },
        ],
        total_duration_sec: 20,
      }),
    ]
    const wrapper = await mountView()

    const row = wrapper.find('[data-test="playlist-row"]')
    expect(row.text()).toContain('가을 축제 홍보')
    expect(row.text()).toContain('지역 주민')
    expect(row.find('[data-test="status-badge"]').text()).toContain('대기중')
    // 전체 재생시간 = 칸 시간의 합 — 서버가 계산해 준 값을 그대로 그린다.
    expect(row.find('[data-test="total-duration"]').text()).toContain('20초')
  })

  it('게시 여부는 서버가 can_publish 로 답한 사람에게만 선택이 열린다', async () => {
    PLAYLISTS = [playlist_({ can_publish: true })]
    put.mockResolvedValue({})
    const wrapper = await mountView()

    const select = wrapper.find('[data-test="status-select"]')
    expect(select.exists()).toBe(true)
    await select.setValue('게시')
    await flushPromises()

    expect(put).toHaveBeenCalledWith('/community/playlists/10/status', { status: '게시' })
  })

  it('편집·삭제 단추는 can_edit/can_remove 를 따른다', async () => {
    PLAYLISTS = [playlist_({ can_edit: false, can_remove: false })]
    const wrapper = await mountView()
    expect(wrapper.find('[data-test="edit-playlist"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="remove-playlist"]').exists()).toBe(false)
  })
})

describe('등록·편집 진입', () => {
  it('편집 단추는 그 재생목록의 편집기로 간다', async () => {
    PLAYLISTS = [playlist_({ can_edit: true })]
    const wrapper = await mountView()
    expect(wrapper.find('[data-test="edit-playlist"]').attributes('href')).toBe(
      '/community/playlists/10/edit',
    )
  })
})

describe('게시 정책', () => {
  it('관리자에게만 토글이 보이고, 바꾸면 서버로 실려 간다', async () => {
    SETTINGS = { auto_publish: false, can_manage: true }
    put.mockResolvedValue({ auto_publish: true, can_manage: true })
    const wrapper = await mountView()

    const toggle = wrapper.find('[data-test="auto-publish"]')
    expect(toggle.exists()).toBe(true)
    await toggle.setValue(true)
    await flushPromises()

    expect(put).toHaveBeenCalledWith(
      '/community/settings',
      { auto_publish: true },
      { org_id: 2 },
    )
  })

  it('관리자가 아니면 토글이 없다', async () => {
    const wrapper = await mountView()
    expect(wrapper.find('[data-test="auto-publish"]').exists()).toBe(false)
  })

})

describe('삭제', () => {
  it('확인 후 지우고 목록을 다시 받는다', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    PLAYLISTS = [playlist_({ can_remove: true })]
    del.mockResolvedValue({ detail: '재생목록을 지웠습니다.' })
    const wrapper = await mountView()

    await wrapper.find('[data-test="remove-playlist"]').trigger('click')
    await flushPromises()

    expect(del).toHaveBeenCalledWith('/community/playlists/10')
  })
})

describe('게시요청 등록 레이어', () => {
  // 절차(2026-10): [게시요청 등록] → 메타 레이어 → 확인하면 등록하고 편집
  // 화면으로, 취소하면 아무 일도 없던 것으로 목록 그대로.

  it('등록 버튼은 편집기로 가지 않고 메타 레이어를 띄운다', async () => {
    const wrapper = await mountView()
    expect(wrapper.find('[data-test="meta-layer"]').exists()).toBe(false)

    await wrapper.find('[data-test="new-playlist"]').trigger('click')
    expect(wrapper.find('[data-test="meta-layer"]').exists()).toBe(true)
    expect(push).not.toHaveBeenCalled()
  })

  it('확인하면 등록하고 편집 화면으로 간다', async () => {
    post.mockResolvedValue({ id: 9, publish_status: '대기중' })
    const wrapper = await mountView()

    await wrapper.find('[data-test="new-playlist"]').trigger('click')
    await wrapper.find('[data-test="editor-title"]').setValue('겨울 알림')
    await wrapper.find('[data-test="editor-memo"]').setValue('첫 줄\n둘째 줄')
    await wrapper.find('[data-test="close-meta"]').trigger('click')
    await flushPromises()

    expect(post).toHaveBeenCalledWith(
      '/community/playlists',
      {
        title: '겨울 알림',
        memo: '첫 줄\n둘째 줄',
        target_org_types: [],
        notice_start: '',
        notice_end: '',
        contact: '',
      },
      { org_id: 2 },
    )
    expect(push).toHaveBeenCalledWith('/community/playlists/9/edit')
    expect(wrapper.find('[data-test="meta-layer"]').exists()).toBe(false)
  })

  it('제목이 비어 있으면 확인 버튼이 눌리지 않는다', async () => {
    const wrapper = await mountView()
    await wrapper.find('[data-test="new-playlist"]').trigger('click')

    expect(wrapper.find('[data-test="close-meta"]').attributes('disabled')).toBeDefined()
    await wrapper.find('[data-test="close-meta"]').trigger('click')
    expect(post).not.toHaveBeenCalled()
  })

  it('취소하면 등록하지 않고 목록 그대로다', async () => {
    const wrapper = await mountView()
    await wrapper.find('[data-test="new-playlist"]').trigger('click')
    await wrapper.find('[data-test="editor-title"]').setValue('버릴 제목')

    await wrapper.find('[data-test="cancel-meta"]').trigger('click')
    expect(wrapper.find('[data-test="meta-layer"]').exists()).toBe(false)
    expect(post).not.toHaveBeenCalled()
    expect(push).not.toHaveBeenCalled()
    // 목록은 그대로 보인다.
    expect(wrapper.findAll('[data-test="playlist-row"]')).toHaveLength(1)
  })
})

describe('미리보기', () => {
  const doc = (text) => ({
    version: 1,
    layout: { width: 1920, height: 1080, background: '#000' },
    elements: [{ id: 'e1', type: 'text', rect: { x: 0, y: 0, w: 100, h: 50, z: 1 }, options: { text } }],
  })

  it('행의 미리보기 버튼이 슬라이드를 한 장씩 넘겨 보여 준다', async () => {
    PLAYLISTS = [
      playlist_({
        items: [
          { duration_sec: 8, document: doc('첫 장') },
          { duration_sec: 12, document: doc('둘째 장') },
        ],
      }),
    ]
    setActivePinia(createPinia())
    const PreviewStub = {
      props: ['document', 'pageIndex', 'pageTotal'],
      emits: ['page', 'close'],
      template: '<div class="preview-stub">{{ document.elements[0].options.text }} {{ pageIndex + 1 }}/{{ pageTotal }}</div>',
    }
    const wrapper = mount(CommunityPlaylistsView, {
      global: {
        plugins: [createPinia(), i18n],
        stubs: {
          RouterLink: { props: ['to'], template: '<a :href="to"><slot /></a>' },
          ContentPreview: PreviewStub,
        },
      },
    })
    await flushPromises()

    expect(wrapper.find('.preview-stub').exists()).toBe(false)
    await wrapper.find('[data-test="preview-playlist"]').trigger('click')
    expect(wrapper.find('.preview-stub').text()).toBe('첫 장 1/2')

    // 넘김은 미리보기 창이 알리고, 어떤 장인지는 목록이 쥔다.
    wrapper.findComponent(PreviewStub).vm.$emit('page', 1)
    await flushPromises()
    expect(wrapper.find('.preview-stub').text()).toBe('둘째 장 2/2')

    wrapper.findComponent(PreviewStub).vm.$emit('close')
    await flushPromises()
    expect(wrapper.find('.preview-stub').exists()).toBe(false)
  })

  it('칸이 없는 게시물은 미리보기 버튼이 눌리지 않는다', async () => {
    PLAYLISTS = [playlist_({ items: [] })]
    const wrapper = await mountView()
    expect(wrapper.find('[data-test="preview-playlist"]').attributes('disabled')).toBeDefined()
  })
})
