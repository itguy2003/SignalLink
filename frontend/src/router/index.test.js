/**
 * 라우트 표 검증.
 *
 * 화면 테스트는 라우터를 통째로 모킹하므로 실제 경로 표를 아무도 보지 않는다.
 * 지운 화면의 경로가 남아 있거나, 살아 있어야 할 경로가 사라지는 것을 여기서 잡는다.
 */
import { describe, expect, it } from 'vitest'

import { router } from './index'

const nameOf = (path) => router.resolve(path).name

describe('스케줄 경로', () => {
  it('주간/목록 편집기는 남아 있다', () => {
    expect(nameOf('/schedules/1/grid')).toBe('schedule-grid')
  })

  it('단일 콘텐츠 편집기 경로는 없앴다', () => {
    // 기능을 지웠으므로 주소를 직접 쳐도 열리면 안 된다.
    expect(nameOf('/schedules/1/editor')).toBe('not-found')
  })
})

describe('콘텐츠 경로', () => {
  it('콘텐츠 편집기는 그대로다', () => {
    // 주간 편집기가 콘텐츠를 고칠 때 쓰는 경로다. 단일 편집기와 다른 화면이다.
    expect(nameOf('/contents/1/editor')).toBe('content-editor')
  })

  it('콘텐츠 목록도 그대로다', () => {
    expect(nameOf('/contents')).toBe('contents')
  })
})

describe('커뮤니티 경로', () => {
  // 2026-10 개편: 커뮤니티는 모든 승인 사용자의 공간 — 역할 제한이 없다.

  it('게시물 화면이 있고, 옛 게시판·콘텐츠 화면은 없다', () => {
    expect(nameOf('/community/playlists')).toBe('community-playlists')
    expect(nameOf('/community/board')).not.toBe('community-board')
    expect(nameOf('/community/contents')).not.toBe('community-contents')
  })

  it('커뮤니티에는 역할 제한이 없다', () => {
    // 누구나 제 커뮤니티를 본다. 올릴 수 있는지는 서버가 답한다.
    expect(router.resolve('/community/playlists').meta.roles).toBeUndefined()
  })

  it('편집기(수정) 경로도 살아 있다 — 등록은 목록의 메타 레이어가 한다', () => {
    for (const name of ['community-playlists', 'community-playlist-edit']) {
      expect(router.hasRoute(name), name).toBe(true)
    }
    expect(nameOf('/community/playlists/new')).toBe('not-found')
  })

  it('커뮤니티 전용 가입 경로는 없앴다', () => {
    // 2026-10 개편: 커뮤니티 유저 역할과 함께 전용 가입도 사라졌다.
    expect(nameOf('/register/community')).toBe('not-found')
  })
})
