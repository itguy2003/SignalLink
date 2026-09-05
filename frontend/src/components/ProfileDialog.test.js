/**
 * 내 정보 변경 창 테스트.
 *
 * 두 갈래가 섞여 있다 — 프로필(이름·연락처·이메일)과 비밀번호. 비밀번호는
 * **현재 비밀번호를 확인**하고 바꾸며, 칸을 비워 두면 건드리지 않는다.
 * 로그인된 자리라는 것만 믿으면, 자리를 비운 사이 누구든 갈아 끼울 수 있다.
 */
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { i18n } from '@/i18n'

const put = vi.fn()
const post = vi.fn()

vi.mock('@/api/client', () => ({
  api: {
    put: (...args) => put(...args),
    post: (...args) => post(...args),
    get: vi.fn(),
    delete: vi.fn(),
  },
  TEST_MODE: false,
  getToken: () => null,
  setToken: vi.fn(),
}))

import { useAuthStore } from '@/stores/auth'
import ProfileDialog from './ProfileDialog.vue'

const ME = {
  id: 1,
  user_id: 'teacher',
  name: '3학년 2반 담임',
  phone: '032-444-4444',
  email: 'teacher@example.ac.kr',
  org_id: 3,
  org_name: '가온초등학교',
  roles: ['MEMBER'],
}

async function mountDialog() {
  // 피니아는 하나여야 한다 — 둘이면 테스트가 채운 나와 화면이 읽는 나가 갈린다.
  const pinia = createPinia()
  setActivePinia(pinia)
  const auth = useAuthStore()
  auth.user = { ...ME }
  const wrapper = mount(ProfileDialog, {
    global: { plugins: [pinia, i18n] },
  })
  await flushPromises()
  return { wrapper, auth }
}

const confirmBtn = (wrapper) => wrapper.find('.dialog-foot .btn-primary')

const fields = (wrapper) => wrapper.findAll('.dialog-body input')

beforeEach(() => {
  i18n.global.locale.value = 'ko'
  put.mockReset()
  post.mockReset()
  put.mockImplementation(async (path, body) => ({ ...ME, ...body }))
  post.mockImplementation(async () => ({ detail: '비밀번호가 변경되었습니다.' }))
})

describe('프로필', () => {
  it('지금 값을 채워 연다', async () => {
    // 고치려던 사람이 처음부터 다시 적게 하면 안 된다.
    const { wrapper } = await mountDialog()

    expect(fields(wrapper)[0].element.value).toBe('3학년 2반 담임')
    expect(fields(wrapper)[1].element.value).toBe('032-444-4444')
    expect(wrapper.text()).toContain('teacher · 가온초등학교')
  })

  it('저장하면 서버에 보내고 화면의 나도 갱신한다', async () => {
    const { wrapper, auth } = await mountDialog()

    await fields(wrapper)[0].setValue('홍길동')
    await confirmBtn(wrapper).trigger('click')
    await flushPromises()

    expect(put).toHaveBeenCalledWith('/auth/me', {
      name: '홍길동',
      phone: '032-444-4444',
      email: 'teacher@example.ac.kr',
    })
    // 상단 바의 이름이 곧바로 바뀌어야 저장된 것이 눈에 보인다.
    expect(auth.user.name).toBe('홍길동')
    expect(wrapper.emitted('close')).toBeTruthy()
  })

  it('이름이 비면 보내지 않는다', async () => {
    const { wrapper } = await mountDialog()

    await fields(wrapper)[0].setValue('')
    await confirmBtn(wrapper).trigger('click')

    expect(put).not.toHaveBeenCalled()
    expect(wrapper.find('.error-text').exists()).toBe(true)
  })
})

describe('비밀번호', () => {
  const passwordInputs = (wrapper) => wrapper.findAll('input[type="password"]')

  it('비워 두면 건드리지 않는다', async () => {
    const { wrapper } = await mountDialog()

    await confirmBtn(wrapper).trigger('click')
    await flushPromises()

    expect(post).not.toHaveBeenCalled()
  })

  it('현재 비밀번호 없이는 못 바꾼다', async () => {
    // 로그인된 자리라는 것만 믿으면 자리를 비운 사이 갈아 끼울 수 있다.
    const { wrapper } = await mountDialog()

    await passwordInputs(wrapper)[1].setValue('newpass1234')
    await passwordInputs(wrapper)[2].setValue('newpass1234')
    await confirmBtn(wrapper).trigger('click')

    expect(post).not.toHaveBeenCalled()
    expect(wrapper.find('.error-text').exists()).toBe(true)
  })

  it('확인이 다르면 보내지 않는다', async () => {
    const { wrapper } = await mountDialog()

    await passwordInputs(wrapper)[0].setValue('test1234')
    await passwordInputs(wrapper)[1].setValue('newpass1234')
    await passwordInputs(wrapper)[2].setValue('다른것12345')
    await confirmBtn(wrapper).trigger('click')

    expect(post).not.toHaveBeenCalled()
  })

  it('셋이 맞으면 현재 비밀번호와 함께 보낸다', async () => {
    const { wrapper } = await mountDialog()

    await passwordInputs(wrapper)[0].setValue('test1234')
    await passwordInputs(wrapper)[1].setValue('newpass1234')
    await passwordInputs(wrapper)[2].setValue('newpass1234')
    await confirmBtn(wrapper).trigger('click')
    await flushPromises()

    expect(post).toHaveBeenCalledWith('/auth/change-password', {
      current_password: 'test1234',
      new_password: 'newpass1234',
      new_password_confirm: 'newpass1234',
    })
  })

  it('현재 비밀번호가 틀리면 서버의 말을 그대로 보여 준다', async () => {
    post.mockRejectedValue({ detail: '현재 비밀번호가 올바르지 않습니다.' })
    const { wrapper } = await mountDialog()

    await passwordInputs(wrapper)[0].setValue('틀린것')
    await passwordInputs(wrapper)[1].setValue('newpass1234')
    await passwordInputs(wrapper)[2].setValue('newpass1234')
    await confirmBtn(wrapper).trigger('click')
    await flushPromises()

    expect(wrapper.find('.error-text').text()).toContain('현재 비밀번호')
    expect(wrapper.emitted('close')).toBeFalsy()
  })
})
