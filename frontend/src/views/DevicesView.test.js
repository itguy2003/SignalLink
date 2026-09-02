/**
 * 장치 관리 화면 테스트.
 *
 * 여기서 확인하는 것은 **장치 탭과 그룹 탭이 같은 데이터를 본다**는 점이다.
 * 그룹 콤보로 거른 목록과 그룹 탭의 구성원이 갈라지면, 어느 화면에서 봤는지에
 * 따라 판단이 달라진다.
 */
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { i18n } from '@/i18n'

const device = (id, name, extra = {}) => ({
  id,
  name,
  device_code: `CODE-${id}`,
  org_id: 3,
  org_name: '가나초등학교',
  place_name: '본관',
  os: 'Windows',
  panel_type: 'LANDSCAPE',
  width: 1920,
  height: 1080,
  is_master: false,
  online: true,
  schedule_id: null,
  schedule_name: null,
  screenshot_at: null,
  ...extra,
})

let devices = []
let groups = []

const get = vi.fn(async (path) => {
  if (path === '/devices') return { items: devices, total: devices.length, page: 1, size: 20 }
  if (path === '/device-groups') return groups
  if (path === '/organizations') return []
  if (path === '/schedules') return { items: [], total: 0, page: 1, size: 200 }
  return {}
})

vi.mock('@/api/client', () => ({
  api: {
    get: (...args) => get(...args),
    post: vi.fn(async () => ({})),
    put: vi.fn(async () => ({})),
    delete: vi.fn(async () => ({})),
  },
  imageUrl: vi.fn(async () => null),
  revokeImageUrl: vi.fn(),
  TEST_MODE: false,
}))

vi.mock('@/stores/auth', () => ({
  useAuthStore: () => ({
    user: { org_id: 3 },
    can: { manageDevices: true, createDevices: true },
  }),
}))

import DevicesView from './DevicesView.vue'

async function mountView() {
  setActivePinia(createPinia())
  const wrapper = mount(DevicesView, {
    global: {
      plugins: [createPinia(), i18n],
      stubs: { RouterLink: { template: '<a><slot /></a>' } },
    },
  })
  await flushPromises()
  return wrapper
}

const cardNames = (wrapper) => wrapper.findAll('.device-card .name').map((n) => n.text().trim())

const groupSelect = (wrapper) => wrapper.findAll('.card-header select')[1]

const tabButton = (wrapper, label) =>
  wrapper.findAll('.tab').find((b) => b.text() === label)

beforeEach(() => {
  devices = [device(1, '로비 DID'), device(2, '3학년 2반'), device(3, '급식실 키오스크')]
  groups = [{ id: 1, name: '본관 1층', user_id: 1, device_ids: [1, 3] }]
  get.mockClear()
  i18n.global.locale.value = 'ko'
})

describe('탭', () => {
  it('장치와 장치그룹을 탭으로 나눈다', async () => {
    const wrapper = await mountView()
    expect(wrapper.findAll('.tab').map((b) => b.text())).toEqual(['장치', '장치그룹'])
  })

  it('처음에는 장치 탭을 보여 준다', async () => {
    const wrapper = await mountView()
    expect(cardNames(wrapper)).toHaveLength(3)
  })

  it('그룹 탭은 고른 그룹의 장치만 보여 준다', async () => {
    const wrapper = await mountView()
    await tabButton(wrapper, '장치그룹').trigger('click')
    await flushPromises()

    expect(wrapper.find('.group-select').exists()).toBe(true)
    expect(cardNames(wrapper)).toEqual(['로비 DID', '급식실 키오스크'])
  })
})

describe('보기 방식', () => {
  it('처음에는 카드로 보여 준다', async () => {
    const wrapper = await mountView()
    expect(wrapper.findAll('.device-card')).toHaveLength(3)
    expect(wrapper.find('.device-row').exists()).toBe(false)
  })

  it('리스트로 바꾸면 표로 보여 준다', async () => {
    const wrapper = await mountView()
    await wrapper.findAll('.view-btn')[1].trigger('click')
    await flushPromises()

    expect(wrapper.findAll('.device-row')).toHaveLength(3)
    expect(wrapper.find('.device-card').exists()).toBe(false)
  })

  it('리스트에도 같은 정보와 같은 제어 버튼을 둔다', async () => {
    // 보기 방식은 밀도만 바꾼다. 리스트에서만 빠진 값이 있으면 그 값을
    // 확인하려고 매번 보기를 바꿔야 한다.
    const wrapper = await mountView()
    await wrapper.findAll('.view-btn')[1].trigger('click')
    await flushPromises()

    const row = wrapper.find('.device-row')
    expect(row.text()).toContain('로비 DID')
    expect(row.text()).toContain('CODE-1')
    expect(row.text()).toContain('가나초등학교')
    expect(row.text()).toContain('1920×1080')
    for (const label of ['끄기', '리부팅', '리로딩', '미리보기']) {
      expect(row.text()).toContain(label)
    }
  })

  it('탭을 옮겨도 보기 방식이 유지된다', async () => {
    // 되돌아가면 리스트로 훑던 흐름이 매번 끊긴다.
    const wrapper = await mountView()
    await wrapper.findAll('.view-btn')[1].trigger('click')
    await flushPromises()

    await tabButton(wrapper, '장치그룹').trigger('click')
    await flushPromises()

    expect(wrapper.findAll('.device-row').length).toBeGreaterThan(0)
    expect(wrapper.find('.device-card').exists()).toBe(false)
  })

  it('그룹 탭에서 바꾼 보기 방식이 장치 탭에도 남는다', async () => {
    const wrapper = await mountView()
    await tabButton(wrapper, '장치그룹').trigger('click')
    await flushPromises()

    await wrapper.findAll('.view-btn')[1].trigger('click')
    await flushPromises()

    await tabButton(wrapper, '장치').trigger('click')
    await flushPromises()

    expect(wrapper.findAll('.device-row')).toHaveLength(3)
  })
})

describe('그룹 필터 콤보', () => {
  it('내 그룹을 선택지로 올린다', async () => {
    const wrapper = await mountView()
    const options = groupSelect(wrapper).findAll('option').map((o) => o.text())
    expect(options).toEqual(['전체 그룹', '본관 1층'])
  })

  it('고르면 그 그룹의 장치만 보여 준다', async () => {
    const wrapper = await mountView()
    await groupSelect(wrapper).setValue(1)
    await flushPromises()

    expect(cardNames(wrapper)).toEqual(['로비 DID', '급식실 키오스크'])
  })

  it('무엇으로 거르고 있는지 알려 준다', async () => {
    const wrapper = await mountView()
    await groupSelect(wrapper).setValue(1)
    await flushPromises()

    expect(wrapper.find('.groupbar').text()).toContain('본관 1층')
  })

  it('전체 그룹으로 되돌리면 다시 다 보인다', async () => {
    const wrapper = await mountView()
    await groupSelect(wrapper).setValue(1)
    await flushPromises()
    await groupSelect(wrapper).setValue('')
    await flushPromises()

    expect(cardNames(wrapper)).toHaveLength(3)
    expect(wrapper.find('.groupbar').exists()).toBe(false)
  })

  it('거르는 동안에는 페이지 넘김을 감춘다', async () => {
    // 그 묶음이 전부다. 다음 장이 있는 것처럼 보이면 안 된다.
    const wrapper = await mountView()
    expect(wrapper.find('.pager').exists()).toBe(true)

    await groupSelect(wrapper).setValue(1)
    await flushPromises()
    expect(wrapper.find('.pager').exists()).toBe(false)
  })

  it('그룹에 없는 장치는 빠진다', async () => {
    const wrapper = await mountView()
    await groupSelect(wrapper).setValue(1)
    await flushPromises()

    expect(cardNames(wrapper)).not.toContain('3학년 2반')
  })
})

describe('장치가 많을 때', () => {
  // 손으로 적은 몇 대만으로는 화면이 무너지는 지점을 볼 수 없다.
  const many = Array.from({ length: 50 }, (_, i) => device(i + 1, `${i + 1}번 장치`))

  it('그룹으로 걸러도 한 화면에 20대까지만 그린다', async () => {
    // 통째로 받아 온 목록이라 서버 페이지가 없다. 그대로 두면 카드 50장이
    // 한꺼번에 그려져 스크롤도 길고 브라우저도 굼떠진다.
    devices = many
    groups = [{ id: 1, name: '전교실', user_id: 1, device_ids: many.map((d) => d.id) }]
    const wrapper = await mountView()

    await groupSelect(wrapper).setValue(1)
    await flushPromises()

    expect(wrapper.findAll('.device-card')).toHaveLength(20)
    expect(wrapper.find('.local-pager').text()).toContain('1 / 3')
  })

  it('다음 장으로 넘길 수 있다', async () => {
    devices = many
    groups = [{ id: 1, name: '전교실', user_id: 1, device_ids: many.map((d) => d.id) }]
    const wrapper = await mountView()
    await groupSelect(wrapper).setValue(1)
    await flushPromises()

    await wrapper.findAll('.local-pager .btn')[1].trigger('click')
    await flushPromises()

    expect(cardNames(wrapper)[0]).toBe('21번 장치')
  })

  it('그룹 탭에서도 20대까지만 그린다', async () => {
    devices = many
    groups = [{ id: 1, name: '전교실', user_id: 1, device_ids: many.map((d) => d.id) }]
    const wrapper = await mountView()

    await tabButton(wrapper, '장치그룹').trigger('click')
    await flushPromises()

    expect(wrapper.findAll('.device-card')).toHaveLength(20)
  })

  it('리스트 보기에서도 같은 수만 그린다', async () => {
    // 보기 방식이 한 화면에 담기는 수를 바꾸면 같은 화면으로 읽히지 않는다.
    devices = many
    groups = [{ id: 1, name: '전교실', user_id: 1, device_ids: many.map((d) => d.id) }]
    const wrapper = await mountView()
    await groupSelect(wrapper).setValue(1)
    await wrapper.findAll('.view-btn')[1].trigger('click')
    await flushPromises()

    expect(wrapper.findAll('.device-row')).toHaveLength(20)
  })

  it('그룹을 바꾸면 첫 장부터 본다', async () => {
    devices = many
    groups = [
      { id: 1, name: '전교실', user_id: 1, device_ids: many.map((d) => d.id) },
      { id: 2, name: '일부', user_id: 1, device_ids: [1, 2] },
    ]
    const wrapper = await mountView()
    await groupSelect(wrapper).setValue(1)
    await flushPromises()
    await wrapper.findAll('.local-pager .btn')[1].trigger('click')
    await flushPromises()

    await groupSelect(wrapper).setValue(2)
    await flushPromises()

    expect(cardNames(wrapper)).toEqual(['1번 장치', '2번 장치'])
  })
})

describe('장치 정보의 단일 출처', () => {
  it('두 탭이 같은 카드로 그린다', async () => {
    // 같은 장치를 두 곳에서 다르게 그리면 어느 쪽이 맞는지 헷갈린다.
    const wrapper = await mountView()
    const inDeviceTab = wrapper.findAll('.device-card')[0].find('.facts').text()

    await tabButton(wrapper, '장치그룹').trigger('click')
    await flushPromises()

    expect(wrapper.findAll('.device-card')[0].find('.facts').text()).toBe(inDeviceTab)
  })

  it('그룹으로 걸러도 카드 모양은 그대로다', async () => {
    const wrapper = await mountView()
    const before = wrapper.find('.device-card').html()

    await groupSelect(wrapper).setValue(1)
    await flushPromises()

    expect(wrapper.find('.device-card').html()).toBe(before)
  })
})
