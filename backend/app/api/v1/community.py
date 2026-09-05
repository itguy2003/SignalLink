"""커뮤니티 — 상위기관 단위의 공유 공간.

공유 게시판(글 + 첨부), 공유 이미지, 공유 동영상. 커뮤니티 유저
(``Role.COMMUNITY_USER``)에게 열려 있는 유일한 영역이고, 그 사람과
관리자가 올리며, 같은 커뮤니티에 속한 사람은 누구나 본다.

어느 커뮤니티인지는 보통 클라이언트가 고르지 않는다 — 소속 기관에서 트리를
따라 올라가 처음 만나는 상위기관으로 서버가 정한다
(``permissions.community_org_id``). 고르게 하면 남의 커뮤니티 id 를 넣어 볼
수 있게 되고, 그때마다 소속 검사를 다시 해야 한다.

예외는 슈퍼관리자다. 시스템 전체를 운영하는 사람이라 **소속과 무관하게 모든
커뮤니티**를 쓴다 — ``org_id`` 를 붙여 대상을 고르고, 안 붙이면 남들과 같이
제 소속 커뮤니티다.
"""

from __future__ import annotations

from fastapi import APIRouter, File, Query, UploadFile, status
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import func, select

from app.api.deps import CurrentUser, DbSession, bad_request, forbid, not_found
from app.models.asset import Asset
from app.models.community import CommunityPost, CommunityPostAsset
from app.models.community_content import CommunityContent
from app.models.community_playlist import CommunityPlaylist
from app.models.enums import OrgType
from app.models.organization import Organization
from app.models.user import User
from app.schemas.asset import AssetOut
from app.schemas.common import Message, Page
from app.services import assets as asset_service
from app.services import permissions, transitions

router = APIRouter(prefix="/community", tags=["커뮤니티"])


# ------------------------------------------------------------------ 스키마


class CommunityContext(BaseModel):
    """지금 사용자가 보는 커뮤니티. 화면이 제목을 그리고 버튼을 켤 근거다."""

    org_id: int
    org_name: str
    can_share: bool


class CommunityPostCreate(BaseModel):
    title: str = Field(min_length=1, max_length=500)
    content: str | None = None


#: 게시 결과의 어휘. 글은 늘 '대기중'으로 시작한다.
PUBLISH_STATUSES = ("대기중", "게시", "게시보류")


class CommunityPostOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    org_id: int
    author_id: int | None
    author_name: str | None = None
    title: str
    content: str | None
    created_at: object = None
    attachments: list[AssetOut] = Field(default_factory=list)
    #: 게시 결과 — 대기중 | 게시 | 게시보류. 커뮤니티 소유 기관 관리자가 정한다.
    publish_status: str = "대기중"
    #: 지금 보는 사람이 지울 수 있는가. 화면이 단추를 켤 근거다.
    can_remove: bool = False
    #: 게시 결과를 바꿀 수 있는가 — 커뮤니티 소유 기관의 관리자만.
    can_publish: bool = False


class PublishStatusUpdate(BaseModel):
    status: str


class CommunityContentCreate(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    #: 캔버스 문서. 비우면 빈 화면으로 시작한다(만들고 나서 편집기로 간다).
    document: dict | None = None


#: 사용대상. 위젯이 장치의 학교급에 맞는 콘텐츠를 고르는 근거다.
AUDIENCES = ("전체", "초", "중", "고")


class CommunityContentUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=200)
    document: dict | None = None
    #: 사용기간(YYYY-MM-DD). 빈 문자열은 '지움'이다.
    start_date: str | None = Field(default=None, max_length=10)
    end_date: str | None = Field(default=None, max_length=10)
    audience: str | None = Field(default=None, max_length=10)


class CommunityContentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    org_id: int
    author_id: int | None
    author_name: str | None = None
    title: str
    version: int
    created_at: object = None
    updated_at: object = None
    document: dict = Field(default_factory=dict)
    start_date: str | None = None
    end_date: str | None = None
    audience: str = "전체"
    #: 요소 수. 목록이 문서 전체를 실어 나르지 않고도 규모를 보여 준다.
    element_count: int = 0
    can_remove: bool = False


class CommunityPlaylistItemIn(BaseModel):
    """재생목록 칸(저장 모양). 재생 규약은 CMS 재생목록과 같다."""

    kind: str  # image | video
    asset_id: int
    duration_sec: int = Field(default=10, ge=1, le=3600)
    transition: str | None = None
    transition_ms: int | None = None


class CommunityPlaylistCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    items: list[CommunityPlaylistItemIn] = Field(default_factory=list)


class CommunityPlaylistUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    items: list[CommunityPlaylistItemIn] | None = None


class CommunityPlaylistOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    org_id: int
    author_id: int | None
    author_name: str | None = None
    name: str
    version: int
    created_at: object = None
    updated_at: object = None
    #: 저장 모양에 화면이 그릴 이름·주소를 붙인 것.
    items: list[dict] = Field(default_factory=list)
    can_remove: bool = False


class CommunityMaterialOut(BaseModel):
    """커뮤니티의 공유 재료 하나 — 게시판 글에 붙은 이미지·동영상.

    콘텐츠 편집기와 재생목록이 이 목록에서 고른다. 별도의 공유 창구가
    아니라 **게시판 첨부가 곧 재료**다.
    """

    id: int
    #: 붙어 있던 글의 제목. 재료를 알아보는 이름이다.
    title: str
    asset: AssetOut


# ------------------------------------------------------------------ 공통


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
    커뮤니티를 쓴다). 남이 고르면 자기 것일 때만 통과시킨다 — 값을 무시하고
    제 것을 돌려주면, 화면은 A 를 보여 준다고 믿는데 실제로는 B 가 온다.
    """
    _require_member(actor)
    if org_id is None:
        return _my_community(db, actor)

    org = db.get(Organization, org_id)
    # 커뮤니티는 상위기관에만 있다. 학교 id 를 넣으면 없는 곳이다.
    if org is None or org.org_type != OrgType.ORG:
        raise not_found("커뮤니티")
    if not permissions.is_super_admin(actor) and org.id != permissions.community_org_id(db, actor):
        raise forbid("해당 커뮤니티를 사용할 권한이 없습니다.")
    return org


def _asset_out(asset: Asset) -> AssetOut:
    out = AssetOut.model_validate(asset)
    out.url = asset_service.public_url(asset)
    out.thumb_url = asset_service.thumb_url(asset)
    return out


def _can_publish(db: DbSession, actor: User, org_id: int) -> bool:
    """게시 결과를 바꿀 수 있는가 — 커뮤니티 소유 기관을 관리하는 관리자만.

    작성자 본인이라도 손대지 못한다. 올리는 사람과 게시를 승인하는 사람을
    가르는 것이 이 필드의 존재 이유다.
    """
    if permissions.is_super_admin(actor):
        return True
    return permissions.is_org_admin(actor) and permissions.can_manage_org(db, actor, org_id)


def _post_out(db: DbSession, post: CommunityPost, actor: User) -> CommunityPostOut:
    out = CommunityPostOut.model_validate(post)
    out.author_name = post.author.name if post.author else None
    out.attachments = [_asset_out(link.asset) for link in post.attachment_links]
    out.can_remove = permissions.can_remove_shared(actor, post.author_id)
    out.can_publish = _can_publish(db, actor, post.org_id)
    return out


async def _store_upload(db: DbSession, actor: User, org: Organization, file: UploadFile) -> Asset:
    """올린 파일을 자산으로 저장한다. 검사 규칙은 업로드 전체와 같다."""
    kind = asset_service.kind_of(file.content_type)
    if kind is None:
        raise bad_request(f"지원하지 않는 형식입니다: {file.content_type or '알 수 없음'}")

    # 조각으로 받아 쓴다. 10GB 동영상을 통째로 메모리에 올리면 서버가 쓰러진다.
    try:
        stored, size = await asset_service.store_stream(file, kind, file.content_type)
    except asset_service.UploadRejected as exc:
        raise bad_request(str(exc)) from exc

    asset = Asset(
        # 커뮤니티가 걸린 상위기관 소유로 둔다. 그 기관 관리자가 라이브러리에서
        # 함께 본다 — 공유된 이미지를 콘텐츠에 쓸 수 있다는 뜻이기도 하다.
        org_id=org.id,
        uploaded_by=actor.id,
        kind=kind,
        filename=file.filename or f"community-{kind}",
        content_type=file.content_type,
        size_bytes=size,
        storage_path=stored,
    )
    # 목록은 원본 대신 이것을 그린다. 실패하면 None — 업로드는 그대로 성공.
    asset_service.attach_thumbnail(asset)
    db.add(asset)
    db.flush()
    return asset


def _can_touch(db: DbSession, actor: User, org_id: int) -> bool:
    """그 커뮤니티의 것을 손댈 자격이 있는가.

    보통은 자기 커뮤니티의 것이지만, 관리자는 제 관리 범위 안의 커뮤니티도
    거둘 수 있어야 한다 — 슈퍼관리자의 커뮤니티는 최상위 기관이라, 자기
    커뮤니티만 따지면 하위 교육청 커뮤니티를 운영할 수 없게 된다.
    """
    if org_id == permissions.community_org_id(db, actor):
        return True
    return permissions.can_manage_org(db, actor, org_id)


def _require_member(actor: User) -> None:
    """커뮤니티 공간의 문지기 — 기관관리자·커뮤니티 유저(·슈퍼관리자)만.

    모든 커뮤니티 조회가 통과하는 ``_my_community`` / ``_resolve_community``
    안에서 부르므로, 라우트마다 따로 기억할 필요가 없다.
    """
    if not permissions.can_use_community(actor):
        raise forbid("커뮤니티를 사용할 권한이 없습니다.")


def _require_manage(actor: User) -> None:
    """콘텐츠·재생목록의 문지기 — 관리자만.

    커뮤니티 유저는 자료를 올리는 사람이고, 자료를 엮어 화면에 내보내는
    일(콘텐츠·재생목록)은 운영이다.
    """
    if not permissions.can_manage_community(actor):
        raise forbid("커뮤니티 콘텐츠·재생목록은 관리자만 다룰 수 있습니다.")


def _require_share(actor: User) -> None:
    if not permissions.can_share_in_community(actor):
        raise forbid("커뮤니티에 올릴 권한이 없습니다.")


# ------------------------------------------------------------------ 컨텍스트


@router.get("/context", response_model=CommunityContext, summary="내가 보는 커뮤니티")
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
def list_communities(actor: CurrentUser, db: DbSession) -> list[CommunityContext]:
    _require_member(actor)
    """화면이 커뮤니티 고르기를 그릴 근거.

    슈퍼관리자에게는 모든 상위기관의 커뮤니티가, 나머지에게는 제 소속
    커뮤니티 하나가 온다 — 목록이 하나뿐이면 화면은 고르기를 그리지 않는다.
    """
    can_share = permissions.can_share_in_community(actor)
    if permissions.is_super_admin(actor):
        rows = db.execute(
            select(Organization)
            .where(Organization.org_type == OrgType.ORG)
            .order_by(Organization.name)
        ).scalars()
        return [
            CommunityContext(org_id=org.id, org_name=org.name, can_share=can_share)
            for org in rows
        ]

    org = _my_community(db, actor)
    return [CommunityContext(org_id=org.id, org_name=org.name, can_share=can_share)]


# ------------------------------------------------------------------ 공유 게시판


@router.get("/posts", response_model=Page[CommunityPostOut], summary="공유 게시판 목록")
def list_posts(
    actor: CurrentUser,
    db: DbSession,
    org_id: int | None = Query(default=None),
    page: int = Query(1, ge=1),
    size: int = Query(20, ge=1, le=100),
) -> Page[CommunityPostOut]:
    org = _resolve_community(db, actor, org_id)
    stmt = select(CommunityPost).where(CommunityPost.org_id == org.id)
    total = db.execute(
        select(func.count()).select_from(stmt.order_by(None).subquery())
    ).scalar_one()
    rows = db.execute(
        stmt.order_by(CommunityPost.id.desc()).offset((page - 1) * size).limit(size)
    ).scalars()
    return Page[CommunityPostOut](
        items=[_post_out(db, row, actor) for row in rows], total=total, page=page, size=size
    )


@router.post(
    "/posts",
    response_model=CommunityPostOut,
    status_code=status.HTTP_201_CREATED,
    summary="공유 게시판 글쓰기",
)
def create_post(
    payload: CommunityPostCreate,
    actor: CurrentUser,
    db: DbSession,
    org_id: int | None = Query(default=None),
) -> CommunityPostOut:
    _require_share(actor)
    org = _resolve_community(db, actor, org_id)

    post = CommunityPost(
        org_id=org.id,
        author_id=actor.id,
        title=payload.title.strip(),
        content=(payload.content or "").strip() or None,
    )
    db.add(post)
    db.commit()
    db.refresh(post)
    return _post_out(db, post, actor)


@router.post(
    "/posts/{post_id}/attachments",
    response_model=AssetOut,
    status_code=status.HTTP_201_CREATED,
    summary="글에 이미지·동영상 붙이기",
)
async def attach_to_post(
    post_id: int,
    actor: CurrentUser,
    db: DbSession,
    file: UploadFile = File(...),
) -> AssetOut:
    post = db.get(CommunityPost, post_id)
    if post is None or not _can_touch(db, actor, post.org_id):
        raise not_found("게시글")
    # 남의 글에는 붙이지 못한다. 글과 첨부의 주인이 갈리면 지울 때 다툰다.
    if not permissions.can_remove_shared(actor, post.author_id):
        raise forbid("이 글에 파일을 붙일 권한이 없습니다.")

    org = db.get(Organization, post.org_id)
    asset = await _store_upload(db, actor, org, file)
    post.attachment_links.append(
        CommunityPostAsset(asset_id=asset.id, sort_order=len(post.attachment_links))
    )
    db.commit()
    db.refresh(asset)
    return _asset_out(asset)


@router.put(
    "/posts/{post_id}/status", response_model=CommunityPostOut, summary="게시 결과 설정"
)
def set_post_status(
    post_id: int,
    payload: PublishStatusUpdate,
    actor: CurrentUser,
    db: DbSession,
) -> CommunityPostOut:
    """게시 결과(대기중·게시·게시보류)를 정한다.

    작성자는 손대지 못한다 — 올리는 사람과 게시를 승인하는 사람을 가른다.
    커뮤니티 소유 기관의 관리자(와 슈퍼관리자)만 바꾼다.
    """
    post = db.get(CommunityPost, post_id)
    if post is None or not _can_touch(db, actor, post.org_id):
        raise not_found("게시글")
    if not _can_publish(db, actor, post.org_id):
        raise forbid("게시 결과는 커뮤니티 소유 기관의 관리자만 설정할 수 있습니다.")
    if payload.status not in PUBLISH_STATUSES:
        raise bad_request("게시 결과는 대기중·게시·게시보류 중 하나여야 합니다.")

    post.publish_status = payload.status
    db.commit()
    db.refresh(post)
    return _post_out(db, post, actor)


@router.delete("/posts/{post_id}", response_model=Message, summary="공유 게시판 글 삭제")
def delete_post(post_id: int, actor: CurrentUser, db: DbSession) -> Message:
    post = db.get(CommunityPost, post_id)
    if post is None or not _can_touch(db, actor, post.org_id):
        raise not_found("게시글")
    if not permissions.can_remove_shared(actor, post.author_id):
        raise forbid("이 글을 지울 권한이 없습니다.")
    db.delete(post)
    db.commit()
    return Message(detail="글을 지웠습니다.")


# ------------------------------------------------------------------ 커뮤니티 콘텐츠


def _empty_document() -> dict:
    """빈 캔버스. CMS 콘텐츠의 기본 문서와 같은 모양이다."""
    return {
        "version": 1,
        "layout": {"width": 1920, "height": 1080, "background": "#000000"},
        "elements": [],
    }


#: 커뮤니티 문서에 넣지 못하는 요소. 위젯과 재생목록은 기관 데이터를 끌어오는
#: 통로라, 커뮤니티 울타리 안에서 열리면 안 된다.
_FORBIDDEN_ELEMENTS = {"widget", "playlist"}


def _validate_document(document: dict | None) -> dict:
    """커뮤니티 문서를 받는다. 기본 요소만 허용한다.

    편집기 레일에도 위젯·재생목록이 없지만, 화면만 믿으면 API 로 직접 넣을
    수 있다 — 최종 판정은 항상 서버다.
    """
    if document is None:
        return _empty_document()
    if not isinstance(document, dict) or not isinstance(document.get("elements"), list):
        raise bad_request("문서 형식이 올바르지 않습니다.")
    for element in document["elements"]:
        if not isinstance(element, dict):
            raise bad_request("문서 형식이 올바르지 않습니다.")
        if element.get("type") in _FORBIDDEN_ELEMENTS:
            raise bad_request("커뮤니티 콘텐츠에는 위젯·재생목록을 넣을 수 없습니다.")
    return document


def _content_out(content: CommunityContent, actor: User) -> CommunityContentOut:
    out = CommunityContentOut.model_validate(content)
    out.author_name = content.author.name if content.author else None
    out.element_count = len((content.document or {}).get("elements") or [])
    out.can_remove = permissions.can_remove_shared(actor, content.author_id)
    return out


@router.get("/contents", response_model=Page[CommunityContentOut], summary="커뮤니티 콘텐츠 목록")
def list_contents(
    actor: CurrentUser,
    db: DbSession,
    org_id: int | None = Query(default=None),
    page: int = Query(1, ge=1),
    size: int = Query(20, ge=1, le=100),
) -> Page[CommunityContentOut]:
    _require_manage(actor)
    org = _resolve_community(db, actor, org_id)
    stmt = select(CommunityContent).where(CommunityContent.org_id == org.id)
    total = db.execute(
        select(func.count()).select_from(stmt.order_by(None).subquery())
    ).scalar_one()
    rows = db.execute(
        stmt.order_by(CommunityContent.id.desc()).offset((page - 1) * size).limit(size)
    ).scalars()
    return Page[CommunityContentOut](
        items=[_content_out(row, actor) for row in rows], total=total, page=page, size=size
    )


@router.post(
    "/contents",
    response_model=CommunityContentOut,
    status_code=status.HTTP_201_CREATED,
    summary="커뮤니티 콘텐츠 만들기",
)
def create_content(
    payload: CommunityContentCreate,
    actor: CurrentUser,
    db: DbSession,
    org_id: int | None = Query(default=None),
) -> CommunityContentOut:
    _require_manage(actor)
    org = _resolve_community(db, actor, org_id)

    content = CommunityContent(
        org_id=org.id,
        author_id=actor.id,
        title=payload.title.strip(),
        document=_validate_document(payload.document),
    )
    db.add(content)
    db.flush()
    # 문서가 쓰는 자산을 색인한다 — 쓰이는 파일을 지우지 못하게 막는 근거다.
    asset_service.sync_community_links(db, content)
    db.commit()
    db.refresh(content)
    return _content_out(content, actor)


@router.get(
    "/contents/{content_id}", response_model=CommunityContentOut, summary="커뮤니티 콘텐츠 상세"
)
def get_content(content_id: int, actor: CurrentUser, db: DbSession) -> CommunityContentOut:
    _require_manage(actor)
    content = db.get(CommunityContent, content_id)
    if content is None or not _can_touch(db, actor, content.org_id):
        raise not_found("커뮤니티 콘텐츠")
    return _content_out(content, actor)


@router.put(
    "/contents/{content_id}", response_model=CommunityContentOut, summary="커뮤니티 콘텐츠 수정"
)
def update_content(
    content_id: int,
    payload: CommunityContentUpdate,
    actor: CurrentUser,
    db: DbSession,
) -> CommunityContentOut:
    _require_manage(actor)
    content = db.get(CommunityContent, content_id)
    if content is None or not _can_touch(db, actor, content.org_id):
        raise not_found("커뮤니티 콘텐츠")
    if not permissions.can_remove_shared(actor, content.author_id):
        raise forbid("이 콘텐츠를 고칠 권한이 없습니다.")

    if payload.title is not None:
        content.title = payload.title.strip()
    if payload.document is not None:
        content.document = _validate_document(payload.document)
        asset_service.sync_community_links(db, content)
    # 빈 문자열은 '기간 지움'이다. None 은 '건드리지 않음'.
    if payload.start_date is not None:
        content.start_date = payload.start_date or None
    if payload.end_date is not None:
        content.end_date = payload.end_date or None
    if payload.audience is not None:
        if payload.audience not in AUDIENCES:
            raise bad_request("사용대상은 전체·초·중·고 중 하나여야 합니다.")
        content.audience = payload.audience
    # 위젯이 변경을 감지하는 근거다.
    content.version += 1
    db.commit()
    db.refresh(content)
    return _content_out(content, actor)


@router.delete("/contents/{content_id}", response_model=Message, summary="커뮤니티 콘텐츠 삭제")
def delete_content(content_id: int, actor: CurrentUser, db: DbSession) -> Message:
    _require_manage(actor)
    content = db.get(CommunityContent, content_id)
    if content is None or not _can_touch(db, actor, content.org_id):
        raise not_found("커뮤니티 콘텐츠")
    if not permissions.can_remove_shared(actor, content.author_id):
        raise forbid("이 콘텐츠를 지울 권한이 없습니다.")
    db.delete(content)
    db.commit()
    return Message(detail="콘텐츠를 지웠습니다.")


# ------------------------------------------------------------------ 커뮤니티 재생목록


def _validate_playlist_items(
    db: DbSession, org: Organization, items: list[CommunityPlaylistItemIn]
) -> list[dict]:
    """칸이 전부 **이 커뮤니티의 공유물**인지 확인하고 저장 모양으로 만든다."""
    if not items:
        raise bad_request("칸을 하나 이상 담아야 합니다.")

    # 이 커뮤니티의 게시판 글에 붙은 파일들이 공유 재료다.
    shared = {
        link.asset_id: link.asset
        for link in db.execute(
            select(CommunityPostAsset)
            .join(CommunityPost, CommunityPostAsset.post_id == CommunityPost.id)
            .where(CommunityPost.org_id == org.id)
        ).scalars()
    }
    cleaned: list[dict] = []
    for item in items:
        asset = shared.get(item.asset_id)
        if item.kind not in ("image", "video") or asset is None or asset.kind != item.kind:
            raise bad_request("커뮤니티에 공유된 이미지·동영상만 담을 수 있습니다.")
        entry: dict = {
            "kind": item.kind,
            "asset_id": item.asset_id,
            "duration_sec": item.duration_sec,
        }
        if item.transition and item.transition != "none":
            entry["transition"] = transitions.normalize(item.transition)
            entry["transition_ms"] = transitions.normalize_ms(item.transition_ms)
        cleaned.append(entry)
    return cleaned


def _resolve_playlist_items(db: DbSession, playlist: CommunityPlaylist) -> list[dict]:
    """저장된 칸에 화면이 그릴 이름·주소를 붙인다. 글이 지워진 것은 건너뛴다."""
    resolved: list[dict] = []
    for item in playlist.items or []:
        link = db.execute(
            select(CommunityPostAsset)
            .join(CommunityPost, CommunityPostAsset.post_id == CommunityPost.id)
            .where(
                CommunityPost.org_id == playlist.org_id,
                CommunityPostAsset.asset_id == item.get("asset_id"),
            )
        ).scalars().first()
        if link is None:
            continue
        entry = dict(item)
        entry["title"] = link.post.title or link.asset.filename
        entry["url"] = asset_service.public_url(link.asset)
        resolved.append(entry)
    return resolved


def _playlist_out(db: DbSession, playlist: CommunityPlaylist, actor: User) -> CommunityPlaylistOut:
    out = CommunityPlaylistOut.model_validate(playlist)
    out.author_name = playlist.author.name if playlist.author else None
    out.items = _resolve_playlist_items(db, playlist)
    out.can_remove = permissions.can_remove_shared(actor, playlist.author_id)
    return out


@router.get("/playlists", response_model=Page[CommunityPlaylistOut], summary="커뮤니티 재생목록")
def list_playlists(
    actor: CurrentUser,
    db: DbSession,
    org_id: int | None = Query(default=None),
    page: int = Query(1, ge=1),
    size: int = Query(20, ge=1, le=100),
) -> Page[CommunityPlaylistOut]:
    _require_manage(actor)
    org = _resolve_community(db, actor, org_id)
    stmt = select(CommunityPlaylist).where(CommunityPlaylist.org_id == org.id)
    total = db.execute(
        select(func.count()).select_from(stmt.order_by(None).subquery())
    ).scalar_one()
    rows = db.execute(
        stmt.order_by(CommunityPlaylist.id.desc()).offset((page - 1) * size).limit(size)
    ).scalars()
    return Page[CommunityPlaylistOut](
        items=[_playlist_out(db, row, actor) for row in rows], total=total, page=page, size=size
    )


@router.post(
    "/playlists",
    response_model=CommunityPlaylistOut,
    status_code=status.HTTP_201_CREATED,
    summary="커뮤니티 재생목록 만들기",
)
def create_playlist(
    payload: CommunityPlaylistCreate,
    actor: CurrentUser,
    db: DbSession,
    org_id: int | None = Query(default=None),
) -> CommunityPlaylistOut:
    _require_manage(actor)
    org = _resolve_community(db, actor, org_id)

    playlist = CommunityPlaylist(
        org_id=org.id,
        author_id=actor.id,
        name=payload.name.strip(),
        items=_validate_playlist_items(db, org, payload.items),
    )
    db.add(playlist)
    db.commit()
    db.refresh(playlist)
    return _playlist_out(db, playlist, actor)


@router.put(
    "/playlists/{playlist_id}",
    response_model=CommunityPlaylistOut,
    summary="커뮤니티 재생목록 수정",
)
def update_playlist(
    playlist_id: int,
    payload: CommunityPlaylistUpdate,
    actor: CurrentUser,
    db: DbSession,
) -> CommunityPlaylistOut:
    _require_manage(actor)
    playlist = db.get(CommunityPlaylist, playlist_id)
    if playlist is None or not _can_touch(db, actor, playlist.org_id):
        raise not_found("커뮤니티 재생목록")
    if not permissions.can_remove_shared(actor, playlist.author_id):
        raise forbid("이 재생목록을 고칠 권한이 없습니다.")

    if payload.name is not None:
        playlist.name = payload.name.strip()
    if payload.items is not None:
        org = db.get(Organization, playlist.org_id)
        playlist.items = _validate_playlist_items(db, org, payload.items)
    playlist.version += 1
    db.commit()
    db.refresh(playlist)
    return _playlist_out(db, playlist, actor)


@router.delete("/playlists/{playlist_id}", response_model=Message, summary="커뮤니티 재생목록 삭제")
def delete_playlist(playlist_id: int, actor: CurrentUser, db: DbSession) -> Message:
    _require_manage(actor)
    playlist = db.get(CommunityPlaylist, playlist_id)
    if playlist is None or not _can_touch(db, actor, playlist.org_id):
        raise not_found("커뮤니티 재생목록")
    if not permissions.can_remove_shared(actor, playlist.author_id):
        raise forbid("이 재생목록을 지울 권한이 없습니다.")
    db.delete(playlist)
    db.commit()
    return Message(detail="재생목록을 지웠습니다.")


# ------------------------------------------------------------------ 공유 재료

# 별도의 공유 창구는 없다 — **게시판 글에 붙인 파일이 곧 공유 재료**다.
# 콘텐츠 편집기와 재생목록이 이 목록에서 고른다.


@router.get(
    "/media", response_model=Page[CommunityMaterialOut], summary="공유 재료(게시판 첨부) 목록"
)
def list_materials(
    actor: CurrentUser,
    db: DbSession,
    kind: str = Query("image", description="image | video"),
    org_id: int | None = Query(default=None),
    page: int = Query(1, ge=1),
    size: int = Query(24, ge=1, le=100),
) -> Page[CommunityMaterialOut]:
    if kind not in ("image", "video"):
        raise bad_request("kind 는 image 또는 video 여야 합니다.")

    org = _resolve_community(db, actor, org_id)
    stmt = (
        select(CommunityPostAsset)
        .join(CommunityPost, CommunityPostAsset.post_id == CommunityPost.id)
        .join(Asset, CommunityPostAsset.asset_id == Asset.id)
        .where(CommunityPost.org_id == org.id, Asset.kind == kind)
    )
    total = db.execute(
        select(func.count()).select_from(stmt.order_by(None).subquery())
    ).scalar_one()
    links = db.execute(
        stmt.order_by(CommunityPostAsset.id.desc()).offset((page - 1) * size).limit(size)
    ).scalars()
    return Page[CommunityMaterialOut](
        items=[
            CommunityMaterialOut(
                id=link.asset_id,
                title=link.post.title or link.asset.filename,
                asset=_asset_out(link.asset),
            )
            for link in links
        ],
        total=total,
        page=page,
        size=size,
    )
