/**
 * 화면 방향(가로형/세로형).
 *
 * 스케줄은 방향을 명시적으로 갖고, 콘텐츠는 편집 해상도에서 방향이 나온다.
 * 스케줄에는 **같은 방향의 콘텐츠만** 붙일 수 있다 — 가로 콘텐츠를 세로
 * 화면에 태우면 위아래에 검은 띠만 남고 글자는 읽을 수 없게 작아진다.
 * 플레이어는 균일 스케일링만 하므로 이 어긋남을 보정해 주지 않는다.
 *
 * 판정 기준은 백엔드 `app/services/orientation.py` 와 **같아야 한다**.
 * 어긋나면 화면에서는 붙던 콘텐츠가 저장에서 거부된다. 최종 판정은 언제나
 * 서버가 하고, 여기 있는 것은 그 전에 알려 주기 위한 것이다.
 */

export const LANDSCAPE = 'LANDSCAPE'
export const PORTRAIT = 'PORTRAIT'

/** 콘텐츠 목록 API(`GET /contents`)의 orientation 질의값. */
const QUERY = { [LANDSCAPE]: 'landscape', [PORTRAIT]: 'portrait' }

export function toQuery(value) {
  return QUERY[value] ?? ''
}

/**
 * 크기로 방향을 정한다.
 *
 * 정사각형은 가로형으로 본다 — 한쪽으로 정해 두지 않으면 1:1 콘텐츠가
 * 어느 스케줄에도 못 붙는다. 백엔드 `Content.is_portrait` 와 같은 기준이다.
 */
export function ofSize(width, height) {
  return height > width ? PORTRAIT : LANDSCAPE
}

/** 콘텐츠(목록 항목)의 방향. */
export function ofContent(content) {
  return ofSize(content?.width ?? 0, content?.height ?? 0)
}

/**
 * 콘텐츠 문서(layout)의 방향. 크기를 알 수 없으면 null.
 *
 * null 은 "따질 수 없다"는 뜻이지 "틀렸다"가 아니다. 아직 아무것도 배치하지
 * 않은 빈 아이템까지 막으면 편집을 시작할 수 없다.
 */
export function ofDocument(document) {
  const layout = document?.layout
  if (!layout) return null
  const { width, height } = layout
  if (typeof width !== 'number' || typeof height !== 'number') return null
  if (width <= 0 || height <= 0) return null
  return ofSize(width, height)
}

/** 그 방향의 기본 편집 해상도. 새 콘텐츠를 만들 때 쓴다. */
export function defaultSize(value) {
  return value === PORTRAIT ? { width: 1080, height: 1920 } : { width: 1920, height: 1080 }
}

/** 이 콘텐츠를 그 방향의 스케줄에 넣을 수 있는가. */
export function matches(content, scheduleOrientation) {
  return ofContent(content) === scheduleOrientation
}

/** i18n 키. `content.landscape` / `content.portrait` 를 재사용한다. */
export function labelKey(value) {
  return value === PORTRAIT ? 'content.portrait' : 'content.landscape'
}
