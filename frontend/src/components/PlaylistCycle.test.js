/**
 * 캔버스 위 재생목록 요소 테스트.
 *
 * 편집 중에는 이름만, 미리보기에서는 실제로 돌아야 한다. 그 경계와, 목록을
 * 받지 못했을 때 화면이 비지 않는지를 본다. 시간을 세는 규칙 자체는
 * `useWidgetCycle` 이 갖고 있고 PlaylistPreview 테스트가 지킨다.
 */
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { i18n } from '@/i18n'

let PLAYLIST = null

const get = vi.fn(async (path) => {
  if (path.startsWith('/playlists/')) {
    if (!PLAYLIST) throw { detail: '없음' }
    return PLAYLIST
  }
  return {}
})

vi.mock('@/api/client', () => ({
  api: { get: (...args) => get(...args) },
  TEST_MODE: false,
}))

import PlaylistCycle from './PlaylistCycle.vue'

const WIDGETS = [
  { key: 'notice', name: '공지사항', category: '기능형', description: '', options: [] },
  { key: 'meal', name: '급식메뉴', category: '기능형', description: '', options: [] },
]

function mountCycle(props = {}) {
  return mount(PlaylistCycle, {
    props: { playlistId: 1, widgets: WIDGETS, width: 600, height: 400, scale: 1, ...props },
    global: {
      plugins: [i18n],
      stubs: {
        WidgetPreview: {
          props: ['widgetKey', 'width', 'height', 'scale'],
          template:
            '<div class="wp" :data-size="`${width}x${height}@${scale}`">{{ widgetKey }}</div>',
        },
      },
    },
  })
}

async function advance(wrapper, seconds) {
  vi.advanceTimersByTime(seconds * 1000)
  await wrapper.vm.$nextTick()
}

beforeEach(() => {
  vi.useFakeTimers()
  i18n.global.locale.value = 'ko'
  get.mockClear()
  PLAYLIST = {
    id: 1,
    name: '현관 순환',
    items: [
      { id: 1, widget_key: 'notice', duration_sec: 5, options: {}, transition: 'none', transition_ms: 600 },
      { id: 2, widget_key: 'meal', duration_sec: 3, options: {}, transition: 'fade', transition_ms: 600 },
    ],
  }
})

afterEach(() => {
  vi.useRealTimers()
})

describe('칸 목록 받기', () => {
  it('참조로 받아 온다', async () => {
    // 문서에는 playlist_id 만 있다. 칸 목록은 서버가 갖고 있다.
    const wrapper = mountCycle()
    await flushPromises()

    expect(get).toHaveBeenCalledWith('/playlists/1')
    expect(wrapper.find('.wp').text()).toBe('notice')
  })

  it('못 받으면 이름만 보여 준다', async () => {
    // 빈 검은 화면보다 무엇이 놓였는지 보이는 편이 낫다.
    PLAYLIST = null
    const wrapper = mountCycle({ name: '현관 순환' })
    await flushPromises()

    expect(wrapper.find('.el-playlist').text()).toContain('현관 순환')
  })

  it('담긴 위젯이 없어도 이름만 보여 준다', async () => {
    PLAYLIST = { id: 1, name: '빈 목록', items: [] }
    const wrapper = mountCycle({ name: '빈 목록' })
    await flushPromises()

    expect(wrapper.find('.el-playlist').exists()).toBe(true)
  })

  it('참조가 없으면 서버를 부르지 않는다', async () => {
    const wrapper = mountCycle({ playlistId: null, name: '재생목록' })
    await flushPromises()

    expect(get).not.toHaveBeenCalled()
    expect(wrapper.find('.el-playlist').exists()).toBe(true)
  })
})

describe('실제 시간대로 돌기', () => {
  it('정한 시간만큼 머물다 넘어간다', async () => {
    const wrapper = mountCycle()
    await flushPromises()

    await advance(wrapper, 4)
    expect(wrapper.find('.wp').text()).toBe('notice')
    await advance(wrapper, 1)
    expect(wrapper.find('.wp').text()).toBe('meal')
  })

  it('끝나면 처음으로 돌아간다', async () => {
    const wrapper = mountCycle()
    await flushPromises()

    await advance(wrapper, 8)
    expect(wrapper.find('.wp').text()).toBe('notice')
  })

  it('전환 효과를 입힌다', async () => {
    const raf = vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation(() => 0)
    const wrapper = mountCycle()
    await flushPromises()

    await advance(wrapper, 5)
    expect(wrapper.find('.layer').attributes('style')).toContain('opacity: 0')
    raf.mockRestore()
  })

  it('요소 크기 그대로 그린다', async () => {
    // 캔버스 요소 안에 들어가므로 문서 좌표를 그대로 받아야 한다.
    const wrapper = mountCycle({ width: 800, height: 600, scale: 0.5 })
    await flushPromises()

    expect(wrapper.find('.wp').attributes('data-size')).toBe('800x600@0.5')
  })

  it('창을 닫으면 타이머를 멈춘다', async () => {
    const clear = vi.spyOn(globalThis, 'clearInterval')
    const wrapper = mountCycle()
    await flushPromises()
    wrapper.unmount()

    expect(clear).toHaveBeenCalled()
    clear.mockRestore()
  })
})
