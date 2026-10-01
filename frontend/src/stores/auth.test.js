/**
 * 인증 스토어의 권한 판정.
 *
 * 2026-10 개편: COMMUNITY_USER 역할이 사라졌다 — 커뮤니티는 모든 승인
 * 사용자의 공간이고, 게시 승인·설정만 관리자의 일로 남는다.
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

import { ASSIGNABLE_ROLES, ROLES, useAuthStore } from './auth'

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
  it('커뮤니티 유저 역할은 더 이상 없다', () => {
    // 2026-10 개편: 커뮤니티는 역할이 아니라 모두의 공간이다.
    expect(ROLES).not.toContain('COMMUNITY_USER')
    expect(ASSIGNABLE_ROLES).not.toContain('COMMUNITY_USER')
  })
})

describe('할 수 있는 일', () => {
  it('일반 회원도 커뮤니티에 들어가고 올릴 수 있다', () => {
    const can = asUser().can
    expect(can.useCommunity).toBe(true)
    expect(can.shareInCommunity).toBe(true)
  })

  it('일반 회원은 수집원·관리 화면을 손대지 못한다', () => {
    const can = asUser().can
    expect(can.manageBoards).toBe(false)
    expect(can.manageOrgs).toBe(false)
    expect(can.manageUsers).toBe(false)
    expect(can.manageDevices).toBe(false)
    expect(can.manageSchedules).toBe(false)
    // 커뮤니티 게시 승인(운영)도 관리자의 일이다.
    expect(can.manageCommunity).toBe(false)
  })

  it('관리자는 커뮤니티 운영(게시 승인·설정)까지 다룬다', () => {
    const can = asUser('ORG_ADMIN').can
    expect(can.shareInCommunity).toBe(true)
    expect(can.manageCommunity).toBe(true)
    expect(can.manageBoards).toBe(true)
  })
})
