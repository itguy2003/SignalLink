/**
 * 커뮤니티 공지대상 토큰.
 *
 * 저장 형식은 기관구분 이름 그대로("학교" = 그 구분 전체)거나, 분류를 붙인
 * 세부 구분("학교:초" = 학교 중 초등)이다 — 서버(FastAPI/.NET)와 목 서버가
 * 같은 토큰으로 검증·매칭한다. 화면은 토큰을 "학교(초)" 모양으로 보여 준다.
 */
export function formatNoticeTarget(token) {
  const text = String(token)
  const at = text.indexOf(':')
  return at === -1 ? text : `${text.slice(0, at)}(${text.slice(at + 1)})`
}

/** 토큰 목록을 사람이 읽는 한 줄로. */
export function formatNoticeTargets(tokens) {
  return (tokens ?? []).map(formatNoticeTarget).join(', ')
}
