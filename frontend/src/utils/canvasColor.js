/**
 * 캔버스 위에 그리는 선 색을 배경색에서 뽑아낸다.
 *
 * 격자와 분할선은 **캔버스 배경 위**에 그려진다. 캔버스 배경은 앱 테마가 아니라
 * 콘텐츠가 정하는 색이다(검정 알림판일 수도, 흰 안내판일 수도 있다).
 * 그래서 앱 테마를 따라 색을 정하면 조합에 따라 선이 배경에 묻혀 사라진다
 * (라이트 테마 + 어두운 캔버스에서 어두운 격자를 그리던 문제).
 *
 * 배경의 밝기를 재서 밝으면 어두운 선을, 어두우면 밝은 선을 쓴다.
 * 캔버스 바깥(무대, 사이드 패널)은 여전히 앱 테마 토큰을 쓴다.
 */

const NAMED = {
  black: { r: 0, g: 0, b: 0 },
  white: { r: 255, g: 255, b: 255 },
  transparent: null,
}

/** `#rgb`, `#rrggbb`, `rgb()`, `rgba()`, 그리고 black/white 를 읽는다. */
export function parseColor(value) {
  if (typeof value !== 'string') return null
  const text = value.trim().toLowerCase()
  if (!text) return null

  if (text in NAMED) return NAMED[text]

  const hex = text.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/)
  if (hex) {
    const digits = hex[1]
    const full =
      digits.length === 3
        ? digits
            .split('')
            .map((c) => c + c)
            .join('')
        : digits
    return {
      r: parseInt(full.slice(0, 2), 16),
      g: parseInt(full.slice(2, 4), 16),
      b: parseInt(full.slice(4, 6), 16),
    }
  }

  const rgb = text.match(/^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/)
  if (rgb) {
    return { r: Number(rgb[1]), g: Number(rgb[2]), b: Number(rgb[3]) }
  }

  // 그라디언트나 알 수 없는 표기.
  return null
}

/** WCAG 상대 휘도(0=검정, 1=흰색). */
export function relativeLuminance(rgb) {
  if (!rgb) return 0
  const channel = (value) => {
    const c = Math.min(255, Math.max(0, value)) / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(rgb.r) + 0.7152 * channel(rgb.g) + 0.0722 * channel(rgb.b)
}

/**
 * 배경이 밝은 편인가.
 *
 * 임계값 0.4 는 중간 회색(#808080, 휘도 약 0.216)을 '어두움'으로 보게 한다.
 * 어중간한 배경에서는 밝은 선이 더 잘 보이기 때문이다.
 * 읽을 수 없는 배경(그라디언트 등)은 캔버스 기본값이 검정이므로 어두움으로 본다.
 */
export function isLightBackground(background) {
  return relativeLuminance(parseColor(background)) > 0.4
}

const DARK_INK = '15, 23, 42' // slate-900
const LIGHT_INK = '255, 255, 255'
const ACCENT_ON_LIGHT = '29, 78, 216' // blue-700
const ACCENT_ON_DARK = '56, 189, 248' // sky-400

/**
 * 배경에 맞춘 캔버스 오버레이 색 묶음.
 *
 * 격자는 콘텐츠를 가리지 않게 옅게, 5칸마다 오는 굵은 선은 조금 진하게.
 * 분할선은 격자와 구분되도록 강조색을 쓴다.
 */
export function canvasLineColors(background) {
  const light = isLightBackground(background)
  const ink = light ? DARK_INK : LIGHT_INK
  const accent = light ? ACCENT_ON_LIGHT : ACCENT_ON_DARK

  return {
    onLight: light,
    grid: `rgba(${ink}, ${light ? 0.16 : 0.14})`,
    gridStrong: `rgba(${ink}, ${light ? 0.34 : 0.3})`,
    region: `rgba(${accent}, 0.85)`,
    regionFill: `rgba(${accent}, 0.1)`,
    regionActive: `rgba(${accent}, 0.24)`,
    divider: `rgba(${accent}, 0.9)`,
    /** 영역 이름표처럼 글자를 얹는 칩의 배경/글자색. */
    chipBg: light ? 'rgba(15, 23, 42, 0.72)' : 'rgba(255, 255, 255, 0.85)',
    chipText: light ? '#f8fafc' : '#0f172a',
  }
}
