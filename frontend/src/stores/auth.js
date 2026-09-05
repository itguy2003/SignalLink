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
  'COMMUNITY_USER',
]

/** 관리자가 화면에서 부여할 수 있는 역할(SUPER_ADMIN 은 별도 처리, MEMBER 는 자동). */
export const ASSIGNABLE_ROLES = [
  'ORG_ADMIN',
  'DEVICE_MANAGER',
  'HOMEROOM_TEACHER',
  'COMMUNITY_USER',
]

/**
 * 커뮤니티 유저에게 열어 두는 화면(커뮤니티 서브 메뉴들).
 *
 * **닫는 목록이 아니라 여는 목록**이다 — 화면이 늘 때마다 막을 것을 적으면
 * 언젠가 잊는다. 서버도 같은 방식으로 경로를 가른다(``api/deps.py``).
 */
export const COMMUNITY_ROUTES = ['community-board']

/**
 * 관리자만 들어가는 커뮤니티 화면.
 *
 * 커뮤니티 유저는 자료(글·이미지·동영상)를 올리는 사람이고, 자료를 엮어
 * 화면에 내보내는 일(콘텐츠·재생목록)은 운영이다. 서버도 같은 규칙으로
 * 막는다(``_require_manage``).
 */
export const COMMUNITY_ADMIN_ROUTES = [
  'community-playlists',
  'community-contents',
  'community-content-editor',
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
   * 게시판만 쓰는 사람인가.
   *
   * 다른 역할을 함께 가졌다면 그쪽이 이긴다 — 커뮤니티 역할은 '이것만 할 수
   * 있다' 는 제한이지 '이것을 할 수 있다' 는 허가가 아니다. 서버도 같은
   * 규칙으로 판정한다(``services/permissions.is_community_user``).
   */
  const isCommunityUser = computed(
    () =>
      roles.value.includes('COMMUNITY_USER') &&
      !hasRole('SUPER_ADMIN', 'ORG_ADMIN', 'DEVICE_MANAGER', 'HOMEROOM_TEACHER'),
  )

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
    // 커뮤니티 공간에 들어올 수 있는가 — 기관관리자와 커뮤니티 역할 보유자만.
    // (isCommunityUser 가 아니라 역할 보유 여부를 본다. 다른 역할과 겸해도
    // 커뮤니티에는 들어온다. 서버의 can_use_community 와 같은 규칙.)
    useCommunity:
      isSuperAdmin.value || isOrgAdmin.value || roles.value.includes('COMMUNITY_USER'),
    // 커뮤니티 콘텐츠·재생목록 — 관리자의 운영 화면.
    manageCommunity: isSuperAdmin.value || isOrgAdmin.value,
    // 커뮤니티에 올릴 수 있는가. 들어올 수 있으면 올릴 수 있다 — 남의 것은
    // 조회만 되고 제 것에만 수정·삭제가 열린다. 최종 판정은 서버가 다시 한다.
    shareInCommunity:
      isSuperAdmin.value || isOrgAdmin.value || roles.value.includes('COMMUNITY_USER'),
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
    isCommunityUser,
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
