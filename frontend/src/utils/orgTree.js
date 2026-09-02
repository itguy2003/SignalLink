/**
 * 기관 트리 가공.
 *
 * 트리에는 **하위 기관을 가진 기관만** 넣는다. 학교처럼 더 내려갈 곳이 없는
 * 기관은 교육청 하나에 수백 개가 달릴 수 있어서, 전부 트리에 늘어놓으면
 * 스크롤만 길어지고 탐색이 되지 않는다. 그런 기관은 상위 기관을 골랐을 때
 * 오른쪽 목록에 표로 나온다.
 *
 * 트리에서 빠졌다고 관리에서 빠지는 것은 아니다 — 목록에서 고르면 상세와
 * 수정/삭제가 그대로 열리고, 그 기관 밑에 하위 기관이 생기는 순간 트리에
 * 다시 나타난다.
 */

/**
 * 자식이 있는 노드만 남긴 트리를 새로 만든다(원본은 건드리지 않는다).
 *
 * 각 노드에는 **가지치기 전** 자식 수를 `childCount` 로 붙인다. 가지치기 후의
 * `children.length` 를 세면 학교만 가진 교육청이 '자식 0' 으로 보여서
 * 트리에서 잎처럼 그려진다.
 *
 * 최상위(depth 0)는 자식이 없어도 남긴다. 갓 부트스트랩한 시스템은 최상위
 * 기관 하나뿐인데, 이때 트리가 비어 버리면 고를 것이 없어 첫 하위 기관조차
 * 등록할 수 없다.
 */
export function branchNodes(nodes, depth = 0) {
  const kept = []
  for (const node of nodes) {
    const childCount = node.children.length
    if (depth > 0 && childCount === 0) continue
    kept.push({ ...node, childCount, children: branchNodes(node.children, depth + 1) })
  }
  return kept
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

/**
 * 최상위부터 대상까지의 경로. 빵부스러기에 쓴다.
 *
 * 트리에 보이지 않는 기관(학교 등)을 목록에서 골랐을 때 지금 어디에 있는지
 * 알려 줄 방법이 이것뿐이다.
 */
export function pathTo(nodes, id) {
  for (const node of nodes) {
    if (node.id === id) return [node]
    const rest = pathTo(node.children, id)
    if (rest.length) return [node, ...rest]
  }
  return []
}

/** 이름·주소로 하위 기관 목록을 거른다. 목록이 길어질 수 있어 검색이 필요하다. */
export function filterChildren(children, query) {
  const needle = query.trim().toLowerCase()
  if (!needle) return children
  return children.filter(
    (child) =>
      child.name.toLowerCase().includes(needle) ||
      (child.address ?? '').toLowerCase().includes(needle),
  )
}
