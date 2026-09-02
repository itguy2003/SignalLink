/**
 * 회원가입 화면 테스트.
 *
 * 가입자는 로그인 전이라 공개 경로만 쓸 수 있고, 기관은 300개를 넘을 수
 * 있다. 스크롤로 자기 학교를 찾게 두지 않고 이름으로 검색해 고르게 한다.
 */
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { i18n } from '@/i18n'

const ORGS = Array.from({ length: 300 }, (_, i) => ({
  id: i + 1,
  name: `가나초등학교 ${i + 1}`,
  parent_id: 1,
}))

const get = vi.fn(async (path, params) => {
  if (path === '/organizations/public') {
    let items = ORGS
    if (params?.q) items = items.filter((o) => o.name.includes(params.q))
    return params?.limit ? items.slice(0, Number(params.limit)) : items
  }
  if (path === '/auth/check-user-id') return { available: true }
  return {}
})
const post = vi.fn(async () => ({ id: 9 }))

vi.mock('@/api/client', () => ({
  api: { get: (...args) => get(...args), post: (...args) => post(...args) },
  TEST_MODE: false,
}))

vi.mock('vue-router', () => ({
  useRouter: () => ({ push: vi.fn() }),
  RouterLink: { template: '<a><slot /></a>' },
}))

import RegisterView from './RegisterView.vue'

async function mountView() {
  setActivePinia(createPinia())
  const wrapper = mount(RegisterView, {
    global: {
      plugins: [createPinia(), i18n],
      stubs: { RouterLink: { template: '<a><slot /></a>' } },
    },
  })
  await flushPromises()
  return wrapper
}

beforeEach(() => {
  get.mockClear()
  post.mockClear()
  i18n.global.locale.value = 'ko'
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('소속기관 고르기', () => {
  it('선택 상자 대신 검색을 쓴다', async () => {
    const wrapper = await mountView()
    expect(wrapper.find('.org-picker').exists()).toBe(true)
    expect(wrapper.find('select#org').exists()).toBe(false)
  })

  it('화면을 열자마자 기관 목록을 받지 않는다', async () => {
    // 예전에는 마운트 즉시 300개를 통째로 받았다.
    await mountView()
    expect(get.mock.calls.filter(([path]) => path === '/organizations/public')).toHaveLength(0)
  })

  it('로그인 전이므로 공개 경로로 검색한다', async () => {
    const wrapper = await mountView()
    await wrapper.find('.org-picker input').trigger('focus')
    await flushPromises()

    const [path, params] = get.mock.calls.at(-1)
    expect(path).toBe('/organizations/public')
    expect(params.limit).toBeLessThanOrEqual(21)
  })

  it('검색어로 좁힌다', async () => {
    const wrapper = await mountView()
    await wrapper.find('.org-picker input').trigger('focus')
    await flushPromises()

    await wrapper.find('.org-picker input').setValue('가나초등학교 250')
    await vi.advanceTimersByTimeAsync(300)
    await flushPromises()

    expect(wrapper.findAll('.result').map((r) => r.text())).toEqual(['가나초등학교 250'])
  })

  it('고르면 이름을 보여 준다', async () => {
    const wrapper = await mountView()
    await wrapper.find('.org-picker input').trigger('focus')
    await flushPromises()

    await wrapper.findAll('.result')[0].trigger('click')
    await flushPromises()

    expect(wrapper.find('.chosen-name').text()).toBe('가나초등학교 1')
  })

  it('기관을 고르기 전에는 가입할 수 없다', async () => {
    // 소속기관 없이 가입하면 아무도 승인해 줄 사람이 없다.
    const wrapper = await mountView()
    const submit = wrapper.find('form .btn-primary')
    expect(submit.attributes('disabled')).toBeDefined()
  })
})
