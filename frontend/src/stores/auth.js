import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

import { api, getToken, setToken } from '@/api/client'

/**
 * 역할 코드. 표시 이름은 로케일 파일의 ``enums.role.*`` 에 있다.
 * 코드는 서버가 정하는 값이므로 번역 대상이 아니다.
 */
export const ROLES = [
  'SUPER_ADMIN',
  'ORG_ADMIN',
  'DEVICE_MANAGER',
  'HOMEROOM_TEACHER',
  'MEMBER',
]

/** 관리자가 화면에서 부여할 수 있는 역할(SUPER_ADMIN 은 별도 처리, MEMBER 는 자동). */
export const ASSIGNABLE_ROLES = [
  'ORG_ADMIN',
  'DEVICE_MANAGER',
  'HOMEROOM_TEACHER',
]

export const useAuthStore = defineStore('auth', () => {
  const user = ref(null)
  const token = ref(getToken())
  const loading = ref(false)

  const isAuthenticated = computed(() => Boolean(user.value))
  const roles = computed(() => user.value?.roles ?? [])

  const isSuperAdmin = computed(() => roles.value.includes('SUPER_ADMIN'))
  const isOrgAdmin = computed(() => roles.value.includes('ORG_ADMIN'))
  const isDeviceManager = computed(() => roles.value.includes('DEVICE_MANAGER'))

  /**
   * 화면 노출 제어용 권한 플래그.
   *
   * 서버가 같은 규칙으로 다시 검사한다(요구사항: Backend/Frontend 양쪽에서 제어).
   * 여기서 통과해도 서버가 거부할 수 있으므로, 화면은 항상 오류 응답을 표시해야 한다.
   */
  const can = computed(() => ({
    manageOrgs: isSuperAdmin.value || isOrgAdmin.value,
    approveUsers: isSuperAdmin.value || isOrgAdmin.value,
    manageUsers: isSuperAdmin.value || isOrgAdmin.value,
    createDevices: isSuperAdmin.value || isOrgAdmin.value,
    manageDevices: isSuperAdmin.value || isOrgAdmin.value || isDeviceManager.value,
    manageSchedules: isSuperAdmin.value || isOrgAdmin.value || isDeviceManager.value,
    manageBoards: isSuperAdmin.value || isOrgAdmin.value,
    // 커뮤니티 — 모든 승인 사용자의 공간(2026-10 개편: COMMUNITY_USER 제거).
    // 게시 승인·설정만 관리자의 일로 남는다(서버의 can_use_community 와 동일).
    useCommunity: true,
    // 커뮤니티 콘텐츠·재생목록 — 관리자의 운영 화면.
    manageCommunity: isSuperAdmin.value || isOrgAdmin.value,
    shareInCommunity: true,
  }))

  function hasRole(...names) {
    return names.some((name) => roles.value.includes(name))
  }

  async function login(userId, password) {
    loading.value = true
    try {
      const result = await api.post('/auth/login', { user_id: userId, password })
      token.value = result.access_token
      setToken(result.access_token)
      user.value = result.user
      try {
        // 커뮤니티 알림 팝업은 로그인마다 한 번 — 지난 세션의 '봤음' 표시를 지운다.
        sessionStorage.removeItem('signallink.community-popup-seen')
      } catch {
        // 저장소가 없으면 팝업 쪽이 알아서 넘어간다.
      }
      return result.user
    } finally {
      loading.value = false
    }
  }

  /** 저장된 토큰으로 세션을 복구한다. 실패하면 조용히 로그아웃한다. */
  async function restore() {
    if (!token.value) return null
    try {
      user.value = await api.get('/auth/me')
      return user.value
    } catch {
      logout()
      return null
    }
  }

  function logout() {
    user.value = null
    token.value = null
    setToken(null)
  }

  return {
    user,
    token,
    loading,
    isAuthenticated,
    roles,
    isSuperAdmin,
    isOrgAdmin,
    isDeviceManager,
    can,
    hasRole,
    login,
    restore,
    logout,
  }
})
