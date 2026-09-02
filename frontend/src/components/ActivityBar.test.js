/**
 * 상단 활동 띠 테스트.
 *
 * 이 띠의 목적은 "멈춘 것처럼 보이지 않게" 하나뿐이다. 그래서 확인할 것도
 * 둘로 좁혀진다 — 오래 걸리는 일에는 반드시 뜨는가, 짧은 일에 번쩍이지는
 * 않는가. 뒤쪽이 빠지면 목록을 넘길 때마다 화면이 깜빡여 오히려 방해가 된다.
 */
import { mount } from '@vue/test-utils'
import { ref } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { i18n } from '@/i18n'

// vi.mock 은 파일 맨 위로 끌어올려진다 — 바깥 변수를 쓰면 아직 만들어지기
// 전이라 터진다. 그래서 ref 를 공장 안에서 만들고, 아래서 꺼내 쓴다.
vi.mock('@/api/client', () => ({
  pendingRequests: ref(0),
  TEST_MODE: false,
}))

import { pendingRequests } from '@/api/client'
import ActivityBar from './ActivityBar.vue'

function mountBar() {
  return mount(ActivityBar, { global: { plugins: [i18n] } })
}

/** 시간을 흘리고 화면을 다시 그린다. */
async function advance(wrapper, ms) {
  vi.advanceTimersByTime(ms)
  await wrapper.vm.$nextTick()
}

async function setPending(wrapper, count) {
  pendingRequests.value = count
  await wrapper.vm.$nextTick()
}

beforeEach(() => {
  vi.useFakeTimers()
  pendingRequests.value = 0
})

afterEach(() => {
  vi.useRealTimers()
})

describe('오래 걸릴 때만 뜬다', () => {
  it('아무것도 안 나가 있으면 없다', () => {
    expect(mountBar().find('.activity').exists()).toBe(false)
  })

  it('잠깐 걸리는 일에는 번쩍이지 않는다', async () => {
    // 목록 하나 받는 50ms 짜리까지 띄우면 화면이 쉴 새 없이 깜빡인다.
    const wrapper = mountBar()

    await setPending(wrapper, 1)
    await advance(wrapper, 100)
    await setPending(wrapper, 0)
    await advance(wrapper, 500)

    expect(wrapper.find('.activity').exists()).toBe(false)
  })

  it('오래 걸리면 띄운다', async () => {
    const wrapper = mountBar()

    await setPending(wrapper, 1)
    await advance(wrapper, 400)

    expect(wrapper.find('.activity').exists()).toBe(true)
  })

  it('끝나면 걷는다', async () => {
    const wrapper = mountBar()

    await setPending(wrapper, 1)
    await advance(wrapper, 400)
    await setPending(wrapper, 0)
    await advance(wrapper, 500)

    expect(wrapper.find('.activity').exists()).toBe(false)
  })

  it('띄운 뒤에는 잠깐이라도 유지한다', async () => {
    // 한 프레임만 번쩍이면 그것대로 눈에 거슬린다.
    const wrapper = mountBar()

    await setPending(wrapper, 1)
    await advance(wrapper, 310)
    await setPending(wrapper, 0)
    await advance(wrapper, 100)

    expect(wrapper.find('.activity').exists()).toBe(true)

    await advance(wrapper, 400)
    expect(wrapper.find('.activity').exists()).toBe(false)
  })
})

describe('여러 개가 겹칠 때', () => {
  it('하나가 끝나도 남아 있으면 계속 띄운다', async () => {
    const wrapper = mountBar()

    await setPending(wrapper, 3)
    await advance(wrapper, 400)
    await setPending(wrapper, 1)
    await advance(wrapper, 500)

    expect(wrapper.find('.activity').exists()).toBe(true)
  })

  it('이어서 다른 일이 시작되면 끊기지 않는다', async () => {
    // 걷으려던 참에 새 요청이 오면 그대로 이어 간다.
    const wrapper = mountBar()

    await setPending(wrapper, 1)
    await advance(wrapper, 400)
    await setPending(wrapper, 0)
    await setPending(wrapper, 1)
    await advance(wrapper, 1000)

    expect(wrapper.find('.activity').exists()).toBe(true)
  })
})
