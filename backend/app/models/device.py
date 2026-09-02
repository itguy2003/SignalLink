from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import (
    BigInteger,
    Boolean,
    DateTime,
    ForeignKey,
    Integer,
    LargeBinary,
    String,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, TimestampMixin
from app.models.enums import DeviceKind, PanelType

if TYPE_CHECKING:
    from app.models.organization import Organization
    from app.models.schedule import Schedule
    from app.models.user import User


class Device(Base, TimestampMixin):
    """DID 장치.

    ``device_code`` 는 서버가 자동 생성하는 전역 유일 식별자이며
    ``XXXX-XXX-XXX`` (대문자/숫자 10자) 포맷이다. 장치 기동 시 인증 키로 쓰인다.
    ``schedule_id`` 가 NULL 이면 플레이어는 시스템 기본 데모를 표출한다.
    """

    __tablename__ = "device"

    id: Mapped[int] = mapped_column(primary_key=True)
    org_id: Mapped[int] = mapped_column(
        ForeignKey("organization.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    device_code: Mapped[str] = mapped_column(String(12), unique=True, nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    os: Mapped[str] = mapped_column(String(20), nullable=False)
    form_factor: Mapped[str] = mapped_column(String(20), nullable=False)
    panel_type: Mapped[str] = mapped_column(String(20), default=PanelType.LANDSCAPE, nullable=False)
    width: Mapped[int | None] = mapped_column(Integer)
    height: Mapped[int | None] = mapped_column(Integer)
    place_name: Mapped[str | None] = mapped_column(String(200))
    place_kind: Mapped[str | None] = mapped_column(String(20))
    device_kind: Mapped[str] = mapped_column(String(20), default=DeviceKind.NORMAL, nullable=False)
    grade: Mapped[int | None] = mapped_column(Integer)
    class_no: Mapped[int | None] = mapped_column(Integer)
    class_name: Mapped[str | None] = mapped_column(String(100))
    #: 계열(고등학교 등)
    track: Mapped[str | None] = mapped_column(String(50))
    is_master: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    cpu: Mapped[str | None] = mapped_column(String(100))
    memory: Mapped[str | None] = mapped_column(String(50))
    #: 등록 시 사람이 적어 넣는 사양 문자열("256GB"). 계산에는 쓰지 않는다.
    storage: Mapped[str | None] = mapped_column(String(50))
    #: 장치가 하트비트로 보고하는 실제 저장공간. 사용률 계산의 유일한 근거다.
    #: BigInteger 인 이유: PostgreSQL 의 INTEGER 는 32비트라 2GB 를 넘기면 넘친다.
    storage_total_bytes: Mapped[int | None] = mapped_column(BigInteger)
    storage_free_bytes: Mapped[int | None] = mapped_column(BigInteger)
    #: 위 두 값을 마지막으로 받은 시각. ``last_seen_at`` 과 따로 두는 이유는,
    #: 저장공간을 보고하지 않는 옛 버전 앱이 하트비트만 계속 보낼 때
    #: 오래된 사용률이 현재 값처럼 보이는 것을 구분하기 위해서다.
    storage_reported_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    #: 장치에 배포된 스케줄 버전. 하트비트에서 서버 버전과 비교해 다르면
    #: 클라이언트가 스케줄을 재수신한다.
    #:
    #: 스케줄을 여러 개 배정할 수 있게 되면서 이 값은 **배정된 스케줄 전체를
    #: 합친 버전**이다(``services/schedule_service.combined_version``). 하나만
    #: 바뀌어도 합계가 달라지므로 장치가 변경을 알아챈다.
    version: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    last_seen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    app_version: Mapped[str | None] = mapped_column(String(50))

    organization: Mapped[Organization] = relationship(back_populates="devices")
    schedule_links: Mapped[list[DeviceScheduleLink]] = relationship(
        back_populates="device",
        cascade="all, delete-orphan",
        order_by="DeviceScheduleLink.sort_order",
        lazy="selectin",
    )
    managers: Mapped[list[DeviceManager]] = relationship(
        back_populates="device", cascade="all, delete-orphan"
    )
    group_links: Mapped[list[DeviceGroupMember]] = relationship(
        back_populates="device", cascade="all, delete-orphan"
    )
    screenshot: Mapped[DeviceScreenshot | None] = relationship(
        back_populates="device",
        cascade="all, delete-orphan",
        # selectin: 목록 N건을 한 번의 추가 질의로 채운다(장치마다 질의하면 N+1).
        # 이미지 본문은 아래에서 deferred 라 여기서 딸려 오지 않는다.
        lazy="selectin",
    )


class DeviceScheduleLink(Base):
    """장치에 배정된 스케줄. 한 장치에 여러 개를 배정할 수 있다.

    행사 기간용 스케줄과 평상시 스케줄을 함께 걸어 두고, 기간
    (``Schedule.start_at``/``end_at``)으로 언제 무엇이 나갈지 갈리게 하는 것이
    이 구조의 목적이다.

    ``sort_order`` 는 같은 시각에 두 스케줄이 모두 유효할 때의 우선순위다.
    작을수록 먼저다 — 겹칠 때 무엇이 이기는지 정해 두지 않으면 같은 설정의
    장치가 서로 다른 화면을 띄운다.
    """

    __tablename__ = "device_schedule"
    __table_args__ = (UniqueConstraint("device_id", "schedule_id", name="uq_device_schedule"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    device_id: Mapped[int] = mapped_column(
        ForeignKey("device.id", ondelete="CASCADE"), nullable=False, index=True
    )
    schedule_id: Mapped[int] = mapped_column(
        ForeignKey("schedule.id", ondelete="CASCADE"), nullable=False, index=True
    )
    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    device: Mapped[Device] = relationship(back_populates="schedule_links")
    schedule: Mapped[Schedule] = relationship(back_populates="device_links")


class DeviceScreenshot(Base):
    """장치가 올린 현재 화면 캡처.

    ``device`` 와 1:1 이지만 **별도 테이블**에 둔다. 같은 테이블에 넣으면
    장치 목록 조회가 매번 수백 KB 짜리 이미지를 함께 읽어 온다.

    장치당 한 장만 보관하고 새 캡처가 오면 덮어쓴다. 이력이 필요한 기능이
    아니라서 쌓아 둘 이유가 없고, 쌓으면 지우는 일이 따라온다.
    """

    __tablename__ = "device_screenshot"

    device_id: Mapped[int] = mapped_column(
        ForeignKey("device.id", ondelete="CASCADE"), primary_key=True
    )
    #: deferred: 목록에서 캡처 시각만 필요할 때 본문까지 읽지 않는다.
    #: 실제 이미지는 ``GET /devices/{id}/screenshot`` 에서만 읽는다.
    image: Mapped[bytes] = mapped_column(LargeBinary, nullable=False, deferred=True)
    content_type: Mapped[str] = mapped_column(String(50), nullable=False)
    captured_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    device: Mapped[Device] = relationship(back_populates="screenshot")


class DeviceManager(Base):
    """장치 관리 위임. 기관관리자가 DEVICE_MANAGER 에게 장치를 위임한다.

    하나의 장치를 여러 관리자에게 위임할 수 있으므로 N:M 이다.
    """

    __tablename__ = "device_manager"
    __table_args__ = (UniqueConstraint("device_id", "user_id", name="uq_device_manager"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    device_id: Mapped[int] = mapped_column(
        ForeignKey("device.id", ondelete="CASCADE"), nullable=False, index=True
    )
    user_id: Mapped[int] = mapped_column(
        ForeignKey("app_user.id", ondelete="CASCADE"), nullable=False, index=True
    )

    device: Mapped[Device] = relationship(back_populates="managers")
    user: Mapped[User] = relationship()


class DeviceGroup(Base, TimestampMixin):
    """장치그룹정보. 사용자가 개인적으로 구성하는 장치 묶음."""

    __tablename__ = "device_group"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("app_user.id", ondelete="CASCADE"), nullable=False, index=True
    )

    owner: Mapped[User] = relationship()
    members: Mapped[list[DeviceGroupMember]] = relationship(
        back_populates="group", cascade="all, delete-orphan"
    )


class DeviceGroupMember(Base):
    """장치그룹관계."""

    __tablename__ = "device_group_member"
    __table_args__ = (UniqueConstraint("group_id", "device_id", name="uq_device_group_member"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    group_id: Mapped[int] = mapped_column(
        ForeignKey("device_group.id", ondelete="CASCADE"), nullable=False, index=True
    )
    device_id: Mapped[int] = mapped_column(
        ForeignKey("device.id", ondelete="CASCADE"), nullable=False, index=True
    )

    group: Mapped[DeviceGroup] = relationship(back_populates="members")
    device: Mapped[Device] = relationship(back_populates="group_links")
