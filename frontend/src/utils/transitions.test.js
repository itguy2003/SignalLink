/**
 * 전환 효과 규약 테스트.
 *
 * 이름과 시간의 범위는 **서버가 정한다**(`app/services/transitions.py`). 이
 * 값을 실제로 그리는 쪽이 브라우저 미리보기 하나가 아니라 플레이어 전부
 * (JS / .NET WPF / Flutter)여서, 각자 제 이름을 쓰면 같은 재생목록이 장치마다
 * 다르게 넘어간다. 그래서 여기서 보는 것은 "서버와 같은 규약인가"다.
 */
import { describe, expect, it } from 'vitest'

import {
  CROSSFADE,
  DEFAULT_TRANSITION,
  MAX_TRANSITION_MS,
  MIN_TRANSITION_MS,
  TRANSITIONS,
  TRANSITION_GROUPS,
  crossfades,
  enterStyle,
  exitStyle,
  fitsIn,
  groupKey,
  labelKey,
  normalize,
  normalizeMs,
  restStyle,
} from './transitions'

describe('이름', () => {
  it('묶음에 든 것이 곧 전체 목록이다', () => {
    // 둘이 어긋나면 고를 수는 있는데 저장이 안 되는 효과가 생긴다.
    expect(TRANSITIONS).toEqual(TRANSITION_GROUPS.flatMap((g) => g.kinds))
  })

  it('모르는 이름은 없음으로 떨어뜨린다', () => {
    // 저장된 효과가 뒤에 사라질 수도 있다. 빈 화면보다 낫다.
    expect(normalize('없는효과')).toBe(DEFAULT_TRANSITION)
    expect(normalize(undefined)).toBe(DEFAULT_TRANSITION)
  })

  it('아는 이름은 그대로 둔다', () => {
    expect(normalize('slide-left')).toBe('slide-left')
  })

  it('언어 키는 이름에서 만든다', () => {
    expect(labelKey('slide-left')).toBe('transition.slide_left')
    expect(groupKey('slide')).toBe('transition.group.slide')
  })
})

describe('시간', () => {
  it('범위를 벗어나면 끌어다 맞춘다', () => {
    expect(normalizeMs(0)).toBe(MIN_TRANSITION_MS)
    expect(normalizeMs(99999)).toBe(MAX_TRANSITION_MS)
  })

  it('숫자가 아니면 기본값', () => {
    expect(normalizeMs('빠르게')).toBe(600)
  })

  it('표출 시간보다 긴 전환은 막는다', () => {
    // 3초 머무는 칸에 5초짜리 전환을 걸면 화면이 영영 제자리에 놓이지 않는다.
    expect(fitsIn('fade', 5000, 3)).toBe(false)
    expect(fitsIn('fade', 2000, 3)).toBe(true)
  })

  it('효과가 없으면 시간은 따지지 않는다', () => {
    expect(fitsIn('none', 5000, 1)).toBe(true)
  })
})

describe('밀기는 앞 화면을 밀어낸다', () => {
  // 들어오는 쪽만 움직이면 새 화면이 가장자리에서 나타날 뿐 밀려나는 느낌이
  // 없다 — 페이드와 구별되지 않는 '가장자리 등장' 이 된다.

  it('밀기는 앞 화면을 남겨 둔다', () => {
    for (const kind of ['slide-left', 'slide-right', 'slide-up', 'slide-down']) {
      expect(crossfades(kind), kind).toBe(true)
    }
  })

  it('들어오는 쪽과 나가는 쪽이 같은 방향으로 움직인다', () => {
    // 반대로 움직이면 둘이 갈라지며 가운데가 비어 버린다.
    expect(enterStyle('slide-left').transform).toBe('translateX(100%)')
    expect(exitStyle('slide-left').transform).toBe('translateX(-100%)')

    expect(enterStyle('slide-right').transform).toBe('translateX(-100%)')
    expect(exitStyle('slide-right').transform).toBe('translateX(100%)')
  })

  it('위아래 밀기도 짝이 맞는다', () => {
    expect(enterStyle('slide-up').transform).toBe('translateY(100%)')
    expect(exitStyle('slide-up').transform).toBe('translateY(-100%)')

    expect(enterStyle('slide-down').transform).toBe('translateY(-100%)')
    expect(exitStyle('slide-down').transform).toBe('translateY(100%)')
  })
})

describe('나머지 겹치기', () => {
  it('닦기는 앞 화면을 제자리에 둔다', () => {
    // 새 화면이 그 위를 덮어 가야 닦이는 것이다. 빈 바탕을 덮으면 그냥 등장이다.
    expect(crossfades('wipe-left')).toBe(true)
    expect(exitStyle('wipe-left')).toEqual({})
  })

  it('디졸브는 자리를 지킨 채 사라진다', () => {
    expect(exitStyle('dissolve')).toEqual({ opacity: 0 })
  })

  it('확대·회전 계열은 겹치지 않는다', () => {
    // 들어오는 쪽만 움직여도 뜻이 통한다. 겹치면 살아 있는 위젯이 두 벌 돈다.
    for (const kind of ['zoom', 'zoom-out', 'flip', 'rotate', 'fade', 'blur']) {
      expect(crossfades(kind), kind).toBe(false)
      expect(exitStyle(kind), kind).toEqual({})
    }
  })

  it('겹치는 효과는 모두 목록에 있는 이름이다', () => {
    for (const kind of CROSSFADE) {
      expect(TRANSITIONS, kind).toContain(kind)
    }
  })
})

describe('제자리', () => {
  it('전환이 끝나면 모든 변형을 푼다', () => {
    // 하나라도 남으면 그 화면이 머무는 내내 비뚤어져 보인다.
    expect(restStyle()).toEqual({
      opacity: 1,
      transform: 'none',
      filter: 'none',
      clipPath: 'inset(0 0 0 0)',
    })
  })

  it('효과가 없으면 시작부터 제자리다', () => {
    expect(enterStyle('none')).toEqual({})
  })
})
