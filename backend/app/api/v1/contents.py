"""콘텐츠 라이브러리.

콘텐츠 편집기가 만든 문서를 이름 붙여 보관하고, 주간 스케줄 편집기의
콘텐츠 브라우저가 이 목록을 조회한다. 하나의 콘텐츠를 여러 시간대·여러
스케줄에서 재사용할 수 있다.

**중요** — 콘텐츠를 수정하면 이를 참조하는 모든 스케줄의 버전을 올린다.
그래야 장치가 하트비트에서 변경을 감지해 다시 받아간다(요구사항 제한사항 5).
"""

from __future__ import annotations

from fastapi import APIRouter, BackgroundTasks, Query, status
from sqlalchemy import and_, func, or_, select

from app.api.deps import CurrentUser, DbSession, bad_request, forbid, not_found
from app.models.content import Content
from app.models.device import Device, DeviceScheduleLink
from app.models.organization import Organization
from app.models.schedule import Schedule, ScheduleItem
from app.schemas.common import Message, Page
from app.schemas.content import (
    ContentCreate,
    ContentOut,
    ContentSummary,
    ContentUpdate,
    empty_document,
)
from app.services import assets as asset_service
from app.services import notify, org_tree, permissions, playlists

router = APIRouter(prefix="/contents", tags=["콘텐츠"])


def _usage_count(db: DbSession, content_id: int) -> int:
    return db.execute(
        select(func.count()).select_from(ScheduleItem).where(ScheduleItem.content_id == content_id)
    ).scalar_one()


def _summary(db: DbSession, content: Content, *, shared: bool = False) -> ContentSummary:
    out = ContentSummary.model_validate(content)
    org = db.get(Organization, content.org_id)
    out.org_name = org.name if org else None
    out.usage_count = _usage_count(db, content.id)
    document = content.document or {}
    out.element_count = len(document.get("elements") or [])
    out.background = (document.get("layout") or {}).get("background", "#000000")
    # 보는 사람의 관리 범위 밖에서 공유로 열려 온 것인지 — 브라우저 배지의 근거.
    out.shared = shared
    return out


def _detail(db: DbSession, content: Content, *, shared: bool = False) -> ContentOut:
    out = ContentOut.model_validate(content)
    summary = _summary(db, content, shared=shared)
    out.org_name = summary.org_name
    out.usage_count = summary.usage_count
    out.element_count = summary.element_count
    out.background = summary.background
    out.shared = summary.shared
    return out


def _share_clause(db: DbSession, consumer_org_id: int):  # noqa: ANN202
    """``consumer_org_id`` 기관에서 '공유로 보이는' 콘텐츠의 SQL 조건.

    ``permissions.content_shared_with`` 의 집합 버전 — 목록 질의에 or 로 붙인다.
    """
    siblings = permissions.sibling_org_ids(db, consumer_org_id)
    return or_(
        Content.share_scope == "전체",
        and_(Content.share_scope == "동일기관", Content.org_id == consumer_org_id),
        and_(Content.share_scope == "소속기관", Content.org_id.in_(siblings)),
    )


def _bump_referencing_schedules(db: DbSession, content_id: int) -> list[tuple[int, str, int]]:
    """이 콘텐츠를 쓰는 스케줄의 버전을 올리고, 통지할 장치 목록을 만든다.

    콘텐츠만 바뀌고 스케줄 레코드는 그대로면 장치가 변경을 알아챌 방법이 없다.
    참조하는 스케줄의 버전을 올려 주는 것이 그 연결 고리다.
    """
    schedules = list(
        db.execute(
            select(Schedule)
            .join(ScheduleItem, ScheduleItem.schedule_id == Schedule.id)
            .where(ScheduleItem.content_id == content_id)
            .distinct()
        )
        .scalars()
        .all()
    )
    targets: list[tuple[int, str, int]] = []
    for schedule in schedules:
        schedule.version += 1
        rows = db.execute(
            select(Device.id, Device.device_code)
            .join(DeviceScheduleLink, DeviceScheduleLink.device_id == Device.id)
            .where(DeviceScheduleLink.schedule_id == schedule.id)
        ).all()
        targets.extend((row.id, row.device_code, schedule.version) for row in rows)
    db.flush()
    return targets


@router.get("", response_model=Page[ContentSummary], summary="콘텐츠 목록(브라우저용)")
def list_contents(
    actor: CurrentUser,
    db: DbSession,
    q: str | None = None,
    org_id: int | None = None,
    orientation: str | None = Query(default=None, description="landscape | portrait"),
    share: str | None = Query(default=None, description="mine | shared (비우면 둘 다)"),
    page: int = Query(1, ge=1),
    size: int = Query(24, ge=1, le=200),
) -> Page[ContentSummary]:
    stmt = select(Content)
    scope = permissions.managed_org_ids(db, actor)

    # 공유 판정의 기준 기관은 소비하는 쪽 — org_id 필터가 있으면(스케줄 편집
    # 맥락) 그 기관, 없으면 보는 사람의 기관.
    consumer_org = org_id if org_id is not None else actor.org_id
    share_clause = _share_clause(db, consumer_org)

    base_ids: set[int] | None = None
    if org_id is not None:
        if not permissions.can_view_org(db, actor, org_id):
            raise forbid("해당 기관의 콘텐츠를 조회할 권한이 없습니다.")
        base_ids = org_tree.descendant_ids(db, org_id)
    elif scope is not None:
        base_ids = scope

    # share: mine = 관리 범위의 것만 | shared = 공유로 열려 온 것만 | 비면 둘 다.
    if share == "mine":
        if base_ids is not None:
            stmt = stmt.where(Content.org_id.in_(base_ids))
    elif share == "shared":
        stmt = stmt.where(share_clause)
        if base_ids is not None:
            stmt = stmt.where(Content.org_id.notin_(base_ids))
    elif base_ids is not None:
        stmt = stmt.where(or_(Content.org_id.in_(base_ids), share_clause))

    if q:
        stmt = stmt.where(Content.name.ilike(f"%{q}%"))
    if orientation == "portrait":
        stmt = stmt.where(Content.height > Content.width)
    elif orientation == "landscape":
        stmt = stmt.where(Content.height <= Content.width)

    total = db.execute(
        select(func.count()).select_from(stmt.order_by(None).subquery())
    ).scalar_one()
    rows = list(
        db.execute(stmt.order_by(Content.updated_at.desc()).offset((page - 1) * size).limit(size))
        .scalars()
        .all()
    )
    return Page[ContentSummary](
        items=[
            _summary(db, c, shared=base_ids is not None and c.org_id not in base_ids)
            for c in rows
        ],
        total=total,
        page=page,
        size=size,
    )


@router.get("/{content_id}", response_model=ContentOut, summary="콘텐츠 상세(문서 포함)")
def get_content(content_id: int, actor: CurrentUser, db: DbSession) -> ContentOut:
    content = db.get(Content, content_id)
    if content is None:
        raise not_found("콘텐츠")
    own = permissions.can_view_org(db, actor, content.org_id)
    # 관리 범위 밖이라도 공유 구분이 열어 주면 읽을 수 있다(수정·삭제는 불가).
    if not own and not permissions.content_shared_with(db, content, actor.org_id):
        raise forbid("해당 콘텐츠를 조회할 권한이 없습니다.")
    return _detail(db, content, shared=not own)


@router.post(
    "", response_model=ContentOut, status_code=status.HTTP_201_CREATED, summary="콘텐츠 생성"
)
def create_content(payload: ContentCreate, actor: CurrentUser, db: DbSession) -> ContentOut:
    org_id = payload.org_id if payload.org_id is not None else actor.org_id
    if not permissions.can_view_org(db, actor, org_id):
        raise forbid("해당 기관에 콘텐츠를 만들 권한이 없습니다.")
    if db.get(Organization, org_id) is None:
        raise bad_request("존재하지 않는 기관입니다.")
    if payload.share_scope not in permissions.CONTENT_SHARE_SCOPES:
        raise bad_request(permissions.CONTENT_SHARE_SCOPE_ERROR)

    content = Content(
        name=payload.name,
        description=payload.description,
        org_id=org_id,
        created_by=actor.id,
        width=payload.width,
        height=payload.height,
        document=payload.document or empty_document(payload.width, payload.height),
        share_scope=payload.share_scope,
        version=1,
    )
    db.add(content)
    db.flush()
    # 문서가 어떤 재생목록을 쓰는지 색인해 둔다. 재생목록을 고쳤을 때
    # 어느 스케줄의 버전을 올려야 하는지 찾는 유일한 수단이다.
    playlists.sync_links(db, content)
    # 올린 파일도 같은 방식으로 색인한다. 쓰이는 파일을 지우지 못하게 막는
    # 근거이자, 안 쓰는 파일을 골라내는 근거다.
    asset_service.sync_links(db, content)
    db.commit()
    db.refresh(content)
    return _detail(db, content)


@router.put("/{content_id}", response_model=ContentOut, summary="콘텐츠 수정")
def update_content(
    content_id: int,
    payload: ContentUpdate,
    actor: CurrentUser,
    db: DbSession,
    background: BackgroundTasks,
) -> ContentOut:
    content = db.get(Content, content_id)
    if content is None:
        raise not_found("콘텐츠")
    if not permissions.can_manage_org(db, actor, content.org_id) and content.created_by != actor.id:
        raise forbid("해당 콘텐츠를 수정할 권한이 없습니다.")
    if (
        payload.share_scope is not None
        and payload.share_scope not in permissions.CONTENT_SHARE_SCOPES
    ):
        raise bad_request(permissions.CONTENT_SHARE_SCOPE_ERROR)

    data = payload.model_dump(exclude_unset=True)
    for key, value in data.items():
        if value is not None:
            setattr(content, key, value)
    content.version += 1

    playlists.sync_links(db, content)
    asset_service.sync_links(db, content)
    # 이 콘텐츠를 쓰는 스케줄의 버전도 올려야 장치가 변경을 감지한다.
    targets = _bump_referencing_schedules(db, content.id)
    db.commit()
    db.refresh(content)

    if targets:
        background.add_task(notify.push_schedule_changed, targets)
    return _detail(db, content)


@router.post("/{content_id}/duplicate", response_model=ContentOut, summary="콘텐츠 복제")
def duplicate_content(content_id: int, actor: CurrentUser, db: DbSession) -> ContentOut:
    source = db.get(Content, content_id)
    if source is None:
        raise not_found("콘텐츠")
    if not permissions.can_view_org(db, actor, source.org_id):
        raise forbid("해당 콘텐츠를 복제할 권한이 없습니다.")

    # 복사본은 '없음'으로 시작한다 — 공유는 명시적인 행동이어야 한다.
    copy = Content(
        name=f"{source.name} (복사본)",
        description=source.description,
        org_id=source.org_id,
        created_by=actor.id,
        width=source.width,
        height=source.height,
        document=source.document,
        version=1,
    )
    db.add(copy)
    db.flush()
    playlists.sync_links(db, copy)
    db.commit()
    db.refresh(copy)
    return _detail(db, copy)


@router.delete("/{content_id}", response_model=Message, summary="콘텐츠 삭제")
def delete_content(content_id: int, actor: CurrentUser, db: DbSession) -> Message:
    content = db.get(Content, content_id)
    if content is None:
        raise not_found("콘텐츠")
    if not permissions.can_manage_org(db, actor, content.org_id) and content.created_by != actor.id:
        raise forbid("해당 콘텐츠를 삭제할 권한이 없습니다.")

    used = _usage_count(db, content_id)
    if used:
        # FK 는 SET NULL 이라 삭제해도 DB 오류는 안 나지만, 그러면 해당 시간대가
        # 조용히 빈 화면이 된다. 사용처를 먼저 정리하도록 막는다.
        raise bad_request(
            f"이 콘텐츠를 사용하는 스케줄 아이템이 {used}건 있습니다. 먼저 배치를 해제하세요."
        )

    db.delete(content)
    db.commit()
    return Message(detail="콘텐츠가 삭제되었습니다.")
