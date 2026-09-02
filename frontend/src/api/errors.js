/**
 * API 오류 타입.
 *
 * 별도 모듈로 둔 이유: 모의 서버(mock/server.js)와 실제 클라이언트(client.js)가
 * 모두 이 타입을 쓰는데, 한쪽에 두면 두 모듈이 서로를 import 하는 순환이 생긴다.
 */
export class ApiError extends Error {
  constructor(status, detail) {
    super(detail)
    this.name = 'ApiError'
    this.status = status
    this.detail = detail
  }
}
