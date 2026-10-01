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

  it('만드는 순서대로 늘어놓는다 — 대시보드 아래에 관리자 그룹', () => {
    // 재생목록은 콘텐츠 편집기에서 가져다 쓰는 재료라 콘텐츠보다 앞에 온다.
    const wrapper = mountLayout({ roles: ['MEMBER', 'ORG_ADMIN', 'SUPER_ADMIN'] })
    expect(wrapper.findAll('.nav-label').map((n) => n.text())).toEqual([
      '대시보드',
      // 관리자 그룹: 머리글 + 학교 정보 관리 + 기관구분 관리 + 기관 관리
      // + 사용자 관리.
      '관리자',
      '학교 정보 관리',
      '기관구분 관리',
      '기관 관리',
      '사용자 관리',
      '장치 관리',
      '스케줄 관리',
      // 콘텐츠 관리 그룹: 머리글 + 기관 게시판·소속기관 공지·콘텐츠·재생목록.
      '콘텐츠 관리',
      '기관 게시판',
      '소속기관 공지',
      '콘텐츠',
      '재생목록',
      // 커뮤니티 — 화면이 하나뿐이라 서브 메뉴 없는 최상위 항목.
      '커뮤니티',
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

describe('관리자 메뉴', () => {
  it('칸마다 권한이 다르다 — 기관관리자에게는 기관 관리만 남는다', () => {
    const admin = mountLayout({ roles: ['MEMBER', 'SUPER_ADMIN'] })
    const adminLabels = admin.findAll('.nav-label').map((n) => n.text())
    expect(adminLabels).toContain('학교 정보 관리')
    expect(adminLabels).toContain('기관구분 관리')

    const orgAdmin = mountLayout({ roles: ['MEMBER', 'ORG_ADMIN'] })
    const orgLabels = orgAdmin.findAll('.nav-label').map((n) => n.text())
    expect(orgLabels).toContain('관리자')
    expect(orgLabels).toContain('기관 관리')
    expect(orgLabels).not.toContain('학교 정보 관리')
  })

  it('보이는 칸이 없으면 그룹째 사라진다', () => {
    const member = mountLayout({ roles: ['MEMBER'] })
    expect(member.findAll('.nav-label').map((n) => n.text())).not.toContain('관리자')
  })
})

describe('그룹 접기', () => {
  it('머리글을 누르면 서브 메뉴가 접히고, 다시 누르면 펴진다', async () => {
    const wrapper = mountLayout({ roles: ['MEMBER', 'SUPER_ADMIN'] })
    const labels = () => wrapper.findAll('.nav-label').map((n) => n.text())
    expect(labels()).toContain('학교 정보 관리')

    await wrapper.find('[data-test="group-admin"]').trigger('click')
    expect(labels()).not.toContain('학교 정보 관리')
    expect(labels()).toContain('관리자') // 머리글은 남는다 — 다시 펼 곳이다.

    await wrapper.find('[data-test="group-admin"]').trigger('click')
    expect(labels()).toContain('학교 정보 관리')
  })

  it('접힘은 그룹마다 따로다', async () => {
    const wrapper = mountLayout({ roles: ['MEMBER', 'ORG_ADMIN', 'SUPER_ADMIN'] })
    await wrapper.find('[data-test="group-admin"]').trigger('click')

    const labels = wrapper.findAll('.nav-label').map((n) => n.text())
    expect(labels).not.toContain('기관 관리')
    expect(labels).toContain('커뮤니티') // 다른 메뉴는 그대로.
  })

  it('접힘 상태를 기억해 새로 그려도 유지한다', async () => {
    const first = mountLayout({ roles: ['MEMBER', 'SUPER_ADMIN'] })
    await first.find('[data-test="group-admin"]').trigger('click')

    const second = mountLayout({ roles: ['MEMBER', 'SUPER_ADMIN'] })
    expect(second.findAll('.nav-label').map((n) => n.text())).not.toContain('학교 정보 관리')
  })

  it('아이콘만 남긴 사이드바에서는 접힘과 무관하게 아이콘이 보인다', async () => {
    // 머리글이 없어 다시 펼 방법이 없으므로, 이 상태에서는 늘 편다.
    const wrapper = mountLayout({ roles: ['MEMBER', 'SUPER_ADMIN'] })
    await wrapper.find('[data-test="group-admin"]').trigger('click')
    await wrapper.find('.rail-btn').trigger('click')

    const titles = wrapper.findAll('.nav-item').map((item) => item.attributes('title'))
    expect(titles).toContain('학교 정보 관리')
  })
})

describe('커뮤니티 메뉴', () => {
  it('서브 메뉴 없는 최상위 항목이다', () => {
    const wrapper = mountLayout({ roles: ['MEMBER', 'ORG_ADMIN'] })

    // 관리자 2칸 + 콘텐츠 관리 4칸 — 커뮤니티는 그룹이 아니라 서브가 없다.
    expect(wrapper.findAll('.nav-item.sub')).toHaveLength(6)
    expect(wrapper.findAll('.nav-label').map((n) => n.text())).toContain('커뮤니티')
  })

  it('일반 회원에게도 보인다 — 커뮤니티는 모두의 공간이다(2026-10 개편)', () => {
    const wrapper = mountLayout({ roles: ['MEMBER'] })
    const labels = wrapper.findAll('.nav-label').map((n) => n.text())

    expect(labels).toContain('커뮤니티')
  })
})
