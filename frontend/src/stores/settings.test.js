/**
 * 테마 / 언어 / 사이드바 설정 스토어 테스트.
 *
 * localStorage 가 막힌 환경에서도 앱이 죽지 않아야 하므로 그 경우도 함께 본다.
 */
import { setActivePinia, createPinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { i18n } from '@/i18n'
import { SIDEBAR_STATES, THEMES, useSettingsStore } from './settings'

function mockMatchMedia(matches) {
  window.matchMedia = vi.fn().mockImplementation((query) => ({
    matches,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
  }))
}

beforeEach(() => {
  localStorage.clear()
  document.documentElement.removeAttribute('data-theme')
  mockMatchMedia(false)
  setActivePinia(createPinia())
  i18n.global.locale.value = 'ko'
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('테마', () => {
  it('기본값은 시스템 설정을 따른다', () => {
    const settings = useSettingsStore()
    expect(settings.theme).toBe('system')
  })

  it('시스템이 라이트면 라이트로 해소된다', () => {
    const settings = useSettingsStore()
    expect(settings.resolvedTheme).toBe('light')
    expect(settings.isDark).toBe(false)
  })

  it('시스템이 다크면 다크로 해소된다', () => {
    mockMatchMedia(true)
    setActivePinia(createPinia())
    const settings = useSettingsStore()
    expect(settings.resolvedTheme).toBe('dark')
  })

  it('명시적으로 고르면 시스템 설정을 덮는다', () => {
    mockMatchMedia(true)
    setActivePinia(createPinia())
    const settings = useSettingsStore()
    settings.setTheme('light')
    expect(settings.resolvedTheme).toBe('light')
  })

  it('선택한 테마를 문서 루트에 반영한다', () => {
    const settings = useSettingsStore()
    settings.setTheme('dark')
    expect(document.documentElement.dataset.theme).toBe('dark')
    // 브라우저 기본 UI(스크롤바/폼)도 함께 맞춘다.
    expect(document.documentElement.style.colorScheme).toBe('dark')
  })

  it('선택을 저장해 다음 방문에 복원한다', () => {
    useSettingsStore().setTheme('dark')
    setActivePinia(createPinia())
    expect(useSettingsStore().theme).toBe('dark')
  })

  it('토글은 지금 보이는 것의 반대로 바꾼다', () => {
    const settings = useSettingsStore()
    expect(settings.isDark).toBe(false)
    settings.toggleTheme()
    expect(settings.theme).toBe('dark')
    settings.toggleTheme()
    expect(settings.theme).toBe('light')
  })

  it("'system' 에서 토글하면 반대 테마로 고정된다", () => {
    mockMatchMedia(true)
    setActivePinia(createPinia())
    const settings = useSettingsStore()
    expect(settings.theme).toBe('system')
    settings.toggleTheme()
    expect(settings.theme).toBe('light')
  })

  it('알 수 없는 값은 무시한다', () => {
    const settings = useSettingsStore()
    settings.setTheme('rainbow')
    expect(THEMES).toContain(settings.theme)
    expect(settings.theme).toBe('system')
  })

  it('저장된 값이 손상되었으면 기본값으로 돌아간다', () => {
    localStorage.setItem('signallink.theme', 'nonsense')
    setActivePinia(createPinia())
    expect(useSettingsStore().theme).toBe('system')
  })
})

describe('사이드바', () => {
  it('기본은 펼침이다', () => {
    const settings = useSettingsStore()
    expect(settings.sidebar).toBe('expanded')
    expect(settings.sidebarCollapsed).toBe(false)
    expect(settings.sidebarHidden).toBe(false)
  })

  it('토글은 펼침과 아이콘만 사이를 오간다', () => {
    const settings = useSettingsStore()
    settings.toggleSidebar()
    expect(settings.sidebar).toBe('collapsed')
    expect(settings.sidebarCollapsed).toBe(true)
    settings.toggleSidebar()
    expect(settings.sidebar).toBe('expanded')
  })

  it('완전히 숨길 수 있다', () => {
    const settings = useSettingsStore()
    settings.setSidebar('hidden')
    expect(settings.sidebarHidden).toBe(true)
    expect(settings.sidebarCollapsed).toBe(false)
  })

  it('숨김 상태에서 토글하면 펼침으로 돌아온다', () => {
    // 접기 버튼은 사이드바 안에 있어 숨김 상태에서는 눌리지 않는다.
    // 그래도 프로그램적으로 불릴 수 있으므로, 사용자가 다시 볼 수 있는
    // 상태(펼침)로 복귀시킨다. 여기서 'collapsed' 로 가면 숨겼다 되돌렸을 때
    // 왜 좁아졌는지 알 수 없다.
    const settings = useSettingsStore()
    settings.setSidebar('hidden')
    settings.toggleSidebar()
    expect(settings.sidebar).toBe('expanded')
  })

  it('상태를 저장해 다음 방문에 복원한다', () => {
    useSettingsStore().setSidebar('collapsed')
    setActivePinia(createPinia())
    expect(useSettingsStore().sidebar).toBe('collapsed')
  })

  it('알 수 없는 상태는 무시한다', () => {
    const settings = useSettingsStore()
    settings.setSidebar('floating')
    expect(SIDEBAR_STATES).toContain(settings.sidebar)
    expect(settings.sidebar).toBe('expanded')
  })
})

describe('언어', () => {
  it('바꾸면 i18n 로케일이 따라간다', () => {
    const settings = useSettingsStore()
    settings.setLocale('en')
    expect(i18n.global.locale.value).toBe('en')
    expect(settings.locale).toBe('en')
  })

  it('문서 lang 속성을 갱신한다', () => {
    useSettingsStore().setLocale('en')
    expect(document.documentElement.getAttribute('lang')).toBe('en')
  })

  it('지원하지 않는 언어는 무시한다', () => {
    const settings = useSettingsStore()
    settings.setLocale('fr')
    expect(settings.locale).toBe('ko')
    expect(i18n.global.locale.value).toBe('ko')
  })

  it('선택을 저장한다', () => {
    useSettingsStore().setLocale('en')
    expect(localStorage.getItem('signallink.locale')).toBe('en')
  })
})

describe('localStorage 를 쓸 수 없는 환경', () => {
  it('읽기가 막혀도 기본값으로 동작한다', () => {
    // 사생활 보호 모드 등에서 접근 자체가 예외를 던진다.
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('access denied')
    })
    setActivePinia(createPinia())
    const settings = useSettingsStore()
    expect(settings.theme).toBe('system')
    expect(settings.sidebar).toBe('expanded')
    spy.mockRestore()
  })

  it('쓰기가 막혀도 설정 변경이 죽지 않는다', () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota exceeded')
    })
    const settings = useSettingsStore()
    expect(() => settings.setTheme('dark')).not.toThrow()
    // 이번 세션에서는 정상 적용된다(저장만 안 될 뿐).
    expect(settings.resolvedTheme).toBe('dark')
    spy.mockRestore()
  })
})
