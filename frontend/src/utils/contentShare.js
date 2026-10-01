/**
 * 콘텐츠 공유 구분 — 서버 계약(한국어 값)과 화면 라벨(번역 키)의 다리.
 *
 * 값은 서버가 정한다: 없음(공유하지 않음) | 동일기관 | 소속기관(같은
 * 상위기관 아래 기관들) | 전체. 화면에는 언어별 라벨을 보여 주되, 저장은
 * 언제나 이 값 그대로 한다.
 */
export const SHARE_SCOPES = ['없음', '동일기관', '소속기관', '전체']

const LABEL_KEYS = {
  없음: 'content.shareNone',
  동일기관: 'content.shareSameOrg',
  소속기관: 'content.shareSiblings',
  전체: 'content.shareAll',
}

export function shareLabelKey(scope) {
  return LABEL_KEYS[scope] ?? 'content.shareNone'
}
