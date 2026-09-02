import { describe, expect, it } from 'vitest'

import {
  assignZ,
  isLocked,
  isVisible,
  layerLabel,
  layerOrder,
  moveLayer,
  nudgeLayer,
  sendLayerTo,
  visibleElements,
} from './layers'

const el = (id, z, extra = {}) => ({
  id,
  type: 'text',
  rect: { x: 0, y: 0, w: 10, h: 10, z },
  options: {},
  ...extra,
})

/** 목록 순서를 id 로 뽑아 비교하기 쉽게. */
const ids = (elements) => layerOrder(elements).map((e) => e.id)

describe('레이어 순서', () => {
  it('앞에 보이는 것(z 가 큰 것)이 목록 위에 온다', () => {
    expect(ids([el('a', 1), el('b', 3), el('c', 2)])).toEqual(['b', 'c', 'a'])
  })

  it('원본 배열을 건드리지 않는다', () => {
    const elements = [el('a', 1), el('b', 3)]
    layerOrder(elements)
    expect(elements.map((e) => e.id)).toEqual(['a', 'b'])
  })

  it('z 가 없어도 처리한다', () => {
    const broken = { id: 'x', type: 'text', rect: {} }
    expect(ids([broken, el('a', 5)])).toEqual(['a', 'x'])
  })

  it('빈 입력도 안전하다', () => {
    expect(layerOrder(undefined)).toEqual([])
  })
})

describe('z 다시 매기기', () => {
  it('맨 위가 가장 큰 z 를 받는다', () => {
    const ordered = [el('a', 99), el('b', 4), el('c', 4)]
    assignZ(ordered)
    expect(ordered.map((e) => e.rect.z)).toEqual([3, 2, 1])
  })

  it('중복되거나 띄엄띄엄한 z 도 정리된다', () => {
    // 손으로 z 를 넣어 겹쳐 놓으면 목록 순서와 화면 순서가 어긋난다.
    const elements = [el('a', 7), el('b', 7), el('c', 7)]
    assignZ(layerOrder(elements))
    expect(new Set(elements.map((e) => e.rect.z)).size).toBe(3)
  })
})

describe('레이어 옮기기', () => {
  it('아래 것을 맨 위로 끌어 올린다', () => {
    const elements = [el('a', 3), el('b', 2), el('c', 1)]
    expect(moveLayer(elements, 2, 0)).toBe(true)
    expect(ids(elements)).toEqual(['c', 'a', 'b'])
  })

  it('아래로 옮길 때 자리 보정을 한다', () => {
    const elements = [el('a', 3), el('b', 2), el('c', 1)]
    moveLayer(elements, 0, 2)
    expect(ids(elements)).toEqual(['b', 'a', 'c'])
  })

  it('맨 뒤로 보낸다', () => {
    const elements = [el('a', 3), el('b', 2), el('c', 1)]
    moveLayer(elements, 0, 3)
    expect(ids(elements)).toEqual(['b', 'c', 'a'])
  })

  it('제자리면 아무것도 하지 않는다', () => {
    const elements = [el('a', 3), el('b', 2)]
    expect(moveLayer(elements, 0, 0)).toBe(false)
    expect(moveLayer(elements, 0, 1)).toBe(false)
  })

  it('범위 밖 인덱스는 무시한다', () => {
    const elements = [el('a', 1)]
    expect(moveLayer(elements, 5, 0)).toBe(false)
  })
})

describe('한 칸 이동', () => {
  it('앞으로 한 칸', () => {
    const elements = [el('a', 3), el('b', 2), el('c', 1)]
    expect(nudgeLayer(elements, 'c', -1)).toBe(true)
    expect(ids(elements)).toEqual(['a', 'c', 'b'])
  })

  it('뒤로 한 칸', () => {
    const elements = [el('a', 3), el('b', 2), el('c', 1)]
    nudgeLayer(elements, 'a', 1)
    expect(ids(elements)).toEqual(['b', 'a', 'c'])
  })

  it('맨 위에서 더 앞으로는 못 간다', () => {
    const elements = [el('a', 2), el('b', 1)]
    expect(nudgeLayer(elements, 'a', -1)).toBe(false)
    expect(ids(elements)).toEqual(['a', 'b'])
  })

  it('없는 요소는 무시한다', () => {
    expect(nudgeLayer([el('a', 1)], 'zzz', -1)).toBe(false)
  })
})

describe('맨 앞 / 맨 뒤', () => {
  it('맨 앞으로 보낸다', () => {
    const elements = [el('a', 3), el('b', 2), el('c', 1)]
    expect(sendLayerTo(elements, 'c', 'front')).toBe(true)
    expect(ids(elements)).toEqual(['c', 'a', 'b'])
  })

  it('맨 뒤로 보낸다', () => {
    const elements = [el('a', 3), el('b', 2), el('c', 1)]
    sendLayerTo(elements, 'a', 'back')
    expect(ids(elements)).toEqual(['b', 'c', 'a'])
  })

  it('이미 그 자리면 아무것도 하지 않는다', () => {
    const elements = [el('a', 2), el('b', 1)]
    expect(sendLayerTo(elements, 'a', 'front')).toBe(false)
    expect(sendLayerTo(elements, 'b', 'back')).toBe(false)
  })
})

describe('표시와 잠금', () => {
  it('필드가 없으면 보이는 것으로 본다', () => {
    // 이 기능이 생기기 전에 저장된 문서가 통째로 사라지면 안 된다.
    expect(isVisible(el('a', 1))).toBe(true)
    expect(isLocked(el('a', 1))).toBe(false)
  })

  it('숨긴 요소는 그리지 않는다', () => {
    const elements = [el('a', 2), el('b', 1, { visible: false })]
    expect(visibleElements(elements).map((e) => e.id)).toEqual(['a'])
  })

  it('잠금은 표시에 영향이 없다', () => {
    const locked = el('a', 1, { locked: true })
    expect(isLocked(locked)).toBe(true)
    expect(visibleElements([locked])).toHaveLength(1)
  })
})

describe('레이어 이름', () => {
  it('텍스트는 내용을 보여 준다', () => {
    expect(layerLabel(el('a', 1, { options: { text: '가나초등학교 알림판' } }))).toBe(
      '가나초등학교 알림판',
    )
  })

  it('긴 텍스트는 줄인다', () => {
    const long = '아주아주아주아주아주아주아주아주 긴 제목입니다'
    expect(layerLabel(el('a', 1, { options: { text: long } }))).toHaveLength(19)
  })

  it('빈 텍스트는 대체 이름을 쓴다', () => {
    expect(layerLabel(el('a', 1, { options: { text: '   ' } }), { fallback: '텍스트' })).toBe(
      '텍스트',
    )
  })

  it('위젯은 위젯 이름을 쓴다', () => {
    const widget = { id: 'w', type: 'widget', widget_key: 'clock', rect: { z: 1 } }
    expect(layerLabel(widget, { widgetName: () => '시계' })).toBe('시계')
  })

  it('이미지는 파일 이름만 보여 준다', () => {
    const image = { id: 'i', type: 'image', src: 'https://cdn.example.com/a/b/photo.png', rect: { z: 1 } }
    expect(layerLabel(image)).toBe('photo.png')
  })

  it('아무것도 없으면 종류를 쓴다', () => {
    expect(layerLabel({ id: 'v', type: 'video', rect: { z: 1 } })).toBe('video')
  })
})
