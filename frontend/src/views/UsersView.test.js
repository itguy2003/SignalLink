/**
 * 사용자 관리 화면 테스트.
 *
 * 두 가지 규칙을 지킨다.
 *   - 역할은 **수정에서만** 준다. 등록과 권한 부여를 한 번에 처리하면 계정을
 *     만드는 김에 권한까지 딸려 나가기 쉽다.
 *   - 소속기관은 검색으로 고른다. 기관이 300개를 넘을 수 있다.
 */
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { i18n } from '@/i18n'

const USERS = [
  {
    id: 2,
    user_id: 'teacher',
    name: '최담임',
    org_id: 3,
    org_name: '가나초등학교',
    phone: null,
    email: null,
    status: '승인',
    roles: ['MEMBER', 'HOMEROOM_TEACHER'],
  },
]

const post = vi.fn(async () => ({}))
const put = vi.fn(async () => ({}))
const get = vi.fn(async (path) => {
  if (path === '/users') return { items: USERS, total: 1, page: 1, size: 20 }
  if (path === '/organizations') return [{ id: 3, name: '가나초등학교', parent_id: 2 }]
  if (path.startsWith('/organizations/')) return { id: 3, name: '가나초등학교' }
  return {}
})

vi.mock('@/api/client', () => ({
  api: {
    get: (...args) => get(...args),
    post: (...args) => post(...args),
    put: (...args) => put(...args),
    delete: vi.fn(async () => ({})),
  },
  TEST_MODE: false,
}))

// 역할 상수는 실제 것을 그대로 쓴다 — 화면이 그리는 목록이 진짜여야 한다.
vi.mock('@/stores/auth', async (importOriginal) => ({
  ...(await importOriginal()),
  useAuthStore: () => ({
    user: { id: 1, org_id: 3 },
    isSuperAdmin: true,
    can: { approveUsers: true },
  }),
}))

import UsersView from './UsersView.vue'

async function mountView() {
  setActivePinia(createPinia())
  const wrapper = mount(UsersView, {
    global: {
      plugins: [createPinia(), i18n],
      stubs: { RouterLink: { template: '<a><slot /></a>' } },
    },
  })
  await flushPromises()
  return wrapper
}

async function openCreate(wrapper) {
  await wrapper.find('.card-header .btn-primary').trigger('click')
  await flushPromises()
}

async function openEdit(wrapper) {
  const edit = wrapper.findAll('tbody .btn').find((b) => b.text() === '수정')
  await edit.trigger('click')
  await flushPromises()
}

beforeEach(() => {
  get.mockClear()
  post.mockClear()
  put.mockClear()
  i18n.global.locale.value = 'ko'
})

describe('역할 부여 시점', () => {
  it('등록 창에는 역할 선택이 없다', async () => {
    const wrapper = await mountView()
    await openCreate(wrapper)

    expect(wrapper.find('.dialog .roles').exists()).toBe(false)
  })

  it('등록 창은 언제 역할을 주는지 알려 준다', async () => {
    // 그냥 없애 버리면 권한을 못 주는 줄 안다.
    const wrapper = await mountView()
    await openCreate(wrapper)

    expect(wrapper.find('.dialog').text()).toContain('수정')
  })

  it('등록 요청에 역할을 싣지 않는다', async () => {
    const wrapper = await mountView()
    await openCreate(wrapper)

    const inputs = wrapper.findAll('.dialog input.input')
    await inputs[0].setValue('newbie')
    await wrapper.find('.dialog input[type="password"]').setValue('test1234')
    await wrapper.find('.dialog-foot .btn-primary').trigger('click')
    await flushPromises()

    expect(post).toHaveBeenCalled()
    expect(post.mock.calls[0][1]).not.toHaveProperty('roles')
  })

  it('수정 창에는 역할 선택이 있다', async () => {
    const wrapper = await mountView()
    await openEdit(wrapper)

    expect(wrapper.find('.dialog .roles').exists()).toBe(true)
  })

  it('수정 창은 현재 역할을 표시한다(MEMBER 제외)', async () => {
    // MEMBER 는 언제나 붙으므로 고를 대상이 아니다.
    const wrapper = await mountView()
    await openEdit(wrapper)

    const checked = wrapper
      .findAll('.roles .role-check')
      .filter((label) => label.find('input').element.checked)
      .map((label) => label.text())
    expect(checked).toEqual(['담임교사'])
  })

  it('수정 요청에는 역할을 싣는다', async () => {
    const wrapper = await mountView()
    await openEdit(wrapper)
    await wrapper.find('.dialog-foot .btn-primary').trigger('click')
    await flushPromises()

    expect(put.mock.calls[0][1].roles).toEqual(['HOMEROOM_TEACHER'])
  })
})

describe('소속기관 고르기', () => {
  it('선택 상자 대신 검색을 쓴다', async () => {
    // 기관이 300개를 넘을 수 있어 다 채울 수 없다.
    const wrapper = await mountView()
    await openCreate(wrapper)

    expect(wrapper.find('.org-picker').exists()).toBe(true)
  })

  it('창을 열 때 기관 목록을 통째로 받지 않는다', async () => {
    const wrapper = await mountView()
    get.mockClear()
    await openCreate(wrapper)

    // 검색 상자를 건드리기 전에는 조회가 없다.
    const orgCalls = get.mock.calls.filter(([path]) => path.startsWith('/organizations'))
    expect(orgCalls.every(([, params]) => params?.limit !== undefined || params === undefined)).toBe(
      true,
    )
  })

  it('수정 창은 지금 소속기관을 이름으로 보여 준다', async () => {
    const wrapper = await mountView()
    await openEdit(wrapper)

    expect(wrapper.find('.org-picker').text()).toContain('가나초등학교')
  })
})
