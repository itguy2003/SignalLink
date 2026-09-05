<script setup>
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import { useRoute, useRouter } from 'vue-router'

import { TEST_MODE } from '@/api/client'
import ActivityBar from '@/components/ActivityBar.vue'
import ProfileDialog from '@/components/ProfileDialog.vue'
import { SUPPORTED_LOCALES } from '@/i18n'
import { COMMUNITY_ROUTES, useAuthStore } from '@/stores/auth'
import { useSettingsStore } from '@/stores/settings'

const auth = useAuthStore()
const settings = useSettingsStore()
const route = useRoute()
const router = useRouter()
const { t } = useI18n()

const NAV = [
  { to: '/', key: 'dashboard', icon: '▤' },
  { to: '/organizations', key: 'organizations', icon: '🏛', roles: ['SUPER_ADMIN', 'ORG_ADMIN'] },
  { to: '/users', key: 'users', icon: '👥', roles: ['SUPER_ADMIN', 'ORG_ADMIN'] },
  { to: '/devices', key: 'devices', icon: '🖥' },
  { to: '/schedules', key: 'schedules', icon: '🗓' },
  // 재생목록을 콘텐츠보다 앞에 둔다 — 재생목록은 콘텐츠 편집기에서 가져다
  // 쓰는 재료라, 만드는 순서가 곧 이 순서다.
  { to: '/playlists', key: 'playlists', icon: '🔁' },
  { to: '/contents', key: 'contents', icon: '🎬' },
  { to: '/boards', key: 'boards', icon: '📰', roles: ['SUPER_ADMIN', 'ORG_ADMIN'] },
  {
    // 커뮤니티는 상위기관 단위의 공유 공간 — 기관관리자와 커뮤니티 유저의
    // 것이다. 어느 커뮤니티를 보는지는 서버가 소속 기관에서 정한다.
    // 콘텐츠·재생목록은 관리자의 운영 화면이라 adminOnly 로 가른다.
    key: 'community',
    icon: '🤝',
    // 공유 이미지·동영상 메뉴는 게시판으로 합쳤다 — 글에 붙인 파일이
    // 곧 공유 재료다(콘텐츠·재생목록이 가져다 쓴다).
    children: [
      { to: '/community/board', key: 'communityBoard', icon: '💬' },
      { to: '/community/playlists', key: 'communityPlaylists', icon: '🔁', adminOnly: true },
      { to: '/community/contents', key: 'communityContents', icon: '🎞', adminOnly: true },
    ],
  },
]

// 역할에 따라 메뉴 자체를 감춘다. 서버도 같은 규칙으로 다시 막는다.
const menu = computed(() => {
  // 커뮤니티 그룹의 서브 메뉴: 관리자 전용 칸(콘텐츠·재생목록)을 가른다.
  const communityGroup = (group) => ({
    ...group,
    children: group.children.filter((child) => !child.adminOnly || auth.can.manageCommunity),
  })

  // 커뮤니티 유저에게는 커뮤니티 그룹만 남긴다. 나머지는 눌러도 서버가
  // 막지만, 눌리는 것 자체가 '내 것인가' 를 헷갈리게 한다.
  if (auth.isCommunityUser) {
    return NAV.filter((item) => item.key === 'community').map(communityGroup)
  }
  return NAV.filter((item) => !item.roles || auth.hasRole(...item.roles))
    .filter((item) => item.key !== 'community' || auth.can.useCommunity)
    .map((item) => (item.key === 'community' ? communityGroup(item) : item))
})

const primaryRole = computed(() => {
  const order = ['SUPER_ADMIN', 'ORG_ADMIN', 'DEVICE_MANAGER', 'HOMEROOM_TEACHER', 'MEMBER']
  const found = order.find((role) => auth.roles.includes(role))
  return found ? t(`enums.role.${found}`) : ''
})

const pageTitle = computed(() => (route.meta.titleKey ? t(route.meta.titleKey) : ''))

function isActive(item) {
  return route.path === item.to || (item.to !== '/' && route.path.startsWith(item.to))
}

const profileOpen = ref(false)

function logout() {
  auth.logout()
  router.push({ name: 'login' })
}
</script>

<template>
  <div class="shell" :class="{ 'sidebar-collapsed': settings.sidebarCollapsed }">
    <aside v-if="!settings.sidebarHidden" class="sidebar">
      <div class="brand">
        <div class="brand-mark">SL</div>
        <div v-if="!settings.sidebarCollapsed" class="brand-text">
          <div class="brand-name">{{ t('app.name') }}</div>
          <div class="brand-sub">{{ t('app.edition') }}</div>
        </div>
      </div>

      <nav class="nav">
        <template v-for="item in menu" :key="item.key">
          <!-- 서브 메뉴가 있는 그룹. 머리글은 누르는 곳이 아니라 이름표다. -->
          <template v-if="item.children">
            <div v-if="!settings.sidebarCollapsed" class="nav-group">
              <span class="nav-icon">{{ item.icon }}</span>
              <span class="nav-label">{{ t(`nav.${item.key}`) }}</span>
            </div>
            <RouterLink
              v-for="child in item.children"
              :key="child.to"
              :to="child.to"
              class="nav-item"
              :class="{ sub: !settings.sidebarCollapsed, active: isActive(child) }"
              :title="settings.sidebarCollapsed ? t(`nav.${child.key}`) : null"
            >
              <span class="nav-icon">{{ child.icon }}</span>
              <span v-if="!settings.sidebarCollapsed" class="nav-label">
                {{ t(`nav.${child.key}`) }}
              </span>
            </RouterLink>
          </template>

          <RouterLink
            v-else
            :to="item.to"
            class="nav-item"
            :class="{ active: isActive(item) }"
            :title="settings.sidebarCollapsed ? t(`nav.${item.key}`) : null"
          >
            <span class="nav-icon">{{ item.icon }}</span>
            <span v-if="!settings.sidebarCollapsed" class="nav-label">
              {{ t(`nav.${item.key}`) }}
            </span>
          </RouterLink>
        </template>
      </nav>

      <div class="sidebar-foot">
        <div
          v-if="TEST_MODE && !settings.sidebarCollapsed"
          class="test-badge"
          :title="t('layout.testModeHint')"
        >
          {{ t('layout.testMode') }}
        </div>
        <div v-else-if="TEST_MODE" class="test-badge dot" :title="t('layout.testModeHint')">T</div>

        <button
          class="rail-btn"
          :title="settings.sidebarCollapsed ? t('nav.expand') : t('nav.collapse')"
          @click="settings.toggleSidebar()"
        >
          <span aria-hidden="true">{{ settings.sidebarCollapsed ? '»' : '«' }}</span>
          <span v-if="!settings.sidebarCollapsed" class="rail-label">{{ t('nav.collapse') }}</span>
        </button>
      </div>
    </aside>

    <div class="main">
      <header class="topbar">
        <!-- 서버에 무엇이든 나가 있으면 여기서 알린다. 화면마다 따로 붙이면
             붙이는 것을 잊은 화면이 반드시 생긴다. -->
        <ActivityBar />

        <!-- 사이드바를 완전히 숨겼을 때 되돌릴 수 있는 유일한 지점이다. -->
        <button
          class="btn btn-icon"
          :title="settings.sidebarHidden ? t('nav.show') : t('nav.hide')"
          @click="settings.setSidebar(settings.sidebarHidden ? 'expanded' : 'hidden')"
        >
          <span aria-hidden="true">☰</span>
          <span class="sr-only">{{ settings.sidebarHidden ? t('nav.show') : t('nav.hide') }}</span>
        </button>

        <h1 class="topbar-title">{{ pageTitle }}</h1>
        <div class="spacer" />

        <button
          class="btn btn-icon"
          :title="`${t('layout.theme')}: ${t(settings.isDark ? 'layout.themeDark' : 'layout.themeLight')}`"
          @click="settings.toggleTheme()"
        >
          <span aria-hidden="true">{{ settings.isDark ? '☀' : '☾' }}</span>
          <span class="sr-only">{{ t('layout.theme') }}</span>
        </button>

        <select
          class="select lang-select"
          :value="settings.locale"
          :title="t('layout.language')"
          :aria-label="t('layout.language')"
          @change="settings.setLocale($event.target.value)"
        >
          <option v-for="option in SUPPORTED_LOCALES" :key="option.code" :value="option.code">
            {{ option.label }}
          </option>
        </select>

        <div v-if="auth.user" class="who">
          <div class="who-name">{{ auth.user.name }}</div>
          <div class="who-meta">{{ auth.user.org_name }} · {{ primaryRole }}</div>
        </div>

        <!-- 자기 정보는 자기가 고친다 — 이름·연락처·이메일과 비밀번호. -->
        <button class="btn btn-sm" @click="profileOpen = true">{{ t('profile.open') }}</button>
        <button class="btn btn-sm" @click="logout">{{ t('layout.logout') }}</button>

        <ProfileDialog v-if="profileOpen" @close="profileOpen = false" />
      </header>

      <main class="content">
        <slot />
      </main>
    </div>
  </div>
</template>

<style scoped>
.shell {
  display: flex;
  min-height: 100%;
}

.sidebar {
  display: flex;
  flex-direction: column;
  width: 220px;
  flex-shrink: 0;
  background: var(--sidebar-bg);
  color: var(--sidebar-text);
  transition: width 0.16s ease;
}

.sidebar-collapsed .sidebar {
  width: 60px;
}

.brand {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 18px 16px;
  border-bottom: 1px solid var(--sidebar-border);
}

.sidebar-collapsed .brand {
  justify-content: center;
  padding: 18px 8px;
}

.brand-mark {
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  flex-shrink: 0;
  border-radius: 8px;
  background: var(--sidebar-active);
  color: #fff;
  font-weight: 700;
  font-size: 13px;
}

.brand-text {
  min-width: 0;
}

.brand-name {
  color: var(--sidebar-text-strong);
  font-weight: 700;
  line-height: 1.2;
}

.brand-sub {
  font-size: 11px;
  color: var(--sidebar-muted);
}

.nav {
  display: flex;
  flex-direction: column;
  padding: 12px 8px;
  gap: 2px;
}

/* 그룹 머리글. 누르는 곳이 아니라 이름표라 흐리게 둔다. */
.nav-group {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 6px;
  padding: 6px 14px 2px;
  color: var(--text-muted);
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
}

/* 서브 메뉴는 그룹 아래로 들여 세운다. 접힌 상태에서는 들일 곳이 없다. */
.nav-item.sub {
  padding-left: 26px;
}

.nav-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 12px;
  border-radius: 6px;
  color: var(--sidebar-text);
  font-size: 13px;
  white-space: nowrap;
  overflow: hidden;
}

.sidebar-collapsed .nav-item {
  justify-content: center;
  padding: 9px 0;
}

.nav-item:hover {
  background: var(--sidebar-hover);
  color: var(--sidebar-text-strong);
}

.nav-item.active {
  background: var(--sidebar-active);
  color: #fff;
}

.nav-icon {
  width: 18px;
  flex-shrink: 0;
  text-align: center;
  font-size: 13px;
}

.sidebar-foot {
  margin-top: auto;
  padding: 12px 8px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.test-badge {
  padding: 6px 10px;
  border-radius: 6px;
  background: #78350f;
  color: #fde68a;
  font-size: 11px;
  font-weight: 600;
  text-align: center;
}

.test-badge.dot {
  padding: 6px 0;
}

.rail-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  padding: 7px 10px;
  border: 1px solid var(--sidebar-border);
  border-radius: 6px;
  background: none;
  color: var(--sidebar-muted);
  font-family: inherit;
  font-size: 12px;
  cursor: pointer;
}

.rail-btn:hover {
  background: var(--sidebar-hover);
  color: var(--sidebar-text-strong);
}

.main {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
}

.topbar {
  position: relative;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 20px;
  background: var(--surface);
  border-bottom: 1px solid var(--border);
  /* 편집기가 '화면 가득' 높이를 계산하려면 이 값이 고정이어야 한다.
     main.css 의 --topbar-height 와 같이 유지할 것. */
  height: var(--topbar-height);
  flex-shrink: 0;
}

.topbar-title {
  font-size: 15px;
  font-weight: 600;
}

.lang-select {
  width: auto;
  padding: 5px 8px;
  font-size: 12px;
}

.who {
  text-align: right;
  line-height: 1.3;
}

.who-name {
  font-size: 13px;
  font-weight: 600;
}

.who-meta {
  font-size: 11px;
  color: var(--text-muted);
}

.content {
  flex: 1;
  padding: 24px;
  min-width: 0;
}

@media (width <= 720px) {
  .who {
    display: none;
  }
}
</style>
