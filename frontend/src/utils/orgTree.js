/**
 * 기관 트리 가공.
 *
 * 트리에는 **모든 기관**을 그린다 — 학교처럼 더 내려갈 곳이 없는 기관도
 * 트리에서 바로 고른다. 오른쪽 상세의 아래쪽은 소속기관 목록이 아니라
 * 그 기관에 소속된 사용자를 보여 준다.
 */

/**
 * 노드마다 소속기관 수(`childCount`)를 붙인 사본 트리를 만든다(원본은
 * 건드리지 않는다). 트리가 접히지 않는 대신 이 숫자로 "빈 기관"과
 * "학교 200개를 가진 교육청"을 구분한다.
 */
export function withChildCount(nodes) {
  return nodes.map((node) => ({
    ...node,
    childCount: node.children.length,
    children: withChildCount(node.children),
  }))
}

/** id 로 노드를 찾는다. 트리를 다시 읽은 뒤 선택을 되살릴 때 쓴다. */
export function findNode(nodes, id) {
  for (const node of nodes) {
    if (node.id === id) return node
    const found = findNode(node.children, id)
    if (found) return found
  }
  return null
}

/** 최상위부터 대상까지의 경로. 빵부스러기에 쓴다. */
export function pathTo(nodes, id) {
  for (const node of nodes) {
    if (node.id === id) return [node]
    const rest = pathTo(node.children, id)
    if (rest.length) return [node, ...rest]
  }
  return []
}

/** 이름·사용자ID로 소속 사용자 목록을 거른다. 큰 기관은 목록이 길어진다. */
export function filterMembers(members, query) {
  const needle = query.trim().toLowerCase()
  if (!needle) return members
  return members.filter(
    (member) =>
      member.name.toLowerCase().includes(needle) ||
      member.user_id.toLowerCase().includes(needle),
  )
}
