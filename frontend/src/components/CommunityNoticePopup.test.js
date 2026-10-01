/**
 * 로그인 커뮤니티 알림 팝업.
 *
 * 판정(게시·대상·기간)은 서버 몫 — 이 컴포넌트의 약속은 두 가지다.
 * 서버가 준 목록이 있으면 로그인 직후 한 번 팝업을 띄우는 것, 그리고
 * 닫으면 이 세션에서는 다시 띄우지 않는 것(다음 로그인에 다시 뜬다).
 */
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { i18n } from '@/i18n'

const get = vi.fn()

vi.mock('@/api/client', () => ({
  api: { get: (...args) => get(...args), post: vi.fn() },
  getToken: () => null,
  setToken: vi.fn(),
  TEST_MODE: false,
}))

import CommunityNoticePopup from './CommunityNoticePopup.vue'
import { useAuthStore } from '@/stores/auth'

const NOTICE = {
  id: 1,
  org_id: 2,
  org_name: '서울특별시교육청',
  title: '가을 축제 자원봉사 모집',
  memo: '토요일 오전, 교육청 앞마당',
  contact: '02-1234-5678',
  author_name: '박교육',
  target_org_types: ['학교'],
  notice_start: '2026-10-01',
  notice_end: '2026-10-14',
}

async function mountPopup({ authenticated = true } = {}) {
  setActivePinia(createPinia())
  if (authenticated) {
    useAuthStore().user = { id: 3, name: '김교장', org_id: 3, roles: ['MEMBER'] }
  }
  const wrapper = mount(CommunityNoticePopup, {
    global: {
      plugins: [i18n],
      stubs: { RouterLink: { template: '<a><slot /></a>' } },
    },
  })
  await flushPromises()
  return wrapper
}

beforeEach(() => {
  i18n.global.locale.value = 'ko'
  get.mockReset()
  get.mockResolvedValue([NOTICE])
  sessionStorage.clear()
})

describe('로그인 알림', () => {
  it('대상 공지가 있으면 팝업으로 알린다', async () => {
    const wrapper = await mountPopup()

    expect(get).toHaveBeenCalledWith('/community/popup')
    const popup = wrapper.find('[data-test="community-popup"]')
    expect(popup.exists()).toBe(true)
    expect(popup.text()).toContain('가을 축제 자원봉사 모집')
    expect(popup.text()).toContain('토요일 오전, 교육청 앞마당')
    expect(popup.text()).toContain('2026-10-01 ~ 2026-10-14')
  })

  it('공지가 없으면 아무것도 띄우지 않는다', async () => {
    get.mockResolvedValue([])
    const wrapper = await mountPopup()

    expect(wrapper.find('[data-test="community-popup"]').exists()).toBe(false)
  })

  it('로그인 전에는 묻지도 않는다', async () => {
    await mountPopup({ authenticated: false })

    expect(get).not.toHaveBeenCalled()
  })

  it('닫으면 이 세션에서는 다시 뜨지 않는다', async () => {
    const first = await mountPopup()
    await first.find('[data-test="popup-close"]').trigger('click')
    expect(first.find('[data-test="community-popup"]').exists()).toBe(false)

    // 새 화면(재마운트)에서도 — 로그인 전까지는 조용하다.
    get.mockClear()
    const second = await mountPopup()
    expect(get).not.toHaveBeenCalled()
    expect(second.find('[data-test="community-popup"]').exists()).toBe(false)
  })

  it('요청이 실패해도 조용히 넘어간다 — 팝업은 부가 기능이다', async () => {
    get.mockRejectedValue(new Error('down'))
    const wrapper = await mountPopup()

    expect(wrapper.find('[data-test="community-popup"]').exists()).toBe(false)
  })
})
