"""소속기관 공지 (.NET Controllers/OrgNoticesController.cs 의 짝).

기간이 정해진 재생목록 형태다: 슬라이드마다 콘텐츠 편집기 문서를 인라인으로
갖고, 순서와 유지 시간으로 순환한다. 만들기 화면이 좌(편집기)/우(목록)
분할이라 저장은 아이템 전체 교체로 온다.

권한: 조회는 관리 범위(can_view_org), 등록/수정/삭제는 기관 관리
(can_manage_org). 고칠 때마다 version 이 오른다.
"""

from __future__ import annotations

from datetime import date, datetime
from typing import Any

from fastapi import APIRouter, Query, status
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select

from app.api.deps import CurrentUser, DbSession, bad_request, forbid, not_found
from app.models.org_notice import OrgNotice, OrgNoticeItem
from app.models.schedule import Schedule, ScheduleItem
from app.schemas.common import Message
from app.models.organization import Organization
from app.services import org_tree, permissions

router = APIRouter(prefix="/org-notices", tags=["소속기관 공지"])


class OrgNoticeItemOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    sort_order: int
    duration_sec: int
    document: dict[str, Any] = Field(default_factory=dict)


class OrgNoticeSummary(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    org_id: int
    name: str
    start_date: str | None
    end_date: str | None
    version: int
    item_count: int = 0
    org_name: str | None = None
    created_at: object = None
    updated_at: object = None


class OrgNoticeDetail(OrgNoticeSummary):
    items: list[OrgNoticeItemOut] = Field(default_factory=list)


class OrgNoticeItemIn(BaseModel):
    duration_sec: int = Field(default=10, ge=1, le=86400)
    document: dict[str, Any] = Field(default_factory=dict)


class OrgNoticeCreate(BaseModel):
    org_id: int | None = None
    name: str = Field(min_length=1, max_length=200)
    start_date: str | None = None
    end_date: str | None = None


class OrgNoticeUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    start_date: str | None = None
    end_date: str | None = None
    items: list[OrgNoticeItemIn] | None = Field(default=None, max_length=100)


def _bump_referencing_schedules(db, notice_id: int) -> None:  # noqa: ANN001
    """이 공지를 참조하는 스케줄의 버전을 올린다 — 장치가 하트비트에서
    변경을 발견해 다시 받는다(공지가 스케줄에 '참조'로 담기는 이유)."""
    schedules = db.execute(
        select(Schedule).where(
            Schedule.id.in_(
                select(ScheduleItem.schedule_id).where(ScheduleItem.org_notice_id == notice_id)
            )
        )
    ).scalars()
    for schedule in schedules:
        schedule.version += 1


def _clean_period(raw: str | None, *, is_end: bool) -> str | None:
    """YYYY-MM-DDTHH:MM 또는 YYYY-MM-DD(날짜만 오면 시작은 00:00, 종료는
    23:59 로 넓혀 저장). 빈 문자열은 '기간 지움'으로 읽어 None."""
    if not raw:
        return None
    try:
        date.fromisoformat(raw)
        return raw + ("T23:59" if is_end else "T00:00")
    except ValueError:
        pass
    try:
        datetime.strptime(raw, "%Y-%m-%dT%H:%M")
    except ValueError:
        raise bad_request("기간은 YYYY-MM-DD 또는 YYYY-MM-DDTHH:MM 형식이어야 합니다.") from None
    return raw


def _summary(notice: OrgNotice, org_name: str | None = None) -> OrgNoticeSummary:
    out = OrgNoticeSummary.model_validate(notice)
    out.item_count = len(notice.items)
    out.org_name = org_name
    return out


def _detail(notice: OrgNotice) -> OrgNoticeDetail:
    out = OrgNoticeDetail.model_validate(notice)
    out.item_count = len(notice.items)
    return out


@router.get("", response_model=list[OrgNoticeSummary], summary="소속기관 공지 목록")
def list_notices(
    actor: CurrentUser,
    db: DbSession,
    org_id: int | None = Query(default=None),
    for_org: int | None = Query(default=None),
) -> list[OrgNoticeSummary]:
    # for_org: 그 기관의 표출용 — 자기 것 + 상위기관이 내린 공지까지.
    # 공지는 상위 기관이 소속기관에 내리는 것이라, 하위가 상위 것을 읽는
    # 방향은 의도된 사용이다(스케줄 편집기가 이 모드를 쓴다).
    if for_org is not None:
        if not permissions.can_view_org(db, actor, for_org):
            raise forbid("해당 기관의 공지를 조회할 권한이 없습니다.")
        chain = org_tree.ancestor_ids(db, for_org, include_self=True)
        order = {org: at for at, org in enumerate(chain)}
        names = {
            org.id: org.name
            for org in db.execute(
                select(Organization).where(Organization.id.in_(chain))
            ).scalars()
        }
        rows = db.execute(select(OrgNotice).where(OrgNotice.org_id.in_(chain))).scalars()
        # 자기 기관 것 먼저, 그다음 가까운 상위 순 — 각 기관 안에서는 최신순.
        ordered = sorted(rows, key=lambda n: (order[n.org_id], -n.updated_at.timestamp()))
        return [_summary(row, names.get(row.org_id)) for row in ordered]

    target = org_id if org_id is not None else actor.org_id
    if not permissions.can_view_org(db, actor, target):
        raise forbid("해당 기관의 공지를 조회할 권한이 없습니다.")
    org = db.get(Organization, target)
    rows = db.execute(
        select(OrgNotice).where(OrgNotice.org_id == target).order_by(OrgNotice.updated_at.desc())
    ).scalars()
    return [_summary(row, org.name if org else None) for row in rows]


@router.get("/{notice_id}", response_model=OrgNoticeDetail, summary="소속기관 공지 상세")
def get_notice(notice_id: int, actor: CurrentUser, db: DbSession) -> OrgNoticeDetail:
    notice = db.get(OrgNotice, notice_id)
    if notice is None:
        raise not_found("공지")
    # 상위기관이 내린 공지는 하위 기관도 읽을 수 있어야 스케줄에 담는다.
    if not permissions.can_view_org(db, actor, notice.org_id) and not org_tree.is_descendant(
        db, ancestor=notice.org_id, node=actor.org_id
    ):
        raise forbid("해당 공지를 조회할 권한이 없습니다.")
    return _detail(notice)


@router.post(
    "", response_model=OrgNoticeDetail, status_code=status.HTTP_201_CREATED, summary="공지 생성"
)
def create_notice(payload: OrgNoticeCreate, actor: CurrentUser, db: DbSession) -> OrgNoticeDetail:
    org_id = payload.org_id if payload.org_id is not None else actor.org_id
    if not permissions.can_manage_org(db, actor, org_id):
        raise forbid("해당 기관에 공지를 만들 권한이 없습니다.")
    name = payload.name.strip()
    if not name or len(name) > 200:
        raise bad_request("공지 이름은 1~200자여야 합니다.")

    notice = OrgNotice(
        org_id=org_id,
        name=name,
        start_date=_clean_period(payload.start_date, is_end=False),
        end_date=_clean_period(payload.end_date, is_end=True),
        created_by=actor.id,
        version=1,
    )
    db.add(notice)
    db.commit()
    db.refresh(notice)
    return _detail(notice)


@router.put("/{notice_id}", response_model=OrgNoticeDetail, summary="공지 수정")
def update_notice(
    notice_id: int, payload: OrgNoticeUpdate, actor: CurrentUser, db: DbSession
) -> OrgNoticeDetail:
    notice = db.get(OrgNotice, notice_id)
    if notice is None:
        raise not_found("공지")
    if not permissions.can_manage_org(db, actor, notice.org_id):
        raise forbid("해당 공지를 수정할 권한이 없습니다.")

    data = payload.model_dump(exclude_unset=True)
    if "name" in data:
        name = (data["name"] or "").strip()
        if not name or len(name) > 200:
            raise bad_request("공지 이름은 1~200자여야 합니다.")
        notice.name = name
    if "start_date" in data:
        notice.start_date = _clean_period(data["start_date"], is_end=False)
    if "end_date" in data:
        notice.end_date = _clean_period(data["end_date"], is_end=True)

    if payload.items is not None:
        # 아이템 전체 교체 — 편집 화면이 순서를 통째로 보낸다.
        notice.items.clear()
        for index, item in enumerate(payload.items):
            notice.items.append(
                OrgNoticeItem(
                    sort_order=index,
                    duration_sec=item.duration_sec,
                    document=item.document,
                )
            )

    notice.version += 1
    _bump_referencing_schedules(db, notice.id)
    db.commit()
    db.refresh(notice)
    return _detail(notice)


@router.delete("/{notice_id}", response_model=Message, summary="공지 삭제")
def delete_notice(notice_id: int, actor: CurrentUser, db: DbSession) -> Message:
    notice = db.get(OrgNotice, notice_id)
    if notice is None:
        raise not_found("공지")
    if not permissions.can_manage_org(db, actor, notice.org_id):
        raise forbid("해당 공지를 삭제할 권한이 없습니다.")

    _bump_referencing_schedules(db, notice.id)
    db.delete(notice)
    db.commit()
    return Message(detail="공지가 삭제되었습니다.")
