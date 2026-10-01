/**
 * 커뮤니티 게시물 편집기 테스트 — 소속기관 공지 편집기와 같은 짜임(2026-10).
 *
 * 약속: 오른쪽 목록에서 슬라이드를 추가·삭제·이동하고, 왼쪽 캔버스는 고른
 * 슬라이드의 문서를 편집한다. 저장은 메타 + 아이템 전체(문서·유지 시간)를
 * 순서대로 보낸다. 이미지·동영상은 이 게시물에 올린 파일만 쓴다.
 */
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { i18n } from '@/i18n'

let PLAYLIST = null

const get = vi.fn(async (path) => {
  if (path === '/org-types') {
    return [
      { id: 1, name: '기관', classifications: '' },
      { id: 2, name: '학교', classifications: '초,중,고' },
    ]
  }
  if (path === '/widgets') return []
  if (!PLAYLIST) throw { detail: '게시물을 찾을 수 없습니다.' }
  return JSON.parse(JSON.stringify(PLAYLIST))
})
const put = vi.fn()
const upload = vi.fn()

vi.mock('@/api/client', () => ({
  api: {
    get: (...args) => get(...args),
    post: vi.fn(),
    put: (...args) => put(...args),
    upload: (...args) => upload(...args),
  },
  TEST_MODE: false,
  getToken: () => null,
  setToken: vi.fn(),
}))

let routeParams = { id: '1' }
let leaveGuard = null

vi.mock('vue-router', () => ({
  useRoute: () => ({ params: routeParams, query: {} }),
  onBeforeRouteLeave: (guard) => {
    leaveGuard = guard
  },
  RouterLink: { props: ['to'], template: '<a :href="to"><slot /></a>' },
}))

import CommunityPlaylistEditorView from './CommunityPlaylistEditorView.vue'

function doc(text) {
  return {
    version: 1,
    layout: { width: 1920, height: 1080, background: '#000000' },
    elements: [
      { id: 'e1', type: 'text', rect: { x: 0, y: 0, w: 100, h: 50, z: 1 }, options: { text } },
    ],
  }
}

function playlist_(over = {}) {
  return {
    id: 1,
    org_id: 2,
    title: '가을 축제 홍보',
    memo: '토요일 오전, 교육청 앞마당',
    target_org_types: ['학교'],
    notice_start: '2026-10-01',
    notice_end: '2026-10-14',
    author_name: '홍길동',
    contact: '010-1234-5678',
    publish_status: '대기중',
    version: 2,
    items: [
      { duration_sec: 10, document: doc('첫 장') },
      { duration_sec: 20, document: doc('둘째 장') },
    ],
    assets: [
      { id: 5, kind: 'image', filename: '사진.png', url: '/a/5', thumb_url: '/a/5' },
      { id: 6, kind: 'video', filename: '영상.mp4', url: '/a/6', thumb_url: null },
    ],
    total_duration_sec: 30,
    can_edit: true,
    can_remove: true,
    can_publish: false,
    ...over,
  }
}

/** 캔버스는 무겁다 — 어떤 문서·출처를 받았는지만 남기는 스텁으로 바꾼다. */
const CanvasStub = {
  props: ['document', 'mediaSource', 'orgId'],
  template: '<div class="canvas-stub">{{ document.elements[0]?.options.text ?? "빈 문서" }}</div>',
}

async function mountView() {
  setActivePinia(createPinia())
  const wrapper = mount(CommunityPlaylistEditorView, {
    global: {
      plugins: [createPinia(), i18n],
      stubs: {
        ContentCanvas: CanvasStub,
        ContentPreview: true,
        RouterLink: { props: ['to'], template: '<a :href="to"><slot /></a>' },
      },
    },
  })
  await flushPromises()
  return wrapper
}

beforeEach(() => {
  i18n.global.locale.value = 'ko'
  PLAYLIST = playlist_()
  routeParams = { id: '1' }
  leaveGuard = null
  get.mockClear()
  put.mockReset()
  upload.mockReset()
})

describe('분할 화면', () => {
  it('오른쪽에 슬라이드 목록, 왼쪽에 고른 슬라이드의 편집기가 선다', async () => {
    const wrapper = await mountView()

    expect(wrapper.findAll('[data-test="slide-row"]')).toHaveLength(2)
    expect(wrapper.find('.canvas-stub').text()).toBe('첫 장')
    // 머리글 메타 요약 — 전체 재생시간은 칸 시간의 합.
    expect(wrapper.find('[data-test="editor-total"]').text()).toContain('30')
    expect(wrapper.find('[data-test="meta-summary"]').text()).toContain('학교')
  })

  it('오른쪽에서 고르면 왼쪽 편집기가 그 슬라이드로 바뀐다', async () => {
    const wrapper = await mountView()
    await wrapper.findAll('[data-test="slide-row"]')[1].trigger('click')
    expect(wrapper.find('.canvas-stub').text()).toBe('둘째 장')
  })

  it('캔버스의 이미지·동영상 출처는 이 게시물에 올린 파일이다', async () => {
    upload.mockResolvedValue({ id: 7, kind: 'image', filename: '포스터.png', url: '/a/7' })
    const wrapper = await mountView()
    const source = wrapper.findComponent(CanvasStub).props('mediaSource')

    // 목록은 올린 파일 중 그 종류만.
    expect((await source.list('image')).map((a) => a.id)).toEqual([5])
    expect((await source.list('video')).map((a) => a.id)).toEqual([6])

    // 업로드는 게시물의 미디어 경로로 — 기관 자산 라이브러리(/assets)가 아니다.
    const asset = await source.upload(new File(['x'], '포스터.png', { type: 'image/png' }))
    expect(upload.mock.calls[0][0]).toBe('/community/playlists/1/media')
    expect(asset.id).toBe(7)
    expect((await source.list('image')).map((a) => a.id)).toEqual([5, 7])
  })
})

describe('슬라이드 관리', () => {
  it('추가하면 빈 문서가 생기고 곧장 선택된다', async () => {
    const wrapper = await mountView()
    await wrapper.find('[data-test="add-slide"]').trigger('click')

    expect(wrapper.findAll('[data-test="slide-row"]')).toHaveLength(3)
    expect(wrapper.find('.canvas-stub').text()).toBe('빈 문서')
  })

  it('위치를 바꾸면 저장 순서도 그대로 바뀐다', async () => {
    put.mockResolvedValue(playlist_())
    const wrapper = await mountView()

    await wrapper.findAll('[data-test="move-up"]')[1].trigger('click')
    await wrapper.find('[data-test="editor-save"]').trigger('click')
    await flushPromises()

    const body = put.mock.calls[0][1]
    const texts = body.items.map((item) => item.document.elements[0].options.text)
    expect(texts).toEqual(['둘째 장', '첫 장'])
  })

  it('유지 시간을 바꿔 저장한다(한계 밖은 끌어다 맞춘다)', async () => {
    put.mockResolvedValue(playlist_())
    const wrapper = await mountView()

    await wrapper.findAll('[data-test="duration-input"]')[0].setValue('0')
    await wrapper.find('[data-test="editor-save"]').trigger('click')
    await flushPromises()

    expect(put.mock.calls[0][1].items[0].duration_sec).toBe(1)
  })

  it('빼면 목록과 저장에서 함께 빠진다', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    // 서버는 저장한 모양 그대로 돌려준다 — 화면은 그 응답으로 다시 선다.
    put.mockImplementation(async (_path, body) => playlist_({ items: body.items }))
    const wrapper = await mountView()

    await wrapper.findAll('[data-test="remove-slide"]')[0].trigger('click')
    await wrapper.find('[data-test="editor-save"]').trigger('click')
    await flushPromises()

    expect(wrapper.findAll('[data-test="slide-row"]')).toHaveLength(1)
    expect(put.mock.calls[0][1].items).toHaveLength(1)
  })
})

describe('저장', () => {
  it('메타와 아이템(문서·유지 시간) 전체를 보낸다 — 화면용 열쇠는 빼고', async () => {
    put.mockResolvedValue(playlist_())
    const wrapper = await mountView()
    await wrapper.find('[data-test="editor-save"]').trigger('click')
    await flushPromises()

    const [path, body] = put.mock.calls[0]
    expect(path).toBe('/community/playlists/1')
    expect(body.title).toBe('가을 축제 홍보')
    expect(body.target_org_types).toEqual(['학교'])
    expect(body.items).toEqual([
      { duration_sec: 10, document: expect.objectContaining({ elements: expect.any(Array) }) },
      { duration_sec: 20, document: expect.objectContaining({ elements: expect.any(Array) }) },
    ])
    expect(body.items[0]).not.toHaveProperty('_key')
  })

  it('저장 없이 나가면 붙잡는다', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)
    const wrapper = await mountView()
    await wrapper.find('[data-test="add-slide"]').trigger('click')

    expect(leaveGuard()).toBe(false)
    expect(confirmSpy).toHaveBeenCalled()
  })
})

describe('메타정보 레이어(수정)', () => {
  it('머리글 제목·[메타정보] 버튼이 레이어를 연다', async () => {
    const wrapper = await mountView()
    expect(wrapper.find('[data-test="meta-layer"]').exists()).toBe(false)

    await wrapper.find('[data-test="editor-title-display"]').trigger('click')
    expect(wrapper.find('[data-test="meta-layer"]').exists()).toBe(true)
    await wrapper.find('[data-test="cancel-meta"]').trigger('click')

    await wrapper.find('[data-test="open-meta"]').trigger('click')
    expect(wrapper.find('[data-test="meta-layer"]').exists()).toBe(true)
  })

  it('확인하면 고친 메타가 반영되고 저장에 실린다', async () => {
    put.mockResolvedValue(playlist_())
    const wrapper = await mountView()
    await wrapper.find('[data-test="open-meta"]').trigger('click')
    await wrapper.find('[data-test="editor-title"]').setValue('고친 제목')
    await wrapper.find('input[value="학교:초"]').setValue(true)
    await wrapper.find('[data-test="close-meta"]').trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-test="editor-title-display"]').text()).toBe('고친 제목')
    expect(wrapper.find('[data-test="meta-summary"]').text()).toContain('학교(초)')

    await wrapper.find('[data-test="editor-save"]').trigger('click')
    await flushPromises()
    const body = put.mock.calls.at(-1)[1]
    expect(body.title).toBe('고친 제목')
    expect(body.target_org_types).toContain('학교:초')
  })

  it('취소하면 고치던 값을 버린다', async () => {
    const wrapper = await mountView()
    await wrapper.find('[data-test="open-meta"]').trigger('click')
    await wrapper.find('[data-test="editor-title"]').setValue('버릴 제목')
    await wrapper.find('[data-test="cancel-meta"]').trigger('click')

    expect(wrapper.find('[data-test="editor-title-display"]').text()).toBe('가을 축제 홍보')
  })
})
