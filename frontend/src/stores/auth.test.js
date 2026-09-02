/**
 * 인증 스토어의 권한 판정 — 커뮤니티 유저 중심.
 *
 * 커뮤니티 역할은 '이것**만** 할 수 있다' 는 제한이지 '이것을 할 수 있다' 는
 * 허가가 아니다. 그래서 다른 역할과 함께 붙었을 때 어느 쪽이 이기는지가
 * 핵심이다 — 담당자에게 얹었다고 그 사람이 갑자기 장치를 못 보게 되면 곤란하다.
 *
 * 화면 판정은 서버 판정의 사본이다(``services/permissions``). 여기서 통과해도
 * 서버가 다시 막는다.
 */
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/api/client', () => ({
  api: { get: vi.fn(), post: vi.fn() },
  getToken: () => null,
  setToken: vi.fn(),
}))

import { ASSIGNABLE_ROLES, COMMUNITY_ROUTES, ROLES, useAuthStore } from './auth'

/** 그 역할들을 가진 사람으로 로그인한 셈 친다. */
function asUser(...roles) {
  const auth = useAuthStore()
  auth.user = { id: 1, user_id: 'tester', name: '테스터', org_id: 3, roles: [...roles, 'MEMBER'] }
  return auth
}

beforeEach(() => {
  setActivePinia(createPinia())
})

describe('역할 목록', () => {
  it('커뮤니티 유저가 역할에 들어 있다', () => {
    expect(ROLES).toContain('COMMUNITY_USER')
  })

  it('관리자가 부여할 수 있다', () => {
    // 부여할 수 없으면 만들 방법이 없는 역할이 된다.
    expect(ASSIGNABLE_ROLES).toContain('COMMUNITY_USER')
  })

  it('열어 두는 화면은 게시판뿐이다', () => {
    expect(COMMUNITY_ROUTES).toEqual(['boards'])
  })
})

describe('커뮤니티 유저 판정', () => {
  it('커뮤니티 역할만 있으면 커뮤니티 유저다', () => {
    expect(asUser('COMMUNITY_USER').isCommunityUser).toBe(true)
  })

  it('아무 역할이 없으면 아니다', () => {
    expect(asUser().isCommunityUser).toBe(false)
  })

  it('관리 역할을 함께 가지면 그쪽이 이긴다', () => {
    // 담당자에게 커뮤니티 역할을 얹었다고 장치를 못 보게 되면 곤란하다.
    for (const role of ['SUPER_ADMIN', 'ORG_ADMIN', 'DEVICE_MANAGER', 'HOMEROOM_TEACHER']) {
      expect(asUser('COMMUNITY_USER', role).isCommunityUser, role).toBe(false)
      setActivePinia(createPinia())
    }
  })
})

describe('할 수 있는 일', () => {
  it('커뮤니티 유저는 글을 올릴 수 있다', () => {
    // 게시판이 그 사람에게 열려 있는 유일한 창구다.
    expect(asUser('COMMUNITY_USER').can.writePosts).toBe(true)
  })

  it('커뮤니티 유저는 수집원을 손대지 못한다', () => {
    // 글을 쓰는 것과 어디서 긁어 올지 정하는 것은 다른 일이다.
    expect(asUser('COMMUNITY_USER').can.manageBoards).toBe(false)
  })

  it('커뮤니티 유저는 관리 화면의 어떤 것도 못 한다', () => {
    const can = asUser('COMMUNITY_USER').can

    expect(can.manageOrgs).toBe(false)
    expect(can.manageUsers).toBe(false)
    expect(can.manageDevices).toBe(false)
    expect(can.manageSchedules).toBe(false)
  })

  it('관리자는 글도 올리고 수집원도 다룬다', () => {
    const can = asUser('ORG_ADMIN').can

    expect(can.writePosts).toBe(true)
    expect(can.manageBoards).toBe(true)
  })

  it('일반 회원은 글을 올리지 못한다', () => {
    // 게시판을 쓰라고 만든 역할은 커뮤니티 유저 쪽이다.
    expect(asUser().can.writePosts).toBe(false)
  })
})
