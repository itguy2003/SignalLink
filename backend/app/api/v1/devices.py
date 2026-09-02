"""장치 관리.

권한(요구사항)
    - 등록/삭제: 기관관리자(자기 기관 및 하위 기관), 슈퍼관리자
    - 수정/스케줄 배정: 위 + 위임받은 장치관리자
    - 장치 고유번호는 등록 시 서버가 자동 생성하며 수정할 수 없다.
"""

from __future__ import annotations

from datetime import UTC, datetime
from email.utils import format_datetime

from fastapi import APIRouter, BackgroundTasks, Query, Response, status
from sqlalchemy import func, select

from app.api.deps import CurrentUser, DbSession, bad_request, forbid, not_found
from app.models.device import (
    Device,
    DeviceManager,
    DeviceScheduleLink,
    DeviceScreenshot,
)
from app.models.enums import Role
from app.models.organization import Organization
from app.models.schedule import Schedule
from app.models.user import User
from app.schemas.common import Message, Page
from app.schemas.device import (
    AssignedSchedule,
    BulkScheduleAssign,
    DeviceCreate,
    DeviceManagerAssign,
    DeviceOut,
    DeviceUpdate,
    ScheduleAssign,
)
from app.schemas.user import UserOut
from app.services import notify, org_tree, permissions, schedule_service, storage
from app.services.device_code import generate_unique_device_code
from app.services.ws_hub import hub

router = APIRouter(prefix="/devices", tags=["장치"])


#: 지원하는 원격 제어 명령과 화면에 쓸 이름.
#:
#: 플레이어(JS/.NET/Flutter)가 이 문자열을 그대로 받아 처리하므로, 값을 바꾸면
#: 모든 플레이어를 함께 고쳐야 한다. 새 명령을 더할 때는 여기만 추가한다.
DEVICE_COMMANDS = {
    "reload": "리로딩",
    "restart": "리부팅",
    "shutdown": "끄기",
    "screenshot": "미리보기",
}


def _to_out(db: DbSession, device: Device) -> DeviceOut:
    org = db.get(Organization, device.org_id)
    out = DeviceOut.model_validate(device)
    out.org_name = org.name if org else None
    out.online = hub.is_online(device.id)

    # 배정된 스케줄과 '지금 유효한가'. 기간 밖이면 걸려 있어도 나가지 않으므로
    # 화면이 둘을 구분해 보여 줄 수 있어야 한다.
    now = datetime.now(UTC)
    out.schedules = [
        AssignedSchedule(
            id=schedule.id,
            name=schedule.name,
            kind=schedule.kind,
            orientation=schedule.orientation,
            start_at=schedule.start_at,
            end_at=schedule.end_at,
            active=schedule_service.is_active(schedule, now),
        )
        for schedule in schedule_service.assigned_schedules(device)
    ]

    # 저장공간 파생값은 서버에서 계산한다. 임계 기준을 화면마다 두면 갈라진다.
    out.storage_used_bytes = storage.used_bytes(
        device.storage_total_bytes, device.storage_free_bytes
    )
    out.storage_usage = storage.usage_ratio(
        device.storage_total_bytes, device.storage_free_bytes
    )
    out.storage_warning = storage.is_warning(out.storage_usage)
    out.screenshot_at = device.screenshot.captured_at if device.screenshot else None
    return out


def _visible_device_stmt(db: DbSession, actor: User):  # noqa: ANN202
    """조회 가능한 장치로 범위를 좁힌 SELECT 를 만든다."""
    stmt = select(Device)
    if permissions.is_super_admin(actor):
        return stmt

    if permissions.is_org_admin(actor):
        return stmt.where(Device.org_id.in_(org_tree.descendant_ids(db, actor.org_id)))

    delegated = permissions.delegated_device_ids(db, actor)
    if actor.has_role(Role.HOMEROOM_TEACHER):
        # 담임교사는 자기 기관 장치를 볼 수 있고, 위임받은 장치는 관리도 가능하다.
        return stmt.where((Device.org_id == actor.org_id) | (Device.id.in_(delegated)))
    return stmt.where(Device.id.in_(delegated))


@router.get("", response_model=Page[DeviceOut], summary="장치 목록")
def list_devices(
    actor: CurrentUser,
    db: DbSession,
    q: str | None = None,
    org_id: int | None = None,
    schedule_id: int | None = None,
    unassigned: bool | None = Query(default=None, description="스케줄 미배정 장치만"),
    online: bool | None = None,
    page: int = Query(1, ge=1),
    size: int = Query(20, ge=1, le=200),
) -> Page[DeviceOut]:
    stmt = _visible_device_stmt(db, actor)

    if q:
        like = f"%{q}%"
        stmt = stmt.where(
            (Device.name.ilike(like))
            | (Device.device_code.ilike(like))
            | (Device.place_name.ilike(like))
        )
    if org_id is not None:
        if not permissions.can_view_org(db, actor, org_id):
            raise forbid("해당 기관의 장치를 조회할 권한이 없습니다.")
        stmt = stmt.where(Device.org_id.in_(org_tree.descendant_ids(db, org_id)))
    # 배정이 N:M 이 되면서 장치 행만으로는 판단할 수 없다. 연결 테이블을 본다.
    if schedule_id is not None:
        stmt = stmt.where(
            Device.id.in_(
                select(DeviceScheduleLink.device_id).where(
                    DeviceScheduleLink.schedule_id == schedule_id
                )
            )
        )
    if unassigned:
        stmt = stmt.where(~Device.id.in_(select(DeviceScheduleLink.device_id)))

    total = db.execute(
        select(func.count()).select_from(stmt.order_by(None).subquery())
    ).scalar_one()
    rows = list(
        db.execute(stmt.order_by(Device.id.desc()).offset((page - 1) * size).limit(size))
        .scalars()
        .all()
    )
    items = [_to_out(db, d) for d in rows]

    if online is not None:
        # 접속 여부는 DB 가 아니라 WebSocket 허브가 갖고 있어 조회 후 거른다.
        items = [i for i in items if i.online == online]

    return Page[DeviceOut](items=items, total=total, page=page, size=size)


@router.get("/{device_id}", response_model=DeviceOut, summary="장치 상세")
def get_device(device_id: int, actor: CurrentUser, db: DbSession) -> DeviceOut:
    device = db.get(Device, device_id)
    if device is None:
        raise not_found("장치")
    if not permissions.can_view_device(db, actor, device):
        raise forbid("해당 장치를 조회할 권한이 없습니다.")
    return _to_out(db, device)


@router.post("", response_model=DeviceOut, status_code=status.HTTP_201_CREATED, summary="장치 등록")
def create_device(payload: DeviceCreate, actor: CurrentUser, db: DbSession) -> DeviceOut:
    if not permissions.can_create_device(db, actor, payload.org_id):
        raise forbid("해당 기관에 장치를 등록할 권한이 없습니다.")
    if db.get(Organization, payload.org_id) is None:
        raise bad_request("존재하지 않는 기관입니다.")

    data = payload.model_dump()
    schedule_ids = data.pop("schedule_ids", None) or []

    device = Device(
        **data,
        # 장치 고유번호는 서버가 생성한다. 클라이언트 입력을 받지 않는다.
        device_code=generate_unique_device_code(db),
    )
    db.add(device)
    if schedule_ids:
        _replace_schedules(db, actor, device, schedule_ids)
    db.commit()
    db.refresh(device)
    return _to_out(db, device)


@router.put("/{device_id}", response_model=DeviceOut, summary="장치 수정")
def update_device(
    device_id: int,
    payload: DeviceUpdate,
    actor: CurrentUser,
    db: DbSession,
    background: BackgroundTasks,
) -> DeviceOut:
    device = db.get(Device, device_id)
    if device is None:
        raise not_found("장치")
    if not permissions.can_manage_device(db, actor, device):
        raise forbid("해당 장치를 수정할 권한이 없습니다.")

    data = payload.model_dump(exclude_unset=True)
    schedule_ids = data.pop("schedule_ids", None)
    schedule_changed = False

    if schedule_ids is not None:
        before = [s.id for s in schedule_service.assigned_schedules(device)]
        _replace_schedules(db, actor, device, schedule_ids)
        schedule_changed = before != list(dict.fromkeys(schedule_ids))

    for key, value in data.items():
        setattr(device, key, value)
    db.commit()
    db.refresh(device)

    if schedule_changed:
        background.add_task(
            notify.push_schedule_changed,
            [(device.id, device.device_code, schedule_service.current_version(db, device))],
        )
    return _to_out(db, device)


@router.delete("/{device_id}", response_model=Message, summary="장치 삭제")
def delete_device(device_id: int, actor: CurrentUser, db: DbSession) -> Message:
    device = db.get(Device, device_id)
    if device is None:
        raise not_found("장치")
    if not permissions.can_delete_device(db, actor, device):
        raise forbid("해당 장치를 삭제할 권한이 없습니다.")
    db.delete(device)
    db.commit()
    return Message(detail="장치가 삭제되었습니다.")


def _assert_schedule_usable(db: DbSession, actor: User, schedule_id: int) -> Schedule:
    schedule = db.get(Schedule, schedule_id)
    if schedule is None:
        raise bad_request("존재하지 않는 스케줄입니다.")
    if not permissions.can_view_org(db, actor, schedule.org_id):
        raise forbid("해당 스케줄을 사용할 권한이 없습니다.")
    return schedule


def _replace_schedules(
    db: DbSession,
    actor: User,
    device: Device,
    schedule_ids: list[int],
) -> None:
    """장치의 스케줄 배정을 통째로 교체한다. 커밋은 호출자가 한다.

    받은 순서가 곧 우선순위다. 같은 id 가 두 번 오면 한 번만 남긴다 —
    UNIQUE 제약에 걸려 저장이 통째로 실패하는 것을 막는다.

    장치 방향과 스케줄 방향이 달라도 막지는 않는다. 종전 동작이 그랬고,
    화면에서 어긋남을 표시해 주는 편이 낫다고 판단했다.
    """
    unique_ids = list(dict.fromkeys(schedule_ids))
    for schedule_id in unique_ids:
        _assert_schedule_usable(db, actor, schedule_id)

    device.schedule_links.clear()
    db.flush()
    for index, schedule_id in enumerate(unique_ids):
        device.schedule_links.append(
            DeviceScheduleLink(schedule_id=schedule_id, sort_order=index)
        )
    db.flush()


@router.put("/{device_id}/schedules", response_model=DeviceOut, summary="스케줄 배정 교체")
def assign_schedules(
    device_id: int,
    payload: ScheduleAssign,
    actor: CurrentUser,
    db: DbSession,
    background: BackgroundTasks,
) -> DeviceOut:
    """장치의 스케줄 배정을 통째로 교체한다. 빈 목록이면 데모 모드가 된다."""
    device = db.get(Device, device_id)
    if device is None:
        raise not_found("장치")
    if not permissions.can_manage_device(db, actor, device):
        raise forbid("해당 장치의 스케줄을 변경할 권한이 없습니다.")

    _replace_schedules(db, actor, device, payload.schedule_ids)
    db.commit()
    db.refresh(device)

    background.add_task(
        notify.push_schedule_changed,
        [(device.id, device.device_code, schedule_service.current_version(db, device))],
    )
    return _to_out(db, device)


@router.post("/schedule/bulk", response_model=Message, summary="스케줄 일괄 배정")
def bulk_assign_schedule(
    payload: BulkScheduleAssign,
    actor: CurrentUser,
    db: DbSession,
    background: BackgroundTasks,
) -> Message:
    devices = list(
        db.execute(select(Device).where(Device.id.in_(payload.device_ids))).scalars().all()
    )
    found_ids = {d.id for d in devices}
    missing = set(payload.device_ids) - found_ids
    if missing:
        raise bad_request(f"존재하지 않는 장치가 있습니다: {sorted(missing)}")

    for device in devices:
        if not permissions.can_manage_device(db, actor, device):
            raise forbid(f"장치 '{device.name}' 의 스케줄을 변경할 권한이 없습니다.")

    # 방향 검사가 장치마다 다르므로 한 대씩 돌린다. 한 대라도 걸리면 전부 취소된다.
    for device in devices:
        _replace_schedules(db, actor, device, payload.schedule_ids)
    db.commit()

    targets = [
        (d.id, d.device_code, schedule_service.current_version(db, d)) for d in devices
    ]
    background.add_task(notify.push_schedule_changed, targets)
    return Message(detail=f"{len(devices)}대의 장치에 스케줄을 배정했습니다.")


@router.get("/{device_id}/managers", response_model=list[UserOut], summary="위임된 장치관리자 목록")
def list_device_managers(device_id: int, actor: CurrentUser, db: DbSession) -> list[UserOut]:
    device = db.get(Device, device_id)
    if device is None:
        raise not_found("장치")
    if not permissions.can_view_device(db, actor, device):
        raise forbid("해당 장치를 조회할 권한이 없습니다.")

    users = list(
        db.execute(
            select(User)
            .join(DeviceManager, DeviceManager.user_id == User.id)
            .where(DeviceManager.device_id == device_id)
        )
        .scalars()
        .all()
    )
    return [
        UserOut(
            id=u.id,
            user_id=u.user_id,
            name=u.name,
            org_id=u.org_id,
            phone=u.phone,
            email=u.email,
            status=u.status,
            roles=sorted(u.role_names),
        )
        for u in users
    ]


@router.put("/{device_id}/managers", response_model=Message, summary="장치 관리 위임(전체 교체)")
def set_device_managers(
    device_id: int, payload: DeviceManagerAssign, actor: CurrentUser, db: DbSession
) -> Message:
    device = db.get(Device, device_id)
    if device is None:
        raise not_found("장치")
    # 위임 자체는 기관관리자 권한이다. 위임받은 장치관리자가 재위임할 수는 없다.
    if not permissions.can_create_device(db, actor, device.org_id):
        raise forbid("장치 관리를 위임할 권한이 없습니다.")

    targets = list(
        db.execute(select(User).where(User.id.in_(payload.user_ids))).scalars().all()
    )
    if len(targets) != len(set(payload.user_ids)):
        raise bad_request("존재하지 않는 사용자가 포함되어 있습니다.")

    scope = permissions.managed_org_ids(db, actor)
    for target in targets:
        if scope is not None and target.org_id not in scope:
            raise forbid(f"'{target.name}' 은(는) 관리 범위 밖의 사용자입니다.")
        if not target.has_role(Role.DEVICE_MANAGER):
            raise bad_request(f"'{target.name}' 에게 DEVICE_MANAGER 역할이 없습니다.")

    device.managers.clear()
    db.flush()
    for target in targets:
        device.managers.append(DeviceManager(user_id=target.id))
    db.commit()
    return Message(detail=f"{len(targets)}명에게 장치 관리를 위임했습니다.")


@router.post("/{device_id}/command", response_model=Message, summary="장치 원격 제어 명령")
async def send_command(
    device_id: int,
    actor: CurrentUser,
    db: DbSession,
    command: str = Query(..., description=" | ".join(sorted(DEVICE_COMMANDS))),
) -> Message:
    device = db.get(Device, device_id)
    if device is None:
        raise not_found("장치")
    if not permissions.can_manage_device(db, actor, device):
        raise forbid("해당 장치를 제어할 권한이 없습니다.")
    if command not in DEVICE_COMMANDS:
        raise bad_request("지원하지 않는 명령입니다.")

    delivered = await notify.push_command(device.id, device.device_code, command)
    if not delivered:
        # 명령은 WebSocket 으로만 나간다. 하트비트로 대신 전달할 수 없으므로
        # 접속하지 않은 장치에는 성공했다고 말하면 안 된다.
        raise bad_request("장치가 접속되어 있지 않습니다.")
    return Message(detail=f"'{DEVICE_COMMANDS[command]}' 명령을 전송했습니다.")


@router.get("/{device_id}/screenshot", summary="장치 화면 캡처 조회")
def get_screenshot(device_id: int, actor: CurrentUser, db: DbSession) -> Response:
    """장치가 마지막으로 올린 화면 캡처를 그대로 내려준다.

    이미지를 JSON 에 base64 로 싣지 않는 이유: 브라우저가 ``<img src>`` 로
    직접 받으면 캐시와 지연 로딩이 그대로 동작하고, 목록 응답이 무거워지지
    않는다. 캡처가 없으면 404 이며, 화면은 그때 안내 문구를 대신 보여 준다.
    """
    device = db.get(Device, device_id)
    if device is None:
        raise not_found("장치")
    if not permissions.can_view_device(db, actor, device):
        raise forbid("해당 장치를 조회할 권한이 없습니다.")

    shot = db.get(DeviceScreenshot, device_id)
    if shot is None:
        raise not_found("화면 캡처")
    return Response(
        content=shot.image,
        media_type=shot.content_type,
        headers={
            # 캡처는 같은 URL 로 계속 갱신된다. 캐시가 남으면 옛 화면이 보인다.
            "Cache-Control": "no-store",
            "Last-Modified": _http_date(shot.captured_at),
        },
    )


def _http_date(value: datetime) -> str:
    """HTTP 날짜 헤더 문자열.

    SQLite 는 ``DateTime(timezone=True)`` 로 저장해도 시간대 정보를 잃고
    naive 로 돌려준다(PostgreSQL 은 aware). ``format_datetime(usegmt=True)``
    는 aware UTC 가 아니면 거부하므로, 여기서 UTC 를 붙여 두 방언의 차이를
    흡수한다. 저장은 언제나 UTC 로 한다.
    """
    if value.tzinfo is None:
        value = value.replace(tzinfo=UTC)
    return format_datetime(value.astimezone(UTC), usegmt=True)
