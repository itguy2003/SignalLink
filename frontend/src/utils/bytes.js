/**
 * 바이트 표시.
 *
 * 1000 진법을 쓴다. 장치 등록 시 사람이 적어 넣는 사양 문자열이 제조사 표기를
 * 따라 "256GB"(=256×10⁹)이므로, 1024 진법으로 보여 주면 같은 디스크가 표에서
 * "238GB" 로 나와 등록 정보와 어긋나 보인다.
 */

const UNITS = ['B', 'KB', 'MB', 'GB', 'TB', 'PB']
const STEP = 1000

/**
 * 사람이 읽을 크기 문자열. 값을 알 수 없으면 null.
 *
 * null 은 '미보고'다. 호출부가 0 으로 갈음하면 안 된다 — 0B 로 보이면
 * 저장공간이 없는 장치처럼 읽힌다.
 */
export function formatBytes(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null
  if (value < STEP) return `${value}B`

  let size = value
  let unit = 0
  while (size >= STEP && unit < UNITS.length - 1) {
    size /= STEP
    unit += 1
  }
  // 100 이상은 소수점이 의미 없고(256.0GB), 그 아래는 한 자리가 있어야 구분된다.
  const digits = size >= 100 ? 0 : 1
  return `${Number(size.toFixed(digits))}${UNITS[unit]}`
}

/** 0~1 사용률을 백분율 정수로. 값을 알 수 없으면 null. */
export function formatPercent(ratio) {
  if (typeof ratio !== 'number' || !Number.isFinite(ratio)) return null
  return Math.round(ratio * 100)
}
