/**
 * 기관 관리 화면 테스트.
 *
 * 트리에는 하위 기관을 가진 기관만 그리고, 잎 기관(학교 등)은 오른쪽 목록이 맡는다.
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

/**
 * 최상위 - 교육청 - 학교 3단계.
 *
 * 부산광역시교육청은 일부러 자식을 비워 뒀다. 자식 없는 중간 기관이
 * 트리에서 빠진 뒤에도 목록을 통해 닿을 수 있어야 한다.
 */
const BASE_TREE = [
  org(1, '최상위 기관', null, [
    org(2, '서울특별시교육청', 1, [school(3, '가나초등학교', 2, '초'), school(4, '다라중학교', 2, '중')], {
      address: '서울시 종로구',
      edu_office_code: 'B10',
    }),
    org(5, '부산광역시교육청', 1, []),
  ]),
]

/** 검색창은 하위 기관이 많을 때만 나온다. 그 조건을 만들려고 따로 둔다. */
const MANY_TREE = [
  org(1, '최상위 기관', null, [
    org(2, '서울특별시교육청', 1, [
      school(11, '가나초등학교', 2, '초'),
      school(12, '다라중학교', 2, '중'),
      school(13, '마바고등학교', 2, '고'),
      school(14, '사아초등학교', 2, '초'),
      school(15, '자차중학교', 2, '중'),
      school(16, '카타고등학교', 2, '고'),
    ]),
  ]),
]

let treeData = BASE_TREE

const put = vi.fn(async (path, body) => ({ id: 1, ...body }))
const del = vi.fn(async () => ({}))
const get = vi.fn(async (path) => {
  if (path === '/organizations/tree') return JSON.parse(JSON.stringify(treeData))
  return []
})

/** 일괄 등록. 진행률 콜백을 받는지 보려면 이름을 붙여 둬야 한다. */
const upload = vi.fn(async () => ({ created: 0, skipped: 0, errors: [] }))

vi.mock('@/api/client', () => ({
  api: {
    get: (...args) => get(...args),
    post: vi.fn(async () => ({})),
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

/** 오른쪽 목록에 그려진 기관 이름들. */
const childNames = (wrapper) => wrapper.findAll('.child-name').map((n) => n.text())

/** 트리에서 이름으로 고른다. */
async function selectInTree(wrapper, name) {
  const node = wrapper.findAll('.node').find((n) => n.text().includes(name))
  await node.trigger('click')
  await flushPromises()
}

/** 오른쪽 목록에서 이름으로 고른다. */
async function selectInList(wrapper, name) {
  const row = wrapper.findAll('.child-name').find((n) => n.text() === name)
  await row.trigger('click')
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
  i18n.global.locale.value = 'ko'
})

describe('기관 트리', () => {
  it('하위 기관을 가진 기관만 그린다', async () => {
    const wrapper = await mountView()
    expect(treeNames(wrapper)).toEqual(['최상위 기관', '서울특별시교육청'])
  })

  it('학교는 트리에 넣지 않는다', async () => {
    // 교육청 하나에 학교가 수백 개 달릴 수 있어 트리로는 탐색이 안 된다.
    const wrapper = await mountView()
    expect(treeNames(wrapper)).not.toContain('가나초등학교')
    expect(treeNames(wrapper)).not.toContain('다라중학교')
  })

  it('자식이 없는 중간 기관도 트리에 넣지 않는다', async () => {
    const wrapper = await mountView()
    expect(treeNames(wrapper)).not.toContain('부산광역시교육청')
  })

  it('트리에 안 그린 하위 기관이 몇 개인지 배지로 알려 준다', async () => {
    // 이 숫자가 없으면 비어 있는 기관과 학교가 잔뜩인 기관이 똑같아 보인다.
    const wrapper = await mountView()
    const seoul = wrapper.findAll('.node').find((n) => n.text().includes('서울특별시교육청'))
    expect(seoul.find('.count').text()).toBe('2')
  })

  it('최상위 기관은 자식이 없어도 남긴다', async () => {
    // 부트스트랩 직후엔 최상위 하나뿐이다. 트리가 비면 첫 하위 기관도 못 만든다.
    treeData = [org(1, '최상위 기관', null, [])]
    const wrapper = await mountView()
    expect(treeNames(wrapper)).toEqual(['최상위 기관'])
  })

  it('처음 들어오면 최상위 기관을 골라 둔다', async () => {
    const wrapper = await mountView()
    expect(heading(wrapper)).toBe('최상위 기관')
  })
})

describe('하위 기관 목록', () => {
  it('기관 정보를 위에, 하위 기관 목록을 아래에 둔다', async () => {
    const wrapper = await mountView()
    const blocks = [...wrapper.find('.detail-panel').element.children].map((el) => el.className)
    expect(blocks).toEqual(['card-header', 'card-body', 'children'])
  })

  it('고른 기관의 직계 하위 기관을 보여 준다', async () => {
    const wrapper = await mountView()
    await selectInTree(wrapper, '서울특별시교육청')
    expect(childNames(wrapper)).toEqual(['가나초등학교', '다라중학교'])
  })

  it('손자는 목록에 섞지 않는다', async () => {
    const wrapper = await mountView()
    await selectInTree(wrapper, '최상위 기관')
    expect(childNames(wrapper)).toEqual(['서울특별시교육청', '부산광역시교육청'])
  })

  it('목록에서 고르면 그 기관의 상세가 열린다', async () => {
    const wrapper = await mountView()
    await selectInTree(wrapper, '서울특별시교육청')
    await selectInList(wrapper, '가나초등학교')

    expect(heading(wrapper)).toBe('가나초등학교')
    expect(wrapper.find('.detail-panel').text()).toContain('초등학교')
  })

  it('트리에 없는 기관을 골라도 어디인지 알려 준다', async () => {
    // 학교는 트리에 없으므로 빵부스러기 말고는 위치를 알 방법이 없다.
    const wrapper = await mountView()
    await selectInTree(wrapper, '서울특별시교육청')
    await selectInList(wrapper, '가나초등학교')

    expect(wrapper.findAll('.crumbs .crumb').map((c) => c.text())).toEqual([
      '최상위 기관',
      '서울특별시교육청',
      '가나초등학교',
    ])
  })

  it('빵부스러기로 상위 기관에 돌아간다', async () => {
    const wrapper = await mountView()
    await selectInTree(wrapper, '서울특별시교육청')
    await selectInList(wrapper, '가나초등학교')

    const up = wrapper.findAll('.crumbs .crumb').find((c) => c.text() === '서울특별시교육청')
    await up.trigger('click')
    await flushPromises()

    expect(heading(wrapper)).toBe('서울특별시교육청')
  })

  it('트리에서 빠진 빈 기관도 목록을 통해 고를 수 있다', async () => {
    // 자식이 없어 트리에 안 나오는 교육청. 여기서 못 고르면 학교를 못 넣는다.
    const wrapper = await mountView()
    await selectInList(wrapper, '부산광역시교육청')

    expect(heading(wrapper)).toBe('부산광역시교육청')
    expect(actionButton(wrapper, '하위 기관 추가').attributes('disabled')).toBeUndefined()
  })

  it('하위 기관이 없으면 무엇을 하면 되는지 알려 준다', async () => {
    const wrapper = await mountView()
    await selectInList(wrapper, '부산광역시교육청')

    expect(wrapper.find('.children').text()).toContain('하위 기관 추가')
    expect(wrapper.findAll('.child-name')).toHaveLength(0)
  })
})

describe('하위 기관 검색', () => {
  it('목록이 짧으면 검색창을 띄우지 않는다', async () => {
    const wrapper = await mountView()
    await selectInTree(wrapper, '서울특별시교육청')
    expect(wrapper.find('.child-search').exists()).toBe(false)
  })

  it('목록이 길면 검색으로 거른다', async () => {
    treeData = MANY_TREE
    const wrapper = await mountView()
    await selectInTree(wrapper, '서울특별시교육청')

    await wrapper.find('.child-search').setValue('중학교')
    expect(childNames(wrapper)).toEqual(['다라중학교', '자차중학교'])
  })

  it('기관을 옮기면 검색어를 지운다', async () => {
    // 검색어가 남아 있으면 다음 기관의 목록이 비어 있는 것처럼 보인다.
    treeData = MANY_TREE
    const wrapper = await mountView()
    await selectInTree(wrapper, '서울특별시교육청')
    await wrapper.find('.child-search').setValue('없는이름')
    await selectInTree(wrapper, '최상위 기관')
    await selectInTree(wrapper, '서울특별시교육청')

    expect(childNames(wrapper)).toHaveLength(6)
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

  it('하위 기관은 삭제할 수 있다', async () => {
    const wrapper = await mountView()
    await selectInTree(wrapper, '서울특별시교육청')

    expect(actionButton(wrapper, '삭제').attributes('disabled')).toBeUndefined()
  })

  it('학교를 지우면 소속 교육청으로 올라간다', async () => {
    // 지운 기관에 머무르면 빈 화면이 남는다. 목록이 있던 자리로 돌려보낸다.
    vi.stubGlobal('confirm', () => true)
    const wrapper = await mountView()
    await selectInTree(wrapper, '서울특별시교육청')
    await selectInList(wrapper, '가나초등학교')

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
