/**
 * 콘텐츠 / 위젯 카드 드래그 앤 드롭 규약.
 *
 * 커스텀 MIME 을 쓰는 이유: text/plain 만 보면 파일 드래그나 브라우저의 글자
 * 선택 드래그와 구분되지 않아 엉뚱한 드롭이 처리된다.
 *
 * 페이로드는 세 종류다.
 *   { kind: 'content', id, name }                라이브러리의 기존 콘텐츠
 *   { kind: 'widget', key, name, width, height } 위젯 하나를 감싼 새 콘텐츠
 *   { kind: 'playlist', id, name }               재생목록 하나를 감싼 새 콘텐츠
 *
 * 스케줄 아이템은 항상 콘텐츠를 가리키므로, 위젯이나 재생목록을 떨어뜨리면
 * 그것 하나가 화면을 꽉 채우는 콘텐츠를 만들어 붙인다. 그래야 이후 편집·재사용
 * 경로가 콘텐츠와 완전히 같아진다.
 */

export const CONTENT_DND_TYPE = 'application/x-signallink-content'

/**
 * 재생 목록 안에서 항목 순서를 바꿀 때 쓰는 별도 MIME.
 *
 * 라이브러리 카드 드롭(새 항목 추가)과 목록 내부 이동(순서 변경)은 결과가
 * 완전히 다르므로 타입으로 갈라야 한다. 같은 타입으로 두면 어느 쪽인지
 * 페이로드를 열어 봐야 알 수 있고, dragover 단계에서는 값을 읽을 수 없다.
 */
export const PLAYLIST_ITEM_DND_TYPE = 'application/x-signallink-playlist-item'

/** 끌고 있는 것이 우리 카드인가. */
export function isContentDrag(event) {
  return Array.from(event?.dataTransfer?.types ?? []).includes(CONTENT_DND_TYPE)
}

function write(event, payload, label) {
  event.dataTransfer.effectAllowed = 'copy'
  event.dataTransfer.setData(CONTENT_DND_TYPE, JSON.stringify(payload))
  // 일부 브라우저는 text/plain 이 없으면 드래그를 시작조차 하지 않는다.
  event.dataTransfer.setData('text/plain', label)
}

export function writeContentDrag(event, content) {
  write(
    event,
    {
      kind: 'content',
      id: content.id,
      name: content.name,
      // 크기를 함께 실어야 드롭 쪽에서 스케줄 방향과 맞는지 즉시 볼 수 있다.
      // 없으면 서버에 저장할 때까지 어긋남을 알 수 없다.
      width: content.width,
      height: content.height,
    },
    content.name,
  )
}

/**
 * 재생목록 카드를 끌기 시작할 때.
 *
 * 크기를 싣지 않는 이유는 재생목록에 고유한 크기가 없기 때문이다 — 어느
 * 방향의 스케줄에 놓든 그 방향에 맞춰 감싸면 된다.
 */
export function writePlaylistDrag(event, playlist) {
  write(
    event,
    { kind: 'playlist', id: playlist.id, name: playlist.name },
    playlist.name,
  )
}

export function writeWidgetDrag(event, widget, { width = 1920, height = 1080 } = {}) {
  write(
    event,
    { kind: 'widget', key: widget.key, name: widget.name, width, height },
    widget.name,
  )
}

/** 드롭된 카드 정보. 형식이 깨졌으면 null(호출부가 무시한다). */
export function readContentDrag(event) {
  try {
    const parsed = JSON.parse(event.dataTransfer.getData(CONTENT_DND_TYPE))
    if (!parsed || typeof parsed !== 'object') return null
    if (parsed.kind === 'widget' && typeof parsed.key === 'string') return parsed
    if (parsed.kind === 'playlist' && typeof parsed.id === 'number') return parsed
    if (typeof parsed.id === 'number') return { kind: 'content', ...parsed }
    return null
  } catch {
    return null
  }
}

/**
 * 위젯 하나가 화면을 꽉 채우는 콘텐츠 문서를 만든다.
 *
 * ``region: 0`` 을 붙여 두면 나중에 분할을 적용했을 때 첫 영역에 맞춰 따라간다.
 */
export function wrapWidgetAsDocument(widgetKey, { width = 1920, height = 1080 } = {}) {
  return {
    version: 1,
    layout: { width, height, background: '#000000' },
    elements: [
      {
        id: `el-${widgetKey}-${Date.now()}`,
        type: 'widget',
        widget_key: widgetKey,
        rect: { x: 0, y: 0, w: width, h: height, z: 1, rotation: 0 },
        opacity: 1,
        options: {},
        src: null,
        region: 0,
      },
    ],
  }
}

/**
 * 재생목록 하나가 화면을 꽉 채우는 콘텐츠 문서.
 *
 * 문서에는 **참조만** 남긴다(`options.playlist_id`). 서버가 플레이어에게
 * 내려줄 때 실제 칸 목록을 채워 주므로, 재생목록을 고치면 이 스케줄에도
 * 그대로 반영된다 — 콘텐츠를 다시 저장할 필요가 없다.
 */
export function wrapPlaylistAsDocument(playlist, { width = 1920, height = 1080 } = {}) {
  return {
    version: 1,
    layout: { width, height, background: '#000000' },
    elements: [
      {
        id: `el-playlist-${playlist.id}-${Date.now()}`,
        type: 'playlist',
        widget_key: null,
        rect: { x: 0, y: 0, w: width, h: height, z: 1, rotation: 0 },
        opacity: 1,
        options: { playlist_id: playlist.id, playlist_name: playlist.name },
        src: null,
        region: 0,
      },
    ],
  }
}

/** 목록 안에서 항목을 끌기 시작할 때. */
export function writePlaylistItemDrag(event, index) {
  event.dataTransfer.effectAllowed = 'move'
  event.dataTransfer.setData(PLAYLIST_ITEM_DND_TYPE, String(index))
  event.dataTransfer.setData('text/plain', String(index))
}

export function isPlaylistItemDrag(event) {
  return Array.from(event?.dataTransfer?.types ?? []).includes(PLAYLIST_ITEM_DND_TYPE)
}

/** 끌고 온 항목의 원래 위치. 읽을 수 없으면 null. */
export function readPlaylistItemDrag(event) {
  const raw = event.dataTransfer.getData(PLAYLIST_ITEM_DND_TYPE)
  const index = Number(raw)
  return Number.isInteger(index) && index >= 0 ? index : null
}

/**
 * 항목을 ``from`` 에서 ``to`` 자리로 옮긴 새 배열.
 *
 * ``to`` 는 "이 항목 앞에 끼운다"는 뜻이라, 아래로 옮길 때는 자기 자신이
 * 빠진 만큼 목표 위치가 하나 당겨진다. 그 보정을 여기서 한다.
 */
export function moveItem(items, from, to) {
  if (from === to || from + 1 === to) return items
  const next = [...items]
  const [moved] = next.splice(from, 1)
  next.splice(from < to ? to - 1 : to, 0, moved)
  return next
}

/**
 * 편집기 레일에서 캔버스로 요소를 끌어다 놓을 때 쓰는 MIME.
 *
 * 스케줄에 콘텐츠를 놓는 것(CONTENT_DND_TYPE)과 목적이 달라 따로 둔다.
 * 이건 캔버스 안에 요소를 만드는 것이다.
 */
export const ELEMENT_DND_TYPE = 'application/x-signallink-element'

export function writeElementDrag(event, { type, widgetKey = null, label = '' }) {
  event.dataTransfer.effectAllowed = 'copy'
  event.dataTransfer.setData(ELEMENT_DND_TYPE, JSON.stringify({ type, widgetKey }))
  event.dataTransfer.setData('text/plain', label || type)
}

export function isElementDrag(event) {
  return Array.from(event?.dataTransfer?.types ?? []).includes(ELEMENT_DND_TYPE)
}

export function readElementDrag(event) {
  try {
    const parsed = JSON.parse(event.dataTransfer.getData(ELEMENT_DND_TYPE))
    return parsed && typeof parsed.type === 'string' ? parsed : null
  } catch {
    return null
  }
}
