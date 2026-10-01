"""기관구분 마스터.

기관구분은 고정 3종이 아니라 관리자가 관리하는 데이터다. ``name`` 은
표시·저장용이고(``organization.org_type`` 문자열이 이 이름을 담는다),
시스템 동작은 ``category`` 가 정한다:

    기관  커뮤니티(공유 공간)의 소유자가 될 수 있다
    학교  학교급(초/중/고)이 적용된다
    기타  그 외

이름을 바꾸면 사용 중인 기관의 ``org_type`` 도 함께 갱신된다(라우터가
한 트랜잭션으로). 사용 중인 구분은 삭제할 수 없다(수정만 가능).

테이블 생성은 EF 마이그레이션(backend-dotnet, 20260917.._OrgTypeTable)이
했고 이 정의는 거울이다.
"""

from __future__ import annotations

from sqlalchemy import String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin


class OrgTypeDef(Base, TimestampMixin):
    __tablename__ = "org_type"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(20), unique=True, nullable=False)
    category: Mapped[str] = mapped_column(String(10), default="기타", nullable=False)
    #: 이 구분의 기관이 고를 수 있는 분류 선택지 — 쉼표로 이어 저장(예:
    #: "초,중,고"). 기관 등록 화면이 쪼개어 드롭다운으로 보여 주고, 고른
    #: 값은 ``organization.school_level`` 에 들어간다. 비면 분류 없음.
    classifications: Mapped[str] = mapped_column(String(200), default="", nullable=False)
