/**
 * 다국어(i18n) 설정.
 *
 * 한국어가 원본이고 나머지는 번역본이다. 키가 빠진 언어는 한국어로 폴백한다.
 * 언어를 늘릴 때는 `src/locales/<code>.json` 을 만들고 아래 두 곳
 * (import 와 SUPPORTED_LOCALES, messages)에 더하면 된다. 키 누락과 미번역은
 * `src/locales/locales.test.js` 가 잡는다.
 *
 * 서버가 만든 메시지(검증 오류, 권한 거부 등)는 한국어 그대로 내려온다.
 * 그것까지 번역하려면 백엔드가 Accept-Language 를 처리해야 한다.
 * 여기서 다루는 것은 화면 문자열과, 서버가 값으로 쓰는 한국어 열거형뿐이다.
 */

import { createI18n } from 'vue-i18n'

import en from '@/locales/en.json'
import ja from '@/locales/ja.json'
import ko from '@/locales/ko.json'
import zh from '@/locales/zh.json'

export const SUPPORTED_LOCALES = [
  // label 은 그 언어 사용자가 읽는 이름이다 — 모르는 언어로 적혀 있으면
  // 자기 언어를 찾지 못한다.
  { code: 'ko', label: '한국어', flag: 'KO' },
  { code: 'en', label: 'English', flag: 'EN' },
  { code: 'ja', label: '日本語', flag: 'JA' },
  { code: 'zh', label: '中文', flag: 'ZH' },
]

export const DEFAULT_LOCALE = 'ko'
const STORAGE_KEY = 'signallink.locale'

export function readStoredLocale() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored && SUPPORTED_LOCALES.some((l) => l.code === stored)) return stored
  } catch {
    // 사생활 보호 모드 등에서 localStorage 접근이 막힐 수 있다. 기본값으로 간다.
  }
  return detectBrowserLocale()
}

export function storeLocale(code) {
  try {
    localStorage.setItem(STORAGE_KEY, code)
  } catch {
    // 저장 실패는 무시한다. 이번 세션에만 적용된다.
  }
}

function detectBrowserLocale() {
  const candidates = navigator?.languages ?? [navigator?.language]
  for (const candidate of candidates) {
    if (!candidate) continue
    const base = candidate.toLowerCase().split('-')[0]
    if (SUPPORTED_LOCALES.some((l) => l.code === base)) return base
  }
  return DEFAULT_LOCALE
}

export const i18n = createI18n({
  legacy: false,
  globalInjection: true,
  locale: readStoredLocale(),
  fallbackLocale: DEFAULT_LOCALE,
  messages: { ko, en, ja, zh },
  // 폴백이 일어나도 콘솔을 더럽히지 않는다. 누락 키는 테스트로 잡는다.
  missingWarn: false,
  fallbackWarn: false,
})

/** ``<html lang>`` 을 맞춰 준다. 스크린리더와 브라우저 번역이 이 값을 본다. */
export function applyDocumentLocale(code) {
  document.documentElement.setAttribute('lang', code)
}

applyDocumentLocale(i18n.global.locale.value)
