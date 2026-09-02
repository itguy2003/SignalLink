"""스케줄 버전 관리와 플레이어 페이로드 생성.

핵심 규칙(요구사항 제한사항 5, 6)
    - 스케줄이나 그 아이템이 바뀌면 ``Schedule.version`` 을 증가시킨다.
    - 장치는 하트비트에서 자신의 ``Device.version`` 과 서버 버전을 비교하고,
      다르면 스케줄을 다시 받아 재생한다.
    - 배정된 스케줄이 하나도 없거나 지금 유효한 것이 없으면 기본 데모를 표출한다.

장치에는 스케줄을 **여러 개** 배정할 수 있다. 서버가 지금 유효한 것들만
골라 아이템을 합쳐 내려주므로, 플레이어가 보는 페이로드 모양은 예전과 같다.
"""

from __future__ import annotations

from datetime import UTC, datetime, time

from sqlalchemy.orm import Session

from app.models.device import Device
from app.models.enums import ScheduleKind
from app.models.schedule import Schedule, ScheduleItem
from app.schemas.schedule import ScheduleItemOut, SchedulePayload
from app.services import playlists

#: 스케줄이 배정되지 않은 장치가 표출할 데모. 버전은 항상 0 이다.
DEMO_VERSION = 0


def bump_version(db: Session, schedule: Schedule) -> int:
    """스케줄 버전을 올린다. 커밋은 호출자가 한다."""
    schedule.version += 1
    db.flush()
    return schedule.version


def as_utc(value: datetime | None) -> datetime | None:
    """저장된 시각을 UTC aware 로. SQLite 는 naive 로 돌려준다(PostgreSQL 은 aware).

    저장은 언제나 UTC 로 하므로, naive 로 온 값에는 UTC 를 붙여 두 방언의
    차이를 흡수한다. 이걸 안 하면 비교에서 TypeError 가 난다.
    """
    if value is not None and value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value


def is_active(schedule: Schedule, now: datetime) -> bool:
    """지금이 이 스케줄의 사용 기간 안인가. 기간이 없으면 언제나 유효하다."""
    start = as_utc(schedule.start_at)
    end = as_utc(schedule.end_at)
    if start is not None and now < start:
        return False
    return not (end is not None and now > end)


def assigned_schedules(device: Device) -> list[Schedule]:
    """배정된 스케줄 전부. 우선순위(sort_order) 순."""
    return [link.schedule for link in device.schedule_links if link.schedule is not None]


def active_schedules(device: Device, now: datetime | None = None) -> list[Schedule]:
    """지금 유효한 스케줄만. 기간이 지난 것은 배정돼 있어도 나가지 않는다."""
    moment = now or datetime.now(UTC)
    return [s for s in assigned_schedules(device) if is_active(s, moment)]


def current_version(db: Session, device: Device, now: datetime | None = None) -> int:  # noqa: ARG001
    """장치가 지금 받아야 할 스케줄의 합성 버전.

    배정된 스케줄 **전체**와 각 스케줄이 지금 유효한지까지 반영한다.

    유효 여부를 넣는 이유: 사용 기간이 시작되거나 끝나는 순간에는 어떤
    레코드도 바뀌지 않는다. 버전을 스케줄 내용만으로 만들면 장치는 기간이
    바뀐 것을 영영 알아채지 못하고 옛 화면을 계속 튼다.

    값 자체에 의미는 없다. 같으면 그대로, 다르면 다시 받는다.
    """
    moment = now or datetime.now(UTC)
    parts = sorted(
        (s.id, s.version, is_active(s, moment)) for s in assigned_schedules(device)
    )
    if not parts:
        return DEMO_VERSION
    if not any(active for _, _, active in parts):
        # 배정은 돼 있지만 지금 유효한 것이 없다 → 데모. 다만 데모와 구분되는
        # 버전이어야 기간이 시작될 때 장치가 변경을 알아챈다.
        pass
    # 31 비트 양수로 줄인다. 부호 있는 32비트 정수에 안전하게 들어가야
    # SQLite/PostgreSQL/각 플레이어 스택에서 모두 같은 값이 된다.
    digest = 0
    for schedule_id, version, active in parts:
        digest = digest * 1_000_003 + schedule_id * 131 + version * 7 + int(active)
        digest %= 2_147_483_647
    # 0 은 데모 전용 값이라 피한다.
    return digest or 1


def build_demo_payload() -> SchedulePayload:
    """기본 데모 콘텐츠.

    스케줄 미배정 장치가 검은 화면만 띄우지 않도록 서버가 합성해 내려준다.
    """
    demo_content = {
        "version": 1,
        "layout": {"width": 1920, "height": 1080, "background": "#0b1120"},
        "elements": [
            {
                "id": "demo-title",
                "type": "text",
                "rect": {"x": 160, "y": 380, "w": 1600, "h": 160, "z": 1},
                "options": {
                    "text": "SignalLink Green",
                    "fontSize": 120,
                    "color": "#ffffff",
                    "align": "center",
                    "bold": True,
                },
            },
            {
                "id": "demo-subtitle",
                "type": "text",
                "rect": {"x": 160, "y": 560, "w": 1600, "h": 90, "z": 1},
                "options": {
                    "text": "스케줄이 배정되지 않은 장치입니다.",
                    "fontSize": 48,
                    "color": "#94a3b8",
                    "align": "center",
                },
            },
            {
                "id": "demo-clock",
                "type": "widget",
                "widget_key": "clock",
                "rect": {"x": 760, "y": 700, "w": 400, "h": 120, "z": 1},
                "options": {"format": "HH:mm:ss"},
            },
        ],
    }
    return SchedulePayload(
        schedule_id=None,
        name="기본 데모",
        kind=ScheduleKind.LIST_LOOP,
        version=DEMO_VERSION,
        is_demo=True,
        server_time=datetime.now(UTC),
        items=[
            ScheduleItemOut(
                id=0,
                schedule_id=0,
                day_of_week=-1,
                start_time=None,
                end_time=None,
                sort_order=0,
                duration_sec=30,
                content=demo_content,
            )
        ],
    )


def build_payload(db: Session, device: Device, now: datetime | None = None) -> SchedulePayload:
    """장치에 내려줄 스케줄 페이로드를 만든다.

    스케줄을 여러 개 배정할 수 있지만 **페이로드 모양은 예전과 같다** —
    지금 유효한 스케줄들의 아이템을 우선순위대로 이어 붙여 하나의 목록으로
    내려준다. 덕분에 플레이어(JS/.NET/Flutter)를 고치지 않아도 된다.

    아이템에는 각자 요일·시각·표출 시간이 들어 있으므로, 종류가 다른 스케줄이
    섞여도 플레이어는 아이템만 보고 언제 무엇을 틀지 판단할 수 있다.
    """
    moment = now or datetime.now(UTC)
    active = active_schedules(device, moment)
    if not active:
        # 배정이 없거나, 있어도 지금은 기간 밖이다. 검은 화면 대신 데모를 튼다.
        payload = build_demo_payload()
        # 기간이 시작되면 버전이 달라져 장치가 알아채야 하므로 합성 버전을 쓴다.
        payload.version = current_version(db, device, moment)
        return payload

    items: list[ScheduleItemOut] = []
    for schedule in active:
        items.extend(_player_item(item, db) for item in schedule.items)

    first = active[0]
    return SchedulePayload(
        schedule_id=first.id,
        # 여러 개면 무엇이 나가고 있는지 이름으로 알 수 있게 이어 붙인다.
        name=" + ".join(s.name for s in active),
        kind=first.kind,
        version=current_version(db, device, moment),
        is_demo=False,
        server_time=moment,
        items=items,
    )


def _player_item(item: ScheduleItem, db: Session | None = None) -> ScheduleItemOut:
    """플레이어용 아이템.

    콘텐츠 라이브러리 참조(``content_id``)를 여기서 해소해 ``content`` 에 인라인한다.
    덕분에 플레이어는 라이브러리의 존재를 몰라도 되고, 콘텐츠 JSON 계약이 그대로 유지된다.

    문서 안의 재생목록 참조도 같은 이유로 여기서 펼친다 — 플레이어가 재생목록
    API 를 알 필요가 없다. 저장된 문서에는 참조만 남아 있으므로, 재생목록을
    고치면 다음 표출에 그대로 반영된다.
    """
    out = ScheduleItemOut.model_validate(item)
    content = item.resolved_content
    if db is not None:
        content = playlists.inline_into_document(db, content)
    out.content = content
    return out


def replace_items(db: Session, schedule: Schedule, items: list[dict]) -> None:
    """스케줄 아이템을 전체 교체하고 버전을 올린다."""
    schedule.items.clear()
    db.flush()
    for index, raw in enumerate(items):
        schedule.items.append(
            ScheduleItem(
                day_of_week=raw.get("day_of_week", -1),
                start_time=_as_time(raw.get("start_time")),
                end_time=_as_time(raw.get("end_time")),
                sort_order=raw.get("sort_order", index),
                duration_sec=raw.get("duration_sec", 10),
                content_id=raw.get("content_id"),
                # 참조 방식이면 인라인 문서를 함께 저장하지 않는다. 두 곳에 사본이
                # 남으면 어느 쪽이 정본인지 모호해진다.
                content={} if raw.get("content_id") else (raw.get("content") or {}),
            )
        )
    bump_version(db, schedule)


def _as_time(value: time | str | None) -> time | None:
    if value is None or isinstance(value, time):
        return value
    return time.fromisoformat(value)
