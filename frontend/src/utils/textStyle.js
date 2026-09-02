/**
 * 텍스트 요소의 꾸미기 값.
 *
 * 값은 콘텐츠 문서(JSON)의 `options` 에 그대로 들어가고, 플레이어가 읽어
 * 그린다. 그래서 **CSS 를 그대로 적지 않고 이름을 쓴다** — .NET/WPF 나
 * Flutter 플레이어는 CSS 를 해석하지 않으므로, 브라우저 전용 문자열을
 * 문서에 박아 두면 그 플레이어들이 아무것도 못 한다.
 *
 * 글꼴 파일은 저장소에 넣어 함께 배포한다(`styles/fonts.css`). 폐쇄망에서
 * CDN 이 막히면 서체만 조용히 폴백되어, 편집기에서 고른 것과 장치에 나오는
 * 것이 달라지기 때문이다. 목록에 없는 서체를 자유 입력으로 받지 않는 이유도
 * 같다 — 이름만 적어 둔 서체는 장치에 있을 수도, 없을 수도 있다.
 *
 * `system` 만 예외로 장치에 깔린 서체를 쓴다. 우리가 담지 않은 서체를 쓰는
 * 장치를 위한 탈출구다.
 */

/**
 * 고를 수 있는 글꼴. `stack` 은 브라우저 쪽 구현일 뿐이다.
 *
 * 제목용(`display: true`)은 굵기가 한 벌뿐이라 '굵게' 를 걸면 브라우저가
 * 합성한다. 편집기가 그 사실을 알려 줄 수 있도록 표시해 둔다.
 */
export const FONTS = [
  { key: 'inherit', stack: '' },
  { key: 'score', stack: "'S-Core Dream', sans-serif" },
  { key: 'nanum', stack: "'Nanum Gothic', sans-serif" },
  { key: 'noto', stack: "'Noto Sans KR', sans-serif" },
  { key: 'myeongjo', stack: "'Nanum Myeongjo', serif" },
  { key: 'jua', stack: "'Jua', sans-serif", display: true },
  { key: 'dohyeon', stack: "'Do Hyeon', sans-serif", display: true },
  { key: 'blackhan', stack: "'Black Han Sans', sans-serif", display: true },
  { key: 'pen', stack: "'Nanum Pen Script', cursive", display: true },
  { key: 'system', stack: "'Malgun Gothic', 'Apple SD Gothic Neo', sans-serif" },
  { key: 'mono', stack: "'D2Coding', Consolas, monospace" },
]

/** 굵기가 한 벌뿐이라 '굵게' 가 합성되는 서체인가. */
export function isDisplayFont(key) {
  return Boolean(FONTS.find((f) => f.key === key)?.display)
}

export const DEFAULT_FONT = 'inherit'

export function fontLabelKey(key) {
  return `text.font.${FONTS.some((f) => f.key === key) ? key : DEFAULT_FONT}`
}

function fontStack(key) {
  return FONTS.find((f) => f.key === key)?.stack ?? ''
}

/** 자간·줄간격의 범위. 벗어난 값은 읽기 어려워지기만 한다. */
export const LINE_HEIGHT = { min: 0.8, max: 3, step: 0.1, default: 1.2 }
export const LETTER_SPACING = { min: -0.1, max: 1, step: 0.01, default: 0 }

/**
 * 텍스트 요소에 입힐 CSS.
 *
 * 값이 없는 항목은 아예 넣지 않는다 — 빈 문자열을 넣으면 상위에서 물려받는
 * 값까지 지워져, 아무 설정도 안 한 텍스트의 모양이 달라진다.
 */
export function textStyle(options = {}) {
  const style = {
    fontSize: `${options.fontSize ?? 48}px`,
    color: options.color ?? '#ffffff',
    textAlign: options.align ?? 'center',
    fontWeight: options.bold ? '800' : '400',
  }

  const stack = fontStack(options.fontFamily ?? DEFAULT_FONT)
  if (stack) style.fontFamily = stack

  if (options.italic) style.fontStyle = 'italic'

  // 밑줄과 취소선은 함께 걸릴 수 있다.
  const lines = []
  if (options.underline) lines.push('underline')
  if (options.strike) lines.push('line-through')
  if (lines.length) style.textDecoration = lines.join(' ')

  if (options.lineHeight) style.lineHeight = String(options.lineHeight)
  if (options.letterSpacing) style.letterSpacing = `${options.letterSpacing}em`
  if (options.background) style.background = options.background

  // 밝은 화면에 흰 글자를 올리는 일이 잦다. 그림자가 없으면 읽히지 않는다.
  if (options.shadow) style.textShadow = '0 2px 6px rgb(0 0 0 / 65%)'

  return style
}
