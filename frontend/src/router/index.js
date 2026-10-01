import { createRouter, createWebHistory } from 'vue-router'

import { useAuthStore } from '@/stores/auth'

/**
 * 라우트 메타
 *   public    로그인 없이 접근 가능
 *   roles     이 역할 중 하나가 있어야 접근 가능(없으면 로그인만 요구)
 *   titleKey  상단 바 제목의 i18n 키. 언어를 바꾸면 함께 바뀐다.
 *
 * 라우트 가드는 편의 기능이다. 실제 접근 통제는 서버가 한다.
 */
const routes = [
  {
    path: '/login',
    name: 'login',
    component: () => import('@/views/LoginView.vue'),
    meta: { public: true, layout: 'blank' },
  },
  {
    path: '/register',
    name: 'register',
    component: () => import('@/views/RegisterView.vue'),
    meta: { public: true, layout: 'blank' },
  },
  {
    // 브라우저 기반 DID 플레이어(테스트용). 장치 자격(X-Device-Token)으로
    // 도는 화면이라 사용자 로그인이 없다 — 접근 통제는 장치 고유번호 인증이다.
    path: '/player',
    name: 'player',
    component: () => import('@/views/PlayerView.vue'),
    meta: { public: true, layout: 'blank', titleKey: 'player.title' },
  },
  {
    path: '/',
    name: 'dashboard',
    component: () => import('@/views/DashboardView.vue'),
    meta: { titleKey: 'nav.dashboard' },
  },
  {
    path: '/organizations',
    name: 'organizations',
    component: () => import('@/views/OrganizationsView.vue'),
    meta: { titleKey: 'nav.organizations', roles: ['SUPER_ADMIN', 'ORG_ADMIN'] },
  },
  {
    path: '/users',
    name: 'users',
    component: () => import('@/views/UsersView.vue'),
    meta: { titleKey: 'nav.users', roles: ['SUPER_ADMIN', 'ORG_ADMIN'] },
  },
  {
    path: '/devices',
    name: 'devices',
    component: () => import('@/views/DevicesView.vue'),
    meta: { titleKey: 'nav.devices' },
  },
  {
    path: '/schedules',
    name: 'schedules',
    component: () => import('@/views/SchedulesView.vue'),
    meta: { titleKey: 'nav.schedules' },
  },
  {
    path: '/schedules/:id/grid',
    name: 'schedule-grid',
    component: () => import('@/views/ScheduleGridView.vue'),
    meta: { titleKey: 'schedule.editorTitle' },
  },
  {
    path: '/contents',
    name: 'contents',
    component: () => import('@/views/ContentsView.vue'),
    meta: { titleKey: 'nav.contents' },
  },
  {
    path: '/playlists',
    name: 'playlists',
    component: () => import('@/views/PlaylistsView.vue'),
    meta: { titleKey: 'nav.playlists' },
  },
  {
    // 만들기와 수정이 같은 화면을 쓴다. 채워야 할 것이 완전히 같다.
    path: '/playlists/new',
    name: 'playlist-create',
    component: () => import('@/views/PlaylistEditorView.vue'),
    meta: { titleKey: 'widgetPlaylist.createTitle' },
  },
  {
    path: '/playlists/:id/edit',
    name: 'playlist-editor',
    component: () => import('@/views/PlaylistEditorView.vue'),
    meta: { titleKey: 'widgetPlaylist.editTitle' },
  },
  {
    path: '/contents/:id/editor',
    name: 'content-editor',
    component: () => import('@/views/ContentEditorView.vue'),
    meta: { titleKey: 'content.title' },
  },
  {
    path: '/admin/schools',
    name: 'admin-schools',
    component: () => import('@/views/AdminSchoolsView.vue'),
    // 관리자 메뉴는 슈퍼관리자의 것이다 — 가드가 meta.roles 로 돌려보낸다.
    meta: { titleKey: 'nav.adminSchools', roles: ['SUPER_ADMIN'] },
  },
  {
    // 소속기관 공지 — 기간이 정해진 재생목록 형태의 공지.
    path: '/org-notices',
    name: 'org-notices',
    component: () => import('@/views/OrgNoticesView.vue'),
    meta: { titleKey: 'nav.orgNotices', roles: ['SUPER_ADMIN', 'ORG_ADMIN'] },
  },
  {
    // 공지 편집기 — 좌(콘텐츠 편집기)/우(재생목록) 분할.
    path: '/org-notices/:id/editor',
    name: 'org-notice-editor',
    component: () => import('@/views/OrgNoticeEditorView.vue'),
    meta: { titleKey: 'nav.orgNotices', roles: ['SUPER_ADMIN', 'ORG_ADMIN'] },
  },
  {
    path: '/admin/org-types',
    name: 'admin-org-types',
    component: () => import('@/views/AdminOrgTypesView.vue'),
    meta: { titleKey: 'nav.adminOrgTypes', roles: ['SUPER_ADMIN'] },
  },
  {
    // 커뮤니티 — 상위기관 단위의 공유 공간. 역할 제한이 없다: 어느 커뮤니티를
    // 보는지는 서버가 소속 기관에서 정하고, 올릴 수 있는지도 서버가 답한다.
    // 개편(2026-09): 게시판·콘텐츠를 걷어내고 재생목록 하나가 커뮤니티다.
    path: '/community/playlists',
    name: 'community-playlists',
    component: () => import('@/views/CommunityPlaylistsView.vue'),
    meta: { titleKey: 'nav.community' },
  },
  {
    // 등록은 목록 화면의 메타 레이어가 하고(2026-10), 칸 다듬기는 이 편집기다.
    path: '/community/playlists/:id/edit',
    name: 'community-playlist-edit',
    component: () => import('@/views/CommunityPlaylistEditorView.vue'),
    meta: { titleKey: 'nav.community' },
  },
  {
    path: '/boards',
    name: 'boards',
    component: () => import('@/views/BoardsView.vue'),
    meta: { titleKey: 'nav.boards', roles: ['SUPER_ADMIN', 'ORG_ADMIN'] },
  },
  {
    path: '/:pathMatch(.*)*',
    name: 'not-found',
    component: () => import('@/views/NotFoundView.vue'),
    meta: { titleKey: 'notFound.title' },
  },
]

export const router = createRouter({
  history: createWebHistory(),
  routes,
})

router.beforeEach(async (to) => {
  const auth = useAuthStore()

  // 새로고침 직후에는 스토어가 비어 있다. 저장된 토큰으로 한 번 복구를 시도한다.
  if (!auth.isAuthenticated && auth.token) {
    await auth.restore()
  }

  if (to.meta.public) {
    return auth.isAuthenticated && to.name === 'login' ? { name: 'dashboard' } : true
  }

  if (!auth.isAuthenticated) {
    return { name: 'login', query: { redirect: to.fullPath } }
  }

  // 2026-10 개편: 커뮤니티는 모든 승인 사용자의 공간 — 전용 가드가 없다.
  if (to.meta.roles && !auth.hasRole(...to.meta.roles)) {
    return { name: 'dashboard' }
  }

  return true
})
