/**
 * CMS 레이아웃 테스트: 메뉴 접기/숨기기, 테마 전환, 언어 전환.
 */
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { ref } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { i18n } from '@/i18n'

// auth 스토어가 초기화 때 getToken 을 부르므로 함께 스텁한다.
vi.mock('@/api/client', () => ({
  TEST_MODE: false,
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
  getToken: () => null,
  setToken: vi.fn(),
  // 상단 활동 띠가 구독한다. 아무것도 안 나가 있는 상태로 둔다.
  pendingRequests: ref(0),
}))

const push = vi.fn()
vi.mock('vue-router', () => ({
  useRoute: () => ({ path: '/devices', meta: { titleKey: 'nav.devices' } }),
  useRouter: () => ({ push }),
}))

import AppLayout from './AppLayout.vue'
import { useAuthStore } from '@/stores/auth'
import { useSettingsStore } from '@/stores/settings'

function mountLayout({ roles = ['MEMBER'] } = {}) {
  const pinia = createPinia()
  setActivePinia(pinia)

  const auth = useAuthStore()
  auth.user = { id: 1, name: '홍길동', org_id: 3, org_name: '가나초등학교', roles, status: '승인' }

  return mount(AppLayout, {
    global: {
      plugins: [pinia, i18n],
      stubs: { RouterLink: { template: '<a><slot /></a>' } },
    },
  })
}

beforeEach(() => {
  localStorage.clear()
  document.documentElement.removeAttribute('data-theme')
  window.matchMedia = vi.fn().mockImplementation((query) => ({
    matches: false,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }))
  i18n.global.locale.value = 'ko'
  push.mockClear()
})

describe('메뉴 표시 제어', () => {
  it('기본은 사이드바가 펼쳐져 있다', () => {
    const wrapper = mountLayout()
    expect(wrapper.find('.sidebar').exists()).toBe(true)
    expect(wrapper.find('.shell').classes()).not.toContain('sidebar-collapsed')
    expect(wrapper.find('.brand-text').exists()).toBe(true)
  })

  it('접으면 아이콘만 남고 라벨이 사라진다', async () => {
    const wrapper = mountLayout()
    await wrapper.find('.rail-btn').trigger('click')

    expect(wrapper.find('.shell').classes()).toContain('sidebar-collapsed')
    expect(wrapper.find('.nav-label').exists()).toBe(false)
    expect(wrapper.find('.brand-text').exists()).toBe(false)
    // 아이콘은 남아 있어야 이동이 가능하다.
    expect(wrapper.findAll('.nav-icon').length).toBeGreaterThan(0)
  })

  it('접힌 상태에서는 메뉴 이름을 title 로 알려 준다', async () => {
    const wrapper = mountLayout()
    await wrapper.find('.rail-btn').trigger('click')
    const item = wrapper.findAll('.nav-item')[0]
    expect(item.attributes('title')).toBe('대시보드')
  })

  it('상단 바 버튼으로 사이드바를 완전히 숨긴다', async () => {
    const wrapper = mountLayout()
    await wrapper.findAll('.topbar .btn-icon')[0].trigger('click')
    expect(wrapper.find('.sidebar').exists()).toBe(false)
  })

  it('숨긴 뒤에도 되돌릴 버튼이 남아 있다', async () => {
    const wrapper = mountLayout()
    const toggle = wrapper.findAll('.topbar .btn-icon')[0]
    await toggle.trigger('click')
    expect(wrapper.find('.sidebar').exists()).toBe(false)

    // 이 버튼이 사라지면 사이드바를 영영 되돌릴 수 없다.
    await wrapper.findAll('.topbar .btn-icon')[0].trigger('click')
    expect(wrapper.find('.sidebar').exists()).toBe(true)
  })

  it('만드는 순서대로 늘어놓는다', () => {
    // 재생목록은 콘텐츠 편집기에서 가져다 쓰는 재료라 콘텐츠보다 앞에 온다.
    const wrapper = mountLayout({ roles: ['MEMBER', 'ORG_ADMIN', 'SUPER_ADMIN'] })
    expect(wrapper.findAll('.nav-label').map((n) => n.text())).toEqual([
      '대시보드',
      '기관 관리',
      '사용자 관리',
      '장치 관리',
      '스케줄 관리',
      '재생목록',
      '콘텐츠',
      '기관 게시판',
    ])
  })

  it('역할에 없는 메뉴는 숨긴다', () => {
    const member = mountLayout({ roles: ['MEMBER'] })
    const memberLinks = member.findAll('.nav-label').map((n) => n.text())
    expect(memberLinks).not.toContain('기관 관리')
    expect(memberLinks).toContain('장치 관리')

    const admin = mountLayout({ roles: ['MEMBER', 'ORG_ADMIN'] })
    const adminLinks = admin.findAll('.nav-label').map((n) => n.text())
    expect(adminLinks).toContain('기관 관리')
  })
})

describe('테마 전환', () => {
  it('버튼을 누르면 다크로 바뀌고 문서에 반영된다', async () => {
    const wrapper = mountLayout()
    const settings = useSettingsStore()
    expect(settings.isDark).toBe(false)

    await wrapper.findAll('.topbar .btn-icon')[1].trigger('click')

    expect(settings.isDark).toBe(true)
    expect(document.documentElement.dataset.theme).toBe('dark')
  })

  it('다시 누르면 라이트로 돌아온다', async () => {
    const wrapper = mountLayout()
    const button = () => wrapper.findAll('.topbar .btn-icon')[1]
    await button().trigger('click')
    await button().trigger('click')
    expect(useSettingsStore().isDark).toBe(false)
  })
})

describe('언어 전환', () => {
  it('선택한 언어로 메뉴가 바뀐다', async () => {
    const wrapper = mountLayout()
    expect(wrapper.findAll('.nav-label')[0].text()).toBe('대시보드')

    await wrapper.find('.lang-select').setValue('en')
    await flushPromises()

    expect(wrapper.findAll('.nav-label')[0].text()).toBe('Dashboard')
  })

  it('상단 바 제목도 함께 번역된다', async () => {
    const wrapper = mountLayout()
    expect(wrapper.find('.topbar-title').text()).toBe('장치 관리')

    await wrapper.find('.lang-select').setValue('en')
    await flushPromises()

    expect(wrapper.find('.topbar-title').text()).toBe('Devices')
  })

  it('역할 이름도 번역된다', async () => {
    const wrapper = mountLayout({ roles: ['MEMBER', 'ORG_ADMIN'] })
    expect(wrapper.find('.who-meta').text()).toContain('기관관리자')

    await wrapper.find('.lang-select').setValue('en')
    await flushPromises()

    expect(wrapper.find('.who-meta').text()).toContain('Org admin')
  })

  it('지원 언어가 모두 선택지에 있다', () => {
    const wrapper = mountLayout()
    const options = wrapper.findAll('.lang-select option').map((o) => o.attributes('value'))
    expect(options).toEqual(['ko', 'en', 'ja', 'zh'])
  })
})
