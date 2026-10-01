import { describe, expect, it } from 'vitest'

import { filterMembers, findNode, pathTo, withChildCount } from './orgTree'

const node = (id, name, children = [], extra = {}) => ({
  id,
  name,
  parent_id: null,
  org_type: '기관',
  school_level: null,
  address: null,
  children,
  ...extra,
})

const TREE = [
  node(1, '최상위', [
    node(2, '서울교육청', [node(3, '가나초'), node(4, '다라중')]),
    node(5, '부산교육청'),
  ]),
]

describe('withChildCount', () => {
  it('모든 기관을 남긴다 — 잎(학교)도 트리에 나온다', () => {
    const [root] = withChildCount(TREE)
    expect(root.children.map((child) => child.name)).toEqual(['서울교육청', '부산교육청'])
    expect(root.children[0].children.map((child) => child.name)).toEqual(['가나초', '다라중'])
  })

  it('노드마다 소속기관 수를 붙인다', () => {
    const [root] = withChildCount(TREE)
    expect(root.childCount).toBe(2)
    expect(root.children[0].childCount).toBe(2) // 서울교육청
    expect(root.children[1].childCount).toBe(0) // 부산교육청
    expect(root.children[0].children[0].childCount).toBe(0) // 가나초
  })

  it('원본 트리는 건드리지 않는다', () => {
    withChildCount(TREE)
    expect('childCount' in TREE[0]).toBe(false)
    expect(TREE[0].children).toHaveLength(2)
  })
})

describe('findNode', () => {
  it('깊이 상관없이 찾는다', () => {
    expect(findNode(TREE, 4).name).toBe('다라중')
  })

  it('없으면 null', () => {
    expect(findNode(TREE, 999)).toBeNull()
  })
})

describe('pathTo', () => {
  it('최상위부터 대상까지의 경로를 준다', () => {
    expect(pathTo(TREE, 3).map((n) => n.name)).toEqual(['최상위', '서울교육청', '가나초'])
  })

  it('최상위 자신은 한 칸짜리 경로', () => {
    expect(pathTo(TREE, 1).map((n) => n.name)).toEqual(['최상위'])
  })

  it('없으면 빈 경로', () => {
    expect(pathTo(TREE, 999)).toEqual([])
  })
})

describe('filterMembers', () => {
  const members = [
    { name: '박교육', user_id: 'edu_admin' },
    { name: '최장학', user_id: 'staff2' },
    { name: '한지원', user_id: 'staff4' },
  ]

  it('검색어가 없으면 그대로', () => {
    expect(filterMembers(members, '  ')).toHaveLength(3)
  })

  it('이름으로 거른다', () => {
    expect(filterMembers(members, '장학').map((m) => m.name)).toEqual(['최장학'])
  })

  it('사용자ID로도 거른다(대소문자 무시)', () => {
    expect(filterMembers(members, 'EDU_admin').map((m) => m.name)).toEqual(['박교육'])
  })

  it('맞는 것이 없으면 빈 목록', () => {
    expect(filterMembers(members, '없는사람')).toEqual([])
  })
})
