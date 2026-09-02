"""장치그룹.

사용자가 개인적으로 구성하는 장치 묶음이다(장치그룹정보의 소유자 FK).
그룹에 담을 수 있는 장치는 그 사용자가 조회 권한을 가진 장치뿐이다.
"""

from __future__ import annotations

from fastapi import APIRouter, status
from sqlalchemy import select

from app.api.deps import CurrentUser, DbSession, bad_request, forbid, not_found
from app.models.device import Device, DeviceGroup, DeviceGroupMember
from app.schemas.common import Message
from app.schemas.device import DeviceGroupCreate, DeviceGroupOut, DeviceGroupUpdate
from app.services import permissions

router = APIRouter(prefix="/device-groups", tags=["장치그룹"])


def _to_out(group: DeviceGroup) -> DeviceGroupOut:
    return DeviceGroupOut(
        id=group.id,
        name=group.name,
        user_id=group.user_id,
        device_ids=[m.device_id for m in group.members],
    )


def _assert_devices_visible(db: DbSession, actor, device_ids: list[int]) -> list[Device]:  # noqa: ANN001
    if not device_ids:
        return []
    devices = list(
        db.execute(select(Device).where(Device.id.in_(device_ids))).scalars().all()
    )
    if len(devices) != len(set(device_ids)):
        raise bad_request("존재하지 않는 장치가 포함되어 있습니다.")
    for device in devices:
        if not permissions.can_view_device(db, actor, device):
            raise forbid(f"장치 '{device.name}' 에 접근할 권한이 없습니다.")
    return devices


@router.get("", response_model=list[DeviceGroupOut], summary="내 장치그룹 목록")
def list_groups(actor: CurrentUser, db: DbSession) -> list[DeviceGroupOut]:
    groups = list(
        db.execute(
            select(DeviceGroup).where(DeviceGroup.user_id == actor.id).order_by(DeviceGroup.id)
        )
        .scalars()
        .all()
    )
    return [_to_out(g) for g in groups]


@router.post(
    "", response_model=DeviceGroupOut, status_code=status.HTTP_201_CREATED, summary="장치그룹 생성"
)
def create_group(
    payload: DeviceGroupCreate, actor: CurrentUser, db: DbSession
) -> DeviceGroupOut:
    _assert_devices_visible(db, actor, payload.device_ids)

    group = DeviceGroup(name=payload.name, user_id=actor.id)
    for device_id in dict.fromkeys(payload.device_ids):
        group.members.append(DeviceGroupMember(device_id=device_id))
    db.add(group)
    db.commit()
    db.refresh(group)
    return _to_out(group)


@router.put("/{group_id}", response_model=DeviceGroupOut, summary="장치그룹 수정")
def update_group(
    group_id: int, payload: DeviceGroupUpdate, actor: CurrentUser, db: DbSession
) -> DeviceGroupOut:
    group = db.get(DeviceGroup, group_id)
    if group is None:
        raise not_found("장치그룹")
    if group.user_id != actor.id:
        raise forbid("본인이 만든 그룹만 수정할 수 있습니다.")

    if payload.name is not None:
        group.name = payload.name

    if payload.device_ids is not None:
        _assert_devices_visible(db, actor, payload.device_ids)
        group.members.clear()
        db.flush()
        for device_id in dict.fromkeys(payload.device_ids):
            group.members.append(DeviceGroupMember(device_id=device_id))

    db.commit()
    db.refresh(group)
    return _to_out(group)


@router.delete("/{group_id}", response_model=Message, summary="장치그룹 삭제")
def delete_group(group_id: int, actor: CurrentUser, db: DbSession) -> Message:
    group = db.get(DeviceGroup, group_id)
    if group is None:
        raise not_found("장치그룹")
    if group.user_id != actor.id:
        raise forbid("본인이 만든 그룹만 삭제할 수 있습니다.")
    db.delete(group)
    db.commit()
    return Message(detail="장치그룹이 삭제되었습니다.")
