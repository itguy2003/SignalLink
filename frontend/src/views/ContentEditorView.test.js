/**
 * 콘텐츠 편집기 화면 테스트 — 저장에 관한 것만.
 *
 * 이 화면에서 저장은 **곧 배포**다. 저장하면 이 콘텐츠를 쓰는 스케줄의 버전이
 * 함께 올라가 장치가 다음 하트비트에 새 화면을 받아 간다. 그래서 언제 보내고
 * 언제 안 보내는지가 중요하다.
 */
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { i18n } from '@/i18n'

const get = vi.fn()
const put = vi.fn()

vi.mock('@/api/client', () => ({
  api: {
    get: (...args) => get(...args),
    put: (...args) => put(...args),
    post: vi.fn(),
    delete: vi.fn(),
  },
  TEST_MODE: false,
  getToken: () => null,
  setToken: vi.fn(),
}))

const push = vi.fn()
vi.mock('vue-router', () => ({
  useRoute: () => ({ params: { id: '7' }, query: {} }),
  useRouter: () => ({ push }),
}))

import ContentEditorView from './ContentEditorView.vue'

const DOCUMENT = {
  version: 1,
  layout: { width: 1920, height: 1080, background: '#000000' },
  elements: [],
}

function detail(over = {}) {
  return {
    id: 7,
    name: '가을 포스터',
    description: null,
    org_id: 1,
    version: 3,
    usage_count: 0,
    document: structuredClone(DOCUMENT),
    ...over,
  }
}

async function mountEditor() {
  setActivePinia(createPinia())
  const wrapper = mount(ContentEditorView, {
    global: {
      plugins: [createPinia(), i18n],
      stubs: {
        ContentCanvas: { name: 'ContentCanvas', template: '<div class="canvas-stub" />' },
        ContentPreview: true,
        RouterLink: { template: '<a><slot /></a>' },
      },
    },
  })
  await flushPromises()
  return wrapper
}

/** 캔버스가 무언가 바뀌었다고 알린다. */
async function edit(wrapper) {
  wrapper.findComponent({ name: 'ContentCanvas' }).vm.$emit('change')
  await wrapper.vm.$nextTick()
}

/** 자동 저장 주기 한 번. */
async function tick(times = 1) {
  for (let i = 0; i < times; i += 1) {
    vi.advanceTimersByTime(30_000)
    await flushPromises()
  }
}

const autoSaveToggle = (wrapper) => wrapper.find('.check input[type="checkbox"]')

beforeEach(() => {
  i18n.global.locale.value = 'ko'
  globalThis.localStorage?.clear?.()
  get.mockReset()
  put.mockReset()
  push.mockReset()
  get.mockImplementation(async (path) => (path === '/widgets' ? [] : detail()))
  put.mockImplementation(async () => detail({ version: 4, usage_count: 2 }))
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('자동 저장', () => {
  it('기본으로 켜져 있다', async () => {
    // 한 번 열면 오래 머무는 화면이라, 저장을 잊는 쪽이 기억하는 쪽보다 흔하다.
    const wrapper = await mountEditor()

    expect(autoSaveToggle(wrapper).element.checked).toBe(true)
  })

  it('고친 것이 있으면 주기마다 저장한다', async () => {
    const wrapper = await mountEditor()
    await edit(wrapper)

    await tick()

    expect(put).toHaveBeenCalledTimes(1)
    expect(put.mock.calls[0][0]).toBe('/contents/7')
  })

  it('고친 것이 없으면 보내지 않는다', async () => {
    // 아무것도 안 바뀌었는데 저장하면 이 콘텐츠를 쓰는 스케줄의 버전이 계속
    // 올라가 장치가 헛되이 다시 받아 간다.
    await mountEditor()

    await tick(3)

    expect(put).not.toHaveBeenCalled()
  })

  it('저장하고 나면 안 저장됨 표시를 지운다', async () => {
    const wrapper = await mountEditor()
    await edit(wrapper)
    expect(wrapper.text()).toContain('저장 안 됨')

    await tick()

    expect(wrapper.text()).not.toContain('저장 안 됨')
  })

  it('마지막으로 저장한 때를 알려 준다', async () => {
    // 30초마다 알림을 띄우면 편집을 방해한다. 상태 한 줄로만 알린다.
    const wrapper = await mountEditor()
    await edit(wrapper)

    await tick()

    expect(wrapper.text()).toContain('방금')
  })

  it('실패하면 알림 대신 상태로 알린다', async () => {
    put.mockRejectedValue({ detail: '권한이 없습니다.' })
    const wrapper = await mountEditor()
    await edit(wrapper)

    await tick()

    expect(wrapper.text()).toContain('자동 저장 실패')
  })
})

describe('끄고 켜기', () => {
  it('끄면 주기가 와도 보내지 않는다', async () => {
    // 저장이 곧 배포다. 다 만들기 전까지 내보내고 싶지 않을 때가 있다.
    const wrapper = await mountEditor()
    await autoSaveToggle(wrapper).setValue(false)
    await edit(wrapper)

    await tick(3)

    expect(put).not.toHaveBeenCalled()
  })

  it('다시 켜면 이어서 저장한다', async () => {
    const wrapper = await mountEditor()
    await autoSaveToggle(wrapper).setValue(false)
    await edit(wrapper)
    await tick(2)

    await autoSaveToggle(wrapper).setValue(true)
    await tick()

    expect(put).toHaveBeenCalledTimes(1)
  })

  it('꺼도 손으로는 저장할 수 있다', async () => {
    const wrapper = await mountEditor()
    await autoSaveToggle(wrapper).setValue(false)
    await edit(wrapper)

    await wrapper.find('.btn-primary').trigger('click')
    await flushPromises()

    expect(put).toHaveBeenCalledTimes(1)
  })
})

describe('저장하는 동안의 편집', () => {
  it('보낸 뒤에 고친 것은 저장된 것으로 치지 않는다', async () => {
    // 그렇게 치면 그 편집이 다음 저장에서 통째로 빠진다.
    let release
    put.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = () => resolve(detail({ version: 4 }))
        }),
    )
    const wrapper = await mountEditor()
    await edit(wrapper)
    await tick()

    // 저장이 오가는 사이에 또 고친다.
    await edit(wrapper)
    release()
    await flushPromises()

    expect(wrapper.text()).toContain('저장 안 됨')
  })

  it('응답으로 문서를 갈아 끼우지 않는다', async () => {
    // 응답이 늦게 오면 그 사이의 편집을 되돌려 버린다. 서버만 아는 값
    // (버전·사용처)만 받아 적는다.
    const wrapper = await mountEditor()
    const before = wrapper.findComponent({ name: 'ContentCanvas' }).props('document')

    await edit(wrapper)
    await tick()

    expect(wrapper.findComponent({ name: 'ContentCanvas' }).props('document')).toBe(before)
    expect(wrapper.text()).toContain('v4')
  })
})
