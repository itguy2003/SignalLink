/**
 * 대시보드 장치 상태 표 테스트.
 *
 * 사양 값(CPU·메모리·저장장치·해상도·앱 버전)은 전부 비어 있을 수 있다.
 * 빈 값을 그대로 이으면 '· ·' 만 남으므로, 그 처리를 특히 확인한다.
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
  os: 'Windows',
  form_factor: 'DID형',
  panel_type: 'LANDSCAPE',
  width: 1920,
  height: 1080,
  cpu: 'Intel N100',
  memory: '8GB',
  storage: '256GB',
  app_version: '1.2.0',
  schedules: [{ id: 1, name: '평일 기본 스케줄', kind: '시간지정', orientation: 'LANDSCAPE', active: true }],
  version: 3,
  last_seen_at: new Date().toISOString(),
  online: true,
  ...extra,
})

let devices = []

const get = vi.fn(async (path) => {
  if (path === '/devices') return { items: devices, total: devices.length, page: 1, size: 200 }
  if (path === '/schedules') return { items: [], total: 0, page: 1, size: 200 }
  if (path === '/users/pending-count') return { count: 0 }
  return {}
})

vi.mock('@/api/client', () => ({
  api: { get: (...args) => get(...args) },
  TEST_MODE: false,
}))

vi.mock('@/stores/auth', () => ({
  useAuthStore: () => ({
    user: { org_name: '가나초등학교' },
    can: { approveUsers: false },
  }),
}))

import DashboardView from './DashboardView.vue'

async function mountView() {
  setActivePinia(createPinia())
  const wrapper = mount(DashboardView, {
    global: {
      plugins: [createPinia(), i18n],
      stubs: { RouterLink: { template: '<a><slot /></a>' } },
    },
  })
  await flushPromises()
  return wrapper
}

/** 장치 상태 표의 첫 행. */
const firstRow = (wrapper) => wrapper.find('.panels tbody tr')

const specCell = (wrapper) => wrapper.find('.panels tbody tr .spec')

beforeEach(() => {
  devices = [device(1, '본관 로비')]
  get.mockClear()
  i18n.global.locale.value = 'ko'
})

describe('장치 상태 표', () => {
  it('시스템 열을 둔다', async () => {
    const wrapper = await mountView()
    const headers = wrapper.findAll('.panels thead th').map((h) => h.text())
    expect(headers).toContain('시스템')
  })

  it('운영체제·해상도·방향을 보여 준다', async () => {
    const wrapper = await mountView()
    const text = specCell(wrapper).text()
    expect(text).toContain('Windows')
    expect(text).toContain('1920×1080')
    expect(text).toContain('가로')
  })

  it('CPU·메모리·저장장치·앱 버전을 보여 준다', async () => {
    const wrapper = await mountView()
    const text = specCell(wrapper).text()
    expect(text).toContain('Intel N100')
    expect(text).toContain('8GB')
    expect(text).toContain('256GB')
    expect(text).toContain('1.2.0')
  })

  it('장치명과 고유번호는 한 칸에 둔다', async () => {
    // 시스템 열을 넣으면서 열 수를 늘리지 않으려고 합쳤다.
    const wrapper = await mountView()
    const cell = firstRow(wrapper).findAll('td')[0]
    expect(cell.text()).toContain('본관 로비')
    expect(cell.text()).toContain('CODE-1')
  })

  it('마우스를 올리면 어떤 값이 무엇인지 알려 준다', async () => {
    const wrapper = await mountView()
    const tip = specCell(wrapper).attributes('title')
    expect(tip).toContain('CPU: Intel N100')
    expect(tip).toContain('해상도: 1920×1080')
    expect(tip).toContain('앱 버전: 1.2.0')
  })
})

describe('저장공간', () => {
  const GB = 1000 ** 3

  it('실제 용량과 사용률을 보여 준다', async () => {
    devices = [
      device(1, '본관 로비', {
        storage: '256GB',
        storage_total_bytes: 256 * GB,
        storage_free_bytes: 100 * GB,
        storage_used_bytes: 156 * GB,
        storage_usage: 0.609375,
        storage_warning: false,
      }),
    ]
    const wrapper = await mountView()

    const text = specCell(wrapper).text()
    expect(text).toContain('256GB')
    expect(text).toContain('156GB')
    expect(text).toContain('61%')
  })

  it('80% 이상이면 경보를 띄운다', async () => {
    devices = [
      device(1, '본관 로비', {
        storage_total_bytes: 100 * GB,
        storage_free_bytes: 15 * GB,
        storage_used_bytes: 85 * GB,
        storage_usage: 0.85,
        storage_warning: true,
      }),
    ]
    const wrapper = await mountView()

    const warn = specCell(wrapper).find('.badge-warning')
    expect(warn.exists()).toBe(true)
    expect(warn.text()).toContain('85%')
  })

  it('80% 미만이면 경보가 없다', async () => {
    devices = [
      device(1, '본관 로비', {
        storage_total_bytes: 100 * GB,
        storage_free_bytes: 50 * GB,
        storage_used_bytes: 50 * GB,
        storage_usage: 0.5,
        storage_warning: false,
      }),
    ]
    const wrapper = await mountView()
    expect(specCell(wrapper).find('.badge-warning').exists()).toBe(false)
  })

  it('경보 판정은 서버 값을 따른다', async () => {
    // 임계 기준을 화면에서 다시 재면 CMS 와 알림이 다른 시점에 경고한다.
    // storage_usage 가 낮아도 서버가 경고라면 경고다.
    devices = [
      device(1, '본관 로비', {
        storage_total_bytes: 100 * GB,
        storage_free_bytes: 90 * GB,
        storage_used_bytes: 10 * GB,
        storage_usage: 0.1,
        storage_warning: true,
      }),
    ]
    const wrapper = await mountView()
    expect(specCell(wrapper).find('.badge-warning').exists()).toBe(true)
  })

  it('보고가 없으면 등록된 사양 문자열로 물러난다', async () => {
    // 사람이 적어 넣은 사양과 실측은 다른 값이다. 실측이 없다고 사양까지 숨기지 않는다.
    devices = [
      device(1, '신규 장치', {
        storage: '128GB',
        storage_total_bytes: null,
        storage_free_bytes: null,
        storage_used_bytes: null,
        storage_usage: null,
        storage_warning: false,
      }),
    ]
    const wrapper = await mountView()

    const text = specCell(wrapper).text()
    expect(text).toContain('128GB')
    expect(text).not.toContain('%')
    expect(specCell(wrapper).find('.badge-warning').exists()).toBe(false)
  })

  it('저장공간이 찬 장치는 확인 목록에 이유와 함께 올라온다', async () => {
    devices = [
      device(1, '본관 로비', {
        storage_total_bytes: 100 * GB,
        storage_free_bytes: 5 * GB,
        storage_used_bytes: 95 * GB,
        storage_usage: 0.95,
        storage_warning: true,
      }),
    ]
    const wrapper = await mountView()

    const todo = wrapper.find('.todo').text()
    expect(todo).toContain('본관 로비')
    expect(todo).toContain('95%')
  })

  it('한 장치가 여러 이유로 걸리면 모두 적는다', async () => {
    // 이름만 나열하면 무엇을 해야 하는지 모른다.
    devices = [
      device(1, '체육관 DID', {
        schedules: [],
        storage_total_bytes: 100 * GB,
        storage_free_bytes: 5 * GB,
        storage_used_bytes: 95 * GB,
        storage_usage: 0.95,
        storage_warning: true,
      }),
    ]
    const wrapper = await mountView()

    const item = wrapper.find('.todo li').text()
    expect(item).toContain('데모')
    expect(item).toContain('저장공간')
  })

  it('걸릴 것이 없으면 그렇게 말한다', async () => {
    const wrapper = await mountView()
    expect(wrapper.text()).toContain('확인이 필요한 장치가 없습니다')
  })
})

describe('사양이 비어 있을 때', () => {
  it('빈 값을 구분점만 남기지 않는다', async () => {
    devices = [device(1, '체육관 DID', { cpu: null, memory: null, storage: '128GB', app_version: null })]
    const wrapper = await mountView()

    const text = specCell(wrapper).text()
    expect(text).toContain('128GB')
    expect(text).not.toMatch(/·\s*·/)
    expect(text).not.toMatch(/·\s*$/)
  })

  it('해상도를 모르면 빼고 보여 준다', async () => {
    devices = [device(1, '신규 장치', { width: null, height: null })]
    const wrapper = await mountView()

    const text = specCell(wrapper).text()
    expect(text).toContain('Windows')
    expect(text).not.toContain('×')
  })

  it('하드웨어 정보가 하나도 없으면 미등록이라고 말한다', async () => {
    // 빈 줄만 남으면 불러오다 만 것인지 등록이 안 된 것인지 알 수 없다.
    devices = [device(1, '미등록 장치', { cpu: null, memory: null, storage: null, app_version: null })]
    const wrapper = await mountView()

    expect(specCell(wrapper).text()).toContain('미등록')
  })

  it('전부 비어도 툴팁은 항목을 다 보여 준다', async () => {
    devices = [device(1, '미등록 장치', { cpu: null, memory: null, storage: null, app_version: null })]
    const wrapper = await mountView()

    const tip = specCell(wrapper).attributes('title')
    expect(tip).toContain('CPU: 미등록')
    expect(tip).toContain('메모리: 미등록')
  })
})
