/**
 * 브라우저 플레이어 테스트.
 *
 * 약속: 장치 고유번호로 프로비전을 거쳐 스케줄을 받아 표출한다. WebSocket 이
 * 막히면 REST 하트비트로 폴백하고, 시간지정 스케줄에 맞는 칸이 없으면
 * 대기 화면(시계)을 보인다.
 */
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { i18n } from '@/i18n'

const get = vi.fn()
const post = vi.fn()
const setDeviceToken = vi.fn()

vi.mock('@/api/client', () => ({
  api: {
    get: (...args) => get(...args),
    post: (...args) => post(...args),
    put: vi.fn(),
    delete: vi.fn(),
  },
  setDeviceToken: (...args) => setDeviceToken(...args),
  TEST_MODE: false,
  getToken: () => null,
  setToken: vi.fn(),
}))

import PlayerView from './PlayerView.vue'

const PROVISION = {
  device_id: 5,
  device_code: 'ABCD-234-EFG',
  name: '복도 DID',
  org_id: 3,
  panel_type: '가로',
  width: 1920,
  height: 1080,
  schedule_version: 7,
  heartbeat_interval_sec: 30,
  ws_url: 'ws://127.0.0.1:8016/api/v1/player/ws',
  device_token: 'device-token-x',
}

function doc(text) {
  return {
    version: 1,
    layout: { width: 1920, height: 1080, background: '#000000' },
    elements: [
      { id: 'e1', type: 'text', rect: { x: 0, y: 0, w: 100, h: 50, z: 1 }, options: { text } },
    ],
  }
}

let SCHEDULE = null

/** 캔버스는 무겁다 — 받은 문서의 글만 남기는 스텁. */
const CanvasStub = {
  props: ['document'],
  template: '<div class="canvas-stub">{{ document.elements[0]?.options.text }}</div>',
}

/** WebSocket 을 바로 닫히는 스텁으로 — REST 폴백 경로를 태운다. */
class ClosingSocket {
  constructor() {
    setTimeout(() => this.onclose?.(), 0)
  }

  close() {}

  send() {}
}

async function mountPlayer() {
  const wrapper = mount(PlayerView, {
    global: { plugins: [i18n], stubs: { ContentCanvas: CanvasStub } },
  })
  await flushPromises()
  return wrapper
}

async function startPlayer(wrapper) {
  await wrapper.find('[data-test="code-input"]').setValue('abcd-234-efg')
  await wrapper.find('[data-test="start"]').trigger('click')
  await flushPromises()
}

/**
 * 조건이 참이 될 때까지 잠깐 기다린다. WebCrypto(HKDF) 는 네이티브 비동기라
 * 마이크로태스크 flush 로는 끝을 보장할 수 없다.
 */
async function until(condition, tries = 100) {
  for (let i = 0; i < tries; i += 1) {
    if (condition()) return
    await new Promise((resolve) => setTimeout(resolve, 5))
    await flushPromises()
  }
}

beforeEach(() => {
  i18n.global.locale.value = 'ko'
  localStorage.clear()
  vi.stubGlobal('WebSocket', ClosingSocket)
  SCHEDULE = {
    schedule_id: 11,
    name: '주간 스케줄',
    kind: '목록반복',
    version: 7,
    is_demo: false,
    server_time: '2026-09-18T00:00:00Z',
    items: [
      { id: 1, day_of_week: -1, sort_order: 0, duration_sec: 10, content: doc('첫 화면') },
      { id: 2, day_of_week: -1, sort_order: 1, duration_sec: 10, content: doc('둘째 화면') },
    ],
  }
  get.mockReset()
  post.mockReset()
  setDeviceToken.mockClear()
  post.mockImplementation(async (path) => {
    if (path === '/player/provision') return JSON.parse(JSON.stringify(PROVISION))
    if (path === '/player/heartbeat') {
      return {
        server_time: '2026-09-18T00:00:00Z',
        schedule_version: 7,
        schedule_changed: false,
        heartbeat_interval_sec: 30,
      }
    }
    return {}
  })
  get.mockImplementation(async (path) => {
    if (path === '/player/schedule') return JSON.parse(JSON.stringify(SCHEDULE))
    return {}
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('프로비전', () => {
  it('고유번호를 대문자로 정리해 인증하고 장치 토큰을 싣는다', async () => {
    const wrapper = await mountPlayer()
    await startPlayer(wrapper)

    expect(post).toHaveBeenCalledWith(
      '/player/provision',
      expect.objectContaining({ device_code: 'ABCD-234-EFG' }),
    )
    expect(setDeviceToken).toHaveBeenCalledWith('device-token-x')
  })

  it('인증이 거부되면 설정 화면에 이유를 남긴다', async () => {
    post.mockRejectedValueOnce({ detail: '등록되지 않은 장치입니다.' })
    const wrapper = await mountPlayer()
    await startPlayer(wrapper)

    expect(wrapper.find('.error-text').text()).toBe('등록되지 않은 장치입니다.')
    expect(wrapper.find('[data-test="start"]').exists()).toBe(true)
  })

  it('고유번호 없이 시작하지 않는다', async () => {
    const wrapper = await mountPlayer()
    await wrapper.find('[data-test="start"]').trigger('click')
    await flushPromises()

    expect(post).not.toHaveBeenCalled()
  })
})

describe('표출', () => {
  it('목록반복 스케줄의 첫 장을 그린다', async () => {
    const wrapper = await mountPlayer()
    await startPlayer(wrapper)
    await until(() => wrapper.find('.canvas-stub').exists())

    expect(wrapper.find('.canvas-stub').text()).toBe('첫 화면')
  })

  it('콘텐츠는 화면에 가득 채운다 — 문서 원본 크기 + 뷰포트 배율', async () => {
    const wrapper = await mountPlayer()
    await startPlayer(wrapper)
    await until(() => wrapper.find('.canvas-stub').exists())

    const style = wrapper.find('.stage').attributes('style')
    expect(style).toContain('width: 1920px')
    expect(style).toContain('height: 1080px')
    expect(style).toContain(
      `scale(${window.innerWidth / 1920}, ${window.innerHeight / 1080})`,
    )
  })

  it('장이 넘어갈 때 겹쳐 그리는 전환이면 앞 장을 잠시 남긴다', async () => {
    // 회전 타이머는 실제 시간으로 돈다 — 유지 시간을 1초로 줄여 기다린다.
    SCHEDULE.items = [
      { id: 1, day_of_week: -1, sort_order: 0, duration_sec: 1, transition: 'none', content: doc('첫 화면') },
      { id: 2, day_of_week: -1, sort_order: 1, duration_sec: 10, transition: 'dissolve', transition_ms: 2000, content: doc('둘째 화면') },
    ]
    const wrapper = await mountPlayer()
    await startPlayer(wrapper)
    await until(() => wrapper.find('.canvas-stub').exists())

    // 1초 뒤 둘째 장으로 — dissolve 는 앞 장을 아래에 남긴다.
    await until(() => wrapper.find('[data-test="stage-out"]').exists(), 600)
    expect(wrapper.find('[data-test="stage-out"]').exists()).toBe(true)

    // 전환 시간(2초)이 지나면 앞 장은 사라진다.
    await until(() => !wrapper.find('[data-test="stage-out"]').exists(), 600)
    expect(wrapper.find('[data-test="stage-out"]').exists()).toBe(false)
  })

  it('시간지정인데 맞는 칸이 없으면 대기 화면(시계)이다', async () => {
    SCHEDULE = {
      ...SCHEDULE,
      kind: '시간지정',
      // 절대 맞지 않는 시간대 — 자정 직후 1분.
      items: [
        {
          id: 1,
          day_of_week: 0,
          start_time: '00:00:00',
          end_time: '00:00:01',
          sort_order: 0,
          duration_sec: 10,
          content: doc('안 나올 화면'),
        },
      ],
    }
    const wrapper = await mountPlayer()
    await startPlayer(wrapper)
    await until(() => wrapper.find('[data-test="idle"]').exists())

    // 월요일 00:00:00~00:00:01 이 아닌 이상 대기다 — 테스트 시각이 거기 걸릴
    // 확률은 무시한다.
    expect(wrapper.find('[data-test="idle"]').exists()).toBe(true)
  })
})

describe('전체화면', () => {
  // jsdom 에는 Fullscreen API 가 없다 — 요청이 나가는지만 본다.
  const requestFullscreen = vi.fn()

  beforeEach(() => {
    requestFullscreen.mockClear()
    document.documentElement.requestFullscreen = requestFullscreen
  })

  afterEach(() => {
    delete document.documentElement.requestFullscreen
  })

  it('시작 버튼을 누르면 전체화면을 요청한다 (사용자 제스처 안)', async () => {
    const wrapper = await mountPlayer()
    await startPlayer(wrapper)

    expect(requestFullscreen).toHaveBeenCalled()
  })

  it('표출 중 화면을 누르면 다시 전체화면으로 들어간다', async () => {
    // 자동 기동은 제스처 밖이라 브라우저가 거부한다 — 클릭이 복구 경로다.
    const wrapper = await mountPlayer()
    await startPlayer(wrapper)
    await until(() => wrapper.find('.canvas-stub').exists())  // 표출(playing) 대기
    requestFullscreen.mockClear()

    await wrapper.find('.player').trigger('click')
    expect(requestFullscreen).toHaveBeenCalled()
  })

  it('설정 화면 클릭은 전체화면을 요청하지 않는다', async () => {
    const wrapper = await mountPlayer()
    await wrapper.find('.player').trigger('click')

    expect(requestFullscreen).not.toHaveBeenCalled()
  })
})

describe('키오스크', () => {
  const release = vi.fn(async () => {})
  const request = vi.fn(async () => ({ release }))

  beforeEach(() => {
    request.mockClear()
    release.mockClear()
    Object.defineProperty(navigator, 'wakeLock', {
      value: { request },
      configurable: true,
    })
  })

  afterEach(() => {
    delete navigator.wakeLock
  })

  async function mountPlaying() {
    const wrapper = await mountPlayer()
    await startPlayer(wrapper)
    await until(() => wrapper.find('.canvas-stub').exists())
    return wrapper
  }

  it('표출이 시작되면 화면 꺼짐 방지(Wake Lock)를 잡는다', async () => {
    await mountPlaying()
    expect(request).toHaveBeenCalledWith('screen')
  })

  it('표출 중에는 우클릭 메뉴를 막는다', async () => {
    const wrapper = await mountPlaying()

    const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
    wrapper.find('.canvas-stub').element.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
  })

  it('설정 화면에서는 우클릭을 막지 않는다', async () => {
    const wrapper = await mountPlayer()

    const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
    wrapper.find('[data-test="code-input"]').element.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(false)
  })

  it('가만히 두면 커서를 숨기고, 움직이면 다시 보인다', async () => {
    const wrapper = await mountPlaying()

    vi.useFakeTimers()
    try {
      await wrapper.find('.player').trigger('mousemove')
      expect(wrapper.find('.player').classes()).not.toContain('cursor-hidden')

      vi.advanceTimersByTime(3100)
      await wrapper.vm.$nextTick()
      expect(wrapper.find('.player').classes()).toContain('cursor-hidden')

      await wrapper.find('.player').trigger('mousemove')
      expect(wrapper.find('.player').classes()).not.toContain('cursor-hidden')
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('네이티브 셸(WPF) 다리', () => {
  const postMessage = vi.fn()

  beforeEach(() => {
    postMessage.mockClear()
    window.chrome = { webview: { postMessage } }
  })

  afterEach(() => {
    delete window.chrome
  })

  it('프로비전되면 장치 토큰을 셸에 넘긴다 (캐처 업로드용)', async () => {
    const wrapper = await mountPlayer()
    await startPlayer(wrapper)

    expect(postMessage).toHaveBeenCalledWith({
      type: 'provisioned',
      device_token: 'device-token-x',
      device_code: 'ABCD-234-EFG',
    })
  })
})

describe('설정 기억', () => {
  it('저장된 설정이 있으면 다시 켰을 때 곧장 표출로 간다', async () => {
    localStorage.setItem(
      'signallink.player',
      JSON.stringify({ device_code: 'ABCD-234-EFG', master_key: 'test-master' }),
    )

    const wrapper = await mountPlayer()
    await until(() => wrapper.find('.canvas-stub').exists())

    expect(post).toHaveBeenCalledWith('/player/provision', expect.anything())
    expect(wrapper.find('.canvas-stub').exists()).toBe(true)
  })
})
