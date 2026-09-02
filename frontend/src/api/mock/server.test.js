/**
 * 모의 서버 테스트.
 *
 * 모의 서버가 실제 백엔드와 같은 권한 규칙을 따르는지 확인한다. 여기가 어긋나면
 * 테스트 모드에서 확인한 화면 동작이 실제 서버에서 재현되지 않는다.
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

describe('인증', () => {
  it('올바른 자격 증명으로 토큰을 발급한다', async () => {
    const result = await mockServer.handle('POST', '/auth/login', {
      body: { user_id: 'admin', password: 'admin1234' },
    })
    expect(result.access_token).toBeTruthy()
    expect(result.user.roles).toContain('SUPER_ADMIN')
  })

  it('비밀번호가 틀리면 401 이다', async () => {
    await expect(
      mockServer.handle('POST', '/auth/login', { body: { user_id: 'admin', password: 'wrong' } }),
    ).rejects.toMatchObject({ status: 401 })
  })

  it('미승인 계정은 로그인할 수 없다', async () => {
    await expect(
      mockServer.handle('POST', '/auth/login', { body: { user_id: 'newbie', password: 'test1234' } }),
    ).rejects.toMatchObject({ status: 403 })
  })

  it('회원가입한 사용자는 미승인 상태이고 MEMBER 역할만 갖는다', async () => {
    const created = await mockServer.handle('POST', '/auth/register', {
      body: { org_id: 3, user_id: 'brandnew', password: 'pass1234', name: '신규' },
    })
    expect(created.status).toBe('미승인')
    expect(created.roles).toEqual(['MEMBER'])
  })

  it('중복된 사용자ID 는 사용할 수 없다고 알린다', async () => {
    const taken = await mockServer.handle('GET', '/auth/check-user-id', {
      params: { user_id: 'admin' },
    })
    const free = await mockServer.handle('GET', '/auth/check-user-id', {
      params: { user_id: 'nobody' },
    })
    expect(taken.available).toBe(false)
    expect(free.available).toBe(true)
  })
})

describe('기관 트리 권한', () => {
  it('슈퍼관리자는 모든 기관을 본다', async () => {
    const token = await loginAs('admin', 'admin1234')
    const orgs = await mockServer.handle('GET', '/organizations', { token })
    expect(orgs).toHaveLength(5)
  })

  it('기관관리자는 자기 기관과 하위 기관만 본다', async () => {
    const token = await loginAs('edu_admin')
    const orgs = await mockServer.handle('GET', '/organizations', { token })
    const names = orgs.map((o) => o.name)
    expect(names).toContain('서울특별시교육청')
    expect(names).toContain('가나초등학교')
    expect(names).not.toContain('부산광역시교육청')
    expect(names).not.toContain('최상위 기관')
  })

  it('관리 범위 밖 기관 아래에는 하위 기관을 만들 수 없다', async () => {
    const token = await loginAs('edu_admin')
    await expect(
      mockServer.handle('POST', '/organizations', {
        token,
        body: { name: '침입기관', parent_id: 5 },
      }),
    ).rejects.toMatchObject({ status: 403 })
  })

  it('트리 응답은 하위 기관을 children 으로 중첩한다', async () => {
    const token = await loginAs('admin', 'admin1234')
    const tree = await mockServer.handle('GET', '/organizations/tree', { token })
    expect(tree).toHaveLength(1)
    const offices = tree[0].children.map((c) => c.name)
    expect(offices).toEqual(expect.arrayContaining(['서울특별시교육청', '부산광역시교육청']))
  })

  it('하위 기관이 있으면 삭제를 거부한다', async () => {
    const token = await loginAs('admin', 'admin1234')
    await expect(
      mockServer.handle('DELETE', '/organizations/2', { token }),
    ).rejects.toMatchObject({ status: 400 })
  })
})

describe('사용자 승인', () => {
  it('기관관리자는 하위 기관 사용자를 승인할 수 있다', async () => {
    const token = await loginAs('edu_admin')
    const approved = await mockServer.handle('POST', '/users/6/approve', { token })
    expect(approved.status).toBe('승인')
  })

  it('관리 범위 밖 사용자는 승인할 수 없다', async () => {
    const token = await loginAs('school_admin') // 가나초등학교 소속
    // 7번 사용자는 다라중학교 소속이라 범위 밖이다.
    await expect(mockServer.handle('POST', '/users/7/approve', { token })).rejects.toMatchObject({
      status: 403,
    })
  })

  it('승인 대기 인원수는 관리 범위 안에서만 센다', async () => {
    const eduToken = await loginAs('edu_admin')
    const schoolToken = await loginAs('school_admin')
    expect((await mockServer.handle('GET', '/users/pending-count', { token: eduToken })).count).toBe(2)
    expect((await mockServer.handle('GET', '/users/pending-count', { token: schoolToken })).count).toBe(1)
  })

  it('기관관리자는 SUPER_ADMIN 역할을 부여할 수 없다', async () => {
    const token = await loginAs('edu_admin')
    await expect(
      mockServer.handle('PUT', '/users/6', { token, body: { roles: ['SUPER_ADMIN'] } }),
    ).rejects.toMatchObject({ status: 403 })
  })

  it('역할을 교체해도 MEMBER 는 유지되고 중복되지 않는다', async () => {
    const token = await loginAs('admin', 'admin1234')
    const updated = await mockServer.handle('PUT', '/users/6', {
      token,
      body: { roles: ['ORG_ADMIN', 'ORG_ADMIN', 'MEMBER'] },
    })
    expect(updated.roles.sort()).toEqual(['MEMBER', 'ORG_ADMIN'])
  })
})

describe('장치', () => {
  const NEW_DEVICE = {
    org_id: 3,
    name: '신규 장치',
    os: 'Windows',
    form_factor: 'DID형',
    panel_type: 'LANDSCAPE',
  }

  it('등록 시 4-3-3 형식의 고유번호를 서버가 생성한다', async () => {
    const token = await loginAs('school_admin')
    const device = await mockServer.handle('POST', '/devices', { token, body: NEW_DEVICE })
    expect(device.device_code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{3}-[A-Z2-9]{3}$/)
  })

  it('클라이언트가 보낸 고유번호는 무시한다', async () => {
    const token = await loginAs('school_admin')
    const device = await mockServer.handle('POST', '/devices', {
      token,
      body: { ...NEW_DEVICE, device_code: 'AAAA-BBB-CCC' },
    })
    expect(device.device_code).not.toBe('AAAA-BBB-CCC')
  })

  it('생성된 고유번호는 서로 겹치지 않는다', async () => {
    const token = await loginAs('school_admin')
    const codes = new Set()
    for (let i = 0; i < 30; i += 1) {
      const device = await mockServer.handle('POST', '/devices', { token, body: NEW_DEVICE })
      codes.add(device.device_code)
    }
    expect(codes.size).toBe(30)
  })

  it('장치관리자는 위임받은 장치만 본다', async () => {
    const token = await loginAs('device_mgr')
    const page = await mockServer.handle('GET', '/devices', { token, params: {} })
    expect(page.items.map((d) => d.id).sort()).toEqual([1, 2])
  })

  it('장치관리자는 장치를 삭제할 수 없다', async () => {
    const token = await loginAs('device_mgr')
    await expect(mockServer.handle('DELETE', '/devices/1', { token })).rejects.toMatchObject({
      status: 403,
    })
  })

  it('장치관리자는 위임받은 장치의 스케줄을 바꿀 수 있다', async () => {
    const token = await loginAs('device_mgr')
    const device = await mockServer.handle('PUT', '/devices/1/schedules', {
      token,
      body: { schedule_ids: [2] },
    })
    expect(device.schedules.map((s) => s.id)).toEqual([2])
  })

  it('한 장치를 여러 관리자에게 위임할 수 있다', async () => {
    const adminToken = await loginAs('admin', 'admin1234')
    // 5번(최담임)에게 DEVICE_MANAGER 역할을 준 뒤 위임한다.
    await mockServer.handle('PUT', '/users/5', {
      token: adminToken,
      body: { roles: ['HOMEROOM_TEACHER', 'DEVICE_MANAGER'] },
    })
    await mockServer.handle('PUT', '/devices/3/managers', {
      token: adminToken,
      body: { user_ids: [4, 5] },
    })
    const managers = await mockServer.handle('GET', '/devices/3/managers', { token: adminToken })
    expect(managers.map((m) => m.id).sort()).toEqual([4, 5])
  })

  it('DEVICE_MANAGER 역할이 없는 사용자에게는 위임할 수 없다', async () => {
    const token = await loginAs('admin', 'admin1234')
    await expect(
      mockServer.handle('PUT', '/devices/1/managers', { token, body: { user_ids: [6] } }),
    ).rejects.toMatchObject({ status: 400 })
  })

  it('스케줄 미배정 필터는 데모 표출 장치만 남긴다', async () => {
    const token = await loginAs('admin', 'admin1234')
    const page = await mockServer.handle('GET', '/devices', {
      token,
      params: { unassigned: true },
    })
    // 시드 크기에 기대지 않는다. 규칙은 '배정된 장치가 섞이지 않는다' 이다.
    expect(page.items.length).toBeGreaterThan(0)
    expect(page.items.every((d) => d.schedules.length === 0)).toBe(true)

    const all = await mockServer.handle('GET', '/devices', { token, params: { size: 200 } })
    expect(page.items).toHaveLength(
      all.items.filter((d) => d.schedules.length === 0).length,
    )
  })
})

describe('스케줄', () => {
  it('수정하면 버전이 올라간다', async () => {
    const token = await loginAs('school_admin')
    const before = await mockServer.handle('GET', '/schedules/1', { token })
    const after = await mockServer.handle('PUT', '/schedules/1', {
      token,
      body: { name: '이름 변경' },
    })
    expect(after.version).toBe(before.version + 1)
  })

  it('사용 중인 스케줄은 삭제할 수 없다', async () => {
    const token = await loginAs('school_admin')
    await expect(mockServer.handle('DELETE', '/schedules/1', { token })).rejects.toMatchObject({
      status: 400,
    })
  })

  it('배정을 모두 해제하면 삭제할 수 있다', async () => {
    const token = await loginAs('school_admin')
    // 이 스케줄을 쓰는 장치를 전부 찾아 푼다. 몇 대인지에 기대지 않는다.
    const all = await mockServer.handle('GET', '/devices', { token, params: { size: 500 } })
    await mockServer.handle('POST', '/devices/schedule/bulk', {
      token,
      body: {
        device_ids: all.items
          .filter((d) => d.schedules.some((s) => s.id === 1))
          .map((d) => d.id),
        schedule_ids: [],
      },
    })
    const result = await mockServer.handle('DELETE', '/schedules/1', { token })
    expect(result.detail).toContain('삭제')
  })

  it('복제하면 아이템까지 복사되고 새 id 를 받는다', async () => {
    const token = await loginAs('school_admin')
    const source = await mockServer.handle('GET', '/schedules/1', { token })
    const copy = await mockServer.handle('POST', '/schedules/1/duplicate', { token })
    expect(copy.id).not.toBe(source.id)
    expect(copy.name).toContain('복사본')
    expect(copy.items).toHaveLength(source.items.length)
    expect(copy.items[0].id).not.toBe(source.items[0].id)
  })

  it('아이템 콘텐츠 JSON 이 그대로 왕복한다', async () => {
    const token = await loginAs('school_admin')
    const document = {
      version: 1,
      layout: { width: 1080, height: 1920, background: '#123456' },
      elements: [
        { id: 'x1', type: 'widget', widget_key: 'clock', rect: { x: 1, y: 2, w: 3, h: 4, z: 5 }, opacity: 1, options: { format: 'HH:mm' } },
      ],
    }
    const updated = await mockServer.handle('PUT', '/schedules/2', {
      token,
      body: { items: [{ day_of_week: -1, duration_sec: 20, content: document }] },
    })
    expect(updated.items[0].content).toEqual(document)
  })
})

describe('스케줄 화면 방향', () => {
  // 시드: 스케줄 1 = 가로형, 스케줄 2 = 세로형.
  //       콘텐츠 1 = 1920×1080(가로), 콘텐츠 3 = 1080×1920(세로).
  // 백엔드 tests/test_schedule_orientation.py 와 같은 규칙을 확인한다.
  const item = (extra) => ({ day_of_week: 0, start_time: '09:00:00', end_time: '10:00:00', ...extra })

  it('목록과 상세에 방향이 실린다', async () => {
    const token = await loginAs('admin', 'admin1234')
    const page = await mockServer.handle('GET', '/schedules', { token, params: {} })
    const byId = Object.fromEntries(page.items.map((s) => [s.id, s.orientation]))
    expect(byId[1]).toBe('LANDSCAPE')
    expect(byId[2]).toBe('PORTRAIT')
  })

  it('가로형 스케줄은 가로형 콘텐츠를 받는다', async () => {
    const token = await loginAs('admin', 'admin1234')
    const updated = await mockServer.handle('PUT', '/schedules/1', {
      token,
      body: { items: [item({ content_id: 1 })] },
    })
    expect(updated.items).toHaveLength(1)
  })

  it('가로형 스케줄은 세로형 콘텐츠를 거부한다', async () => {
    const token = await loginAs('admin', 'admin1234')
    await expect(
      mockServer.handle('PUT', '/schedules/1', { token, body: { items: [item({ content_id: 3 })] } }),
    ).rejects.toMatchObject({ status: 400 })
  })

  it('세로형 스케줄은 가로형 콘텐츠를 거부한다', async () => {
    const token = await loginAs('admin', 'admin1234')
    await expect(
      mockServer.handle('PUT', '/schedules/2', {
        token,
        body: { items: [{ day_of_week: -1, content_id: 1 }] },
      }),
    ).rejects.toMatchObject({ status: 400 })
  })

  it('어느 콘텐츠가 왜 안 되는지 말해 준다', async () => {
    const token = await loginAs('admin', 'admin1234')
    await expect(
      mockServer.handle('PUT', '/schedules/1', { token, body: { items: [item({ content_id: 3 })] } }),
    ).rejects.toMatchObject({ detail: expect.stringContaining('가을 운동회') })
  })

  it('인라인 콘텐츠의 방향도 검사한다', async () => {
    const token = await loginAs('admin', 'admin1234')
    await expect(
      mockServer.handle('PUT', '/schedules/1', {
        token,
        body: {
          items: [item({ content: { version: 1, layout: { width: 1080, height: 1920 }, elements: [] } })],
        },
      }),
    ).rejects.toMatchObject({ status: 400 })
  })

  it('크기를 모르는 인라인 콘텐츠는 통과시킨다', async () => {
    // 아직 아무것도 배치하지 않은 빈 아이템까지 막으면 편집을 시작할 수 없다.
    const token = await loginAs('admin', 'admin1234')
    const updated = await mockServer.handle('PUT', '/schedules/1', {
      token,
      body: { items: [item({ content: { version: 1, elements: [] } })] },
    })
    expect(updated.items).toHaveLength(1)
  })

  it('붙어 있는 콘텐츠와 안 맞는 방향으로는 못 바꾼다', async () => {
    const token = await loginAs('admin', 'admin1234')
    await expect(
      mockServer.handle('PUT', '/schedules/1', { token, body: { orientation: 'PORTRAIT' } }),
    ).rejects.toMatchObject({ status: 400 })
  })

  it('거부된 방향 변경은 저장되지 않는다', async () => {
    const token = await loginAs('admin', 'admin1234')
    await mockServer
      .handle('PUT', '/schedules/1', { token, body: { orientation: 'PORTRAIT' } })
      .catch(() => {})
    const after = await mockServer.handle('GET', '/schedules/1', { token })
    expect(after.orientation).toBe('LANDSCAPE')
  })

  it('콘텐츠를 함께 갈아 끼우면 방향을 바꿀 수 있다', async () => {
    const token = await loginAs('admin', 'admin1234')
    const updated = await mockServer.handle('PUT', '/schedules/1', {
      token,
      body: { orientation: 'PORTRAIT', items: [item({ content_id: 3 })] },
    })
    expect(updated.orientation).toBe('PORTRAIT')
  })

  it('새 스케줄의 기본은 가로형이다', async () => {
    const token = await loginAs('admin', 'admin1234')
    const created = await mockServer.handle('POST', '/schedules', {
      token,
      body: { name: '기본', org_id: 3 },
    })
    expect(created.orientation).toBe('LANDSCAPE')
  })

  it('복제하면 방향이 따라온다', async () => {
    // 안 따라오면 복사본의 아이템이 전부 방향 불일치가 된다.
    const token = await loginAs('admin', 'admin1234')
    const copy = await mockServer.handle('POST', '/schedules/2/duplicate', { token })
    expect(copy.orientation).toBe('PORTRAIT')
  })
})

describe('장치 원격 제어', () => {
  // 시드: 장치 1 = 온라인, 장치 3 = 오프라인.
  // 백엔드 tests/test_device_screenshot.py 와 같은 규칙을 확인한다.
  const send = (token, id, command) =>
    mockServer.handle('POST', `/devices/${id}/command`, { token, params: { command } })

  it.each(['reload', 'restart', 'shutdown', 'screenshot'])(
    '온라인 장치는 %s 명령을 받는다',
    async (command) => {
      const token = await loginAs('admin', 'admin1234')
      const result = await send(token, 1, command)
      expect(result.detail).toBeTruthy()
    },
  )

  it('사람이 읽는 이름으로 알려 준다', async () => {
    const token = await loginAs('admin', 'admin1234')
    expect((await send(token, 1, 'shutdown')).detail).toContain('끄기')
  })

  it('오프라인 장치에는 보낼 수 없다', async () => {
    // 명령은 WebSocket 으로만 나간다. 성공했다고 하면 안 된다.
    const token = await loginAs('admin', 'admin1234')
    await expect(send(token, 3, 'reload')).rejects.toMatchObject({ status: 400 })
  })

  it('모르는 명령은 거부한다', async () => {
    const token = await loginAs('admin', 'admin1234')
    await expect(send(token, 1, '포맷')).rejects.toMatchObject({ status: 400 })
  })

  it('미리보기를 보내면 캡처 시각이 갱신된다', async () => {
    const token = await loginAs('admin', 'admin1234')
    const before = (await mockServer.handle('GET', '/devices/1', { token })).screenshot_at
    await send(token, 1, 'screenshot')
    const after = (await mockServer.handle('GET', '/devices/1', { token })).screenshot_at
    expect(after).not.toBe(before)
  })
})

describe('장치 화면 캡처', () => {
  it('캡처를 올린 장치는 이미지를 준다', async () => {
    expect(mockServer.imageUrl('/devices/1/screenshot')).toContain('data:image/svg+xml')
  })

  it('캡처가 없는 장치는 null', async () => {
    // 실제 서버에서도 404 이고, 화면은 안내 문구를 대신 보여 준다.
    expect(mockServer.imageUrl('/devices/4/screenshot')).toBeNull()
  })

  it('없는 장치도 null', () => {
    expect(mockServer.imageUrl('/devices/999/screenshot')).toBeNull()
  })

  it('다른 경로는 처리하지 않는다', () => {
    expect(mockServer.imageUrl('/devices/1')).toBeNull()
  })
})

describe('장치그룹', () => {
  // 백엔드 tests/test_device_groups.py 와 같은 규칙을 확인한다.
  const create = (token, body) => mockServer.handle('POST', '/device-groups', { token, body })
  const list = (token) => mockServer.handle('GET', '/device-groups', { token })

  it('내 그룹만 보인다', async () => {
    // 장치그룹은 사용자 개인의 묶음이다. 남의 그룹이 섞이면 안 된다.
    const admin = await loginAs('admin', 'admin1234')
    expect((await list(admin)).map((g) => g.name)).toEqual(['본관 1층'])

    const teacher = await loginAs('school_admin')
    expect(await list(teacher)).toEqual([])
  })

  it('장치를 담아 만든다', async () => {
    const token = await loginAs('admin', 'admin1234')
    const group = await create(token, { name: '2층', device_ids: [2, 4] })
    expect(group.device_ids).toEqual([2, 4])
  })

  it('중복 장치는 한 번만 담는다', async () => {
    // 실제 서버는 UNIQUE 제약이 있어 두 번 담으면 저장이 통째로 실패한다.
    const token = await loginAs('admin', 'admin1234')
    const group = await create(token, { name: '중복', device_ids: [2, 2] })
    expect(group.device_ids).toEqual([2])
  })

  it('없는 장치는 담을 수 없다', async () => {
    const token = await loginAs('admin', 'admin1234')
    await expect(create(token, { name: 'x', device_ids: [999] })).rejects.toMatchObject({
      status: 400,
    })
  })

  it('볼 수 없는 장치는 담을 수 없다', async () => {
    // teacher 는 가나초등학교 소속이라 다라중 장치(5번)가 보이지 않는다.
    const token = await loginAs('teacher')
    await expect(create(token, { name: 'x', device_ids: [5] })).rejects.toMatchObject({
      status: 403,
    })
  })

  it('이름만 바꾸면 구성원은 그대로다', async () => {
    const token = await loginAs('admin', 'admin1234')
    const updated = await mockServer.handle('PUT', '/device-groups/1', {
      token,
      body: { name: '새 이름' },
    })
    expect(updated.name).toBe('새 이름')
    expect(updated.device_ids).toEqual([1, 3])
  })

  it('빈 배열을 주면 구성원을 비운다', async () => {
    const token = await loginAs('admin', 'admin1234')
    const updated = await mockServer.handle('PUT', '/device-groups/1', {
      token,
      body: { device_ids: [] },
    })
    expect(updated.device_ids).toEqual([])
  })

  it('남의 그룹은 고칠 수 없다', async () => {
    const token = await loginAs('school_admin')
    await expect(
      mockServer.handle('PUT', '/device-groups/1', { token, body: { name: '가로채기' } }),
    ).rejects.toMatchObject({ status: 403 })
  })

  it('없는 그룹은 404', async () => {
    const token = await loginAs('admin', 'admin1234')
    await expect(
      mockServer.handle('DELETE', '/device-groups/999', { token }),
    ).rejects.toMatchObject({ status: 404 })
  })

  it('그룹을 지워도 장치는 남는다', async () => {
    const token = await loginAs('admin', 'admin1234')
    await mockServer.handle('DELETE', '/device-groups/1', { token })

    expect(await list(token)).toEqual([])
    const devices = await mockServer.handle('GET', '/devices', { token, params: {} })
    expect(devices.items.length).toBeGreaterThan(0)
  })

  it('지워진 장치는 구성원에서 빠진다', async () => {
    const token = await loginAs('admin', 'admin1234')
    await mockServer.handle('DELETE', '/devices/1', { token })

    expect((await list(token))[0].device_ids).toEqual([3])
  })
})

describe('자산(업로드 파일)', () => {
  /** 브라우저 File 을 흉내 낸 FormData. */
  function form(name, type, size = 1024) {
    const data = new FormData()
    data.append('file', new File(['x'.repeat(size)], name, { type }))
    return data
  }

  it('올리면 목록에 들어간다', async () => {
    const token = await loginAs('admin', 'admin1234')
    const created = await mockServer.handle('POST', '/assets', {
      token,
      body: form('poster.png', 'image/png'),
      params: {},
    })
    expect(created.kind).toBe('image')
    expect(created.filename).toBe('poster.png')

    const page = await mockServer.handle('GET', '/assets', { token, params: {} })
    expect(page.total).toBe(1)
  })

  it('동영상은 갈래가 다르다', async () => {
    const token = await loginAs('admin', 'admin1234')
    const created = await mockServer.handle('POST', '/assets', {
      token,
      body: form('intro.mp4', 'video/mp4'),
      params: {},
    })
    expect(created.kind).toBe('video')
  })

  it('갈래로 걸러 준다', async () => {
    const token = await loginAs('admin', 'admin1234')
    await mockServer.handle('POST', '/assets', { token, body: form('a.png', 'image/png'), params: {} })
    await mockServer.handle('POST', '/assets', { token, body: form('b.mp4', 'video/mp4'), params: {} })

    const page = await mockServer.handle('GET', '/assets', { token, params: { kind: 'video' } })
    expect(page.items.map((a) => a.filename)).toEqual(['b.mp4'])
  })

  it('빈 요청은 거부한다', async () => {
    const token = await loginAs('admin', 'admin1234')
    await expect(
      mockServer.handle('POST', '/assets', { token, body: new FormData(), params: {} }),
    ).rejects.toMatchObject({ status: 400 })
  })

  it('주소를 서버가 정해 준다', async () => {
    // 편집기가 경로 규칙을 알 필요가 없다.
    const token = await loginAs('admin', 'admin1234')
    const created = await mockServer.handle('POST', '/assets', {
      token,
      body: form('a.png', 'image/png'),
      params: {},
    })
    expect(created.url).toBeTruthy()
  })

  it('이름을 고칠 수 있다', async () => {
    const token = await loginAs('admin', 'admin1234')
    const created = await mockServer.handle('POST', '/assets', {
      token,
      body: form('a.png', 'image/png'),
      params: {},
    })
    const renamed = await mockServer.handle('PUT', `/assets/${created.id}`, {
      token,
      body: { filename: '행사 포스터.png' },
    })
    expect(renamed.filename).toBe('행사 포스터.png')
  })

  it('안 쓰는 파일은 지워진다', async () => {
    const token = await loginAs('admin', 'admin1234')
    const created = await mockServer.handle('POST', '/assets', {
      token,
      body: form('a.png', 'image/png'),
      params: {},
    })
    await mockServer.handle('DELETE', `/assets/${created.id}`, { token })

    const page = await mockServer.handle('GET', '/assets', { token, params: {} })
    expect(page.total).toBe(0)
  })
})

describe('재생목록 전환 효과', () => {
  it('안 주면 없음으로 저장한다', async () => {
    const token = await loginAs('admin', 'admin1234')
    const created = await mockServer.handle('POST', '/playlists', {
      token,
      body: { name: '순환', org_id: 3, items: [{ widget_key: 'notice', duration_sec: 5 }] },
    })
    expect(created.items[0].transition).toBe('none')
  })

  it('고른 효과를 그대로 저장한다', async () => {
    const token = await loginAs('admin', 'admin1234')
    const created = await mockServer.handle('POST', '/playlists', {
      token,
      body: {
        name: '순환',
        org_id: 3,
        items: [{ widget_key: 'notice', duration_sec: 5, transition: 'slide-left' }],
      },
    })
    expect(created.items[0].transition).toBe('slide-left')
  })

  it('모르는 이름은 거부한다', async () => {
    // 백엔드와 같은 규칙이다. 받아 두면 장치마다 다르게 넘어간다.
    const token = await loginAs('admin', 'admin1234')
    await expect(
      mockServer.handle('POST', '/playlists', {
        token,
        body: {
          name: '순환',
          org_id: 3,
          items: [{ widget_key: 'notice', duration_sec: 5, transition: '폭발' }],
        },
      }),
    ).rejects.toMatchObject({ status: 422 })
  })

  it('전환 시간을 저장한다', async () => {
    const token = await loginAs('admin', 'admin1234')
    const created = await mockServer.handle('POST', '/playlists', {
      token,
      body: {
        name: '순환',
        org_id: 3,
        items: [
          { widget_key: 'notice', duration_sec: 10, transition: 'fade', transition_ms: 1500 },
        ],
      },
    })
    expect(created.items[0].transition_ms).toBe(1500)
  })

  it('안 주면 600ms 다', async () => {
    const token = await loginAs('admin', 'admin1234')
    const created = await mockServer.handle('POST', '/playlists', {
      token,
      body: { name: '순환', org_id: 3, items: [{ widget_key: 'notice', duration_sec: 5 }] },
    })
    expect(created.items[0].transition_ms).toBe(600)
  })

  it('범위를 벗어난 전환 시간은 거부한다', async () => {
    const token = await loginAs('admin', 'admin1234')
    await expect(
      mockServer.handle('POST', '/playlists', {
        token,
        body: {
          name: '순환',
          org_id: 3,
          items: [
            { widget_key: 'notice', duration_sec: 30, transition: 'fade', transition_ms: 9000 },
          ],
        },
      }),
    ).rejects.toMatchObject({ status: 422 })
  })

  it('표출 시간보다 긴 전환은 거부한다', async () => {
    // 효과가 끝나기 전에 넘어가면 화면이 영영 제자리에 놓이지 않는다.
    const token = await loginAs('admin', 'admin1234')
    await expect(
      mockServer.handle('POST', '/playlists', {
        token,
        body: {
          name: '순환',
          org_id: 3,
          items: [
            { widget_key: 'notice', duration_sec: 3, transition: 'fade', transition_ms: 5000 },
          ],
        },
      }),
    ).rejects.toMatchObject({ status: 422 })
  })

  it('효과가 없으면 길이를 따지지 않는다', async () => {
    const token = await loginAs('admin', 'admin1234')
    const created = await mockServer.handle('POST', '/playlists', {
      token,
      body: {
        name: '순환',
        org_id: 3,
        items: [{ widget_key: 'notice', duration_sec: 1, transition_ms: 5000 }],
      },
    })
    expect(created.items[0].transition_ms).toBe(5000)
  })

  it('늘어난 효과를 모두 받는다', async () => {
    const token = await loginAs('admin', 'admin1234')
    const kinds = [
      'dissolve',
      'blur',
      'slide-down',
      'wipe-left',
      'wipe-right',
      'zoom-out',
      'flip',
      'rotate',
    ]
    const created = await mockServer.handle('POST', '/playlists', {
      token,
      body: {
        name: '순환',
        org_id: 3,
        items: kinds.map((kind) => ({
          widget_key: 'notice',
          duration_sec: 10,
          transition: kind,
        })),
      },
    })
    expect(created.items.map((i) => i.transition)).toEqual(kinds)
  })

  it('복제해도 효과가 따라간다', async () => {
    // 복사본이 밋밋해지면 어디가 달라졌는지 찾느라 시간을 쓴다.
    const token = await loginAs('admin', 'admin1234')
    const copy = await mockServer.handle('POST', '/playlists/1/duplicate', { token })
    expect(copy.items.map((i) => i.transition)).toEqual(['fade', 'slide-left', 'none'])
  })
})

describe('스케줄 사용 기간', () => {
  it('기간을 저장하고 돌려준다', async () => {
    const token = await loginAs('admin', 'admin1234')
    const created = await mockServer.handle('POST', '/schedules', {
      token,
      body: { name: '행사', org_id: 3, start_at: '2026-10-01T00:00:00Z' },
    })
    expect(created.start_at).toBe('2026-10-01T00:00:00Z')
  })

  it('null 을 보내면 기간을 지운다', async () => {
    // null 은 '제한 없음'이라는 뜻이라 보내온 null 도 반영해야 한다.
    const token = await loginAs('admin', 'admin1234')
    const updated = await mockServer.handle('PUT', '/schedules/2', {
      token,
      body: { start_at: null, end_at: null },
    })
    expect(updated.start_at).toBeNull()
  })

  it('앞뒤가 뒤집힌 기간은 거부한다', async () => {
    // 백엔드와 같은 규칙이다. 뒤집힌 기간은 언제나 기간 밖이라 아무 때도
    // 표출되지 않는다 — 저장은 됐는데 화면만 안 나오는 상태가 된다.
    const token = await loginAs('admin', 'admin1234')
    await expect(
      mockServer.handle('POST', '/schedules', {
        token,
        body: {
          name: '뒤집힘',
          org_id: 3,
          start_at: '2026-10-31T00:00:00Z',
          end_at: '2026-10-01T00:00:00Z',
        },
      }),
    ).rejects.toMatchObject({ status: 400 })
  })

  it('고칠 때도 앞뒤를 본다', async () => {
    const token = await loginAs('admin', 'admin1234')
    await expect(
      mockServer.handle('PUT', '/schedules/2', {
        token,
        body: { start_at: '2026-10-31T00:00:00Z', end_at: '2026-10-01T00:00:00Z' },
      }),
    ).rejects.toMatchObject({ status: 400 })
  })

  it('한쪽만 고쳐도 남아 있는 쪽과 견준다', async () => {
    // 시작만 뒤로 밀어도 이미 저장된 종료보다 늦어질 수 있다.
    const token = await loginAs('admin', 'admin1234')
    await mockServer.handle('PUT', '/schedules/2', {
      token,
      body: { start_at: '2026-10-01T00:00:00Z', end_at: '2026-10-10T00:00:00Z' },
    })
    await expect(
      mockServer.handle('PUT', '/schedules/2', {
        token,
        body: { start_at: '2026-10-20T00:00:00Z' },
      }),
    ).rejects.toMatchObject({ status: 400 })
  })
})

describe('장치 다중 스케줄', () => {
  it('여러 개를 순서대로 배정한다', async () => {
    // 순서가 곧 우선순위다.
    const token = await loginAs('admin', 'admin1234')
    const device = await mockServer.handle('PUT', '/devices/1/schedules', {
      token,
      body: { schedule_ids: [2, 1] },
    })
    expect(device.schedules.map((s) => s.id)).toEqual([2, 1])
  })

  it('같은 스케줄을 두 번 걸지 않는다', async () => {
    const token = await loginAs('admin', 'admin1234')
    const device = await mockServer.handle('PUT', '/devices/1/schedules', {
      token,
      body: { schedule_ids: [1, 1] },
    })
    expect(device.schedules).toHaveLength(1)
  })

  it('빈 목록이면 배정을 푼다', async () => {
    const token = await loginAs('admin', 'admin1234')
    const device = await mockServer.handle('PUT', '/devices/1/schedules', {
      token,
      body: { schedule_ids: [] },
    })
    expect(device.schedules).toEqual([])
  })

  it('없는 스케줄은 거부한다', async () => {
    const token = await loginAs('admin', 'admin1234')
    await expect(
      mockServer.handle('PUT', '/devices/1/schedules', { token, body: { schedule_ids: [999] } }),
    ).rejects.toMatchObject({ status: 400 })
  })

  it('기간 밖 스케줄은 걸려 있어도 active 가 false 다', async () => {
    // 시드의 스케줄 2 는 2026-10 행사 기간이라 지금은 기간 밖이다.
    const token = await loginAs('admin', 'admin1234')
    const device = await mockServer.handle('PUT', '/devices/1/schedules', {
      token,
      body: { schedule_ids: [1, 2] },
    })
    const byId = Object.fromEntries(device.schedules.map((s) => [s.id, s.active]))
    expect(byId[1]).toBe(true)
    expect(byId[2]).toBe(false)
  })
})

describe('위젯 재생목록', () => {
  it('시드 재생목록을 보여 준다', async () => {
    const token = await loginAs('admin', 'admin1234')
    const page = await mockServer.handle('GET', '/playlists', { token, params: {} })
    expect(page.items[0].name).toBe('현관 순환')
  })

  it('전체 재생 시간을 계산해 준다', async () => {
    const token = await loginAs('admin', 'admin1234')
    const page = await mockServer.handle('GET', '/playlists', { token, params: {} })
    expect(page.items[0].total_duration_sec).toBe(35)
  })

  it('위젯을 담아 만든다', async () => {
    const token = await loginAs('admin', 'admin1234')
    const created = await mockServer.handle('POST', '/playlists', {
      token,
      body: { name: '새 순환', org_id: 3, items: [{ widget_key: 'clock', duration_sec: 5 }] },
    })
    expect(created.items.map((i) => i.widget_key)).toEqual(['clock'])
  })

  it('없는 위젯은 거부한다', async () => {
    const token = await loginAs('admin', 'admin1234')
    await expect(
      mockServer.handle('POST', '/playlists', {
        token,
        body: { name: 'x', org_id: 3, items: [{ widget_key: '없는위젯' }] },
      }),
    ).rejects.toMatchObject({ status: 400 })
  })

  it('고치면 버전이 올라간다', async () => {
    // 이 값이 콘텐츠·스케줄로 번져 장치가 변경을 받아 간다.
    const token = await loginAs('admin', 'admin1234')
    const before = await mockServer.handle('GET', '/playlists/1', { token })
    const after = await mockServer.handle('PUT', '/playlists/1', {
      token,
      body: { name: '수정' },
    })
    expect(after.version).toBe(before.version + 1)
  })

  it('쓰는 콘텐츠가 있으면 삭제를 막는다', async () => {
    const token = await loginAs('admin', 'admin1234')
    // 콘텐츠 문서에 재생목록 요소를 넣는다.
    await mockServer.handle('POST', '/contents', {
      token,
      body: {
        name: '재생목록 콘텐츠',
        org_id: 3,
        document: {
          version: 1,
          elements: [{ id: 'e1', type: 'playlist', options: { playlist_id: 1 } }],
        },
      },
    })
    await expect(
      mockServer.handle('DELETE', '/playlists/1', { token }),
    ).rejects.toMatchObject({ status: 400 })
  })

  it('안 쓰이면 지울 수 있다', async () => {
    const token = await loginAs('admin', 'admin1234')
    const result = await mockServer.handle('DELETE', '/playlists/1', { token })
    expect(result.detail).toContain('삭제')
  })
})

describe('라우팅', () => {
  it('지원하지 않는 경로는 404 로 알린다', async () => {
    await expect(mockServer.handle('GET', '/없는경로', {})).rejects.toMatchObject({ status: 404 })
  })

  it('위젯 목록을 반환한다', async () => {
    const token = await loginAs('admin', 'admin1234')
    const specs = await mockServer.handle('GET', '/widgets', { token })
    expect(specs.length).toBeGreaterThan(10)
    expect(specs.map((s) => s.key)).toContain('notice')
  })
})
