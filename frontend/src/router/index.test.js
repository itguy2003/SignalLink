/**
 * 라우트 표 검증.
 *
 * 화면 테스트는 라우터를 통째로 모킹하므로 실제 경로 표를 아무도 보지 않는다.
 * 지운 화면의 경로가 남아 있거나, 살아 있어야 할 경로가 사라지는 것을 여기서 잡는다.
 */
import { describe, expect, it } from 'vitest'

import { COMMUNITY_ROUTES } from '@/stores/auth'
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

describe('커뮤니티 유저의 울타리', () => {
  // 메뉴를 숨기는 것만으로는 주소창에 직접 치고 들어오는 것을 못 막는다.
  // 서버도 같은 방식으로 경로를 가른다(api/deps.py).

  it('게시판 화면이 있고, 옛 이미지·동영상 화면은 없다', () => {
    // 공유 이미지·동영상 메뉴는 게시판으로 합쳤다 — 첨부가 곧 재료다.
    expect(nameOf('/community/board')).toBe('community-board')
    expect(nameOf('/community/images')).not.toBe('community-images')
    expect(nameOf('/community/videos')).not.toBe('community-videos')
  })

  it('커뮤니티에는 역할 제한이 없다', () => {
    // 누구나 제 커뮤니티를 본다. 올릴 수 있는지는 서버가 답한다.
    expect(router.resolve('/community/board').meta.roles).toBeUndefined()
  })

  it('관리 화면은 관리자의 것이다', () => {
    for (const path of ['/organizations', '/users', '/boards']) {
      expect(router.resolve(path).meta.roles, path).not.toContain('COMMUNITY_USER')
    }
  })

  it('여는 목록에 든 이름은 실제 경로다', () => {
    // 오타가 나면 커뮤니티 유저가 어디로도 못 간다.
    for (const name of COMMUNITY_ROUTES) {
      expect(router.hasRoute(name), name).toBe(true)
    }
  })
})
