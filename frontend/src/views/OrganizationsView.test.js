/**
 * 기관 관리 화면 테스트.
 *
 * 트리에는 **모든 기관**을 그린다 — 학교 같은 잎 기관도 트리에서 바로 고른다.
 * 오른쪽 상세의 아래쪽은 그 기관에 **직접 소속된 사용자** 목록이다.
 * 최상위 기관도 이름을 고칠 수 있어야 한다(삭제만 막는다).
 */
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { i18n } from '@/i18n'

/** 기관 한 건. 트리 응답과 같은 모양이면 되고, 안 쓰는 필드는 기본값으로 채운다. */
function org(id, name, parentId, children = [], extra = {}) {
  return {
    id,
    name,
    parent_id: parentId,
    org_type: '기관',
    school_level: null,
    address: null,
    latitude: null,
    longitude: null,
    edu_office_code: null,
    school_code: null,
    children,
    ...extra,
  }
}

const school = (id, name, parentId, level) =>
  org(id, name, parentId, [], { org_type: '학교', school_level: level })

/** 최상위 - 교육청 - 학교 3단계. 부산광역시교육청은 일부러 자식이 없다. */
const BASE_TREE = [
  org(1, '최상위 기관', null, [
    org(2, '서울특별시교육청', 1, [school(3, '가나초등학교', 2, '초'), school(4, '다라중학교', 2, '중')], {
      address: '서울시 종로구',
      edu_office_code: 'B10',
    }),
    org(5, '부산광역시교육청', 1, []),
  ]),
]

/** 사용자 한 명. /users 응답의 최소 모양. */
function user(id, userId, name, orgId, roles = ['MEMBER'], extra = {}) {
  return { id, user_id: userId, name, org_id: orgId, roles, status: '승인', phone: null, ...extra }
}

/** 검색창은 소속 사용자가 많을 때만 나온다. 서울교육청에 6명을 둔다. */
const USERS = [
  user(1, 'admin', '시스템 관리자', 1, ['MEMBER', 'SUPER_ADMIN']),
  user(2, 'edu_admin', '박교육', 2, ['MEMBER', 'ORG_ADMIN'], { phone: '010-1111-2222' }),
  user(3, 'staff1', '이연구', 2),
  user(4, 'staff2', '최장학', 2),
  user(5, 'staff3', '정행정', 2, ['MEMBER'], { status: '미승인' }),
  user(6, 'staff4', '한지원', 2),
  user(7, 'staff5', '오통계', 2),
  // 학교(org 3) 소속 — 교육청을 고르면 하위 트리 응답에는 섞여 오지만
  // "직접 소속" 목록에는 나오면 안 된다.
  user(8, 'principal', '김교장', 3, ['MEMBER', 'ORG_ADMIN']),
]

let treeData = BASE_TREE

const put = vi.fn(async (path, body) => ({ id: 1, ...body }))
const del = vi.fn(async () => ({}))
const get = vi.fn(async (path) => {
  if (path === '/organizations/tree') return JSON.parse(JSON.stringify(treeData))
  if (path === '/users') return { items: USERS, total: USERS.length, page: 1, size: 200 }
  return []
})

/** 일괄 등록. 진행률 콜백을 받는지 보려면 이름을 붙여 둬야 한다. */
const upload = vi.fn(async () => ({ created: 0, skipped: 0, errors: [] }))

const post = vi.fn(async () => ({ id: 99 }))

vi.mock('@/api/client', () => ({
  api: {
    get: (...args) => get(...args),
    post: (...args) => post(...args),
    put: (...args) => put(...args),
    delete: (...args) => del(...args),
    upload: (...args) => upload(...args),
  },
  TEST_MODE: false,
  getToken: () => null,
  setToken: vi.fn(),
}))

import OrganizationsView from './OrganizationsView.vue'

async function mountView() {
  setActivePinia(createPinia())
  const wrapper = mount(OrganizationsView, {
    global: {
      plugins: [createPinia(), i18n],
      stubs: { RouterLink: { template: '<a><slot /></a>' } },
    },
  })
  await flushPromises()
  return wrapper
}

/** 트리에 그려진 기관 이름들. */
const treeNames = (wrapper) => wrapper.findAll('.node-name').map((n) => n.text())

/** 소속 사용자 목록의 이름들. */
const memberNames = (wrapper) =>
  wrapper.findAll('[data-test="member-row"]').map((row) => row.find('td').text())

/** 트리에서 이름으로 고른다. */
async function selectInTree(wrapper, name) {
  const node = wrapper.findAll('.node').find((n) => n.text().includes(name))
  await node.trigger('click')
  await flushPromises()
}

const heading = (wrapper) => wrapper.find('.detail-panel .card-header h2').text()

function actionButton(wrapper, label) {
  return wrapper.findAll('.detail-panel .card-header .btn').find((b) => b.text() === label)
}

beforeEach(() => {
  treeData = BASE_TREE
  put.mockClear()
  get.mockClear()
  del.mockClear()
  post.mockClear()
  i18n.global.locale.value = 'ko'
})

describe('기관 트리', () => {
  it('모든 기관을 그린다 — 학교 같은 잎 기관도 포함', async () => {
    const wrapper = await mountView()
    expect(treeNames(wrapper)).toEqual([
      '최상위 기관',
      '서울특별시교육청',
      '가나초등학교',
      '다라중학교',
      '부산광역시교육청',
    ])
  })

  it('소속기관 수를 배지로 알려 준다', async () => {
    // 이 숫자가 없으면 비어 있는 기관과 학교가 잔뜩인 기관이 접힌 상태에서 똑같아 보인다.
    const wrapper = await mountView()
    const seoul = wrapper.findAll('.node').find((n) => n.text().includes('서울특별시교육청'))
    expect(seoul.find('.count').text()).toBe('2')
  })

  it('최상위 하나뿐이어도 트리가 비지 않는다', async () => {
    treeData = [org(1, '최상위 기관', null, [])]
    const wrapper = await mountView()
    expect(treeNames(wrapper)).toEqual(['최상위 기관'])
  })

  it('처음 들어오면 최상위 기관을 골라 둔다', async () => {
    const wrapper = await mountView()
    expect(heading(wrapper)).toBe('최상위 기관')
  })

  it('학교를 트리에서 바로 골라 상세를 연다', async () => {
    const wrapper = await mountView()
    await selectInTree(wrapper, '가나초등학교')

    expect(heading(wrapper)).toBe('가나초등학교')
    expect(wrapper.findAll('.crumbs .crumb').map((c) => c.text())).toEqual([
      '최상위 기관',
      '서울특별시교육청',
      '가나초등학교',
    ])
  })

  it('빵부스러기로 상위 기관에 돌아간다', async () => {
    const wrapper = await mountView()
    await selectInTree(wrapper, '가나초등학교')

    const up = wrapper.findAll('.crumbs .crumb').find((c) => c.text() === '서울특별시교육청')
    await up.trigger('click')
    await flushPromises()

    expect(heading(wrapper)).toBe('서울특별시교육청')
  })

  it('자식 없는 기관도 트리에서 골라 소속기관을 추가할 수 있다', async () => {
    const wrapper = await mountView()
    await selectInTree(wrapper, '부산광역시교육청')

    expect(heading(wrapper)).toBe('부산광역시교육청')
    expect(actionButton(wrapper, '소속기관 추가').attributes('disabled')).toBeUndefined()
  })
})

describe('소속 사용자 목록', () => {
  it('기관 정보를 위에, 소속 사용자 목록을 아래에 둔다', async () => {
    const wrapper = await mountView()
    const blocks = [...wrapper.find('.detail-panel').element.children].map((el) => el.className)
    expect(blocks).toEqual(['card-header', 'card-body', 'children'])
  })

  it('고른 기관에 직접 소속된 사용자만 보여 준다', async () => {
    // /users?org_id= 는 하위 트리 전체를 돌려주지만, 학교(김교장) 소속은
    // 교육청 목록에 섞이면 안 된다.
    const wrapper = await mountView()
    await selectInTree(wrapper, '서울특별시교육청')

    const names = memberNames(wrapper)
    expect(names).toContain('박교육')
    expect(names).not.toContain('김교장')
    expect(names).not.toContain('시스템 관리자')
  })

  it('역할·상태·연락처를 함께 보여 준다', async () => {
    const wrapper = await mountView()
    await selectInTree(wrapper, '서울특별시교육청')

    const rows = wrapper.findAll('[data-test="member-row"]')
    const eduAdmin = rows.find((row) => row.text().includes('박교육'))
    expect(eduAdmin.text()).toContain('기관관리자')
    expect(eduAdmin.text()).toContain('010-1111-2222')

    const pending = rows.find((row) => row.text().includes('정행정'))
    expect(pending.text()).toContain('미승인')
  })

  it('소속 사용자가 없으면 그렇게 말한다', async () => {
    const wrapper = await mountView()
    await selectInTree(wrapper, '부산광역시교육청')

    expect(wrapper.findAll('[data-test="member-row"]')).toHaveLength(0)
    expect(wrapper.find('.children').text()).toContain('소속된 사용자가 없습니다')
  })

  it('관리자가 고른 기관에 사용자를 바로 등록한다', async () => {
    const wrapper = await mountView()
    await selectInTree(wrapper, '부산광역시교육청')

    await wrapper.find('[data-test="add-member"]').trigger('click')
    await wrapper.find('[data-test="member-user-id"]').setValue('busan_staff')
    await wrapper.find('[data-test="member-name"]').setValue('부산직원')
    await wrapper.find('[data-test="member-password"]').setValue('test1234')
    await wrapper.find('[data-test="member-password-confirm"]').setValue('test1234')
    await wrapper.find('.dialog-foot .btn-primary').trigger('click')
    await flushPromises()

    const [path, body] = post.mock.calls[0]
    expect(path).toBe('/users')
    expect(body.org_id).toBe(5)
    expect(body.user_id).toBe('busan_staff')
    expect(body.name).toBe('부산직원')
    // 저장 뒤 목록을 다시 읽는다.
    expect(get.mock.calls.filter(([p]) => p === '/users').length).toBeGreaterThan(1)
  })

  it('비밀번호 확인이 다르면 보내지 않고 알려 준다', async () => {
    const wrapper = await mountView()
    await selectInTree(wrapper, '부산광역시교육청')

    await wrapper.find('[data-test="add-member"]').trigger('click')
    await wrapper.find('[data-test="member-user-id"]').setValue('busan_staff')
    await wrapper.find('[data-test="member-name"]').setValue('부산직원')
    await wrapper.find('[data-test="member-password"]').setValue('test1234')
    await wrapper.find('[data-test="member-password-confirm"]').setValue('test5678')
    await wrapper.find('.dialog-foot .btn-primary').trigger('click')
    await flushPromises()

    expect(post).not.toHaveBeenCalled()
    expect(wrapper.find('.error-text').text()).toContain('일치하지 않습니다')
  })
})

describe('소속 사용자 검색', () => {
  it('목록이 짧으면 검색창을 띄우지 않는다', async () => {
    const wrapper = await mountView()
    await selectInTree(wrapper, '최상위 기관')
    expect(wrapper.find('.child-search').exists()).toBe(false)
  })

  it('목록이 길면 이름으로 거른다', async () => {
    const wrapper = await mountView()
    await selectInTree(wrapper, '서울특별시교육청')

    await wrapper.find('.child-search').setValue('장학')
    expect(memberNames(wrapper)).toEqual(['최장학'])
  })

  it('사용자ID로도 거른다', async () => {
    const wrapper = await mountView()
    await selectInTree(wrapper, '서울특별시교육청')

    await wrapper.find('.child-search').setValue('edu_admin')
    expect(memberNames(wrapper)).toEqual(['박교육'])
  })

  it('기관을 옮기면 검색어를 지운다', async () => {
    // 검색어가 남아 있으면 다음 기관의 목록이 비어 있는 것처럼 보인다.
    const wrapper = await mountView()
    await selectInTree(wrapper, '서울특별시교육청')
    await wrapper.find('.child-search').setValue('없는이름')
    await selectInTree(wrapper, '최상위 기관')
    await selectInTree(wrapper, '서울특별시교육청')

    expect(memberNames(wrapper)).toHaveLength(6)
  })
})

describe('최상위 기관 이름 편집', () => {
  it('수정 버튼을 쓸 수 있다', async () => {
    const wrapper = await mountView()
    await selectInTree(wrapper, '최상위 기관')

    const edit = actionButton(wrapper, '수정')
    expect(edit.attributes('disabled')).toBeUndefined()
  })

  it('수정 창이 현재 이름을 채워 연다', async () => {
    const wrapper = await mountView()
    await selectInTree(wrapper, '최상위 기관')
    await actionButton(wrapper, '수정').trigger('click')
    await flushPromises()

    expect(wrapper.find('.dialog').exists()).toBe(true)
    expect(wrapper.find('.dialog input').element.value).toBe('최상위 기관')
  })

  it('이름을 바꿔 저장한다', async () => {
    const wrapper = await mountView()
    await selectInTree(wrapper, '최상위 기관')
    await actionButton(wrapper, '수정').trigger('click')
    await flushPromises()

    await wrapper.find('.dialog input').setValue('우리교육그룹')
    await wrapper.find('.dialog-foot .btn-primary').trigger('click')
    await flushPromises()

    expect(put).toHaveBeenCalledTimes(1)
    const [path, body] = put.mock.calls[0]
    expect(path).toBe('/organizations/1')
    expect(body.name).toBe('우리교육그룹')
  })

  it('최상위 상태를 유지한 채 저장한다', async () => {
    // parent_id 에 값이 붙으면 서버가 "최상위 기관은 하위로 이동할 수 없다"로 막는다.
    const wrapper = await mountView()
    await selectInTree(wrapper, '최상위 기관')
    await actionButton(wrapper, '수정').trigger('click')
    await flushPromises()

    await wrapper.find('.dialog input').setValue('우리교육그룹')
    await wrapper.find('.dialog-foot .btn-primary').trigger('click')
    await flushPromises()

    expect(put.mock.calls[0][1].parent_id).toBeNull()
  })

  it('저장 후 트리를 다시 읽는다', async () => {
    const wrapper = await mountView()
    await selectInTree(wrapper, '최상위 기관')
    await actionButton(wrapper, '수정').trigger('click')
    await flushPromises()

    get.mockClear()
    await wrapper.find('.dialog input').setValue('우리교육그룹')
    await wrapper.find('.dialog-foot .btn-primary').trigger('click')
    await flushPromises()

    expect(get).toHaveBeenCalledWith('/organizations/tree')
  })
})

describe('기관 삭제', () => {
  it('최상위 기관의 삭제 버튼은 막혀 있다', async () => {
    // 최상위 기관이 사라지면 회원가입도 기관 등록도 불가능해진다.
    const wrapper = await mountView()
    await selectInTree(wrapper, '최상위 기관')

    expect(actionButton(wrapper, '삭제').attributes('disabled')).toBeDefined()
  })

  it('왜 막혔는지, 무엇은 되는지 알려 준다', async () => {
    // 이유가 없으면 '최상위는 전부 잠긴 것'으로 읽혀 이름 수정도 포기하게 된다.
    const wrapper = await mountView()
    await selectInTree(wrapper, '최상위 기관')

    expect(actionButton(wrapper, '삭제').attributes('title')).toContain(
      '이름과 주소는 수정할 수 있습니다',
    )
    expect(wrapper.find('.root-note').text()).toContain("'수정'으로 바꿀 수 있습니다")
  })

  it('최상위가 아닌 기관은 삭제할 수 있다', async () => {
    const wrapper = await mountView()
    await selectInTree(wrapper, '서울특별시교육청')

    expect(actionButton(wrapper, '삭제').attributes('disabled')).toBeUndefined()
  })

  it('학교를 지우면 소속 교육청으로 올라간다', async () => {
    // 지운 기관에 머무르면 빈 화면이 남는다. 상위 기관으로 돌려보낸다.
    vi.stubGlobal('confirm', () => true)
    const wrapper = await mountView()
    await selectInTree(wrapper, '가나초등학교')

    await actionButton(wrapper, '삭제').trigger('click')
    await flushPromises()

    expect(del).toHaveBeenCalledWith('/organizations/3')
    expect(heading(wrapper)).toBe('서울특별시교육청')
    vi.unstubAllGlobals()
  })
})

describe('엑셀 일괄 등록 진행률', () => {
  // 수백 줄짜리 엑셀은 보내는 데도, 서버가 읽는 데도 시간이 걸린다.
  // 아무 말 없이 기다리게 하면 멈춘 줄 알고 다시 누른다.

  const bar = (wrapper) => wrapper.findComponent({ name: 'ProgressBar' })

  /** 일괄 등록 창을 열고 파일을 고른다. */
  async function openUpload(wrapper) {
    await wrapper.findAll('.btn').find((b) => b.text().includes('일괄')).trigger('click')
    await flushPromises()
    const input = wrapper.find('input[type="file"]')
    const file = new File(['x'], '기관목록.xlsx', { type: 'application/vnd.ms-excel' })
    Object.defineProperty(input.element, 'files', { value: [file], configurable: true })
    await input.trigger('change')
    return input
  }

  it('올리기 전에는 막대가 없다', async () => {
    const wrapper = await mountView()
    await openUpload(wrapper)

    expect(bar(wrapper).exists()).toBe(false)
  })

  it('올리는 동안 막대를 띄우고 끝나면 걷는다', async () => {
    let release
    upload.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = () => resolve({ created: 3, skipped: 0, errors: [] })
        }),
    )
    const wrapper = await mountView()
    await openUpload(wrapper)

    await wrapper.find('.dialog-foot .btn-primary').trigger('click')
    await flushPromises()
    expect(bar(wrapper).exists()).toBe(true)

    release()
    await flushPromises()
    expect(bar(wrapper).exists()).toBe(false)
  })

  it('보낸 양을 알려 달라고 요청한다', async () => {
    const wrapper = await mountView()
    await openUpload(wrapper)

    await wrapper.find('.dialog-foot .btn-primary').trigger('click')
    await flushPromises()

    expect(typeof upload.mock.calls.at(-1)[3]?.onProgress).toBe('function')
  })
})
