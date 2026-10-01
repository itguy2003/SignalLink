"""기관구분 마스터 지원 (.NET Services/OrgTypeSupport.cs 의 짝).

의미 판정은 언제나 이름이 아니라 ``category`` 로 한다 — 이름은 관리자가
바꿀 수 있기 때문이다.
"""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.org_type import OrgTypeDef

CATEGORIES = ("기관", "학교", "기타")

#: 분류 문자열의 구분자 — DB 에는 이어 붙여 저장하고 화면이 쪼갠다.
CLASSIFICATION_SEPARATOR = ","

INVALID_CLASSIFICATIONS_ERROR = "분류는 쉼표로 구분하며 각 항목은 1~10자여야 합니다."


def split_classifications(raw: str | None) -> list[str]:
    seen: list[str] = []
    for part in (raw or "").split(CLASSIFICATION_SEPARATOR):
        cleaned = part.strip()
        if cleaned and cleaned not in seen:
            seen.append(cleaned)
    return seen


def normalize_classifications(raw: str | None) -> str | None:
    """입력을 저장 형태로 정규화한다. 항목이 규칙에 어긋나면 None."""
    parts = split_classifications(raw)
    if any(len(part) > 10 for part in parts):
        return None
    joined = CLASSIFICATION_SEPARATOR.join(parts)
    return joined if len(joined) <= 200 else None


def classifications_of(db: Session, type_name: str) -> list[str]:
    """기관구분 이름으로 분류 선택지를 가져온다. 없으면 빈 목록."""
    row = db.execute(
        select(OrgTypeDef.classifications).where(OrgTypeDef.name == type_name)
    ).scalar_one_or_none()
    return split_classifications(row)


def category_of(db: Session, type_name: str) -> str:
    """이름의 동작 분류. 마스터에 없는 이름은 '기타'로 취급한다."""
    row = db.execute(
        select(OrgTypeDef.category).where(OrgTypeDef.name == type_name)
    ).scalar_one_or_none()
    return row or "기타"


def names_of_category(db: Session, category: str) -> set[str]:
    rows = db.execute(select(OrgTypeDef.name).where(OrgTypeDef.category == category))
    return {row[0] for row in rows}


def all_names(db: Session) -> set[str]:
    return {row[0] for row in db.execute(select(OrgTypeDef.name))}


def seed_defaults(db: Session) -> None:
    """기본 3종을 심는다. 테이블이 비어 있을 때만 — 관리자가 이름을 바꾼
    뒤에 기본 이름을 다시 심으면 안 된다. 멱등."""
    if db.execute(select(OrgTypeDef.id).limit(1)).first() is not None:
        return
    for name in CATEGORIES:
        # 학교의 분류 선택지는 학교급이다 — 다른 구분은 비워 시작한다.
        db.add(OrgTypeDef(
            name=name, category=name,
            classifications="초,중,고" if name == "학교" else "",
        ))
    db.flush()
