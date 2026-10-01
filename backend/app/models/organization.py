from __future__ import annotations

from typing import TYPE_CHECKING

from sqlalchemy import Float, ForeignKey, Index, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, TimestampMixin
from app.models.enums import OrgType

if TYPE_CHECKING:
    from app.models.board import OrgBoard
    from app.models.device import Device
    from app.models.user import User


class Organization(Base, TimestampMixin):
    """기관.

    ``parent_id`` 로 자기참조 트리를 이룬다. 최상위 기관만 NULL 이며
    시스템 부트스트랩 시 반드시 하나 생성된다(``db/init_db.py``).
    권한 판정이 이 트리를 따라 내려가므로, 조상 조회는
    ``services/org_tree.py`` 의 헬퍼를 사용할 것.
    """

    __tablename__ = "organization"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    address: Mapped[str | None] = mapped_column(String(500))
    org_type: Mapped[str] = mapped_column(String(20), default=OrgType.ORG, nullable=False)
    school_level: Mapped[str | None] = mapped_column(String(10))
    parent_id: Mapped[int | None] = mapped_column(
        ForeignKey("organization.id", ondelete="RESTRICT"), index=True
    )
    latitude: Mapped[float | None] = mapped_column(Float)
    longitude: Mapped[float | None] = mapped_column(Float)
    #: 시도교육청코드 (학교 일괄등록 API 연동 키)
    edu_office_code: Mapped[str | None] = mapped_column(String(20), index=True)
    #: 학교코드 (표준학교코드 = 나이스 행정코드)
    school_code: Mapped[str | None] = mapped_column(String(20), index=True)
    # 학교 정보 일괄 등록(나이스 표준 헤더)에서 수집하는 부가 정보.
    edu_office_name: Mapped[str | None] = mapped_column(String(40))
    sido_name: Mapped[str | None] = mapped_column(String(20))
    jurisdiction_name: Mapped[str | None] = mapped_column(String(100))
    address_detail: Mapped[str | None] = mapped_column(String(300))
    phone: Mapped[str | None] = mapped_column(String(30))
    homepage: Mapped[str | None] = mapped_column(String(300))

    parent: Mapped[Organization | None] = relationship(
        remote_side="Organization.id", back_populates="children"
    )
    children: Mapped[list[Organization]] = relationship(
        back_populates="parent", cascade="save-update, merge"
    )
    users: Mapped[list[User]] = relationship(back_populates="organization")
    devices: Mapped[list[Device]] = relationship(back_populates="organization")
    boards: Mapped[list[OrgBoard]] = relationship(
        back_populates="organization", cascade="all, delete-orphan"
    )

    __table_args__ = (
        # 학교 일괄등록 시 중복 판별에 쓰인다. 학교코드가 없는 일반 기관은 NULL 이며
        # NULL 은 UNIQUE 제약에서 서로 충돌하지 않는다(SQLite/PostgreSQL 공통).
        Index("uq_org_school_code", "edu_office_code", "school_code", unique=True),
    )

    @property
    def is_root(self) -> bool:
        return self.parent_id is None
