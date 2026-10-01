/**
 * API 클라이언트.
 *
 * 테스트 모드(VITE_TEST_MODE=true)에서는 네트워크로 나가지 않고 모의 서버가
 * 요청을 처리한다. 화면 코드는 어느 쪽인지 알 필요가 없다
 * (요구사항 제한사항 8: CMS 클라이언트를 독립적으로 테스트할 수 있어야 한다).
 */

import { ref } from 'vue'

import { ApiError } from './errors'

export { ApiError }

/**
 * 지금 서버에 나가 있는 요청 수.
 *
 * 오래 걸리는 일이 얼마나 남았는지 알 수 없을 때가 많다 — 서버가 엑셀 수백
 * 줄을 읽거나, 바깥 제공처에서 사진을 받아 오는 동안 브라우저는 아무것도
 * 보지 못한다. 그때도 화면이 조용하면 사람은 멈춘 것으로 여기고 다시 누른다.
 * 그래서 **무엇이든 나가 있으면** 위쪽에 얇은 띠를 흘린다(`AppLayout`).
 */
export const pendingRequests = ref(0)

export const TEST_MODE = import.meta.env.VITE_TEST_MODE === 'true'

/**
 * 모의 서버는 **테스트 모드 빌드에만** 들어간다.
 *
 * 정적으로 import 하면 운영 번들에도 모의 서버와 시드 데이터, 테스트 계정
 * 비밀번호가 그대로 딸려 나간다. `VITE_TEST_MODE` 는 빌드 시점에 상수로
 * 접히므로, 아래 분기 전체가 운영 빌드에서는 사라진다.
 *
 * 한 번 받은 모듈은 재사용한다 — 요청마다 import() 를 하면 화면이 느려진다.
 */
let mockServerPromise = null

function loadMockServer() {
  mockServerPromise ??= import('./mock/server').then((module) => module.mockServer)
  return mockServerPromise
}

const API_BASE = import.meta.env.VITE_API_BASE || ''
const PREFIX = '/api/v1'
const TOKEN_KEY = 'signallink.token'

export function getToken() {
  return localStorage.getItem(TOKEN_KEY)
}

export function setToken(token) {
  if (token) localStorage.setItem(TOKEN_KEY, token)
  else localStorage.removeItem(TOKEN_KEY)
}

/**
 * 장치 토큰(플레이어 전용).
 *
 * 플레이어는 사용자 로그인 없이 장치 자격(X-Device-Token)으로 서버와
 * 말한다. 설정해 두면 모든 요청에 실린다 — 위젯 데이터처럼 사용자/장치
 * 겸용 API 가 장치 쪽 자격으로 동작하게 된다.
 */
let deviceToken = null

export function setDeviceToken(token) {
  deviceToken = token || null
}

function buildQuery(params) {
  if (!params) return ''
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue
    search.append(key, value)
  }
  const query = search.toString()
  return query ? `?${query}` : ''
}

/** FastAPI 의 detail 은 문자열이거나 검증 오류 배열이다. 둘 다 읽을 수 있게 만든다. */
function formatDetail(detail, fallback) {
  if (typeof detail === 'string') return detail
  if (Array.isArray(detail)) {
    return detail
      .map((item) => {
        const field = Array.isArray(item.loc) ? item.loc.slice(1).join('.') : ''
        return field ? `${field}: ${item.msg}` : item.msg
      })
      .join('\n')
  }
  return fallback
}

async function request(method, path, options = {}) {
  pendingRequests.value += 1
  try {
    return await send(method, path, options)
  } finally {
    pendingRequests.value -= 1
  }
}

async function send(method, path, { body, params, raw } = {}) {
  const url = `${PREFIX}${path}${buildQuery(params)}`

  if (TEST_MODE) {
    const mockServer = await loadMockServer()
    return mockServer.handle(method, path, { body, params, token: getToken() })
  }

  const headers = {}
  const token = getToken()
  if (token) headers.Authorization = `Bearer ${token}`
  if (deviceToken) headers['X-Device-Token'] = deviceToken

  let payload
  if (raw) {
    payload = raw // FormData: Content-Type 을 브라우저가 정하도록 둔다.
  } else if (body !== undefined) {
    headers['Content-Type'] = 'application/json'
    payload = JSON.stringify(body)
  }

  const response = await fetch(`${API_BASE}${url}`, { method, headers, body: payload })

  if (response.status === 204) return null

  const text = await response.text()
  const data = text ? JSON.parse(text) : null

  if (!response.ok) {
    throw new ApiError(response.status, formatDetail(data?.detail, `요청 실패 (${response.status})`))
  }
  return data
}

/**
 * 인증이 필요한 이미지의 URL 을 만든다.
 *
 * ``<img src>`` 는 Authorization 헤더를 보낼 수 없다. 그래서 직접 받아
 * objectURL 로 바꾼다. 다 쓰면 **반드시** ``revokeImageUrl`` 로 해제해야
 * 한다 — 안 하면 목록을 새로 그릴 때마다 blob 이 쌓인다.
 *
 * 없으면(404) null 이다. 아직 캡처가 없는 장치는 오류가 아니라 정상이다.
 */
export async function imageUrl(path) {
  if (TEST_MODE) {
    const mockServer = await loadMockServer()
    return mockServer.imageUrl(path)
  }

  const token = getToken()
  const response = await fetch(`${API_BASE}${PREFIX}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  })
  if (!response.ok) return null
  return URL.createObjectURL(await response.blob())
}

/** ``imageUrl`` 이 만든 objectURL 을 해제한다. 데이터 URL(테스트 모드)은 그냥 둔다. */
export function revokeImageUrl(url) {
  if (typeof url === 'string' && url.startsWith('blob:')) URL.revokeObjectURL(url)
}

/**
 * 진행률을 알려 주며 올린다.
 *
 * `fetch` 로는 **보낸 양을 알 수 없다** — 500MB 동영상을 올리는 동안 화면이
 * 아무 말도 못 하고, 사람은 멈춘 것으로 여겨 다시 누른다. 그래서 진행률을
 * 원할 때만 XHR 로 보낸다(그 외에는 지금까지와 똑같이 fetch 로).
 *
 * `onProgress` 는 0~1 을 받는다. 길이를 모르는 경우(드물게 스트리밍)에는
 * null 을 준다 — 받는 쪽이 '얼마나' 대신 '하는 중' 만 그리면 된다.
 */
function uploadWithProgress(path, formData, params, onProgress) {
  const url = `${API_BASE}${PREFIX}${path}${buildQuery(params)}`

  pendingRequests.value += 1
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', url)

    const token = getToken()
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`)

    xhr.upload.onprogress = (event) => {
      onProgress(event.lengthComputable ? event.loaded / event.total : null)
    }

    xhr.onload = () => {
      // 다 보낸 뒤 서버가 저장하는 시간이 남아 있다. 100% 로 두어야 막대가
      // 끝에서 멈춘 채로 보인다 — 99% 에서 멈춰 있으면 고장으로 읽힌다.
      onProgress(1)
      const data = xhr.responseText ? JSON.parse(xhr.responseText) : null
      if (xhr.status >= 200 && xhr.status < 300) resolve(data)
      else {
        reject(
          new ApiError(xhr.status, formatDetail(data?.detail, `요청 실패 (${xhr.status})`)),
        )
      }
    }
    xhr.onerror = () => reject(new ApiError(0, '서버에 연결할 수 없습니다.'))
    xhr.onabort = () => reject(new ApiError(0, '전송이 취소되었습니다.'))

    xhr.send(formData)
  }).finally(() => {
    pendingRequests.value -= 1
  })
}

export const api = {
  get: (path, params) => request('GET', path, { params }),
  post: (path, body, params) => request('POST', path, { body, params }),
  put: (path, body) => request('PUT', path, { body }),
  delete: (path) => request('DELETE', path),
  /**
   * 파일을 올린다. `onProgress` 를 주면 보낸 양을 0~1 로 알려 준다.
   *
   * 테스트 모드에는 네트워크가 없다 — 끝났다는 것만 한 번 알린다. 그래야
   * 화면 코드가 두 모드에서 같은 길을 탄다.
   */
  upload: (path, formData, params, { onProgress } = {}) => {
    if (!onProgress) return request('POST', path, { raw: formData, params })
    if (TEST_MODE) {
      return request('POST', path, { raw: formData, params }).finally(() => onProgress(1))
    }
    return uploadWithProgress(path, formData, params, onProgress)
  },
}
