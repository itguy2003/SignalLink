/**
 * 화면 캡처 썸네일 테스트.
 *
 * objectURL 수명 관리가 이 컴포넌트의 존재 이유다. 해제를 빠뜨리면 목록을
 * 다시 그릴 때마다 blob 이 쌓이는데, 화면에서는 아무 증상도 보이지 않는다.
 */
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { i18n } from '@/i18n'

const imageUrl = vi.fn(async () => 'blob:one')
const revokeImageUrl = vi.fn()

vi.mock('@/api/client', () => ({
  imageUrl: (...args) => imageUrl(...args),
  revokeImageUrl: (...args) => revokeImageUrl(...args),
}))

import DeviceScreenThumb from './DeviceScreenThumb.vue'

const device = (extra = {}) => ({
  id: 7,
  name: '로비 DID',
  screenshot_at: '2026-08-30T01:12:00Z',
  ...extra,
})

async function mountThumb(props = {}, slots = {}) {
  const wrapper = mount(DeviceScreenThumb, {
    props: { device: device(), ...props },
    slots,
    global: { plugins: [i18n] },
  })
  await flushPromises()
  return wrapper
}

beforeEach(() => {
  imageUrl.mockClear()
  imageUrl.mockResolvedValue('blob:one')
  revokeImageUrl.mockClear()
  i18n.global.locale.value = 'ko'
})

describe('불러오기', () => {
  it('그 장치의 캡처를 받아 그린다', async () => {
    const wrapper = await mountThumb()

    expect(imageUrl).toHaveBeenCalledWith('/devices/7/screenshot')
    expect(wrapper.find('img').attributes('src')).toBe('blob:one')
  })

  it('캡처가 없으면 요청하지 않는다', async () => {
    // 올라온 것이 없으면 실제 서버에서도 404 다. 헛요청을 보낼 이유가 없다.
    const wrapper = await mountThumb({ device: device({ screenshot_at: null }) })

    expect(imageUrl).not.toHaveBeenCalled()
    expect(wrapper.find('img').exists()).toBe(false)
    expect(wrapper.find('.thumb-empty').exists()).toBe(true)
  })

  it('받지 못해도 빈 상태로 남는다', async () => {
    imageUrl.mockResolvedValue(null)
    const wrapper = await mountThumb()

    expect(wrapper.find('img').exists()).toBe(false)
    expect(wrapper.find('.thumb-empty').exists()).toBe(true)
  })

  it('캡처 시각이 바뀌면 다시 받는다', async () => {
    const wrapper = await mountThumb()
    imageUrl.mockClear()

    await wrapper.setProps({ device: device({ screenshot_at: '2026-08-30T02:00:00Z' }) })
    await flushPromises()

    expect(imageUrl).toHaveBeenCalledTimes(1)
  })

  it('시각이 그대로면 다시 받지 않는다', async () => {
    const wrapper = await mountThumb()
    imageUrl.mockClear()

    await wrapper.setProps({ device: device({ name: '이름만 변경' }) })
    await flushPromises()

    expect(imageUrl).not.toHaveBeenCalled()
  })
})

describe('해제', () => {
  it('사라질 때 objectURL 을 해제한다', async () => {
    const wrapper = await mountThumb()
    wrapper.unmount()

    expect(revokeImageUrl).toHaveBeenCalledWith('blob:one')
  })

  it('새로 받기 전에 이전 것을 해제한다', async () => {
    // 갱신할 때마다 쌓이면 오래 열어 둔 화면에서 특히 티가 난다.
    const wrapper = await mountThumb()
    imageUrl.mockResolvedValue('blob:two')

    await wrapper.setProps({ device: device({ screenshot_at: '2026-08-30T02:00:00Z' }) })
    await flushPromises()

    expect(revokeImageUrl).toHaveBeenCalledWith('blob:one')
    expect(wrapper.find('img').attributes('src')).toBe('blob:two')
  })

  it('언마운트 뒤 도착한 응답도 해제한다', async () => {
    // 늦게 온 URL 을 그냥 버리면 아무도 해제하지 않는다.
    let resolveImage
    imageUrl.mockReturnValue(new Promise((resolve) => { resolveImage = resolve }))

    const wrapper = mount(DeviceScreenThumb, {
      props: { device: device() },
      global: { plugins: [i18n] },
    })
    wrapper.unmount()

    resolveImage('blob:late')
    await flushPromises()

    expect(revokeImageUrl).toHaveBeenCalledWith('blob:late')
  })
})

describe('화면에 들어올 때까지 미루기', () => {
  /** IntersectionObserver 를 흉내 낸다. jsdom 에는 없다. */
  function stubObserver() {
    const observed = []
    let fire
    class FakeIO {
      constructor(callback) {
        fire = (isIntersecting) => callback([{ isIntersecting }])
      }
      observe(el) {
        observed.push(el)
      }
      disconnect() {
        observed.length = 0
      }
    }
    vi.stubGlobal('IntersectionObserver', FakeIO)
    return { observed, enter: () => fire(true), leave: () => fire(false) }
  }

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('보이기 전에는 받지 않는다', async () => {
    // 장치 50대면 마운트하자마자 수십 장이 동시에 나가고, 브라우저 동시
    // 연결 한도에 걸려 맨 위 카드조차 늦게 뜬다.
    const io = stubObserver()
    await mountThumb()

    expect(imageUrl).not.toHaveBeenCalled()
    expect(io.observed).toHaveLength(1)
  })

  it('화면에 들어오면 받는다', async () => {
    const io = stubObserver()
    const wrapper = await mountThumb()

    io.enter()
    await flushPromises()

    expect(imageUrl).toHaveBeenCalledWith('/devices/7/screenshot')
    expect(wrapper.find('img').attributes('src')).toBe('blob:one')
  })

  it('스쳐 지나가기만 하면 받지 않는다', async () => {
    const io = stubObserver()
    await mountThumb()

    io.leave()
    await flushPromises()

    expect(imageUrl).not.toHaveBeenCalled()
  })

  it('아직 못 본 카드는 캡처 시각이 바뀌어도 받지 않는다', async () => {
    // 그때 화면에 들어오면 받으면 된다. 미리 받으면 미루는 의미가 없다.
    stubObserver()
    const wrapper = await mountThumb()

    await wrapper.setProps({ device: device({ screenshot_at: '2026-08-30T02:00:00Z' }) })
    await flushPromises()

    expect(imageUrl).not.toHaveBeenCalled()
  })

  it('IntersectionObserver 가 없으면 바로 받는다', async () => {
    // 미루기는 성능 최적화이지 동작 조건이 아니다. 없다고 영영 안 뜨면 더 나쁘다.
    vi.stubGlobal('IntersectionObserver', undefined)
    await mountThumb()
    expect(imageUrl).toHaveBeenCalledTimes(1)
  })
})

describe('빈 상태', () => {
  it('기본 문구는 무엇을 하면 되는지 알려 준다', async () => {
    const wrapper = await mountThumb({ device: device({ screenshot_at: null }) })
    expect(wrapper.text()).toContain('미리보기')
  })

  it('부모가 문구를 갈아 끼울 수 있다', async () => {
    // 그룹 카드의 작은 칸에는 긴 안내가 들어가지 않는다.
    const wrapper = await mountThumb(
      { device: device({ screenshot_at: null }) },
      { empty: '<span class="custom">로비 DID</span>' },
    )
    expect(wrapper.find('.custom').text()).toBe('로비 DID')
    expect(wrapper.text()).not.toContain('미리보기')
  })
})
