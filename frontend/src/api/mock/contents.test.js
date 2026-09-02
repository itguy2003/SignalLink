/**
 * 모의 서버의 콘텐츠 라이브러리 / 주간 편집기 규칙 테스트.
 *
 * 백엔드 tests/test_contents.py 와 같은 시나리오를 확인한다. 두 쪽이 어긋나면
 * 테스트 모드에서 본 동작이 실서버에서 재현되지 않는다.
 */
import { beforeEach, describe, expect, it } from 'vitest'

import { mockServer } from './server'

async function loginAs(userId, password = 'test1234') {
  const result = await mockServer.handle('POST', '/auth/login', {
    body: { user_id: userId, password },
  })
  return result.access_token
}

beforeEach(() => {
  mockServer.reset()
})

describe('콘텐츠 목록', () => {
  it('요약만 반환하고 문서 본문은 싣지 않는다', async () => {
    const token = await loginAs('school_admin')
    const page = await mockServer.handle('GET', '/contents', { token, params: {} })
    expect(page.items.length).toBeGreaterThan(0)
    const item = page.items[0]
    expect(item.document).toBeUndefined()
    expect(item).toHaveProperty('element_count')
    expect(item).toHaveProperty('background')
  })

  it('상세 조회는 문서를 포함한다', async () => {
    const token = await loginAs('school_admin')
    const content = await mockServer.handle('GET', '/contents/1', { token })
    expect(content.document.elements.length).toBe(3)
  })

  it('방향으로 거를 수 있다', async () => {
    const token = await loginAs('school_admin')
    const portrait = await mockServer.handle('GET', '/contents', {
      token,
      params: { orientation: 'portrait' },
    })
    expect(portrait.items.every((c) => c.height > c.width)).toBe(true)
    expect(portrait.items.map((c) => c.name)).toContain('가을 운동회 안내 (세로)')
  })

  it('관리 범위 밖 콘텐츠는 보이지 않는다', async () => {
    const token = await loginAs('edu_admin') // 서울시교육청 - 가나초 포함
    const mine = await mockServer.handle('GET', '/contents', { token, params: {} })
    expect(mine.total).toBeGreaterThan(0)

    const adminToken = await loginAs('admin', 'admin1234')
    // 부산교육청(5) 소속 콘텐츠를 만든 뒤 서울 관리자에게 보이지 않는지 본다.
    await mockServer.handle('POST', '/contents', {
      token: adminToken,
      body: { name: '부산 콘텐츠', org_id: 5 },
    })
    const after = await mockServer.handle('GET', '/contents', { token, params: {} })
    expect(after.items.map((c) => c.name)).not.toContain('부산 콘텐츠')
  })

  it('사용 중인 곳의 수를 센다', async () => {
    const token = await loginAs('school_admin')
    const content = await mockServer.handle('GET', '/contents/1', { token })
    // 시드에서 1번 콘텐츠는 월/화/수/금 아침에 배치되어 있다.
    expect(content.usage_count).toBe(4)
  })
})

describe('콘텐츠 편집', () => {
  it('새 콘텐츠는 빈 문서로 시작한다', async () => {
    const token = await loginAs('school_admin')
    const created = await mockServer.handle('POST', '/contents', {
      token,
      body: { name: '새 화면', width: 1080, height: 1920 },
    })
    expect(created.document.elements).toEqual([])
    expect(created.document.layout).toEqual({
      width: 1080,
      height: 1920,
      background: '#000000',
    })
  })

  it('수정하면 콘텐츠 버전이 오른다', async () => {
    const token = await loginAs('school_admin')
    const before = await mockServer.handle('GET', '/contents/1', { token })
    const after = await mockServer.handle('PUT', '/contents/1', {
      token,
      body: { name: '이름 변경' },
    })
    expect(after.version).toBe(before.version + 1)
  })

  it('콘텐츠를 고치면 이를 쓰는 스케줄 버전도 오른다', async () => {
    // 이것이 없으면 장치가 화면 변경을 영영 알아채지 못한다.
    const token = await loginAs('school_admin')
    const before = await mockServer.handle('GET', '/schedules/1', { token })
    await mockServer.handle('PUT', '/contents/1', {
      token,
      body: { document: { version: 1, layout: {}, elements: [] } },
    })
    const after = await mockServer.handle('GET', '/schedules/1', { token })
    expect(after.version).toBe(before.version + 1)
  })

  it('쓰이지 않는 콘텐츠를 고쳐도 다른 스케줄 버전은 그대로다', async () => {
    const token = await loginAs('school_admin')
    const before = await mockServer.handle('GET', '/schedules/1', { token })
    // 4번 콘텐츠는 화요일 점심에만 쓰인다. 3번은 2번 스케줄에서만 쓰인다.
    await mockServer.handle('PUT', '/contents/3', { token, body: { name: '무관한 수정' } })
    const after = await mockServer.handle('GET', '/schedules/1', { token })
    expect(after.version).toBe(before.version)
  })

  it('사용 중인 콘텐츠는 삭제할 수 없다', async () => {
    const token = await loginAs('school_admin')
    await expect(mockServer.handle('DELETE', '/contents/1', { token })).rejects.toMatchObject({
      status: 400,
    })
  })

  it('사용되지 않는 콘텐츠는 삭제된다', async () => {
    const token = await loginAs('school_admin')
    const created = await mockServer.handle('POST', '/contents', {
      token,
      body: { name: '임시' },
    })
    const result = await mockServer.handle('DELETE', `/contents/${created.id}`, { token })
    expect(result.detail).toContain('삭제')
  })

  it('복제본은 문서를 그대로 갖고 버전은 1 이다', async () => {
    const token = await loginAs('school_admin')
    const source = await mockServer.handle('GET', '/contents/1', { token })
    const copy = await mockServer.handle('POST', '/contents/1/duplicate', { token })
    expect(copy.id).not.toBe(source.id)
    expect(copy.name).toContain('복사본')
    expect(copy.document).toEqual(source.document)
    expect(copy.version).toBe(1)
  })
})

describe('주간 편집기 저장 규칙', () => {
  const block = (day, start, end, contentId = 1) => ({
    day_of_week: day,
    start_time: start,
    end_time: end,
    content_id: contentId,
  })

  it('블록에 콘텐츠 이름이 붙어 온다', async () => {
    const token = await loginAs('school_admin')
    const detail = await mockServer.handle('GET', '/schedules/1', { token })
    const monday = detail.items.find((i) => i.day_of_week === 0)
    expect(monday.content_name).toBe('아침 알림판')
  })

  it('같은 요일의 겹치는 블록은 거부한다', async () => {
    const token = await loginAs('school_admin')
    await expect(
      mockServer.handle('PUT', '/schedules/1', {
        token,
        body: {
          items: [block(0, '09:00:00', '12:00:00'), block(0, '11:00:00', '13:00:00')],
        },
      }),
    ).rejects.toMatchObject({ status: 400 })
  })

  it('맞닿은 블록은 허용한다', async () => {
    const token = await loginAs('school_admin')
    const updated = await mockServer.handle('PUT', '/schedules/1', {
      token,
      body: { items: [block(0, '09:00:00', '12:00:00'), block(0, '12:00:00', '13:00:00')] },
    })
    expect(updated.items).toHaveLength(2)
  })

  it('다른 요일의 같은 시간은 허용한다', async () => {
    const token = await loginAs('school_admin')
    const items = Array.from({ length: 7 }, (_, day) => block(day, '09:00:00', '12:00:00'))
    const updated = await mockServer.handle('PUT', '/schedules/1', { token, body: { items } })
    expect(updated.items).toHaveLength(7)
  })

  it('참조 방식 아이템은 인라인 문서를 남기지 않는다', async () => {
    const token = await loginAs('school_admin')
    const updated = await mockServer.handle('PUT', '/schedules/1', {
      token,
      body: {
        items: [{ ...block(0, '09:00:00', '10:00:00'), content: { elements: ['남으면 안 됨'] } }],
      },
    })
    expect(updated.items[0].content).toEqual({})
    expect(updated.items[0].content_id).toBe(1)
  })

  it('존재하지 않는 콘텐츠 참조는 거부한다', async () => {
    const token = await loginAs('school_admin')
    await expect(
      mockServer.handle('PUT', '/schedules/1', {
        token,
        body: { items: [block(0, '09:00:00', '10:00:00', 9999)] },
      }),
    ).rejects.toMatchObject({ status: 400 })
  })

  it('관리 범위 밖 콘텐츠는 배치할 수 없다', async () => {
    const adminToken = await loginAs('admin', 'admin1234')
    const foreign = await mockServer.handle('POST', '/contents', {
      token: adminToken,
      body: { name: '남의 콘텐츠', org_id: 5 },
    })

    const token = await loginAs('school_admin')
    await expect(
      mockServer.handle('PUT', '/schedules/1', {
        token,
        body: { items: [block(0, '09:00:00', '10:00:00', foreign.id)] },
      }),
    ).rejects.toMatchObject({ status: 403 })
  })

  it('요일 미지정 아이템도 그대로 저장된다', async () => {
    const token = await loginAs('school_admin')
    const updated = await mockServer.handle('PUT', '/schedules/1', {
      token,
      body: {
        items: [
          block(0, '09:00:00', '10:00:00'),
          { day_of_week: -1, start_time: null, end_time: null, duration_sec: 15, content_id: 2 },
        ],
      },
    })
    expect(updated.items).toHaveLength(2)
    expect(updated.items.some((i) => i.day_of_week === -1)).toBe(true)
  })
})
