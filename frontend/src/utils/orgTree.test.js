import { describe, expect, it } from 'vitest'

import { branchNodes, filterChildren, findNode, pathTo } from './orgTree'

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

describe('branchNodes', () => {
  it('자식이 없는 기관은 뺀다', () => {
    const [root] = branchNodes(TREE)
    expect(root.children.map((c) => c.name)).toEqual(['서울교육청'])
  })

  it('잎을 걷어내 트리를 한 단계 얕게 만든다', () => {
    const [root] = branchNodes(TREE)
    expect(root.children[0].children).toEqual([])
  })

  it('가지치기 전 자식 수를 childCount 로 남긴다', () => {
    // 가지친 뒤의 children.length 를 세면 학교만 가진 교육청이 잎처럼 보인다.
    const [root] = branchNodes(TREE)
    expect(root.childCount).toBe(2)
    expect(root.children[0].childCount).toBe(2)
  })

  it('최상위는 자식이 없어도 남긴다', () => {
    // 부트스트랩 직후 최상위 하나뿐인 상태에서 트리가 비면 아무것도 못 만든다.
    expect(branchNodes([node(1, '최상위')]).map((n) => n.name)).toEqual(['최상위'])
  })

  it('원본을 건드리지 않는다', () => {
    branchNodes(TREE)
    expect(TREE[0].children.map((c) => c.name)).toEqual(['서울교육청', '부산교육청'])
    expect(TREE[0].children[0].children).toHaveLength(2)
  })

  it('깊이가 더 깊어도 잎만 걷어낸다', () => {
    const deep = [node(1, 'a', [node(2, 'b', [node(3, 'c', [node(4, 'd')])])])]
    const [a] = branchNodes(deep)
    expect(a.children[0].name).toBe('b')
    expect(a.children[0].children[0].name).toBe('c')
    expect(a.children[0].children[0].children).toEqual([])
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

describe('filterChildren', () => {
  const children = [
    node(1, '가나초등학교', [], { address: '서울시 종로구' }),
    node(2, '다라중학교', [], { address: '부산시 해운대구' }),
    node(3, '마바고등학교'),
  ]

  it('검색어가 없으면 그대로', () => {
    expect(filterChildren(children, '  ')).toHaveLength(3)
  })

  it('이름으로 거른다', () => {
    expect(filterChildren(children, '중학교').map((c) => c.name)).toEqual(['다라중학교'])
  })

  it('주소로도 거른다', () => {
    expect(filterChildren(children, '해운대').map((c) => c.name)).toEqual(['다라중학교'])
  })

  it('주소가 없는 기관에서 터지지 않는다', () => {
    expect(filterChildren(children, '종로').map((c) => c.name)).toEqual(['가나초등학교'])
  })

  it('대소문자를 가리지 않는다', () => {
    const en = [node(1, 'Gana Elementary')]
    expect(filterChildren(en, 'gana')).toHaveLength(1)
  })
})
