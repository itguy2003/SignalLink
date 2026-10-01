"""위젯 재생목록.

위젯 여러 개를 순서와 표출 시간만 정해 묶어 둔 것이다. 콘텐츠 편집기에서
한 요소로 놓으면 그 자리에서 위젯들이 차례로 바뀐다.

**중요** — 재생목록을 고치면 이를 쓰는 콘텐츠의 버전을 올리고, 그 콘텐츠를
쓰는 스케줄의 버전까지 올린다. 그래야 장치가 하트비트에서 변경을 감지해
다시 받아간다(요구사항 제한사항 5). 콘텐츠 라이브러리와 같은 연쇄다.
"""

from __future__ import annotations

from fastapi import APIRouter, BackgroundTasks, Query, status
from sqlalchemy import func, select

from app.api.deps import CurrentUser, DbSession, bad_request, forbid, not_found
from app.models.content import Content
from app.models.device import Device, DeviceScheduleLink
from app.models.organization import Organization
from app.models.playlist import ContentPlaylist, Playlist, PlaylistItem
from app.models.schedule import Schedule, ScheduleItem
from app.schemas.common import Message, Page
from app.schemas.playlist import PlaylistCreate, PlaylistOut, PlaylistUpdate
from app.services import assets as asset_service
from app.services import notify, org_tree, permissions, widgets

router = APIRouter(prefix="/playlists", tags=["재생목록"])


def _usage_count(db: DbSession, playlist_id: int) -> int:
    return db.execute(
        select(func.count())
        .select_from(ContentPlaylist)
        .where(ContentPlaylist.playlist_id == playlist_id)
    ).scalar_one()


def _to_out(db: DbSession, playlist: Playlist) -> PlaylistOut:
    out = PlaylistOut.model_validate(playlist)
    org = db.get(Organization, playlist.org_id)
    out.org_name = org.name if org else None
    out.usage_count = _usage_count(db, playlist.id)
    out.total_duration_sec = sum(item.duration_sec for item in playlist.items)
    return out


def _assert_can_manage(db: DbSession, actor, playlist: Playlist) -> None:  # noqa: ANN001
    """재생목록은 기관 자원이다. 기관을 관리하거나 본인이 만든 것이면 고칠 수 있다."""
    if permissions.can_manage_org(db, actor, playlist.org_id):
        return
    if playlist.created_by == actor.id:
        return
    raise forbid("해당 재생목록을 수정할 권한이 없습니다.")


def _replace_items(playlist: Playlist, items: list) -> None:
    """칸을 전체 교체한다. 받은 순서가 곧 재생 순서다."""
    known = {spec.key for spec in widgets.list_widgets()}
    for item in items:
        if item.widget_key not in known:
            raise bad_request(f"알 수 없는 위젯입니다: {item.widget_key}")

    playlist.items.clear()
    for index, item in enumerate(items):
        playlist.items.append(
            PlaylistItem(
                sort_order=index,
                widget_key=item.widget_key,
                duration_sec=item.duration_sec,
                options=item.options,
                transition=item.transition,
                transition_ms=item.transition_ms,
            )
        )


def _bump_referencing(db: DbSession, playlist_id: int) -> list[tuple[int, str, int]]:
    """이 재생목록을 쓰는 콘텐츠·스케줄의 버전을 올리고 통지 대상을 모은다.

    재생목록만 바뀌고 콘텐츠·스케줄 레코드는 그대로면 장치가 변경을 알아챌
    방법이 없다. 색인(``ContentPlaylist``)이 그 연결 고리다.
    """
    content_ids = list(
        db.execute(
            select(ContentPlaylist.content_id).where(ContentPlaylist.playlist_id == playlist_id)
        )
        .scalars()
        .all()
    )

    for content in db.execute(select(Content).where(Content.id.in_(content_ids))).scalars().all():
        content.version += 1

    # 스케줄 아이템이 재생목록을 **인라인 문서**로 직접 들 수도 있다(라이브러리
    # 콘텐츠 없이 스케줄에 놓은 경우). 색인이 없으므로 문서를 훑는다 —
    # 여기서 빼먹으면 그 스케줄의 장치는 고친 재생목록을 영영 받지 못한다.
    from app.services.playlists import referenced_ids as _playlist_refs

    inline_schedule_ids = {
        item.schedule_id
        for item in db.execute(
            select(ScheduleItem).where(ScheduleItem.content_id.is_(None))
        ).scalars()
        if playlist_id in _playlist_refs(item.content)
    }

    if not content_ids and not inline_schedule_ids:
        return []

    stmt = select(Schedule)
    if content_ids:
        stmt = (
            stmt.join(ScheduleItem, ScheduleItem.schedule_id == Schedule.id)
            .where(
                (ScheduleItem.content_id.in_(content_ids))
                | (Schedule.id.in_(inline_schedule_ids))
            )
            .distinct()
        )
    else:
        stmt = stmt.where(Schedule.id.in_(inline_schedule_ids))

    schedules = list(db.execute(stmt).scalars().all())
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


@router.get("", response_model=Page[PlaylistOut], summary="재생목록 목록")
def list_playlists(
    actor: CurrentUser,
    db: DbSession,
    q: str | None = None,
    org_id: int | None = None,
    page: int = Query(1, ge=1),
    size: int = Query(24, ge=1, le=200),
) -> Page[PlaylistOut]:
    stmt = select(Playlist)
    scope = permissions.managed_org_ids(db, actor)
    if scope is not None:
        stmt = stmt.where(Playlist.org_id.in_(scope))
    if q:
        stmt = stmt.where(Playlist.name.ilike(f"%{q}%"))
    if org_id is not None:
        if not permissions.can_view_org(db, actor, org_id):
            raise forbid("해당 기관의 재생목록을 조회할 권한이 없습니다.")
        stmt = stmt.where(Playlist.org_id.in_(org_tree.descendant_ids(db, org_id)))

    total = db.execute(
        select(func.count()).select_from(stmt.order_by(None).subquery())
    ).scalar_one()
    rows = list(
        db.execute(stmt.order_by(Playlist.updated_at.desc()).offset((page - 1) * size).limit(size))
        .scalars()
        .all()
    )
    return Page[PlaylistOut](
        items=[_to_out(db, p) for p in rows], total=total, page=page, size=size
    )


@router.get("/{playlist_id}", response_model=PlaylistOut, summary="재생목록 상세")
def get_playlist(playlist_id: int, actor: CurrentUser, db: DbSession) -> PlaylistOut:
    playlist = db.get(Playlist, playlist_id)
    if playlist is None:
        raise not_found("재생목록")
    if not permissions.can_view_org(db, actor, playlist.org_id):
        raise forbid("해당 재생목록을 조회할 권한이 없습니다.")
    return _to_out(db, playlist)


@router.post(
    "", response_model=PlaylistOut, status_code=status.HTTP_201_CREATED, summary="재생목록 생성"
)
def create_playlist(payload: PlaylistCreate, actor: CurrentUser, db: DbSession) -> PlaylistOut:
    org_id = payload.org_id if payload.org_id is not None else actor.org_id
    if not permissions.can_view_org(db, actor, org_id):
        raise forbid("해당 기관에 재생목록을 만들 권한이 없습니다.")
    if db.get(Organization, org_id) is None:
        raise bad_request("존재하지 않는 기관입니다.")

    playlist = Playlist(
        name=payload.name,
        description=payload.description,
        org_id=org_id,
        created_by=actor.id,
        version=1,
    )
    _replace_items(playlist, payload.items)
    db.add(playlist)
    # 칸의 옵션이 가리키는 자산을 색인한다(이미지앨범의 사진들). 이것이
    # 쓰이는 파일을 지우지 못하게 막는 근거다.
    db.flush()
    asset_service.sync_playlist_links(db, playlist)
    db.commit()
    db.refresh(playlist)
    return _to_out(db, playlist)


@router.put("/{playlist_id}", response_model=PlaylistOut, summary="재생목록 수정")
def update_playlist(
    playlist_id: int,
    payload: PlaylistUpdate,
    actor: CurrentUser,
    db: DbSession,
    background: BackgroundTasks,
) -> PlaylistOut:
    playlist = db.get(Playlist, playlist_id)
    if playlist is None:
        raise not_found("재생목록")
    _assert_can_manage(db, actor, playlist)

    if payload.name is not None:
        playlist.name = payload.name
    if payload.description is not None:
        playlist.description = payload.description
    if payload.items is not None:
        _replace_items(playlist, payload.items)
        db.flush()
        asset_service.sync_playlist_links(db, playlist)
    playlist.version += 1

    # 이 재생목록을 쓰는 콘텐츠·스케줄의 버전도 올려야 장치가 변경을 감지한다.
    targets = _bump_referencing(db, playlist.id)
    db.commit()
    db.refresh(playlist)

    if targets:
        background.add_task(notify.push_schedule_changed, targets)
    return _to_out(db, playlist)


@router.post("/{playlist_id}/duplicate", response_model=PlaylistOut, summary="재생목록 복제")
def duplicate_playlist(playlist_id: int, actor: CurrentUser, db: DbSession) -> PlaylistOut:
    source = db.get(Playlist, playlist_id)
    if source is None:
        raise not_found("재생목록")
    if not permissions.can_view_org(db, actor, source.org_id):
        raise forbid("해당 재생목록을 복제할 권한이 없습니다.")

    copy = Playlist(
        name=f"{source.name} (복사본)",
        description=source.description,
        org_id=source.org_id,
        created_by=actor.id,
        version=1,
    )
    for item in source.items:
        copy.items.append(
            PlaylistItem(
                sort_order=item.sort_order,
                widget_key=item.widget_key,
                duration_sec=item.duration_sec,
                options=item.options,
                transition=item.transition,
                transition_ms=item.transition_ms,
            )
        )
    db.add(copy)
    db.commit()
    db.refresh(copy)
    return _to_out(db, copy)


@router.delete("/{playlist_id}", response_model=Message, summary="재생목록 삭제")
def delete_playlist(playlist_id: int, actor: CurrentUser, db: DbSession) -> Message:
    playlist = db.get(Playlist, playlist_id)
    if playlist is None:
        raise not_found("재생목록")
    _assert_can_manage(db, actor, playlist)

    used = _usage_count(db, playlist_id)
    if used:
        # 지우면 그 콘텐츠가 빈 자리를 그리게 된다. 어디서 쓰는지 알려 준다.
        raise bad_request(f"이 재생목록을 쓰는 콘텐츠가 {used}건 있습니다. 먼저 교체하세요.")

    db.delete(playlist)
    db.commit()
    return Message(detail="재생목록이 삭제되었습니다.")
