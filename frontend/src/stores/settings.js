/**
 * 화면 환경설정: 테마, 언어, 사이드바 상태.
 *
 * 모두 브라우저 localStorage 에만 저장한다. 서버 계정 설정이 아니라
 * 이 브라우저에서의 보기 취향이기 때문이다. 저장이 막힌 환경에서도
 * 동작해야 하므로 읽기/쓰기를 전부 try 로 감싼다.
 */

import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'

import { applyDocumentLocale, i18n, storeLocale, SUPPORTED_LOCALES } from '@/i18n'
import { DEFAULT_GRID_SIZE, GRID_SIZES } from '@/utils/canvasGrid'
import { DEFAULT_SLOT_MINUTES, SLOT_CHOICES } from '@/utils/scheduleGrid'

const KEYS = {
  theme: 'signallink.theme',
  sidebar: 'signallink.sidebar',
  gridShow: 'signallink.grid.show',
  gridSnap: 'signallink.grid.snap',
  gridSize: 'signallink.grid.size',
  slotMinutes: 'signallink.schedule.slot',
  previewSize: 'signallink.preview.size',
  autoSave: 'signallink.editor.autosave',
}

/**
 * 미리보기 창 크기. 모달 폭과 무대 높이를 함께 정한다.
 *
 * 폭만 키우면 가로형 화면이 위아래로 남고, 높이만 키우면 좌우가 남는다 —
 * 표출 화면은 비율이 정해져 있어 둘을 같이 움직여야 실제로 커진다.
 */
export const PREVIEW_SIZES = {
  s: { width: '820px', stage: '32vh' },
  m: { width: '1040px', stage: '46vh' },
  l: { width: '1280px', stage: '60vh' },
  xl: { width: '96vw', stage: '74vh' },
}

/** 'light' | 'dark' | 'system' */
export const THEMES = ['light', 'dark', 'system']

/** 'expanded' | 'collapsed' | 'hidden' */
export const SIDEBAR_STATES = ['expanded', 'collapsed', 'hidden']

function readStored(key, allowed, fallback) {
  try {
    const value = localStorage.getItem(key)
    return allowed.includes(value) ? value : fallback
  } catch {
    return fallback
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, value)
  } catch {
    // 저장 실패는 무시한다(이번 세션에만 적용).
  }
}

const prefersDark = () =>
  typeof window !== 'undefined' && window.matchMedia
    ? window.matchMedia('(prefers-color-scheme: dark)').matches
    : false

function readFlag(key, fallback) {
  try {
    const value = localStorage.getItem(key)
    return value === null ? fallback : value === 'true'
  } catch {
    return fallback
  }
}

function readNumber(key, allowed, fallback) {
  try {
    const value = Number(localStorage.getItem(key))
    return allowed.includes(value) ? value : fallback
  } catch {
    return fallback
  }
}

export const useSettingsStore = defineStore('settings', () => {
  const theme = ref(readStored(KEYS.theme, THEMES, 'system'))
  const sidebar = ref(readStored(KEYS.sidebar, SIDEBAR_STATES, 'expanded'))
  const locale = ref(i18n.global.locale.value)
  const systemDark = ref(prefersDark())

  // 편집기 그리드는 콘텐츠가 아니라 편집 취향이라 여기에 둔다.
  const gridShow = ref(readFlag(KEYS.gridShow, true))
  const gridSnap = ref(readFlag(KEYS.gridSnap, true))

  /**
   * 편집기 자동 저장. 기본은 켜짐 — 한 번 열면 오래 머무는 화면이라, 저장을
   * 잊는 쪽이 기억하는 쪽보다 흔하다.
   *
   * 끌 수 있게 두는 이유는 저장이 곧 배포이기 때문이다. 이 콘텐츠를 쓰는
   * 스케줄의 버전이 함께 올라가 장치가 다음 하트비트에 받아 간다 — 다 만들기
   * 전까지는 내보내고 싶지 않을 때가 있다.
   */
  const autoSave = ref(readFlag(KEYS.autoSave, true))
  const gridSize = ref(readNumber(KEYS.gridSize, GRID_SIZES, DEFAULT_GRID_SIZE))

  // 주간 편집기의 시간 분할. 매번 다시 고르게 하면 쓰던 사람이 번거롭다.
  const slotMinutes = ref(readNumber(KEYS.slotMinutes, SLOT_CHOICES, DEFAULT_SLOT_MINUTES))

  // 미리보기 창 크기도 같은 이유로 남긴다.
  const previewSize = ref(readStored(KEYS.previewSize, Object.keys(PREVIEW_SIZES), 'm'))

  /** 실제로 적용되는 테마('system' 을 해소한 결과). */
  const resolvedTheme = computed(() =>
    theme.value === 'system' ? (systemDark.value ? 'dark' : 'light') : theme.value,
  )

  const isDark = computed(() => resolvedTheme.value === 'dark')
  const sidebarCollapsed = computed(() => sidebar.value === 'collapsed')
  const sidebarHidden = computed(() => sidebar.value === 'hidden')

  function applyTheme() {
    // CSS 는 :root[data-theme] 로 팔레트를 바꾼다.
    document.documentElement.dataset.theme = resolvedTheme.value
    // 폼 컨트롤/스크롤바 같은 브라우저 기본 UI 도 함께 맞춘다.
    document.documentElement.style.colorScheme = resolvedTheme.value
  }

  function setTheme(next) {
    if (!THEMES.includes(next)) return
    theme.value = next
    write(KEYS.theme, next)
    applyTheme()
  }

  function toggleTheme() {
    // 순환하지 않고 현재 보이는 것의 반대로 바꾼다. 'system' 이어도 의도가 분명해진다.
    setTheme(isDark.value ? 'light' : 'dark')
  }

  function setSidebar(next) {
    if (!SIDEBAR_STATES.includes(next)) return
    sidebar.value = next
    write(KEYS.sidebar, next)
  }

  /** 펼침 <-> 아이콘만. 완전히 숨기는 것은 setSidebar('hidden'). */
  function toggleSidebar() {
    setSidebar(sidebar.value === 'expanded' ? 'collapsed' : 'expanded')
  }

  function setLocale(next) {
    if (!SUPPORTED_LOCALES.some((l) => l.code === next)) return
    locale.value = next
    i18n.global.locale.value = next
    storeLocale(next)
    applyDocumentLocale(next)
  }

  /** 앱 시작 시 한 번 호출한다. 시스템 테마 변경도 여기서 구독한다. */
  function init() {
    applyTheme()
    applyDocumentLocale(locale.value)

    if (typeof window !== 'undefined' && window.matchMedia) {
      const query = window.matchMedia('(prefers-color-scheme: dark)')
      const onChange = (event) => {
        systemDark.value = event.matches
      }
      // Safari 14 미만은 addEventListener 를 지원하지 않는다.
      if (query.addEventListener) query.addEventListener('change', onChange)
      else query.addListener(onChange)
    }
  }

  // 시스템 테마가 바뀌면 'system' 모드에서 즉시 반영된다.
  watch(resolvedTheme, applyTheme)

  function setGridShow(value) {
    gridShow.value = Boolean(value)
    write(KEYS.gridShow, String(gridShow.value))
  }

  function setAutoSave(value) {
    autoSave.value = Boolean(value)
    write(KEYS.autoSave, String(autoSave.value))
  }

  function setGridSnap(value) {
    gridSnap.value = Boolean(value)
    write(KEYS.gridSnap, String(gridSnap.value))
  }

  function setSlotMinutes(value) {
    const minutes = Number(value)
    if (!SLOT_CHOICES.includes(minutes)) return
    slotMinutes.value = minutes
    write(KEYS.slotMinutes, String(minutes))
  }

  function setPreviewSize(value) {
    if (!PREVIEW_SIZES[value]) return
    previewSize.value = value
    write(KEYS.previewSize, value)
  }

  function setGridSize(value) {
    const size = Number(value)
    if (!GRID_SIZES.includes(size)) return
    gridSize.value = size
    write(KEYS.gridSize, String(size))
  }

  return {
    theme,
    resolvedTheme,
    isDark,
    sidebar,
    sidebarCollapsed,
    sidebarHidden,
    locale,
    gridShow,
    gridSnap,
    autoSave,
    gridSize,
    slotMinutes,
    setSlotMinutes,
    previewSize,
    setPreviewSize,
    setTheme,
    toggleTheme,
    setSidebar,
    toggleSidebar,
    setLocale,
    setGridShow,
    setGridSnap,
    setAutoSave,
    setGridSize,
    init,
  }
})
