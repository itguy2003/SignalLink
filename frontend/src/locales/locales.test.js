/**
 * 로케일 파일 정합성 테스트.
 *
 * 한국어가 원본이고 나머지는 번역본이다. 키가 어긋나면 화면 일부만 한국어로
 * 남거나(폴백) 아무도 안 쓰는 번역이 쌓인다. 그것을 사람 눈이 아니라
 * 테스트가 잡게 한다.
 *
 * 언어를 늘릴 때는 `TRANSLATIONS` 에 한 줄 더하면 모든 검사가 그 언어에도
 * 적용된다 — 언어마다 검사를 베껴 쓰면 새 언어가 검사에서 빠진 채 들어온다.
 */
import { describe, expect, it } from 'vitest'

import en from './en.json'
import ja from './ja.json'
import ko from './ko.json'
import zh from './zh.json'

/** 원본(한국어)의 번역본들. 코드 → 사전. */
const TRANSLATIONS = { en, ja, zh }

/** 중첩 객체를 'a.b.c' 형태의 평면 키 목록으로 만든다. */
function flatten(obj, prefix = '') {
  const keys = []
  for (const [key, value] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      keys.push(...flatten(value, path))
    } else {
      keys.push(path)
    }
  }
  return keys
}

function get(obj, path) {
  return path.split('.').reduce((acc, part) => acc?.[part], obj)
}

/** "{count}건" -> ['count'] */
function placeholders(text) {
  return [...String(text).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort()
}

const koKeys = flatten(ko)

describe('로케일 키 정합성', () => {
  it('빈 문자열 값이 없다', () => {
    const empty = koKeys.filter((key) => !String(get(ko, key)).trim())
    expect(empty).toEqual([])
  })

  for (const [code, messages] of Object.entries(TRANSLATIONS)) {
    const keys = flatten(messages)

    describe(code, () => {
      it('빠진 키가 없다', () => {
        const missing = koKeys.filter((key) => !keys.includes(key))
        expect(missing).toEqual([])
      })

      it('남는 키가 없다', () => {
        const extra = keys.filter((key) => !koKeys.includes(key))
        expect(extra).toEqual([])
      })

      it('빈 문자열 값이 없다', () => {
        const empty = keys.filter((key) => !String(get(messages, key)).trim())
        expect(empty).toEqual([])
      })

      it('치환 변수가 원본과 일치한다', () => {
        // {count} 를 한쪽에서 빠뜨리면 그 언어에서만 숫자가 사라진다.
        const mismatched = koKeys.filter(
          (key) =>
            placeholders(get(ko, key)).join(',') !== placeholders(get(messages, key)).join(','),
        )
        expect(mismatched).toEqual([])
      })
    })
  }
})

describe('열거형 번역', () => {
  // 서버가 값으로 쓰는 한국어 코드들. 이 표에 빠지면 화면에 키가 그대로 노출된다.
  const SERVER_ENUMS = {
    orgType: ['기관', '학교', '기타'],
    schoolLevel: ['초', '중', '고'],
    userStatus: ['승인', '미승인'],
    role: ['SUPER_ADMIN', 'ORG_ADMIN', 'DEVICE_MANAGER', 'HOMEROOM_TEACHER', 'MEMBER'],
    os: ['Windows', 'Android', 'IOS'],
    formFactor: ['키오스크형', 'DID형'],
    panelType: ['LANDSCAPE', 'PORTRAIT'],
    placeKind: ['교실', '기타'],
    deviceKind: ['일반', '전자칠판'],
    scheduleKind: ['시간지정', '목록반복'],
    boardKind: ['게시판', '일정', '급식메뉴', '시간표'],
    scrapeResult: ['성공', '실패'],
    widgetCategory: ['기능형', '콘텐츠형'],
  }

  const ALL = { ko, ...TRANSLATIONS }

  for (const [group, values] of Object.entries(SERVER_ENUMS)) {
    it(`${group} 의 모든 서버 값이 전 언어에 있다`, () => {
      for (const value of values) {
        for (const [code, messages] of Object.entries(ALL)) {
          expect(
            get(messages, `enums.${group}.${value}`),
            `${code}.enums.${group}.${value}`,
          ).toBeTruthy()
        }
      }
    })
  }
})

describe('번역 품질', () => {
  // 기관 등록 엑셀 헤더처럼 실제 한국어 컬럼명을 안내해야 하는 곳은 예외다.
  const KEEPS_KOREAN = ['org.upload.headers', 'org.upload.headersNote']

  /**
   * 원본과 같아도 정상인 키.
   *
   * 고유명사와, 그 언어에서도 같은 형태로 쓰는 기술 용어·단위다. 한자를 쓰는
   * 언어는 한국어 한자어와 표기가 겹치는 낱말이 많아, 언어별로 따로 둔다.
   */
  const SAME_OK = {
    // board.urlPlaceholder('https://…')는 언어 중립인 URL 형태 안내다.
    en: ['app.name', 'app.edition', 'device.cpu', 'transition.ms', 'board.urlPlaceholder'],
    ja: ['app.name', 'app.edition', 'device.cpu', 'transition.ms', 'board.urlPlaceholder'],
    zh: ['app.name', 'app.edition', 'device.cpu', 'board.urlPlaceholder'],
  }

  for (const [code, messages] of Object.entries(TRANSLATIONS)) {
    describe(code, () => {
      it('한글이 남아 있지 않다', () => {
        const leftover = flatten(messages).filter(
          (key) => !KEEPS_KOREAN.includes(key) && /[가-힣]/.test(String(get(messages, key))),
        )
        expect(leftover).toEqual([])
      })

      it('원본을 그대로 베껴 둔 값이 없다', () => {
        const allowed = new Set(SAME_OK[code])
        const identical = koKeys.filter(
          (key) =>
            !allowed.has(key) &&
            !key.startsWith('enums.os.') &&
            String(get(ko, key)) === String(get(messages, key)),
        )
        expect(identical).toEqual([])
      })
    })
  }
})
