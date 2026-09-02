/**
 * 장치그룹 패널 테스트.
 *
 * 그룹을 하나 골라 **그 그룹의 장치만** 보여 준다. 장치는 장치 탭과 같은
 * 컴포넌트로 그리므로, 여기서 확인할 것은 '어느 묶음을 고르고 있는가' 와
 * 그룹 자체의 CRUD 다.
 */
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { i18n } from '@/i18n'

const post = vi.fn(async (path, body) => ({ id: 9, user_id: 1, ...body }))
const put = vi.fn(async (path, body) => ({ id: 1, user_id: 1, ...body }))
const del = vi.fn(async () => ({ detail: 'ok' }))

vi.mock('@/api/client', () => ({
  api: {
    get: vi.fn(async () => []),
    post: (...args) => post(...args),
    put: (...args) => put(...args),
    delete: (...args) => del(...args),
  },
  imageUrl: vi.fn(async () => null),
  revokeImageUrl: vi.fn(),
  TEST_MODE: false,
}))

import DeviceGroupPanel from './DeviceGroupPanel.vue'

const device = (id, name, extra = {}) => ({
  id,
  name,
  device_code: `CODE-${id}`,
  org_name: '가나초등학교',
  place_name: '본관',
  os: 'Windows',
  panel_type: 'LANDSCAPE',
  width: 1920,
  height: 1080,
  online: true,
  schedules: [],
  screenshot_at: null,
  ...extra,
})

const DEVICES = [
  device(1, '로비 DID'),
  device(2, '3학년 2반', { online: false }),
  device(3, '급식실 키오스크'),
]

const GROUPS = [
  { id: 1, name: '본관 1층', user_id: 1, device_ids: [1, 3] },
  { id: 2, name: '교실', user_id: 1, device_ids: [2] },
]

const SCHEDULES = [{ id: 1, name: '평일 기본 스케줄' }]

async function mountPanel({ devices = DEVICES, groups = GROUPS, mode = 'card' } = {}) {
  setActivePinia(createPinia())
  const wrapper = mount(DeviceGroupPanel, {
    props: { devices, groups, mode, schedules: SCHEDULES, canManage: true, canCreate: true },
    global: { plugins: [createPinia(), i18n] },
  })
  await flushPromises()
  return wrapper
}

const groupSelect = (wrapper) => wrapper.find('.group-select')

const shownNames = (wrapper) =>
  wrapper.findAll('.device-card .name, .device-row .name').map((n) => n.text().trim())

const headerButton = (wrapper, label) =>
  wrapper.findAll('.card-header .btn').find((b) => b.text() === label)

async function openCreate(wrapper) {
  await headerButton(wrapper, '그룹 만들기').trigger('click')
  await flushPromises()
}

beforeEach(() => {
  post.mockClear()
  put.mockClear()
  del.mockClear()
  i18n.global.locale.value = 'ko'
})

describe('그룹 선택', () => {
  it('내 그룹을 선택지로 올린다', async () => {
    const wrapper = await mountPanel()
    expect(groupSelect(wrapper).findAll('option').map((o) => o.text())).toEqual([
      '본관 1층',
      '교실',
    ])
  })

  it('처음에는 첫 그룹을 고른다', async () => {
    // 아무것도 안 고른 상태로 두면 빈 화면만 보인다.
    const wrapper = await mountPanel()
    expect(shownNames(wrapper)).toEqual(['로비 DID', '급식실 키오스크'])
  })

  it('한 번에 한 그룹만 보여 준다', async () => {
    // 여러 그룹을 펼치면 같은 장치가 화면에 여러 번 나온다.
    const wrapper = await mountPanel()
    await groupSelect(wrapper).setValue(2)
    await flushPromises()

    expect(shownNames(wrapper)).toEqual(['3학년 2반'])
  })

  it('고른 그룹의 장치 수와 온라인 수를 알려 준다', async () => {
    const wrapper = await mountPanel()
    const header = wrapper.find('.card-header').text()
    expect(header).toContain('장치 2대')
    expect(header).toContain('온라인 2대')
  })

  it('고른 그룹이 사라지면 남은 첫 그룹으로 옮긴다', async () => {
    const wrapper = await mountPanel()
    await groupSelect(wrapper).setValue(2)
    await flushPromises()

    await wrapper.setProps({ groups: [GROUPS[0]] })
    await flushPromises()

    expect(shownNames(wrapper)).toEqual(['로비 DID', '급식실 키오스크'])
  })

  it('그룹이 없으면 그렇게 말한다', async () => {
    const wrapper = await mountPanel({ groups: [] })
    expect(wrapper.text()).toContain('만든 장치그룹이 없습니다')
    expect(groupSelect(wrapper).attributes('disabled')).toBeDefined()
  })

  it('빈 그룹은 담긴 장치가 없다고 말한다', async () => {
    const wrapper = await mountPanel({ groups: [{ ...GROUPS[0], device_ids: [] }] })
    expect(wrapper.text()).toContain('담긴 장치가 없습니다')
  })

  it('후보에 없는 id 는 그리지 않는다', async () => {
    // 다른 페이지의 장치라 아직 못 읽었거나 방금 지워진 경우다.
    const wrapper = await mountPanel({ groups: [{ ...GROUPS[0], device_ids: [1, 999] }] })
    expect(shownNames(wrapper)).toEqual(['로비 DID'])
  })
})

describe('보기 방식', () => {
  it('카드로도 리스트로도 그린다', async () => {
    const cards = await mountPanel()
    expect(cards.findAll('.device-card')).toHaveLength(2)

    const list = await mountPanel({ mode: 'list' })
    expect(list.findAll('.device-row')).toHaveLength(2)
  })

  it('보기 방식은 그대로 위로 넘긴다', async () => {
    // 장치 탭과 같은 값을 쓰므로 여기서 들고 있지 않는다.
    const wrapper = await mountPanel()
    await wrapper.findAll('.view-btn')[1].trigger('click')

    expect(wrapper.emitted('update:mode')[0]).toEqual(['list'])
  })

  it('선택 체크박스는 두지 않는다', async () => {
    // 일괄 배정 도구는 장치 탭에 있다. 여기서 고르면 아무것도 못 한다.
    const wrapper = await mountPanel({ mode: 'list' })
    expect(wrapper.find('.device-row input[type="checkbox"]').exists()).toBe(false)
  })
})

describe('장치 조작 전달', () => {
  it('제어 명령을 위로 넘긴다', async () => {
    // 처리 코드는 장치 관리 화면 하나가 맡는다.
    const wrapper = await mountPanel()
    const reboot = wrapper.findAll('.device-card .controls .btn').find((b) => b.text() === '리부팅')
    await reboot.trigger('click')

    expect(wrapper.emitted('command')[0][0].command).toBe('restart')
  })

  it('스케줄 배정을 위로 넘긴다', async () => {
    const wrapper = await mountPanel()
    // 후보 스케줄을 골라 배정하면 부모로 올라간다.
    await wrapper.find('.device-card .schedule-picker select').setValue(1)
    expect(wrapper.emitted('assign')[0][0].scheduleIds).toEqual([1])
  })
})

describe('그룹 만들기', () => {
  it('이름과 장치를 골라 저장한다', async () => {
    const wrapper = await mountPanel()
    await openCreate(wrapper)

    await wrapper.find('.dialog input.input').setValue('2층 전체')
    await wrapper.findAll('.pick-row input')[1].trigger('change')
    await wrapper.find('.dialog-foot .btn-primary').trigger('click')
    await flushPromises()

    const [path, body] = post.mock.calls[0]
    expect(path).toBe('/device-groups')
    expect(body).toEqual({ name: '2층 전체', device_ids: [2] })
  })

  it('저장하면 부모에게 다시 읽으라고 알린다', async () => {
    // 콤보와 목록이 각자 읽으면 어긋난다.
    const wrapper = await mountPanel()
    await openCreate(wrapper)
    await wrapper.find('.dialog input.input').setValue('2층')
    await wrapper.find('.dialog-foot .btn-primary').trigger('click')
    await flushPromises()

    expect(wrapper.emitted('changed')).toHaveLength(1)
  })

  it('이름이 비면 저장하지 않는다', async () => {
    const wrapper = await mountPanel()
    await openCreate(wrapper)
    await wrapper.find('.dialog-foot .btn-primary').trigger('click')
    await flushPromises()

    expect(post).not.toHaveBeenCalled()
    expect(wrapper.find('.error-text').text()).toContain('그룹명')
  })

  it('후보 장치를 검색으로 거른다', async () => {
    const wrapper = await mountPanel()
    await openCreate(wrapper)

    await wrapper.findAll('.dialog input.input')[1].setValue('급식')
    expect(wrapper.findAll('.pick-name').map((n) => n.text())).toEqual(['급식실 키오스크'])
  })

  it('밖에서 고른 장치로 열 수 있다', async () => {
    // 장치 탭에서 이미 골라 둔 것을 그대로 쓴다.
    const wrapper = await mountPanel()
    wrapper.vm.openCreate([1, 3])
    await flushPromises()

    const checked = wrapper.findAll('.pick-row input').map((i) => i.element.checked)
    expect(checked).toEqual([true, false, true])
  })

  it('그룹이 없어도 만들 수 있다', async () => {
    const wrapper = await mountPanel({ groups: [] })
    await openCreate(wrapper)
    expect(wrapper.find('.dialog').exists()).toBe(true)
  })
})

describe('고른 그룹 수정·삭제', () => {
  it('현재 값을 채워 연다', async () => {
    const wrapper = await mountPanel()
    await headerButton(wrapper, '수정').trigger('click')
    await flushPromises()

    expect(wrapper.find('.dialog input.input').element.value).toBe('본관 1층')
    const checked = wrapper.findAll('.pick-row input').map((i) => i.element.checked)
    expect(checked).toEqual([true, false, true])
  })

  it('구성원을 바꿔 저장한다', async () => {
    const wrapper = await mountPanel()
    await headerButton(wrapper, '수정').trigger('click')
    await flushPromises()

    await wrapper.findAll('.pick-row input')[0].trigger('change') // 1 해제
    await wrapper.find('.dialog-foot .btn-primary').trigger('click')
    await flushPromises()

    expect(put.mock.calls[0][0]).toBe('/device-groups/1')
    expect(put.mock.calls[0][1].device_ids).toEqual([3])
  })

  it('묶음만 사라진다고 확인받는다', async () => {
    // 장치가 함께 지워진다고 오해하면 아무도 못 지운다.
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    const wrapper = await mountPanel()

    await headerButton(wrapper, '삭제').trigger('click')
    await flushPromises()

    expect(confirmSpy.mock.calls[0][0]).toContain('장치는 남습니다')
    expect(del).toHaveBeenCalledWith('/device-groups/1')
    expect(wrapper.emitted('changed')).toHaveLength(1)
    confirmSpy.mockRestore()
  })

  it('취소하면 지우지 않는다', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)
    const wrapper = await mountPanel()

    await headerButton(wrapper, '삭제').trigger('click')
    await flushPromises()

    expect(del).not.toHaveBeenCalled()
    confirmSpy.mockRestore()
  })
})
