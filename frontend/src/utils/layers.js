/**
 * 레이어(요소 겹침 순서) 관리.
 *
 * 캔버스의 요소는 ``rect.z`` 로 앞뒤가 정해진다. 레이어 목록은 이것을
 * 사람이 다루기 쉬운 형태 — 위에 있는 것이 앞에 보이는 목록 — 로 바꾼다.
 *
 * 순서를 바꿀 때마다 z 를 1..n 으로 다시 매긴다. 사용자가 손으로 넣은 z 값이
 * 중복되거나 띄엄띄엄해도 목록 순서와 화면 순서가 어긋나지 않게 하기 위해서다.
 *
 * ``visible`` 은 표출 여부라 플레이어도 지켜야 하고, ``locked`` 는 편집기에서
 * 실수로 옮기는 것을 막는 용도라 플레이어와 무관하다
 * (backend/app/schemas/content.py 의 ContentElement 참조).
 */

/** 화면 앞에 있는 것이 먼저 오는 목록(레이어 패널 표시 순서). */
export function layerOrder(elements) {
  return [...(elements ?? [])].sort((a, b) => {
    const az = a.rect?.z ?? 0
    const bz = b.rect?.z ?? 0
    if (az !== bz) return bz - az
    // z 가 같으면 나중에 추가된 것이 위로 온다(배열 순서 유지).
    return 0
  })
}

/** z 를 1..n 으로 다시 매긴다. ``top`` 이 앞(가장 큰 z). */
export function assignZ(topFirst) {
  const count = topFirst.length
  topFirst.forEach((element, index) => {
    element.rect = { ...element.rect, z: count - index }
  })
  return topFirst
}

/**
 * 레이어 목록에서 ``from`` 을 ``to`` 자리로 옮기고 z 를 다시 매긴다.
 *
 * ``to`` 는 "이 레이어 앞에 끼운다"는 뜻이라, 아래로 옮길 때는 자기 자신이
 * 빠진 만큼 목표가 한 칸 당겨진다(재생 목록의 moveItem 과 같은 규칙).
 */
export function moveLayer(elements, from, to) {
  const ordered = layerOrder(elements)
  if (from < 0 || from >= ordered.length) return false
  if (from === to || from + 1 === to) return false

  const [moved] = ordered.splice(from, 1)
  ordered.splice(from < to ? to - 1 : to, 0, moved)
  assignZ(ordered)
  return true
}

/** 한 칸 앞/뒤로. offset -1 이 앞(위), +1 이 뒤(아래). */
export function nudgeLayer(elements, elementId, offset) {
  const ordered = layerOrder(elements)
  const index = ordered.findIndex((element) => element.id === elementId)
  if (index < 0) return false

  const target = index + offset
  if (target < 0 || target >= ordered.length) return false

  const [moved] = ordered.splice(index, 1)
  ordered.splice(target, 0, moved)
  assignZ(ordered)
  return true
}

/** 맨 앞 / 맨 뒤로. */
export function sendLayerTo(elements, elementId, position) {
  const ordered = layerOrder(elements)
  const index = ordered.findIndex((element) => element.id === elementId)
  if (index < 0) return false
  if (position === 'front' && index === 0) return false
  if (position === 'back' && index === ordered.length - 1) return false

  const [moved] = ordered.splice(index, 1)
  if (position === 'front') ordered.unshift(moved)
  else ordered.push(moved)
  assignZ(ordered)
  return true
}

export function isVisible(element) {
  // 예전 문서에는 필드가 없다. 없으면 보이는 것으로 본다.
  return element?.visible !== false
}

export function isLocked(element) {
  return element?.locked === true
}

/** 화면에 실제로 그릴 요소만. 숨긴 것은 장치에서도 나오지 않는다. */
export function visibleElements(elements) {
  return (elements ?? []).filter(isVisible)
}

/** 레이어 이름. 텍스트는 내용 앞부분, 위젯은 위젯 이름을 쓴다. */
export function layerLabel(element, { widgetName, fallback } = {}) {
  if (!element) return fallback ?? ''

  if (element.type === 'text') {
    const text = String(element.options?.text ?? '').trim()
    if (text) return text.length > 18 ? `${text.slice(0, 18)}…` : text
  }
  if (element.type === 'widget') {
    return widgetName?.(element.widget_key) ?? element.widget_key ?? fallback ?? ''
  }
  if (element.src) {
    // 주소는 파일 이름만 보여 준다. 전체 URL 은 목록에서 읽을 수 없다.
    const name = element.src.split('/').pop()
    if (name) return name.length > 18 ? `${name.slice(0, 18)}…` : name
  }
  return fallback ?? element.type
}
