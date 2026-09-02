/**
 * 테스트 모드 배선 검증.
 *
 * 화면 테스트는 `@/api/client` 자체를 모킹하므로 이 배선을 지나가지 않는다.
 * 그런데 모의 서버는 운영 번들에서 빼려고 **동적 import** 로 불러온다
 * (client.js 의 loadMockServer). 그 연결이 끊기면 `npm run dev:test` 와
 * `npm run build:test` 산출물의 모든 화면이 한꺼번에 죽는데, 지금까지는
 * 어떤 테스트도 그걸 잡지 못했다.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// TEST_MODE 는 모듈이 처음 평가될 때 굳는다. 불러오기 전에 켜야 한다.
vi.stubEnv('VITE_TEST_MODE', 'true')

const { api, TEST_MODE, setToken } = await import('./client')

/** 테스트 모드에서 네트워크로 나가면 곧바로 터지게 한다. */
const fetchGuard = vi.fn(() => {
  throw new Error('테스트 모드에서 네트워크 요청이 나갔다')
})

beforeEach(() => {
  vi.stubGlobal('fetch', fetchGuard)
  fetchGuard.mockClear()
  setToken(null)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('테스트 모드', () => {
  it('켜져 있다', () => {
    expect(TEST_MODE).toBe(true)
  })

  it('모의 서버가 요청을 처리한다', async () => {
    const orgs = await api.get('/organizations/public')
    expect(orgs.map((o) => o.name)).toContain('가나초등학교')
  })

  it('네트워크로 나가지 않는다', async () => {
    await api.get('/organizations/public')
    expect(fetchGuard).not.toHaveBeenCalled()
  })

  it('로그인해서 토큰을 받는다', async () => {
    const result = await api.post('/auth/login', { user_id: 'admin', password: 'admin1234' })
    expect(result.access_token).toBeTruthy()
  })

  it('로그인 뒤 인증이 필요한 요청도 통한다', async () => {
    const { access_token: token } = await api.post('/auth/login', {
      user_id: 'admin',
      password: 'admin1234',
    })
    setToken(token)

    const tree = await api.get('/organizations/tree')
    expect(tree[0].name).toBe('최상위 기관')
  })

  it('오류도 실제와 같은 모양으로 돌려준다', async () => {
    await expect(
      api.post('/auth/login', { user_id: 'admin', password: '틀린비밀번호' }),
    ).rejects.toMatchObject({ status: 401 })
  })

  it('모의 서버 모듈을 한 번만 불러온다', async () => {
    // 요청마다 import() 를 새로 하면 화면이 눈에 띄게 느려진다.
    const first = await api.get('/organizations/public')
    const second = await api.get('/organizations/public')
    expect(second).toEqual(first)
    expect(fetchGuard).not.toHaveBeenCalled()
  })
})
