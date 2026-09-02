import { createRouter, createWebHistory } from 'vue-router'

import { COMMUNITY_ROUTES, useAuthStore } from '@/stores/auth'

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
    path: '/boards',
    name: 'boards',
    component: () => import('@/views/BoardsView.vue'),
    meta: { titleKey: 'nav.boards', roles: ['SUPER_ADMIN', 'ORG_ADMIN', 'COMMUNITY_USER'] },
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

  // 커뮤니티 유저는 게시판 바깥으로 나가지 못한다. 대시보드조차 그 사람의
  // 화면이 아니므로 돌려보낼 곳도 게시판이다.
  if (auth.isCommunityUser && !COMMUNITY_ROUTES.includes(to.name)) {
    return { name: 'boards' }
  }

  if (to.meta.roles && !auth.hasRole(...to.meta.roles)) {
    return { name: 'dashboard' }
  }

  return true
})
