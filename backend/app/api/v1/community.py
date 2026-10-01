"""커뮤니티 — .NET(Controllers/CommunityController.cs)의 거울.

개편(2026-10): COMMUNITY_USER 역할을 걷어내고 커뮤니티를 모든 승인 사용자의
공간으로 바꿨다. 게시물의 메타데이터는 제목·공지대상(기관구분)·공지희망기간·
연락처·메모다.

  - 칸(items)은 소속기관 공지와 같은 모양 — 콘텐츠 편집기 문서를 인라인으로
    갖고 유지 시간을 둔다({document, duration_sec}). 파일은 게시물에 직접
    올리고(/playlists/{id}/media) 문서의 이미지·동영상 요소가 그 주소를 쓴다.
  - 게시 결과(대기중·게시·게시보류)는 커뮤니티 소유 기관의 관리자가 정하고,
    '게시' 상태만 콘텐츠(커뮤니티 위젯)가 표출한다.
  - 로그인 팝업(/popup): '게시' 중이고, 공지대상이 비었거나 내 기관의
    기관구분을 포함하고, 공지희망기간 안인 글만 알린다.
  - 전체 재생시간은 서버가 계산한다 — 칸 재생시간의 합(total_duration_sec).
"""

from __future__ import annotations

from datetime import date
from typing import Any

from fastapi import APIRouter, File, Query, UploadFile, status
from pydantic import BaseModel, ConfigDict, Field

from app.api.deps import CurrentUser, DbSession, bad_request, forbid, not_found
from app.models.asset import Asset
from app.models.community_playlist import (
    CommunityPlaylist,
    CommunityPlaylistAsset,
    CommunitySetting,
)
from app.models.org_type import OrgTypeDef
from app.models.organization import Organization
from app.models.user import User
from app.schemas.asset import AssetOut
from app.schemas.common import Message, Page
from app.services import assets as asset_service, video_transcode
from app.services import org_types, permissions
from sqlalchemy import func, select

router = APIRouter(prefix="/community", tags=["커뮤니티"])

PUBLISH_STATUSES = ("대기중", "게시", "게시보류")

#: 칸 검증 문구 — .NET·목 서버와 같은 말을 한다.
ITEM_DOCUMENT_REQUIRED = "칸에는 콘텐츠 문서가 있어야 합니다."
NESTED_COMMUNITY_WIDGET = "커뮤니티 게시물 안에는 커뮤니티 위젯을 넣을 수 없습니다."


# ------------------------------------------------------------------ 스키마


class CommunityContext(BaseModel):
    org_id: int
    org_name: str
    can_share: bool


class CommunityPlaylistItemIn(BaseModel):
    """칸(슬라이드) — 소속기관 공지와 같은 모양(2026-10): 콘텐츠 편집기 문서를
    인라인으로 갖고, 유지 시간만 따로 둔다. 이미지·동영상은 문서의 요소다."""

    document: dict[str, Any] | None = None
    duration_sec: int = Field(default=10, ge=1, le=86400)


class CommunityPlaylistCreate(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    #: 간단한 메모 — 게시 요청에 덧붙이는 짧은 글.
    memo: str | None = Field(default=None, max_length=500)
    #: 공지대상 — 기관구분 이름들. 빈 배열은 '전체 대상'.
    target_org_types: list[str] | None = None
    #: 공지희망기간 "YYYY-MM-DD".
    notice_start: str | None = Field(default=None, max_length=10)
    notice_end: str | None = Field(default=None, max_length=10)
    #: 게시자 표시 이름 — 비우면 계정 이름을 쓴다.
    author_name: str | None = Field(default=None, max_length=100)
    contact: str | None = Field(default=None, max_length=200)
    items: list[CommunityPlaylistItemIn] = Field(default_factory=list)


class CommunityPlaylistUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=200)
    #: 빈 문자열은 '지움', None 은 '건드리지 않음'.
    memo: str | None = Field(default=None, max_length=500)
    target_org_types: list[str] | None = None
    #: 빈 문자열은 '지움'.
    notice_start: str | None = Field(default=None, max_length=10)
    notice_end: str | None = Field(default=None, max_length=10)
    author_name: str | None = Field(default=None, max_length=100)
    contact: str | None = Field(default=None, max_length=200)
    items: list[CommunityPlaylistItemIn] | None = None


class PublishStatusUpdate(BaseModel):
    status: str


class CommunityNoticeOut(BaseModel):
    """로그인 팝업 한 줄 — 대상·기간이 맞는 '게시' 중 공지의 요약."""

    id: int
    org_id: int
    org_name: str
    title: str
    memo: str | None = None
    contact: str | None = None
    author_name: str | None = None
    target_org_types: list[str] = Field(default_factory=list)
    notice_start: str | None = None
    notice_end: str | None = None


class CommunitySettingOut(BaseModel):
    """게시 정책 — auto_publish 가 켜지면 등록 즉시 '게시'."""

    auto_publish: bool
    can_manage: bool


class CommunitySettingUpdate(BaseModel):
    auto_publish: bool


class CommunityPlaylistOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    org_id: int
    author_id: int | None = None
    #: 게시자 이름 — 계정이 지워졌으면 None.
    author_name: str | None = None
    title: str
    #: 간단한 메모.
    memo: str | None = None
    #: 공지대상(기관구분 이름들). 빈 배열은 '전체 대상'.
    target_org_types: list[str] = Field(default_factory=list)
    #: 공지희망기간 "YYYY-MM-DD".
    notice_start: str | None = None
    notice_end: str | None = None
    #: 연락처 — 게시자가 적은 자유 형식.
    contact: str | None = None
    #: 실제 게시 여부 — 대기중 | 게시 | 게시보류.
    publish_status: str = "대기중"
    version: int = 1
    created_at: object = None
    updated_at: object = None
    #: 저장 모양에 화면이 그릴 이름·주소를 붙인 것.
    items: list[dict] = Field(default_factory=list)
    #: 이 게시물에 올린 파일 전부(올린 순서) — 편집기의 왼쪽 재료 칸.
    assets: list[dict] = Field(default_factory=list)
    #: 전체 재생시간 — 실제로 재생될 칸들의 표출 시간 합.
    total_duration_sec: int = 0
    can_edit: bool = False
    can_remove: bool = False
    can_publish: bool = False


# ------------------------------------------------------------------ 공통


def _require_member(actor: User) -> None:
    if not permissions.can_use_community(actor):
        raise forbid("커뮤니티를 사용할 권한이 없습니다.")


def _require_share(actor: User) -> None:
    if not permissions.can_share_in_community(actor):
        raise forbid("커뮤니티에 올릴 권한이 없습니다.")


def _my_community(db: DbSession, actor: User) -> Organization:
    _require_member(actor)
    org_id = permissions.community_org_id(db, actor)
    if org_id is None:
        raise not_found("커뮤니티")
    org = db.get(Organization, org_id)
    if org is None:
        raise not_found("커뮤니티")
    return org


def _resolve_community(db: DbSession, actor: User, org_id: int | None) -> Organization:
    """이번 요청이 다루는 커뮤니티.

    ``org_id`` 가 없으면 제 소속 커뮤니티다. 있으면 그 커뮤니티를 고른
    것인데, 그럴 수 있는 사람은 **슈퍼관리자뿐**이다(소속과 무관하게 모든
    커뮤니티를 쓴다). 남이 고르면 자기 것일 때만 통과시킨다.
    """
    _require_member(actor)
    if org_id is None:
        return _my_community(db, actor)

    org = db.get(Organization, org_id)
    # 커뮤니티는 상위기관에만 있다. 학교 id 를 넣으면 없는 곳이다.
    if org is None or org_types.category_of(db, org.org_type) != "기관":
        raise not_found("커뮤니티")
    if not permissions.is_super_admin(actor) and org.id != permissions.community_org_id(db, actor):
        raise forbid("해당 커뮤니티를 사용할 권한이 없습니다.")
    return org


def _can_touch(db: DbSession, actor: User, org_id: int) -> bool:
    """그 커뮤니티의 것을 손댈 자격 — 제 커뮤니티거나 관리 범위 안."""
    if not permissions.can_use_community(actor):
        return False
    if permissions.is_super_admin(actor):
        return True
    if org_id == permissions.community_org_id(db, actor):
        return True
    return permissions.can_manage_org(db, actor, org_id)


def _can_publish(db: DbSession, actor: User, org_id: int) -> bool:
    """게시 결과를 바꿀 수 있는가 — 커뮤니티 소유 기관을 관리하는 관리자만.

    작성자 본인이라도 손대지 못한다. 올리는 사람과 게시를 승인하는 사람을
    가르는 것이 이 필드의 존재 이유다.
    """
    if permissions.is_super_admin(actor):
        return True
    return permissions.is_org_admin(actor) and permissions.can_manage_org(db, actor, org_id)


def _load(db: DbSession, actor: User, playlist_id: int) -> CommunityPlaylist:
    playlist = db.get(CommunityPlaylist, playlist_id)
    if playlist is None or not _can_touch(db, actor, playlist.org_id):
        raise not_found("커뮤니티 게시물")
    return playlist


def _allowed_target_tokens(db: DbSession) -> set[str]:
    """기관구분 마스터가 허용하는 공지대상 토큰.

    "학교" 처럼 구분 이름 그대로면 그 구분 전체, "학교:초" 처럼 분류를
    붙이면 그 구분 중 해당 분류(세부 구분)만이다. 선택지는 언제나 기관구분
    관리에 등록된 이름·분류에서 나온다 — 이름을 쪼개 해석하지 않고 허용
    토큰 집합의 멤버십으로 검사한다(이름에 어떤 글자가 와도 안전하다).
    """
    allowed: set[str] = set()
    rows = db.execute(select(OrgTypeDef.name, OrgTypeDef.classifications)).all()
    for name, classifications in rows:
        allowed.add(name)
        for cls in (classifications or "").split(","):
            if cls.strip():
                allowed.add(f"{name}:{cls.strip()}")
    return allowed


def _validate_meta(
    db: DbSession,
    targets: list[str] | None,
    notice_start: str | None,
    notice_end: str | None,
) -> None:
    """공지대상은 기관구분 마스터의 이름(또는 이름:분류)만, 기간은 YYYY-MM-DD."""
    if targets:
        allowed = _allowed_target_tokens(db)
        for name in (t.strip() for t in targets):
            if name and name not in allowed:
                raise bad_request("공지대상은 기관구분에서 골라야 합니다.")
    for value in (notice_start, notice_end):
        if not value or not value.strip():
            continue
        try:
            date.fromisoformat(value.strip())
        except ValueError:
            raise bad_request("공지희망기간은 YYYY-MM-DD 형식이어야 합니다.") from None
    if (
        notice_start
        and notice_end
        and notice_start.strip()
        and notice_end.strip()
        and notice_start.strip() > notice_end.strip()
    ):
        raise bad_request("공지희망기간의 시작이 종료보다 늦을 수 없습니다.")


def _clean_targets(targets: list[str] | None) -> list[str]:
    return [name.strip() for name in (targets or []) if name.strip()]


def validate_items(
    playlist: CommunityPlaylist, items: list[CommunityPlaylistItemIn]
) -> list[dict[str, Any]]:
    """칸을 검사하고 저장 모양으로 만든다.

    칸마다 콘텐츠 문서가 있어야 하고(소속기관 공지와 같은 계약), 문서 안에
    커뮤니티 위젯을 넣을 수는 없다 — 커뮤니티 안에서 커뮤니티를 틀면 끝없이
    파고든다.
    """
    cleaned: list[dict[str, Any]] = []
    for item in items:
        document = item.document
        if not isinstance(document, dict) or not isinstance(document.get("elements"), list):
            raise bad_request(ITEM_DOCUMENT_REQUIRED)
        for element in document["elements"]:
            if (
                isinstance(element, dict)
                and element.get("type") == "widget"
                and element.get("widget_key") == "community"
            ):
                raise bad_request(NESTED_COMMUNITY_WIDGET)
        cleaned.append({"document": document, "duration_sec": item.duration_sec})
    return cleaned


def resolve_items(playlist: CommunityPlaylist) -> list[dict[str, Any]]:
    """표출할 칸 — 문서를 가진 칸만. 옛 모양(파일 참조·QR)은 표출하지 않는다."""
    return [dict(item) for item in (playlist.items or []) if isinstance(item.get("document"), dict)]


def total_duration_sec(resolved_items: list[dict[str, Any]]) -> int:
    """전체 재생시간 — 실제로 재생될 칸들의 표출 시간 합."""
    return sum(int(item.get("duration_sec") or 0) for item in resolved_items)


def _out(db: DbSession, playlist: CommunityPlaylist, actor: User) -> CommunityPlaylistOut:
    out = CommunityPlaylistOut.model_validate(playlist)
    # 게시자가 적은 표시 이름이 먼저, 없으면 계정 이름.
    out.author_name = playlist.author_name or (
        playlist.author.name if playlist.author else None
    )
    out.items = resolve_items(playlist)
    out.total_duration_sec = total_duration_sec(out.items)
    out.assets = [
        {
            "id": link.asset.id,
            "kind": link.asset.kind,
            "filename": link.asset.filename,
            "url": asset_service.public_url(link.asset),
            "thumb_url": asset_service.thumb_url(link.asset),
        }
        for link in sorted(playlist.asset_links, key=lambda link: link.id)
    ]
    out.can_edit = permissions.can_remove_shared(actor, playlist.author_id)
    out.can_remove = permissions.can_remove_shared(actor, playlist.author_id)
    out.can_publish = _can_publish(db, actor, playlist.org_id)
    return out


# ------------------------------------------------------------------ 컨텍스트


@router.get("/context", response_model=CommunityContext, summary="내 커뮤니티")
def community_context(
    actor: CurrentUser, db: DbSession, org_id: int | None = Query(default=None)
) -> CommunityContext:
    org = _resolve_community(db, actor, org_id)
    return CommunityContext(
        org_id=org.id,
        org_name=org.name,
        can_share=permissions.can_share_in_community(actor),
    )


@router.get("/list", response_model=list[CommunityContext], summary="쓸 수 있는 커뮤니티들")
def community_list(actor: CurrentUser, db: DbSession) -> list[CommunityContext]:
    """슈퍼관리자는 전체, 나머지는 제 것 하나."""
    _require_member(actor)
    can_share = permissions.can_share_in_community(actor)
    if permissions.is_super_admin(actor):
        owner_types = org_types.names_of_category(db, "기관")
        orgs = (
            db.execute(
                select(Organization)
                .where(Organization.org_type.in_(owner_types))
                .order_by(Organization.name)
            )
            .scalars()
            .all()
        )
        return [
            CommunityContext(org_id=o.id, org_name=o.name, can_share=can_share) for o in orgs
        ]

    org_id = permissions.community_org_id(db, actor)
    if org_id is None:
        return []
    org = db.get(Organization, org_id)
    if org is None:
        return []
    return [CommunityContext(org_id=org.id, org_name=org.name, can_share=can_share)]


@router.get("/popup", response_model=list[CommunityNoticeOut], summary="로그인 팝업 공지")
def popup_notices(actor: CurrentUser, db: DbSession) -> list[CommunityNoticeOut]:
    """내 커뮤니티의 '게시' 글 중, 공지대상이 비었거나 내 기관의 기관구분을
    포함하고, 공지희망기간 안인 것만 — 로그인 직후 화면이 팝업으로 알린다."""
    org_id = permissions.community_org_id(db, actor)
    if org_id is None:
        return []
    org = db.get(Organization, org_id)
    if org is None:
        return []

    my_org = db.get(Organization, actor.org_id)
    # 내 기관이 받을 수 있는 토큰: 구분 전체("학교")와 세부 구분("학교:초").
    my_tokens: set[str] = set()
    if my_org is not None:
        my_tokens.add(my_org.org_type)
        if my_org.school_level:
            my_tokens.add(f"{my_org.org_type}:{my_org.school_level}")
    today = date.today().isoformat()

    rows = (
        db.execute(
            select(CommunityPlaylist)
            .where(
                CommunityPlaylist.org_id == org_id,
                CommunityPlaylist.publish_status == "게시",
            )
            .order_by(CommunityPlaylist.id.desc())
        )
        .scalars()
        .all()
    )

    notices: list[CommunityNoticeOut] = []
    for row in rows:
        targets = row.target_org_types or []
        if targets and not my_tokens.intersection(targets):
            continue
        if row.notice_start and today < row.notice_start:
            continue
        if row.notice_end and today > row.notice_end:
            continue
        notices.append(
            CommunityNoticeOut(
                id=row.id,
                org_id=org.id,
                org_name=org.name,
                title=row.title,
                memo=row.memo,
                contact=row.contact,
                author_name=row.author_name or (row.author.name if row.author else None),
                target_org_types=targets,
                notice_start=row.notice_start,
                notice_end=row.notice_end,
            )
        )
    return notices


# ------------------------------------------------------------------ 설정


def _auto_publish(db: DbSession, org_id: int) -> bool:
    setting = db.execute(
        select(CommunitySetting).where(CommunitySetting.org_id == org_id)
    ).scalar_one_or_none()
    return bool(setting and setting.auto_publish)


@router.get("/settings", response_model=CommunitySettingOut, summary="게시 정책 조회")
def get_settings(
    actor: CurrentUser, db: DbSession, org_id: int | None = Query(default=None)
) -> CommunitySettingOut:
    """등록 화면이 '즉시 게시' 안내를 띄우는 근거 — 멤버도 조회할 수 있다."""
    org = _resolve_community(db, actor, org_id)
    return CommunitySettingOut(
        auto_publish=_auto_publish(db, org.id),
        can_manage=_can_publish(db, actor, org.id),
    )


@router.put("/settings", response_model=CommunitySettingOut, summary="게시 정책 설정")
def set_settings(
    payload: CommunitySettingUpdate,
    actor: CurrentUser,
    db: DbSession,
    org_id: int | None = Query(default=None),
) -> CommunitySettingOut:
    """커뮤니티 소유 기관의 관리자만.

    켜면 '관리자 승인 없이' 등록 즉시 게시, 끄면(기본) 승인 후 게시다.
    """
    org = _resolve_community(db, actor, org_id)
    if not _can_publish(db, actor, org.id):
        raise forbid("게시 정책은 커뮤니티 소유 기관의 관리자만 설정할 수 있습니다.")

    setting = db.execute(
        select(CommunitySetting).where(CommunitySetting.org_id == org.id)
    ).scalar_one_or_none()
    if setting is None:
        setting = CommunitySetting(org_id=org.id)
        db.add(setting)
    setting.auto_publish = payload.auto_publish
    db.commit()
    return CommunitySettingOut(auto_publish=setting.auto_publish, can_manage=True)


# ------------------------------------------------------------------ 재생목록


@router.get("/playlists", response_model=Page[CommunityPlaylistOut], summary="게시물 목록")
def list_playlists(
    actor: CurrentUser,
    db: DbSession,
    org_id: int | None = Query(default=None),
    page: int = Query(1, ge=1),
    size: int = Query(20, ge=1, le=100),
) -> Page[CommunityPlaylistOut]:
    org = _resolve_community(db, actor, org_id)
    total = db.execute(
        select(func.count())
        .select_from(CommunityPlaylist)
        .where(CommunityPlaylist.org_id == org.id)
    ).scalar_one()
    rows = (
        db.execute(
            select(CommunityPlaylist)
            .where(CommunityPlaylist.org_id == org.id)
            .order_by(CommunityPlaylist.id.desc())
            .offset((page - 1) * size)
            .limit(size)
        )
        .scalars()
        .all()
    )
    return Page[CommunityPlaylistOut](
        items=[_out(db, row, actor) for row in rows], total=total, page=page, size=size
    )


@router.get(
    "/playlists/{playlist_id}", response_model=CommunityPlaylistOut, summary="게시물 상세"
)
def get_playlist(playlist_id: int, actor: CurrentUser, db: DbSession) -> CommunityPlaylistOut:
    _require_member(actor)
    return _out(db, _load(db, actor, playlist_id), actor)


@router.post(
    "/playlists",
    response_model=CommunityPlaylistOut,
    status_code=status.HTTP_201_CREATED,
    summary="게시물 등록",
)
def create_playlist(
    payload: CommunityPlaylistCreate,
    actor: CurrentUser,
    db: DbSession,
    org_id: int | None = Query(default=None),
) -> CommunityPlaylistOut:
    org = _resolve_community(db, actor, org_id)
    _require_share(actor)
    _validate_meta(db, payload.target_org_types, payload.notice_start, payload.notice_end)

    playlist = CommunityPlaylist(
        org_id=org.id,
        author_id=actor.id,
        title=payload.title.strip(),
        memo=(payload.memo or "").strip() or None,
        target_org_types=_clean_targets(payload.target_org_types),
        notice_start=(payload.notice_start or "").strip() or None,
        notice_end=(payload.notice_end or "").strip() or None,
        author_name=(payload.author_name or "").strip() or None,
        contact=(payload.contact or "").strip() or None,
        # 게시 정책: 자동 게시가 켜진 커뮤니티는 승인 없이 곧장 '게시'다.
        publish_status="게시" if _auto_publish(db, org.id) else "대기중",
        items=[],
        version=1,
    )
    # 칸은 만들 때 비어 있을 수 있다 — 파일을 올리려면 먼저 id 가 필요하다.
    if payload.items:
        playlist.items = validate_items(playlist, payload.items)
    db.add(playlist)
    db.commit()
    db.refresh(playlist)
    return _out(db, playlist, actor)


@router.post(
    "/playlists/{playlist_id}/media",
    response_model=AssetOut,
    status_code=status.HTTP_201_CREATED,
    summary="게시물에 파일 올리기",
)
async def upload_media(
    playlist_id: int,
    actor: CurrentUser,
    db: DbSession,
    file: UploadFile = File(...),
) -> AssetOut:
    """올린 파일만 칸이 될 수 있다 — 색인(community_playlist_asset)이 근거다."""
    playlist = _load(db, actor, playlist_id)
    if not permissions.can_remove_shared(actor, playlist.author_id):
        raise forbid("이 게시물에 파일을 올릴 권한이 없습니다.")

    kind = asset_service.kind_of(file.content_type)
    if kind is None:
        raise bad_request(f"지원하지 않는 형식입니다: {file.content_type or '알 수 없음'}")

    content_type = file.content_type
    try:
        stored, size = await asset_service.store_stream(file, kind, content_type)
        if kind == "video":
            # 웹 표준(H.264/AAC MP4, faststart)으로 정규화 — 장치가 항상 그린다.
            stored, size, content_type = await video_transcode.ensure_web_video_async(
                stored, content_type
            )
    except asset_service.UploadRejected as exc:
        raise bad_request(str(exc)) from exc

    asset = Asset(
        # 커뮤니티가 걸린 상위기관 소유 — 그 기관 관리자가 라이브러리에서 함께 본다.
        org_id=playlist.org_id,
        uploaded_by=actor.id,
        kind=kind,
        filename=file.filename or f"community-{kind}",
        content_type=content_type,
        size_bytes=size,
        storage_path=stored,
    )
    asset_service.attach_thumbnail(asset)
    db.add(asset)
    db.flush()
    db.add(CommunityPlaylistAsset(playlist_id=playlist.id, asset_id=asset.id))
    db.commit()
    db.refresh(asset)

    out = AssetOut.model_validate(asset)
    out.url = asset_service.public_url(asset)
    out.thumb_url = asset_service.thumb_url(asset)
    return out


@router.put(
    "/playlists/{playlist_id}", response_model=CommunityPlaylistOut, summary="게시물 수정"
)
def update_playlist(
    playlist_id: int,
    payload: CommunityPlaylistUpdate,
    actor: CurrentUser,
    db: DbSession,
) -> CommunityPlaylistOut:
    playlist = _load(db, actor, playlist_id)
    if not permissions.can_remove_shared(actor, playlist.author_id):
        raise forbid("이 게시물을 고칠 권한이 없습니다.")

    _validate_meta(db, payload.target_org_types, payload.notice_start, payload.notice_end)

    if payload.title is not None:
        playlist.title = payload.title.strip()
    if payload.memo is not None:
        playlist.memo = payload.memo.strip() or None
    if payload.target_org_types is not None:
        playlist.target_org_types = _clean_targets(payload.target_org_types)
    if payload.notice_start is not None:
        playlist.notice_start = payload.notice_start.strip() or None
    if payload.notice_end is not None:
        playlist.notice_end = payload.notice_end.strip() or None
    if payload.author_name is not None:
        playlist.author_name = payload.author_name.strip() or None
    if payload.contact is not None:
        playlist.contact = payload.contact.strip() or None
    if payload.items is not None:
        playlist.items = validate_items(playlist, payload.items)
    # 기간은 한쪽만 고칠 수 있으니 최종 값으로 순서를 본다.
    if (
        playlist.notice_start
        and playlist.notice_end
        and playlist.notice_start > playlist.notice_end
    ):
        raise bad_request("공지희망기간의 시작이 종료보다 늦을 수 없습니다.")
    playlist.version += 1  # 위젯이 변경을 감지하는 근거다.
    db.commit()
    db.refresh(playlist)
    return _out(db, playlist, actor)


@router.put(
    "/playlists/{playlist_id}/status",
    response_model=CommunityPlaylistOut,
    summary="게시 결과 설정",
)
def set_status(
    playlist_id: int,
    payload: PublishStatusUpdate,
    actor: CurrentUser,
    db: DbSession,
) -> CommunityPlaylistOut:
    """작성자는 손대지 못하고 커뮤니티 소유 기관의 관리자만 바꾼다.

    '게시'만 위젯이 표출한다 — 게시 여부가 곧 표출 여부다.
    """
    playlist = _load(db, actor, playlist_id)
    if not _can_publish(db, actor, playlist.org_id):
        raise forbid("게시 결과는 커뮤니티 소유 기관의 관리자만 설정할 수 있습니다.")
    if payload.status not in PUBLISH_STATUSES:
        raise bad_request("게시 결과는 대기중·게시·게시보류 중 하나여야 합니다.")

    playlist.publish_status = payload.status
    playlist.version += 1
    db.commit()
    db.refresh(playlist)
    return _out(db, playlist, actor)


@router.delete("/playlists/{playlist_id}", response_model=Message, summary="게시물 삭제")
def delete_playlist(playlist_id: int, actor: CurrentUser, db: DbSession) -> Message:
    playlist = _load(db, actor, playlist_id)
    if not permissions.can_remove_shared(actor, playlist.author_id):
        raise forbid("이 게시물을 지울 권한이 없습니다.")
    db.delete(playlist)
    db.commit()
    return Message(detail="게시물을 지웠습니다.")
