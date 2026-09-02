"""기관 트리 조회 헬퍼.

권한 판정이 기관 트리를 따라 내려가므로("상위 기관 관리자는 하위 기관도 관리")
"내 기관 + 모든 하위 기관" 집합을 구하는 연산이 전 API 에서 반복된다.

재귀 CTE 는 SQLite/PostgreSQL 모두 지원하지만 방언별 미묘한 차이가 있어,
기관 수가 많지 않은 도메인 특성(교육청-학교 2~3단계)을 고려해
전체 (id, parent_id) 만 읽어 메모리에서 순회한다. 기관 수가 수만 건 규모로
커지면 재귀 CTE 또는 closure table 로 교체할 것.
"""

from __future__ import annotations

from collections import defaultdict

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.organization import Organization


def _edges(db: Session) -> tuple[dict[int, list[int]], dict[int, int | None]]:
    rows = db.execute(select(Organization.id, Organization.parent_id)).all()
    children: dict[int, list[int]] = defaultdict(list)
    parent_of: dict[int, int | None] = {}
    for org_id, parent_id in rows:
        parent_of[org_id] = parent_id
        if parent_id is not None:
            children[parent_id].append(org_id)
    return children, parent_of


def descendant_ids(db: Session, org_id: int, *, include_self: bool = True) -> set[int]:
    """``org_id`` 와 그 하위 모든 기관의 id 집합."""
    children, _ = _edges(db)
    result: set[int] = {org_id} if include_self else set()
    stack = list(children.get(org_id, []))
    while stack:
        current = stack.pop()
        if current in result:
            continue
        result.add(current)
        stack.extend(children.get(current, []))
    return result


def ancestor_ids(db: Session, org_id: int, *, include_self: bool = False) -> list[int]:
    """``org_id`` 의 조상을 가까운 순서로 반환한다."""
    _, parent_of = _edges(db)
    result: list[int] = [org_id] if include_self else []
    seen = {org_id}
    current = parent_of.get(org_id)
    while current is not None and current not in seen:
        result.append(current)
        seen.add(current)
        current = parent_of.get(current)
    return result


def is_descendant(db: Session, *, ancestor: int, node: int) -> bool:
    if ancestor == node:
        return True
    return ancestor in ancestor_ids(db, node)


def would_create_cycle(db: Session, *, org_id: int, new_parent_id: int | None) -> bool:
    """상위 기관 변경이 순환을 만드는지 검사한다."""
    if new_parent_id is None:
        return False
    if new_parent_id == org_id:
        return True
    return is_descendant(db, ancestor=org_id, node=new_parent_id)


def get_root_org(db: Session) -> Organization | None:
    return db.execute(
        select(Organization).where(Organization.parent_id.is_(None)).order_by(Organization.id)
    ).scalars().first()
