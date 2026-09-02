from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from app.models.enums import (
    DeviceKind,
    DeviceOS,
    FormFactor,
    PanelType,
    PlaceKind,
)


class DeviceBase(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    os: DeviceOS
    form_factor: FormFactor = FormFactor.DID
    panel_type: PanelType = PanelType.LANDSCAPE
    width: int | None = Field(default=None, ge=1, le=32767)
    height: int | None = Field(default=None, ge=1, le=32767)
    place_name: str | None = Field(default=None, max_length=200)
    place_kind: PlaceKind | None = None
    device_kind: DeviceKind = DeviceKind.NORMAL
    grade: int | None = Field(default=None, ge=1, le=12)
    class_no: int | None = Field(default=None, ge=1, le=99)
    class_name: str | None = Field(default=None, max_length=100)
    track: str | None = Field(default=None, max_length=50)
    is_master: bool = False
    cpu: str | None = Field(default=None, max_length=100)
    memory: str | None = Field(default=None, max_length=50)
    storage: str | None = Field(default=None, max_length=50)


class DeviceCreate(DeviceBase):
    org_id: int
    #: 배정할 스케줄. 순서가 곧 우선순위다. 비우면 데모 모드로 시작한다.
    schedule_ids: list[int] = Field(default_factory=list)


class DeviceUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    os: DeviceOS | None = None
    form_factor: FormFactor | None = None
    panel_type: PanelType | None = None
    width: int | None = Field(default=None, ge=1, le=32767)
    height: int | None = Field(default=None, ge=1, le=32767)
    place_name: str | None = Field(default=None, max_length=200)
    place_kind: PlaceKind | None = None
    device_kind: DeviceKind | None = None
    grade: int | None = Field(default=None, ge=1, le=12)
    class_no: int | None = Field(default=None, ge=1, le=99)
    class_name: str | None = Field(default=None, max_length=100)
    track: str | None = Field(default=None, max_length=50)
    is_master: bool | None = None
    cpu: str | None = Field(default=None, max_length=100)
    memory: str | None = Field(default=None, max_length=50)
    storage: str | None = Field(default=None, max_length=50)
    #: 주면 배정을 통째로 교체한다. 안 주면 건드리지 않는다(빈 목록은 '전부 해제').
    schedule_ids: list[int] | None = None


class DeviceOut(DeviceBase):
    """CMS 응답용 장치.

    저장공간 관련 필드는 **장치가 하트비트로 보고한 값**이며, 등록 시 적어
    넣는 사양 문자열(``storage``)과는 다르다. 파생값(사용 바이트·사용률·경고)을
    서버에서 계산해 함께 내려주는 이유는, 임계 기준이 화면마다 갈라지면
    CMS·플레이어·알림이 서로 다른 시점에 경고하기 때문이다
    (``services/storage.py``).
    """

    model_config = ConfigDict(from_attributes=True)

    id: int
    org_id: int
    device_code: str
    version: int
    last_seen_at: datetime | None
    app_version: str | None
    storage_total_bytes: int | None = None
    storage_free_bytes: int | None = None
    storage_reported_at: datetime | None = None
    #: 사용 중인 바이트. 보고가 없거나 값이 앞뒤가 안 맞으면 None.
    storage_used_bytes: int | None = None
    #: 0~1 사용률. None 은 '미보고'이며 0(여유)과 구분해야 한다.
    storage_usage: float | None = None
    #: 임계치를 넘었는가. 기준은 ``services/storage.WARN_THRESHOLD``.
    storage_warning: bool = False
    #: 마지막 화면 캡처 시각. 이미지는 ``GET /devices/{id}/screenshot`` 로 따로 받는다
    #: (목록 응답에 이미지를 실으면 수십 MB 가 된다).
    screenshot_at: datetime | None = None
    org_name: str | None = None
    #: 배정된 스케줄. 우선순위(먼저 오는 것이 이긴다) 순서다.
    schedules: list[AssignedSchedule] = Field(default_factory=list)
    online: bool = False


class AssignedSchedule(BaseModel):
    """장치에 배정된 스케줄 한 건.

    ``active`` 는 **지금** 사용 기간 안인지다. 배정돼 있어도 기간 밖이면
    나가지 않으므로, 화면이 '걸려 있지만 지금은 안 나감' 을 구분해 보여 줄 수
    있어야 한다.
    """

    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    kind: str
    orientation: str
    start_at: datetime | None = None
    end_at: datetime | None = None
    active: bool = True


class ScheduleAssign(BaseModel):
    """장치의 스케줄 배정을 **통째로 교체**한다.

    빈 목록이면 배정 해제(데모 모드). 순서가 곧 우선순위다 — 같은 시각에
    둘 다 유효할 때 앞의 것이 먼저 나간다.
    """

    schedule_ids: list[int] = Field(default_factory=list)


class BulkScheduleAssign(BaseModel):
    """여러 장치의 배정을 한꺼번에 같은 목록으로 교체한다."""

    device_ids: list[int] = Field(min_length=1)
    schedule_ids: list[int] = Field(default_factory=list)


class DeviceManagerAssign(BaseModel):
    """장치 관리 위임. 지정한 사용자 목록으로 전체 교체한다."""

    user_ids: list[int] = Field(default_factory=list)


class DeviceGroupBase(BaseModel):
    name: str = Field(min_length=1, max_length=200)


class DeviceGroupCreate(DeviceGroupBase):
    device_ids: list[int] = Field(default_factory=list)


class DeviceGroupUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    device_ids: list[int] | None = None


class DeviceGroupOut(DeviceGroupBase):
    model_config = ConfigDict(from_attributes=True)

    id: int
    user_id: int
    device_ids: list[int] = Field(default_factory=list)


class DeviceProvisionRequest(BaseModel):
    """장치 기동 시 인증 요청(요구사항 제한사항 3)."""

    device_code: str
    app_version: str | None = None
    os: str | None = None
    width: int | None = None
    height: int | None = None
    cpu: str | None = None
    memory: str | None = None
    storage: str | None = None


class DeviceProvisionResponse(BaseModel):
    device_id: int
    device_code: str
    name: str
    org_id: int
    panel_type: str
    width: int | None
    height: int | None
    schedule_version: int
    heartbeat_interval_sec: int
    ws_url: str
    #: 세션 토큰. 이후 REST 요청의 ``X-Device-Token`` 헤더로 사용한다.
    device_token: str
