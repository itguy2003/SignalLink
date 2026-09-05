/**
 * 커뮤니티 재생목록 화면 테스트.
 *
 * 이 화면의 약속은 셋이다 — 목록을 보여 주고, 공유물만 담을 수 있는
 * 편집 창을 열고, 담은 순서·시간·전환을 그대로 저장한다.
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
    upload: vi.fn(),
  },
  TEST_MODE: false,
  getToken: () => null,
  setToken: vi.fn(),
}))

import CommunityPlaylistsView from './CommunityPlaylistsView.vue'

const CONTEXT = { org_id: 2, org_name: '인천광역시교육청', can_share: true }

function media(id, kind, title) {
  return {
    id,
    org_id: 2,
    title,
    asset: { id: id * 10, kind, filename: `${title}.bin`, url: `/api/v1/assets/${id * 10}/x/file` },
  }
}

function playlist(over = {}) {
  return {
    id: 5,
    org_id: 2,
    name: '가을 모음',
    author_name: '지역 주민',
    version: 2,
    created_at: '2026-09-01T09:00:00',
    can_remove: true,
    items: [
      { kind: 'image', asset_id: 10, duration_sec: 8, transition: 'fade', title: '단풍', url: '/a' },
      { kind: 'video', asset_id: 20, duration_sec: 30, title: '행사', url: '/b' },
    ],
    ...over,
  }
}

let PLAYLISTS = []

async function mountView() {
  setActivePinia(createPinia())
  const wrapper = mount(CommunityPlaylistsView, {
    global: { plugins: [createPinia(), i18n] },
  })
  await flushPromises()
  return wrapper
}

beforeEach(() => {
  i18n.global.locale.value = 'ko'
  PLAYLISTS = [playlist()]
  for (const fn of [get, post, put, del]) fn.mockReset()
  get.mockImplementation(async (path, params) => {
    if (path === '/community/list') return [CONTEXT]
    if (path === '/community/context') return CONTEXT
    if (path === '/community/playlists')
      return { items: PLAYLISTS, total: PLAYLISTS.length, page: 1, size: 20 }
    if (path === '/community/media') {
      // 게시판 첨부가 곧 재료다. 서버가 {id, title, asset} 낱개로 준다.
      const row = params?.kind === 'video' ? media(2, 'video', '행사 영상') : media(1, 'image', '단풍')
      return { items: [row], total: 1, page: 1, size: 100 }
    }
    return {}
  })
  post.mockImplementation(async () => playlist({ id: 9 }))
  put.mockImplementation(async () => playlist())
})

describe('목록', () => {
  it('이름·칸 수·버전과 칸 미리보기를 보여 준다', async () => {
    const wrapper = await mountView()

    expect(wrapper.text()).toContain('가을 모음')
    expect(wrapper.text()).toContain('칸 2개')
    expect(wrapper.text()).toContain('v2')
    // 이미지 칸은 그림으로, 동영상 칸은 표식으로.
    expect(wrapper.find('.strip img').exists()).toBe(true)
    expect(wrapper.find('.strip .mark').exists()).toBe(true)
  })
})

describe('편집 창', () => {
  it('왼쪽의 공유물을 눌러 칸으로 담는다', async () => {
    const wrapper = await mountView()
    await wrapper.find('[data-test="new-playlist"]').trigger('click')
    await flushPromises()

    await wrapper.find('[data-test="material"]').trigger('click')

    const slides = wrapper.findAll('[data-test="slide"]')
    expect(slides).toHaveLength(1)
    expect(slides[0].text()).toContain('단풍')
  })

  it('담은 순서·시간·전환이 그대로 저장된다', async () => {
    const wrapper = await mountView()
    await wrapper.find('[data-test="new-playlist"]').trigger('click')
    await flushPromises()

    await wrapper.find('[data-test="playlist-name"]').setValue('시월 순환')
    await wrapper.find('[data-test="material"]').trigger('click')
    const slide = wrapper.find('[data-test="slide"]')
    await slide.find('input[type="number"]').setValue(12)
    await slide.find('select').setValue('slide-left')

    await wrapper.findComponent({ name: 'ModalDialog' }).vm.$emit('confirm')
    await flushPromises()

    expect(post).toHaveBeenCalledWith(
      '/community/playlists',
      {
        name: '시월 순환',
        items: [
          {
            kind: 'image',
            asset_id: 10,
            duration_sec: 12,
            transition: 'slide-left',
            transition_ms: 600,
          },
        ],
      },
      { org_id: 2 },
    )
  })

  it('빈 재생목록은 저장을 거절한다', async () => {
    const wrapper = await mountView()
    await wrapper.find('[data-test="new-playlist"]').trigger('click')
    await flushPromises()
    await wrapper.find('[data-test="playlist-name"]').setValue('빈 것')

    await wrapper.findComponent({ name: 'ModalDialog' }).vm.$emit('confirm')
    await flushPromises()

    expect(post).not.toHaveBeenCalled()
  })

  it('기존 재생목록을 열면 칸이 채워져 있고 저장은 PUT 으로 간다', async () => {
    const wrapper = await mountView()
    await wrapper.find('.actions .btn').trigger('click')
    await flushPromises()

    expect(wrapper.findAll('[data-test="slide"]')).toHaveLength(2)

    await wrapper.findComponent({ name: 'ModalDialog' }).vm.$emit('confirm')
    await flushPromises()

    expect(put).toHaveBeenCalled()
    expect(put.mock.calls[0][0]).toBe('/community/playlists/5')
  })
})
