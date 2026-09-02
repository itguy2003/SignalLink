/**
 * 스케줄 관리 화면 테스트.
 *
 * 사용 기간이 이 화면의 까다로운 부분이다. 입력칸은 지역 시각이고 서버는
 * UTC 라 오갈 때마다 시차만큼 어긋날 여지가 있고, 비운 칸은 0 이 아니라
 * **제한 없음**이라 null 로 보내야 한다. 그리고 기간 밖인 스케줄은 배정돼
 * 있어도 표출되지 않으므로 목록에서 그 상태가 보여야 한다.
 */
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { i18n } from '@/i18n'

const ORGS = [{ id: 3, name: '대구교육청' }]

let schedules = []

const post = vi.fn(async () => ({}))
const put = vi.fn(async () => ({}))
const del = vi.fn(async () => ({ detail: '삭제되었습니다.' }))
let detail = null

const get = vi.fn(async (path) => {
  if (path === '/organizations') return ORGS
  if (path === '/widgets') return [{ key: 'clock', name: '시계', category: '기능형', options: [] }]
  if (path === '/schedules') {
    return { items: schedules, total: schedules.length, page: 1, size: 20 }
  }
  if (path.startsWith('/schedules/')) {
    if (!detail) throw { detail: '스케줄을 불러오지 못했습니다.' }
    return detail
  }
  return {}
})

vi.mock('@/api/client', () => ({
  api: {
    get: (...args) => get(...args),
    post: (...args) => post(...args),
    put: (...args) => put(...args),
    delete: (...args) => del(...args),
  },
  TEST_MODE: false,
}))

vi.mock('@/stores/auth', () => ({
  useAuthStore: () => ({ user: { org_id: 3 }, can: { manageSchedules: true } }),
}))

import SchedulesView from './SchedulesView.vue'

const schedule = (extra = {}) => ({
  id: 1,
  name: '평일 기본',
  kind: '시간지정',
  orientation: 'LANDSCAPE',
  org_id: 3,
  version: 2,
  device_count: 1,
  start_at: null,
  end_at: null,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  ...extra,
})

async function mountView() {
  setActivePinia(createPinia())
  const wrapper = mount(SchedulesView, {
    global: {
      plugins: [createPinia(), i18n],
      stubs: { RouterLink: { template: '<a><slot /></a>' } },
    },
  })
  await flushPromises()
  return wrapper
}

const rowButton = (wrapper, label) => wrapper.findAll('tbody .btn').find((b) => b.text() === label)

async function openEdit(wrapper) {
  await rowButton(wrapper, '수정').trigger('click')
  await flushPromises()
}

const periodInputs = (wrapper) => wrapper.findAll('.dialog input[type="datetime-local"]')

/** `datetime-local` 이 쓰는 지역 시각 문자열. 화면과 같은 방식으로 만든다. */
function localValue(iso) {
  const date = new Date(iso)
  const pad = (n) => String(n).padStart(2, '0')
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}`
  )
}

beforeEach(() => {
  schedules = [schedule()]
  detail = {
    ...schedule(),
    items: [
      {
        id: 1,
        day_of_week: 0,
        start_time: '09:00',
        end_time: '12:00',
        duration_sec: 30,
        content_id: 5,
        content_name: '아침 안내',
        sort_order: 0,
      },
    ],
  }
  get.mockClear()
  post.mockClear()
  put.mockClear()
  del.mockClear()
  i18n.global.locale.value = 'ko'
})

describe('사용 기간 보기', () => {
  it('기간이 없으면 제한 없음이라고 말한다', async () => {
    const wrapper = await mountView()
    expect(wrapper.text()).toContain('제한 없음')
  })

  it('기간이 있으면 시작 ~ 종료로 보여 준다', async () => {
    schedules = [schedule({ start_at: '2026-10-01T00:00:00Z', end_at: '2026-10-31T00:00:00Z' })]
    const wrapper = await mountView()
    expect(wrapper.text()).toMatch(/~/)
  })

  it('한쪽만 있으면 그쪽만 말한다', async () => {
    schedules = [schedule({ end_at: '2026-10-31T00:00:00Z' })]
    const wrapper = await mountView()
    expect(wrapper.text()).toContain('까지')
  })

  it('기간이 지났으면 그렇게 표시한다', async () => {
    // 배정돼 있어도 표출되지 않는다. 이 표시가 없으면 원인을 못 찾는다.
    schedules = [schedule({ end_at: '2020-01-01T00:00:00Z' })]
    const wrapper = await mountView()
    expect(wrapper.text()).toContain('기간 지남')
  })

  it('아직 시작 전이면 그렇게 표시한다', async () => {
    schedules = [schedule({ start_at: '2099-01-01T00:00:00Z' })]
    const wrapper = await mountView()
    expect(wrapper.text()).toContain('기간 전')
  })

  it('기간 안이면 아무 배지도 달지 않는다', async () => {
    schedules = [schedule({ start_at: '2020-01-01T00:00:00Z', end_at: '2099-01-01T00:00:00Z' })]
    const wrapper = await mountView()
    expect(wrapper.text()).not.toContain('기간 지남')
    expect(wrapper.text()).not.toContain('기간 전')
  })
})

describe('만들 때 기간 넣기', () => {
  async function openCreate(wrapper) {
    await wrapper.find('.card-header .btn-primary').trigger('click')
    await flushPromises()
  }

  it('비워 두면 제한 없음으로 보낸다', async () => {
    const wrapper = await mountView()
    await openCreate(wrapper)
    await wrapper.find('.dialog input.input').setValue('새 스케줄')
    await wrapper.find('.dialog-foot .btn-primary').trigger('click')
    await flushPromises()

    expect(post.mock.calls[0][1]).toMatchObject({ start_at: null, end_at: null })
  })

  it('넣은 기간을 ISO 로 바꿔 보낸다', async () => {
    const wrapper = await mountView()
    await openCreate(wrapper)
    await wrapper.find('.dialog input.input').setValue('행사 주간')
    await periodInputs(wrapper)[0].setValue('2026-10-01T09:00')
    await periodInputs(wrapper)[1].setValue('2026-10-05T18:00')
    await wrapper.find('.dialog-foot .btn-primary').trigger('click')
    await flushPromises()

    const body = post.mock.calls[0][1]
    expect(body.start_at).toBe(new Date('2026-10-01T09:00').toISOString())
    expect(body.end_at).toBe(new Date('2026-10-05T18:00').toISOString())
  })
})

describe('미리보기', () => {
  const previewButton = (wrapper) => rowButton(wrapper, '미리보기')

  it('목록에서 바로 열 수 있다', async () => {
    // 편집기까지 들어가야만 볼 수 있으면 여러 스케줄을 훑는 일이
    // 화면 이동의 반복이 된다.
    const wrapper = await mountView()
    expect(previewButton(wrapper)).toBeTruthy()
  })

  it('누르면 상세를 받아 그 스케줄을 보여 준다', async () => {
    const wrapper = await mountView()
    await previewButton(wrapper).trigger('click')
    await flushPromises()

    expect(get).toHaveBeenCalledWith('/schedules/1')
    expect(wrapper.findComponent({ name: 'SchedulePreview' }).exists()).toBe(true)
  })

  it('시간지정이면 요일 탭을 보여 준다', async () => {
    const wrapper = await mountView()
    await previewButton(wrapper).trigger('click')
    await flushPromises()

    const preview = wrapper.findComponent({ name: 'SchedulePreview' })
    expect(preview.props('showGroups')).toBe(true)
    expect(preview.props('groups')).toHaveLength(7)
  })

  it('목록반복이면 재생 순서 하나만 보여 준다', async () => {
    // 요일 축이 의미가 없어 빈 표만 보인다.
    schedules = [schedule({ kind: '목록반복' })]
    detail = { ...schedules[0], items: detail.items }
    const wrapper = await mountView()
    await previewButton(wrapper).trigger('click')
    await flushPromises()

    const preview = wrapper.findComponent({ name: 'SchedulePreview' })
    expect(preview.props('showGroups')).toBe(false)
    expect(preview.props('groups')).toHaveLength(1)
  })

  it('받아 오는 동안에도 창을 연다', async () => {
    // 눌렀는데 한참 아무 일도 없으면 눌린 것인지 알 수 없다.
    const wrapper = await mountView()
    await previewButton(wrapper).trigger('click')

    expect(wrapper.find('.dialog').text()).toContain('불러오는 중')
  })

  it('못 받으면 창을 닫고 알린다', async () => {
    detail = null
    const wrapper = await mountView()
    await previewButton(wrapper).trigger('click')
    await flushPromises()

    expect(wrapper.findComponent({ name: 'SchedulePreview' }).exists()).toBe(false)
  })

  it('닫으면 사라진다', async () => {
    const wrapper = await mountView()
    await previewButton(wrapper).trigger('click')
    await flushPromises()

    wrapper.findComponent({ name: 'SchedulePreview' }).vm.$emit('close')
    await flushPromises()
    expect(wrapper.findComponent({ name: 'SchedulePreview' }).exists()).toBe(false)
  })
})

describe('기간 고치기', () => {
  it('수정 창을 연다', async () => {
    const wrapper = await mountView()
    await openEdit(wrapper)
    expect(wrapper.find('.dialog').text()).toContain('스케줄 수정')
  })

  it('지금 기간을 채워 연다', async () => {
    // 빈 칸으로 열면 고치려던 사람이 기간을 통째로 지우게 된다.
    schedules = [schedule({ start_at: new Date('2026-10-01T09:00').toISOString() })]
    const wrapper = await mountView()
    await openEdit(wrapper)

    expect(periodInputs(wrapper)[0].element.value).toBe('2026-10-01T09:00')
  })

  it('지역 시각으로 채운다', async () => {
    // 입력칸은 지역 시각이라 UTC 문자열을 그대로 넣으면 시차만큼 어긋난다.
    const iso = '2026-10-01T00:00:00Z'
    schedules = [schedule({ start_at: iso })]
    const wrapper = await mountView()
    await openEdit(wrapper)

    expect(periodInputs(wrapper)[0].element.value).toBe(localValue(iso))
  })

  it('고친 기간을 저장한다', async () => {
    const wrapper = await mountView()
    await openEdit(wrapper)
    await periodInputs(wrapper)[0].setValue('2026-12-01T00:00')
    await wrapper.find('.dialog-foot .btn-primary').trigger('click')
    await flushPromises()

    expect(put.mock.calls[0][0]).toBe('/schedules/1')
    expect(put.mock.calls[0][1].start_at).toBe(new Date('2026-12-01T00:00').toISOString())
  })

  it('기간을 지우면 제한 없음으로 되돌린다', async () => {
    // null 을 보내야 서버가 지운다. 안 보내면 예전 기간이 그대로 남는다.
    schedules = [schedule({ start_at: '2026-10-01T00:00:00Z', end_at: '2026-10-31T00:00:00Z' })]
    const wrapper = await mountView()
    await openEdit(wrapper)
    await periodInputs(wrapper)[0].setValue('')
    await periodInputs(wrapper)[1].setValue('')
    await wrapper.find('.dialog-foot .btn-primary').trigger('click')
    await flushPromises()

    expect(put.mock.calls[0][1]).toMatchObject({ start_at: null, end_at: null })
  })

  it('앞뒤가 뒤집히면 저장하지 않는다', async () => {
    // 뒤집힌 기간은 언제나 기간 밖이라 아무 때도 표출되지 않는다.
    const wrapper = await mountView()
    await openEdit(wrapper)
    await periodInputs(wrapper)[0].setValue('2026-10-31T00:00')
    await periodInputs(wrapper)[1].setValue('2026-10-01T00:00')
    await wrapper.find('.dialog-foot .btn-primary').trigger('click')
    await flushPromises()

    expect(put).not.toHaveBeenCalled()
    expect(wrapper.find('.error-text').text()).toContain('종료일시')
  })

  it('구분은 잠근다', async () => {
    // 짜 놓은 편성의 축이라 바꾸면 아이템이 통째로 어긋난다.
    const wrapper = await mountView()
    await openEdit(wrapper)
    expect(wrapper.find('.dialog select').attributes('disabled')).toBeDefined()
  })

  it('아이템은 건드리지 않는다', async () => {
    // 이 창은 메타데이터만 고친다. items 를 보내면 편성이 통째로 지워진다.
    const wrapper = await mountView()
    await openEdit(wrapper)
    await wrapper.find('.dialog-foot .btn-primary').trigger('click')
    await flushPromises()

    expect(put.mock.calls[0][1].items).toBeUndefined()
  })
})
