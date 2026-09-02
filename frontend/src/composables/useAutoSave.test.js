/**
 * 주기적 자동 저장 테스트.
 *
 * 확인할 것은 셋이다 — 때가 되면 저장하는가, 저장하는 사이에 들어온 편집을
 * 삼키지 않는가, 실패가 이어질 때 물러서는가. 두 번째가 빠지면 저장하는
 * 동안 한 편집이 다음 저장에서 통째로 빠진다.
 */
import { defineComponent, h, nextTick } from 'vue'
import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { AUTO_SAVE_INTERVAL_MS, useAutoSave } from './useAutoSave'

/**
 * 컴포넌트 안에서 만든다. `onBeforeUnmount` 를 쓰기 때문에 setup 바깥에서
 * 부르면 경고가 뜨고 정리도 안 된다.
 */
function withAutoSave(attempt, options) {
  let api = null
  const wrapper = mount(
    defineComponent({
      setup() {
        api = useAutoSave(attempt, options)
        return () => h('div')
      },
    }),
  )
  return { api, wrapper }
}

/** 주기 n 번만큼 시간을 흘린다. */
async function ticks(n = 1, interval = AUTO_SAVE_INTERVAL_MS) {
  for (let i = 0; i < n; i += 1) {
    vi.advanceTimersByTime(interval)
    await nextTick()
    await Promise.resolve()
    await Promise.resolve()
  }
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('때가 되면 저장한다', () => {
  it('처음에는 아무 일도 없다', () => {
    const attempt = vi.fn(async () => true)
    const { api } = withAutoSave(attempt)

    expect(attempt).not.toHaveBeenCalled()
    expect(api.status.value).toBe('idle')
  })

  it('주기가 되면 저장한다', async () => {
    const attempt = vi.fn(async () => true)
    const { api } = withAutoSave(attempt)

    await ticks(1)

    expect(attempt).toHaveBeenCalledTimes(1)
    expect(api.status.value).toBe('saved')
    expect(api.savedAt.value).toBeInstanceOf(Date)
  })

  it('고칠 것이 없으면 저장 시각을 갱신하지 않는다', async () => {
    // 아무것도 안 바뀌었는데 저장하면 이 콘텐츠를 쓰는 스케줄의 버전이
    // 계속 올라가 장치가 헛되이 다시 받아 간다.
    const attempt = vi.fn(async () => false)
    const { api } = withAutoSave(attempt)

    await ticks(1)

    expect(api.status.value).toBe('idle')
    expect(api.savedAt.value).toBeNull()
  })

  it('앞서 저장한 적이 있으면 그 표시를 지우지 않는다', async () => {
    let saved = true
    const { api } = withAutoSave(async () => saved)

    await ticks(1)
    const at = api.savedAt.value
    saved = false
    await ticks(1)

    expect(api.status.value).toBe('saved')
    expect(api.savedAt.value).toBe(at)
  })

  it('멈추면 더 저장하지 않는다', async () => {
    const attempt = vi.fn(async () => true)
    const { api } = withAutoSave(attempt)

    api.stop()
    await ticks(3)

    expect(attempt).not.toHaveBeenCalled()
  })

  it('다시 켜면 이어서 센다', async () => {
    const attempt = vi.fn(async () => true)
    const { api } = withAutoSave(attempt)

    api.stop()
    api.start()
    await ticks(1)

    expect(attempt).toHaveBeenCalledTimes(1)
  })

  it('화면을 떠나면 시계를 끈다', async () => {
    const attempt = vi.fn(async () => true)
    const { wrapper } = withAutoSave(attempt)

    wrapper.unmount()
    await ticks(3)

    expect(attempt).not.toHaveBeenCalled()
  })
})

describe('겹치지 않는다', () => {
  it('앞 저장이 끝나기 전에 또 보내지 않는다', async () => {
    // 두 벌이 동시에 나가면 어느 쪽이 나중에 닿는지 알 수 없다.
    let release
    const attempt = vi.fn(
      () =>
        new Promise((resolve) => {
          release = () => resolve(true)
        }),
    )
    const { api } = withAutoSave(attempt)

    await ticks(1)
    expect(api.status.value).toBe('saving')

    await ticks(2)
    expect(attempt).toHaveBeenCalledTimes(1)

    release()
    await ticks(0)
  })
})

describe('실패하면 물러선다', () => {
  it('실패를 상태로 남긴다', async () => {
    const { api } = withAutoSave(async () => {
      throw { detail: '권한이 없습니다.' }
    })

    await ticks(1)

    expect(api.status.value).toBe('error')
    expect(api.error.value).toBe('권한이 없습니다.')
  })

  it('실패가 이어지면 간격을 벌린다', async () => {
    // 서버가 죽은 상태에서 30초마다 두드리면 오류만 쌓인다.
    const attempt = vi.fn(async () => {
      throw new Error('down')
    })
    withAutoSave(attempt)

    await ticks(1)
    expect(attempt).toHaveBeenCalledTimes(1)

    // 한 번 건너뛴다.
    await ticks(1)
    expect(attempt).toHaveBeenCalledTimes(1)

    await ticks(1)
    expect(attempt).toHaveBeenCalledTimes(2)
  })

  it('한 번 성공하면 다시 제 주기로 돌아온다', async () => {
    let fail = true
    const attempt = vi.fn(async () => {
      if (fail) throw new Error('down')
      return true
    })
    withAutoSave(attempt)

    await ticks(1)
    fail = false
    await ticks(2) // 한 번 건너뛰고 두 번째에 성공
    expect(attempt).toHaveBeenCalledTimes(2)

    await ticks(1)
    expect(attempt).toHaveBeenCalledTimes(3)
  })
})

describe('지금 저장', () => {
  it('주기를 기다리지 않고 한 번 보낸다', async () => {
    // 화면을 떠나기 직전에 마지막 30초를 잃지 않기 위해서다.
    const attempt = vi.fn(async () => true)
    const { api } = withAutoSave(attempt)

    await api.flush()

    expect(attempt).toHaveBeenCalledTimes(1)
  })

  it('물러서는 중이어도 보낸다', async () => {
    let fail = true
    const attempt = vi.fn(async () => {
      if (fail) throw new Error('down')
      return true
    })
    const { api } = withAutoSave(attempt)

    await ticks(1)
    fail = false
    await api.flush()

    expect(attempt).toHaveBeenCalledTimes(2)
  })
})
