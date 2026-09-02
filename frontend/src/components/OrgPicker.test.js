/**
 * 소속기관 고르기 테스트.
 *
 * 이 컴포넌트가 있는 이유는 기관이 300개를 넘을 수 있다는 것 하나다.
 * 그래서 확인할 것도 '받아 오는 양이 기관 수와 무관한가' 에 몰려 있다.
 */
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { i18n } from '@/i18n'

/** 기관 300개. 실제로 문제가 되는 규모를 그대로 쓴다. */
const ALL = Array.from({ length: 300 }, (_, i) => ({
  id: i + 1,
  name: i % 3 === 0 ? `가나초등학교 ${i + 1}` : `다라중학교 ${i + 1}`,
  parent_id: 1,
}))

const get = vi.fn(async (path, params) => {
  if (/^\/organizations\/\d+$/.test(path)) {
    const id = Number(path.split('/').pop())
    return ALL.find((o) => o.id === id)
  }
  let items = ALL
  if (params?.q) items = items.filter((o) => o.name.includes(params.q))
  return params?.limit ? items.slice(0, Number(params.limit)) : items
})

vi.mock('@/api/client', () => ({
  api: { get: (...args) => get(...args) },
  TEST_MODE: false,
}))

import OrgPicker from './OrgPicker.vue'

async function mountPicker(props = {}) {
  const wrapper = mount(OrgPicker, {
    props: { modelValue: null, ...props },
    global: { plugins: [i18n] },
  })
  await flushPromises()
  return wrapper
}

const results = (wrapper) => wrapper.findAll('.result').map((r) => r.text())

/** 검색어를 넣고 디바운스를 흘려보낸다. */
async function type(wrapper, text) {
  await wrapper.find('input').setValue(text)
  await vi.advanceTimersByTimeAsync(300)
  await flushPromises()
}

beforeEach(() => {
  get.mockClear()
  i18n.global.locale.value = 'ko'
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('검색', () => {
  it('한 번에 받아 오는 개수를 제한한다', async () => {
    // 300개를 통째로 받으면 창을 열 때마다 목록 전체가 오간다.
    const wrapper = await mountPicker()
    await wrapper.find('input').trigger('focus')
    await flushPromises()

    const [, params] = get.mock.calls.at(-1)
    expect(params.limit).toBeLessThanOrEqual(21)
    expect(results(wrapper).length).toBeLessThanOrEqual(20)
  })

  it('검색어로 좁힌다', async () => {
    const wrapper = await mountPicker()
    await wrapper.find('input').trigger('focus')
    await flushPromises()

    await type(wrapper, '가나초등학교 4')
    expect(results(wrapper).every((name) => name.includes('가나초등학교 4'))).toBe(true)
  })

  it('글자마다 요청하지 않는다', async () => {
    // 300개짜리 목록을 글자 수만큼 다시 훑게 된다.
    const wrapper = await mountPicker()
    await wrapper.find('input').trigger('focus')
    await flushPromises()
    get.mockClear()

    await wrapper.find('input').setValue('가')
    await wrapper.find('input').setValue('가나')
    await wrapper.find('input').setValue('가나초')
    await vi.advanceTimersByTimeAsync(300)
    await flushPromises()

    expect(get).toHaveBeenCalledTimes(1)
  })

  it('결과가 더 있으면 좁히라고 알린다', async () => {
    // 잘라 놓고 말 안 하면 없는 줄 안다.
    const wrapper = await mountPicker()
    await wrapper.find('input').trigger('focus')
    await flushPromises()

    expect(wrapper.find('.hint').text()).toContain('좁혀')
  })

  it('결과가 없으면 그렇게 말한다', async () => {
    const wrapper = await mountPicker()
    await wrapper.find('input').trigger('focus')
    await flushPromises()

    await type(wrapper, '없는기관이름')
    expect(wrapper.text()).toContain('검색 결과가 없습니다')
  })
})

describe('선택', () => {
  it('고르면 id 를 올린다', async () => {
    const wrapper = await mountPicker()
    await wrapper.find('input').trigger('focus')
    await flushPromises()

    await wrapper.findAll('.result')[0].trigger('click')
    expect(wrapper.emitted('update:modelValue')[0]).toEqual([1])
  })

  it('고른 뒤에는 이름을 보여 준다', async () => {
    // 입력창에 검색어만 남으면 무엇을 골랐는지 확인할 수 없다.
    const wrapper = await mountPicker({ modelValue: 7 })
    await flushPromises()

    expect(wrapper.find('.chosen-name').text()).toBe(ALL[6].name)
    expect(wrapper.find('input').exists()).toBe(false)
  })

  it('처음에 이름을 모르면 서버에 물어본다', async () => {
    // 수정 창은 id 만 들고 열린다.
    await mountPicker({ modelValue: 42 })
    await flushPromises()
    expect(get).toHaveBeenCalledWith('/organizations/42')
  })

  it('이름을 못 읽어도 고른 상태는 유지한다', async () => {
    // 지워 버리면 저장할 때 소속기관이 사라진다.
    get.mockImplementationOnce(async () => {
      throw new Error('권한 없음')
    })
    const wrapper = await mountPicker({ modelValue: 999 })
    await flushPromises()

    expect(wrapper.find('.chosen-name').text()).toBe('#999')
  })

  it('변경을 누르면 다시 고를 수 있다', async () => {
    const wrapper = await mountPicker({ modelValue: 7 })
    await flushPromises()

    await wrapper.find('.chosen .btn').trigger('click')
    await flushPromises()

    expect(wrapper.emitted('update:modelValue')[0]).toEqual([null])
    expect(wrapper.find('input').exists()).toBe(true)
  })
})

describe('조회 경로', () => {
  it('기본은 로그인한 사용자용 경로', async () => {
    const wrapper = await mountPicker()
    await wrapper.find('input').trigger('focus')
    await flushPromises()
    expect(get.mock.calls.at(-1)[0]).toBe('/organizations')
  })

  it('로그인 전 화면은 공개 경로를 쓸 수 있다', async () => {
    const wrapper = await mountPicker({ endpoint: '/organizations/public' })
    await wrapper.find('input').trigger('focus')
    await flushPromises()
    expect(get.mock.calls.at(-1)[0]).toBe('/organizations/public')
  })
})
