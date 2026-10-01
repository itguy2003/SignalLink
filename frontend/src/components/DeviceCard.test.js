/**
 * 장치 카드 테스트.
 *
 * 제어 명령은 WebSocket 으로만 나가므로 접속 중인 장치에만 보낼 수 있다.
 * 오프라인 장치의 버튼이 눌리면 눌러 본 뒤에야 실패를 알게 되므로,
 * 잠금 상태를 특히 확인한다.
 */
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { i18n } from '@/i18n'

const imageUrl = vi.fn(async () => 'blob:fake-screenshot')
const revokeImageUrl = vi.fn()

vi.mock('@/api/client', () => ({
  imageUrl: (...args) => imageUrl(...args),
  revokeImageUrl: (...args) => revokeImageUrl(...args),
}))

import DeviceCard from './DeviceCard.vue'

const device = (extra = {}) => ({
  id: 1,
  name: '본관 1층 로비',
  device_code: 'K7QM-3RT-9XZ',
  org_name: '가나초등학교',
  place_name: '본관 로비',
  class_name: null,
  os: 'Windows',
  panel_type: 'LANDSCAPE',
  width: 1920,
  height: 1080,
  is_master: false,
  online: true,
  schedules: [{ id: 1, name: '평일 기본 스케줄', kind: '시간지정', orientation: 'LANDSCAPE', active: true }],
  screenshot_at: '2026-08-30T01:12:00Z',
  ...extra,
})

function mountCard(props = {}) {
  return mount(DeviceCard, {
    props: {
      device: device(),
      schedules: [{ id: 1, name: '평일 기본 스케줄' }],
      canManage: true,
      canCreate: true,
      ...props,
    },
    global: { plugins: [i18n] },
  })
}

/** 제어 버튼(끄기/리부팅/리로딩/미리보기). */
const controlButtons = (wrapper) => wrapper.findAll('.controls .btn')

const controlLabels = (wrapper) => controlButtons(wrapper).map((b) => b.text())

const buttonByLabel = (wrapper, label) =>
  controlButtons(wrapper).find((b) => b.text() === label)

beforeEach(() => {
  imageUrl.mockClear()
  imageUrl.mockResolvedValue('blob:fake-screenshot')
  revokeImageUrl.mockClear()
  i18n.global.locale.value = 'ko'
})

afterEach(() => {
  vi.useRealTimers()
})

describe('제어 버튼', () => {
  it('끄기·리부팅·리로딩·미리보기를 이 순서로 둔다', async () => {
    const wrapper = mountCard()
    await flushPromises()
    expect(controlLabels(wrapper)).toEqual(['끄기', '리부팅', '리로딩', '미리보기'])
  })

  it('온라인이면 모두 누를 수 있다', async () => {
    const wrapper = mountCard()
    await flushPromises()
    expect(controlButtons(wrapper).every((b) => b.attributes('disabled') === undefined)).toBe(true)
  })

  it('오프라인이면 모두 잠근다', async () => {
    // 명령은 WebSocket 으로만 나간다. 누르게 두면 눌러 본 뒤에야 실패를 안다.
    const wrapper = mountCard({ device: device({ online: false }) })
    await flushPromises()
    expect(controlButtons(wrapper).every((b) => b.attributes('disabled') !== undefined)).toBe(true)
  })

  it('왜 잠겼는지 알려 준다', async () => {
    const wrapper = mountCard({ device: device({ online: false }) })
    await flushPromises()
    expect(controlButtons(wrapper)[0].attributes('title')).toContain('접속 중인 장치')
  })

  it('제어 권한이 없으면 잠근다', async () => {
    const wrapper = mountCard({ canManage: false })
    await flushPromises()
    expect(controlButtons(wrapper).every((b) => b.attributes('disabled') !== undefined)).toBe(true)
  })

  it('누르면 명령을 부모에게 넘긴다', async () => {
    const wrapper = mountCard()
    await flushPromises()
    await buttonByLabel(wrapper, '리부팅').trigger('click')

    const [payload] = wrapper.emitted('command')[0]
    expect(payload.command).toBe('restart')
    expect(payload.device.id).toBe(1)
  })

  it('끄기는 위험한 동작으로 표시한다', async () => {
    const wrapper = mountCard()
    await flushPromises()
    expect(buttonByLabel(wrapper, '끄기').classes()).toContain('btn-danger')
  })
})

describe('화면 캡처', () => {
  it('가운데에 캡처를 보여 준다', async () => {
    const wrapper = mountCard()
    await flushPromises()

    const img = wrapper.find('.screen img')
    expect(img.exists()).toBe(true)
    expect(img.attributes('src')).toBe('blob:fake-screenshot')
    expect(imageUrl).toHaveBeenCalledWith('/devices/1/screenshot')
  })

  it('캡처가 없으면 무엇을 하면 되는지 알려 준다', async () => {
    const wrapper = mountCard({ device: device({ screenshot_at: null }) })
    await flushPromises()

    expect(wrapper.find('.screen img').exists()).toBe(false)
    expect(wrapper.find('.thumb-empty').text()).toContain('미리보기')
    // 받을 것이 없으므로 요청도 하지 않는다.
    expect(imageUrl).not.toHaveBeenCalled()
  })

  it('세로 장치는 세로 비율로 그린다', async () => {
    // 늘어난 화면을 보여 주면 배치를 잘못 판단하게 된다.
    const wrapper = mountCard({ device: device({ panel_type: 'PORTRAIT' }) })
    await flushPromises()
    expect(wrapper.find('.screen').classes()).toContain('portrait')
  })

  it('캡처 시각이 바뀌면 다시 받는다', async () => {
    const wrapper = mountCard()
    await flushPromises()
    imageUrl.mockClear()

    await wrapper.setProps({ device: device({ screenshot_at: '2026-08-30T02:00:00Z' }) })
    await flushPromises()

    expect(imageUrl).toHaveBeenCalledTimes(1)
  })

  it('사라질 때 objectURL 을 해제한다', async () => {
    // 해제하지 않으면 목록을 다시 그릴 때마다 blob 이 쌓인다.
    const wrapper = mountCard()
    await flushPromises()
    wrapper.unmount()

    expect(revokeImageUrl).toHaveBeenCalledWith('blob:fake-screenshot')
  })

  it('캡처를 못 받아도 카드는 그려진다', async () => {
    imageUrl.mockResolvedValue(null)
    const wrapper = mountCard()
    await flushPromises()

    expect(wrapper.find('.thumb-empty').exists()).toBe(true)
    expect(wrapper.text()).toContain('본관 1층 로비')
  })
})

describe('미리보기 요청', () => {
  it('명령을 보내고 새로고침으로 캡처를 기다린다', async () => {
    vi.useFakeTimers()
    const wrapper = mountCard()
    await flushPromises()

    await buttonByLabel(wrapper, '미리보기').trigger('click')

    // 부모가 성공을 알려 줘야 다음 단계로 넘어간다.
    wrapper.emitted('command')[0][0].resolve(true)
    await flushPromises()

    await vi.advanceTimersByTimeAsync(1000)
    expect(wrapper.emitted('refresh')).toBeTruthy()

    // 새 캡처가 도착했다고 알려 주면 더 확인하지 않는다.
    wrapper.emitted('refresh')[0][0].resolve({ screenshot_at: '2026-08-30T02:00:00Z' })
    await flushPromises()
    await vi.advanceTimersByTimeAsync(10000)
    expect(wrapper.emitted('refresh')).toHaveLength(1)
  })

  it('명령이 실패하면 기다리지 않는다', async () => {
    vi.useFakeTimers()
    const wrapper = mountCard()
    await flushPromises()

    await buttonByLabel(wrapper, '미리보기').trigger('click')
    wrapper.emitted('command')[0][0].resolve(false)
    await flushPromises()
    await vi.advanceTimersByTimeAsync(10000)

    expect(wrapper.emitted('refresh')).toBeUndefined()
  })

  it('기다리는 동안 미리보기 버튼을 잠근다', async () => {
    vi.useFakeTimers()
    const wrapper = mountCard()
    await flushPromises()

    await buttonByLabel(wrapper, '미리보기').trigger('click')
    await flushPromises()

    expect(buttonByLabel(wrapper, '미리보기').attributes('disabled')).toBeDefined()
    expect(wrapper.find('.screen-badge').text()).toContain('요청')
  })
})

describe('장치 정보', () => {
  it('이름과 고유번호를 보여 준다', async () => {
    const wrapper = mountCard()
    await flushPromises()
    expect(wrapper.text()).toContain('본관 1층 로비')
    expect(wrapper.text()).toContain('K7QM-3RT-9XZ')
  })

  it('오프라인 장치를 시각적으로 구분한다', async () => {
    const wrapper = mountCard({ device: device({ online: false }) })
    await flushPromises()
    expect(wrapper.classes()).toContain('offline')
    expect(wrapper.text()).toContain('오프라인')
  })

  it('배정 버튼은 분할 수정 창을 열도록 부모에게 알린다', async () => {
    // 배정 수정은 카드 안이 아니라 분할 창(DeviceScheduleDialog)에서 한다.
    const wrapper = mountCard()
    await flushPromises()

    await wrapper.find('[data-test="edit-schedules"]').trigger('click')
    expect(wrapper.emitted('edit-schedules')[0][0].id).toBe(1)
  })

  it('선택 여부를 표시한다', async () => {
    const wrapper = mountCard({ selected: true })
    await flushPromises()
    expect(wrapper.classes()).toContain('picked')
  })

  it('등록 권한이 없으면 위임·삭제를 감춘다', async () => {
    const wrapper = mountCard({ canCreate: false })
    await flushPromises()
    const labels = wrapper.findAll('.manage .btn').map((b) => b.text())
    expect(labels).toEqual(['수정'])
  })
})
