"""스케줄 관리.

스케줄이나 아이템이 바뀌면 ``version`` 이 올라가고, 이 스케줄을 쓰는
장치들에 변경을 푸시한다. 푸시가 유실돼도 장치는 하트비트에서
버전 차이를 발견해 스스로 재수신한다(요구사항 제한사항 5).
"""

from __future__ import annotations

from fastapi import APIRouter, BackgroundTasks, Query, status
from sqlalchemy import func, select

from app.api.deps import CurrentUser, DbSession, bad_request, forbid, not_found
from app.models.content import Content
from app.models.org_notice import OrgNotice
from app.models.device import Device, DeviceScheduleLink
from app.models.schedule import Schedule
from app.schemas.common import Message, Page
from app.schemas.content import empty_document
from app.schemas.schedule import (
    ScheduleCreate,
    ScheduleDetail,
    ScheduleOut,
    ScheduleUpdate,
)
from app.services import notify, org_tree, orientation, permissions, schedule_service

router = APIRouter(prefix="/schedules", tags=["스케줄"])


DAY_NAMES = ["월", "화", "수", "목", "금", "토", "일"]


def _assert_orientation(items: list[dict], contents: dict[int, Content], expected: str) -> None:
    """아이템의 콘텐츠가 스케줄 방향과 같은지 검사한다.

    가로 콘텐츠를 세로 화면에 태우면 위아래에 검은 띠만 남고 글자는 읽을 수
    없게 작아진다. 플레이어는 장치 해상도에 맞춰 균일 스케일링만 하므로
    이 어긋남을 보정해 주지 않는다. 그래서 붙는 시점에 막는다.

    참조 콘텐츠는 저장된 크기로, 인라인 콘텐츠는 문서의 ``layout`` 으로
    판정한다. 크기를 알 수 없는 인라인(빈 아이템)은 통과시킨다 — 아직
    아무것도 배치하지 않은 아이템까지 막으면 편집을 시작할 수 없다.
    """
    want = orientation.label(expected)
    for item in items:
        content_id = item.get("content_id")
        if content_id:
            content = contents[content_id]
            actual = orientation.of_size(content.width, content.height)
            if str(actual) != str(expected):
                raise bad_request(
                    f"{want} 스케줄에는 {want} 콘텐츠만 넣을 수 있습니다. "
                    f"'{content.name}' 은(는) {orientation.label(actual)}"
                    f"({content.width}×{content.height})입니다."
                )
            continue

        actual = orientation.of_document(item.get("content"))
        if actual is not None and str(actual) != str(expected):
            layout = (item.get("content") or {}).get("layout") or {}
            raise bad_request(
                f"{want} 스케줄에는 {want} 콘텐츠만 넣을 수 있습니다. "
                f"{orientation.label(actual)}"
                f"({layout.get('width')}×{layout.get('height')}) 콘텐츠가 들어 있습니다."
            )


def _validate_items(
    db: DbSession,
    actor,  # noqa: ANN001
    items: list[dict],
    expected_orientation: str,
    schedule_org_id: int,
) -> None:
    """아이템 저장 전 검사.

    1. 참조한 콘텐츠가 존재하고 조회 권한이 있는지.
    2. 콘텐츠 방향이 스케줄 방향과 같은지.
    3. 같은 요일에 시간대가 겹치지 않는지 — 겹치면 그 시각에 무엇을 틀지
       모호해지므로 주간 편집기 단계에서 막는다.
    """
    content_ids = {item["content_id"] for item in items if item.get("content_id")}
    found: dict[int, Content] = {}
    if content_ids:
        found = {
            c.id: c
            for c in db.execute(select(Content).where(Content.id.in_(content_ids))).scalars().all()
        }
        for content_id in content_ids:
            content = found.get(content_id)
            if content is None:
                raise bad_request(f"존재하지 않는 콘텐츠입니다: {content_id}")
            # 관리 범위 밖이라도 공유 구분이 스케줄의 기관에 열려 있으면 쓸 수 있다.
            if not permissions.can_view_org(db, actor, content.org_id) and not (
                permissions.content_shared_with(db, content, schedule_org_id)
            ):
                raise forbid(f"콘텐츠 '{content.name}' 을(를) 사용할 권한이 없습니다.")

    # 공지 참조 검사 — 스케줄 기관의 자기/상위기관 공지만 쓸 수 있다.
    notice_ids = {item["org_notice_id"] for item in items if item.get("org_notice_id")}
    if notice_ids:
        notices = {
            n.id: n
            for n in db.execute(select(OrgNotice).where(OrgNotice.id.in_(notice_ids))).scalars()
        }
        chain = set(org_tree.ancestor_ids(db, schedule_org_id, include_self=True))
        for notice_id in notice_ids:
            notice = notices.get(notice_id)
            if notice is None:
                raise bad_request(f"존재하지 않는 공지입니다: {notice_id}")
            if notice.org_id not in chain:
                raise forbid(f"이 기관에서 쓸 수 없는 공지입니다: '{notice.name}'")

    _assert_orientation(items, found, expected_orientation)

    by_day: dict[int, list[dict]] = {}
    for item in items:
        if item.get("start_time") and item.get("end_time"):
            by_day.setdefault(item.get("day_of_week", -1), []).append(item)

    for day, day_items in by_day.items():
        ordered = sorted(day_items, key=lambda i: i["start_time"])
        for previous, current in zip(ordered, ordered[1:], strict=False):
            if current["start_time"] < previous["end_time"]:
                label = DAY_NAMES[day] if 0 <= day <= 6 else "요일 미지정"
                raise bad_request(
                    f"{label}요일의 시간대가 겹칩니다: "
                    f"{previous['start_time']}~{previous['end_time']} 과 "
                    f"{current['start_time']}~{current['end_time']}"
                )


def _device_count(db: DbSession, schedule_id: int) -> int:
    return db.execute(
        select(func.count())
        .select_from(DeviceScheduleLink)
        .where(DeviceScheduleLink.schedule_id == schedule_id)
    ).scalar_one()


def _to_out(db: DbSession, schedule: Schedule) -> ScheduleOut:
    out = ScheduleOut.model_validate(schedule)
    out.device_count = _device_count(db, schedule.id)
    return out


def _to_detail(db: DbSession, schedule: Schedule) -> ScheduleDetail:
    detail = ScheduleDetail.model_validate(schedule)
    detail.device_count = _device_count(db, schedule.id)
    return detail


def _assert_can_manage(db: DbSession, actor, schedule: Schedule) -> None:  # noqa: ANN001
    """스케줄 수정 권한.

    스케줄은 기관 단위 자원이므로, 해당 기관을 관리할 수 있거나
    본인이 만든 스케줄이면 수정할 수 있다.
    """
    if permissions.can_manage_org(db, actor, schedule.org_id):
        return
    if schedule.created_by == actor.id:
        return
    raise forbid("해당 스케줄을 수정할 권한이 없습니다.")


def _notify_targets(db: DbSession, schedule: Schedule) -> list[tuple[int, str, int]]:
    """푸시 대상을 지금 확정한다.

    백그라운드 태스크는 응답 반환 뒤에 실행되고 그때는 요청 세션이 이미
    닫혀 있으므로, ORM 객체가 아니라 값으로 넘겨야 한다.
    """
    rows = db.execute(
        select(Device.id, Device.device_code)
        .join(DeviceScheduleLink, DeviceScheduleLink.device_id == Device.id)
        .where(DeviceScheduleLink.schedule_id == schedule.id)
    ).all()
    return [(row.id, row.device_code, schedule.version) for row in rows]


@router.get("", response_model=Page[ScheduleOut], summary="스케줄 목록")
def list_schedules(
    actor: CurrentUser,
    db: DbSession,
    q: str | None = None,
    org_id: int | None = None,
    page: int = Query(1, ge=1),
    size: int = Query(20, ge=1, le=200),
) -> Page[ScheduleOut]:
    stmt = select(Schedule)
    scope = permissions.managed_org_ids(db, actor)
    if scope is not None:
        stmt = stmt.where(Schedule.org_id.in_(scope))
    if q:
        stmt = stmt.where(Schedule.name.ilike(f"%{q}%"))
    if org_id is not None:
        if not permissions.can_view_org(db, actor, org_id):
            raise forbid("해당 기관의 스케줄을 조회할 권한이 없습니다.")
        stmt = stmt.where(Schedule.org_id.in_(org_tree.descendant_ids(db, org_id)))

    total = db.execute(
        select(func.count()).select_from(stmt.order_by(None).subquery())
    ).scalar_one()
    rows = list(
        db.execute(stmt.order_by(Schedule.id.desc()).offset((page - 1) * size).limit(size))
        .scalars()
        .all()
    )
    return Page[ScheduleOut](
        items=[_to_out(db, s) for s in rows], total=total, page=page, size=size
    )


@router.get("/content/blank", response_model=dict, summary="빈 콘텐츠 문서 템플릿")
def blank_content(width: int = 1920, height: int = 1080) -> dict:
    """편집기가 새 아이템을 만들 때 쓰는 기본 문서.

    ``/{schedule_id}`` 보다 먼저 선언해야 한다. 뒤에 두면 'content' 가
    정수 경로 파라미터 검증에 걸려 422 가 된다.
    """
    return empty_document(width, height)


@router.get("/{schedule_id}", response_model=ScheduleDetail, summary="스케줄 상세(아이템 포함)")
def get_schedule(schedule_id: int, actor: CurrentUser, db: DbSession) -> ScheduleDetail:
    schedule = db.get(Schedule, schedule_id)
    if schedule is None:
        raise not_found("스케줄")
    if not permissions.can_view_org(db, actor, schedule.org_id):
        raise forbid("해당 스케줄을 조회할 권한이 없습니다.")
    return _to_detail(db, schedule)


@router.post(
    "", response_model=ScheduleDetail, status_code=status.HTTP_201_CREATED, summary="스케줄 생성"
)
def create_schedule(
    payload: ScheduleCreate, actor: CurrentUser, db: DbSession
) -> ScheduleDetail:
    org_id = payload.org_id if payload.org_id is not None else actor.org_id
    if not permissions.can_view_org(db, actor, org_id):
        raise forbid("해당 기관에 스케줄을 만들 권한이 없습니다.")

    schedule = Schedule(
        name=payload.name,
        kind=payload.kind,
        orientation=payload.orientation,
        start_at=payload.start_at,
        end_at=payload.end_at,
        org_id=org_id,
        created_by=actor.id,
        version=1,
    )
    db.add(schedule)
    db.flush()

    if payload.items:
        items = [item.model_dump(mode="json") for item in payload.items]
        _validate_items(db, actor, items, schedule.orientation, schedule.org_id)
        schedule_service.replace_items(db, schedule, items)
    db.commit()
    db.refresh(schedule)
    return _to_detail(db, schedule)


@router.put("/{schedule_id}", response_model=ScheduleDetail, summary="스케줄 수정")
def update_schedule(
    schedule_id: int,
    payload: ScheduleUpdate,
    actor: CurrentUser,
    db: DbSession,
    background: BackgroundTasks,
) -> ScheduleDetail:
    schedule = db.get(Schedule, schedule_id)
    if schedule is None:
        raise not_found("스케줄")
    _assert_can_manage(db, actor, schedule)

    data = payload.model_dump(mode="json", exclude_unset=True)
    items = data.pop("items", None)
    new_orientation = data.get("orientation") or schedule.orientation

    # 검사를 먼저 끝내고 나서 바꾼다. 순서를 뒤집으면 거부된 요청이 세션에
    # 변경을 남긴 채 롤백에 기대게 된다.
    if items is not None:
        _validate_items(db, actor, items, new_orientation, schedule.org_id)
    elif new_orientation != schedule.orientation:
        # 방향만 바꾸는 경우. 이미 붙어 있는 콘텐츠가 새 방향과 맞아야 한다.
        # 안 맞는데 통과시키면 장치에서 검은 띠만 남은 화면이 나간다.
        _validate_items(
            db,
            actor,
            [{"content_id": i.content_id, "content": i.content} for i in schedule.items],
            new_orientation,
            schedule.org_id,
        )

    # 한쪽만 보내오는 경우가 흔하다(행사가 하루 밀렸다 → 종료만 고친다).
    # 페이로드 안에서만 앞뒤를 보면 이미 저장된 반대쪽과 뒤집히는 것을 놓친다.
    # 뒤집힌 기간은 언제나 '기간 밖'이라 아무 때도 표출되지 않는다.
    # ``data`` 는 mode="json" 이라 문자열이다. 비교는 payload 의 datetime 으로 한다.
    fields = payload.model_fields_set
    start = payload.start_at if "start_at" in fields else schedule.start_at
    end = payload.end_at if "end_at" in fields else schedule.end_at
    if start and end and schedule_service.as_utc(start) >= schedule_service.as_utc(end):
        raise bad_request("종료일시는 시작일시보다 뒤여야 합니다.")

    # 사용 기간은 ``data`` 가 아니라 payload 에서 가져온다. ``mode="json"`` 이
    # datetime 을 문자열로 바꿔 놓기 때문에, 그대로 넣으면 SQLite 가 거부한다.
    # null 은 '제한 없음' 이라는 뜻이라 보내온 null 도 반영해야 한다.
    for key in ("start_at", "end_at"):
        data.pop(key, None)
        if key in fields:
            setattr(schedule, key, getattr(payload, key))

    for key, value in data.items():
        # 나머지 필드는 null 이 '안 바꿈' 이다(exclude_unset 과 함께 쓴다).
        if value is not None:
            setattr(schedule, key, value)

    if items is not None:
        schedule_service.replace_items(db, schedule, items)
    else:
        # 메타데이터만 바뀌어도 장치가 이름 등을 갱신하도록 버전을 올린다.
        schedule_service.bump_version(db, schedule)

    db.commit()
    db.refresh(schedule)
    background.add_task(notify.push_schedule_changed, _notify_targets(db, schedule))
    return _to_detail(db, schedule)


@router.delete("/{schedule_id}", response_model=Message, summary="스케줄 삭제")
def delete_schedule(schedule_id: int, actor: CurrentUser, db: DbSession) -> Message:
    schedule = db.get(Schedule, schedule_id)
    if schedule is None:
        raise not_found("스케줄")
    _assert_can_manage(db, actor, schedule)

    count = _device_count(db, schedule_id)
    if count:
        raise bad_request(
            f"이 스케줄을 사용 중인 장치가 {count}대 있습니다. 먼저 배정을 해제하세요."
        )
    db.delete(schedule)
    db.commit()
    return Message(detail="스케줄이 삭제되었습니다.")


@router.post("/{schedule_id}/duplicate", response_model=ScheduleDetail, summary="스케줄 복제")
def duplicate_schedule(
    schedule_id: int, actor: CurrentUser, db: DbSession
) -> ScheduleDetail:
    source = db.get(Schedule, schedule_id)
    if source is None:
        raise not_found("스케줄")
    if not permissions.can_view_org(db, actor, source.org_id):
        raise forbid("해당 스케줄을 복제할 권한이 없습니다.")

    copy = Schedule(
        name=f"{source.name} (복사본)",
        kind=source.kind,
        # 방향까지 같이 복제해야 아이템의 콘텐츠가 그대로 유효하다.
        orientation=source.orientation,
        # 기간도 그대로 가져간다. 복사본이 무기한이 되면 지난 행사 안내가 다시 나간다.
        start_at=source.start_at,
        end_at=source.end_at,
        org_id=source.org_id,
        created_by=actor.id,
        version=1,
    )
    db.add(copy)
    db.flush()
    schedule_service.replace_items(
        db,
        copy,
        [
            {
                "day_of_week": item.day_of_week,
                "start_time": item.start_time,
                "end_time": item.end_time,
                "sort_order": item.sort_order,
                "duration_sec": item.duration_sec,
                # 콘텐츠는 라이브러리에서 공유되므로 참조만 복사한다(문서를 복제하지 않는다).
                "content_id": item.content_id,
                "content": item.content,
            }
            for item in source.items
        ],
    )
    db.commit()
    db.refresh(copy)
    return _to_detail(db, copy)
