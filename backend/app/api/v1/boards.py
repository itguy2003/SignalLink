"""기관게시판과 수집 데이터 관리.

게시판 위젯(공지사항/가정통신문/학사일정/급식/시간표)이 표출할 데이터의
수집원을 등록하고, 수집 결과를 조회·입력한다.

게시판은 커뮤니티 유저(``Role.COMMUNITY_USER``)에게 열려 있는 **유일한**
창구다. 그래서 글쓰기와 첨부는 기관 관리 권한이 아니라 게시판 권한으로
판정한다(``permissions.can_post_to_board``).

첨부파일은 자산(``Asset``)으로 저장하고 게시글이 그것을 가리킨다. 파일을
다루는 길이 하나뿐이어야 올리기·용량 제한·형식 검사·내려받기 주소가 갈리지
않는다.
"""

from __future__ import annotations

from fastapi import APIRouter, File, Query, UploadFile, status
from sqlalchemy import func, select

from app.api.deps import CurrentUser, DbSession, bad_request, forbid, not_found
from app.models.asset import Asset, BoardPostAsset
from app.models.board import BoardPost, OrgBoard
from app.models.organization import Organization
from app.schemas.asset import AssetOut
from app.schemas.board import (
    BoardPostCreate,
    BoardPostOut,
    OrgBoardCreate,
    OrgBoardOut,
    OrgBoardUpdate,
)
from app.schemas.common import Message, Page
from app.services import assets as asset_service
from app.services import permissions

router = APIRouter(prefix="/boards", tags=["기관게시판"])


def _post_out(post: BoardPost) -> BoardPostOut:
    """첨부파일 주소를 붙여 내보낸다.

    주소를 서버가 만들어 주는 이유는 열쇠가 붙기 때문이다 — 브라우저의
    ``<img>`` 는 인증 헤더를 못 붙인다(``services/assets.public_url``).
    """
    out = BoardPostOut.model_validate(post)
    out.attachments = []
    for link in post.attachment_links:
        asset = AssetOut.model_validate(link.asset)
        asset.url = asset_service.public_url(link.asset)
        out.attachments.append(asset)
    return out


def _post_for_write(db: DbSession, actor, board_id: int, post_id: int) -> BoardPost:  # noqa: ANN001
    """글을 손댈 수 있는지 확인하고 그 글을 돌려준다."""
    post = db.get(BoardPost, post_id)
    if post is None or post.board_id != board_id:
        raise not_found("게시글")
    board = db.get(OrgBoard, board_id)
    if board is None or not permissions.can_post_to_board(db, actor, board.org_id):
        raise forbid("해당 게시글을 수정할 권한이 없습니다.")
    return post


@router.get("", response_model=list[OrgBoardOut], summary="기관게시판 목록")
def list_boards(
    actor: CurrentUser, db: DbSession, org_id: int | None = None
) -> list[OrgBoard]:
    target_org = org_id if org_id is not None else actor.org_id
    if not permissions.can_view_org(db, actor, target_org):
        raise forbid("해당 기관의 게시판을 조회할 권한이 없습니다.")
    return list(
        db.execute(select(OrgBoard).where(OrgBoard.org_id == target_org).order_by(OrgBoard.id))
        .scalars()
        .all()
    )


@router.post(
    "", response_model=OrgBoardOut, status_code=status.HTTP_201_CREATED, summary="게시판 등록"
)
def create_board(payload: OrgBoardCreate, actor: CurrentUser, db: DbSession) -> OrgBoard:
    if not permissions.can_manage_org(db, actor, payload.org_id):
        raise forbid("해당 기관에 게시판을 등록할 권한이 없습니다.")
    if db.get(Organization, payload.org_id) is None:
        raise bad_request("존재하지 않는 기관입니다.")

    board = OrgBoard(**payload.model_dump())
    db.add(board)
    db.commit()
    db.refresh(board)
    return board


@router.put("/{board_id}", response_model=OrgBoardOut, summary="게시판 수정")
def update_board(
    board_id: int, payload: OrgBoardUpdate, actor: CurrentUser, db: DbSession
) -> OrgBoard:
    board = db.get(OrgBoard, board_id)
    if board is None:
        raise not_found("게시판")
    if not permissions.can_manage_org(db, actor, board.org_id):
        raise forbid("해당 게시판을 수정할 권한이 없습니다.")

    for key, value in payload.model_dump(exclude_unset=True).items():
        if value is not None:
            setattr(board, key, value)
    db.commit()
    db.refresh(board)
    return board


@router.delete("/{board_id}", response_model=Message, summary="게시판 삭제")
def delete_board(board_id: int, actor: CurrentUser, db: DbSession) -> Message:
    board = db.get(OrgBoard, board_id)
    if board is None:
        raise not_found("게시판")
    if not permissions.can_manage_org(db, actor, board.org_id):
        raise forbid("해당 게시판을 삭제할 권한이 없습니다.")
    db.delete(board)
    db.commit()
    return Message(detail="게시판이 삭제되었습니다.")


@router.get("/{board_id}/posts", response_model=Page[BoardPostOut], summary="수집 데이터 목록")
def list_posts(
    board_id: int,
    actor: CurrentUser,
    db: DbSession,
    year: int | None = None,
    month: int | None = None,
    page: int = Query(1, ge=1),
    size: int = Query(20, ge=1, le=200),
) -> Page[BoardPostOut]:
    board = db.get(OrgBoard, board_id)
    if board is None:
        raise not_found("게시판")
    if not permissions.can_view_org(db, actor, board.org_id):
        raise forbid("해당 게시판을 조회할 권한이 없습니다.")

    stmt = select(BoardPost).where(BoardPost.board_id == board_id)
    if year is not None:
        stmt = stmt.where(BoardPost.year == year)
    if month is not None:
        stmt = stmt.where(BoardPost.month == month)

    total = db.execute(
        select(func.count()).select_from(stmt.order_by(None).subquery())
    ).scalar_one()
    rows = list(
        db.execute(stmt.order_by(BoardPost.id.desc()).offset((page - 1) * size).limit(size))
        .scalars()
        .all()
    )
    return Page[BoardPostOut](
        items=[_post_out(r) for r in rows],
        total=total,
        page=page,
        size=size,
    )


@router.post(
    "/{board_id}/posts",
    response_model=BoardPostOut,
    status_code=status.HTTP_201_CREATED,
    summary="수집 데이터 직접 입력",
)
def create_post(
    board_id: int, payload: BoardPostCreate, actor: CurrentUser, db: DbSession
) -> BoardPostOut:
    """스크래핑이 어려운 게시판은 사람이 직접 입력한다.

    커뮤니티 유저도 자기 기관 게시판에는 올릴 수 있다 — 그것이 그 사람에게
    열려 있는 유일한 창구다.
    """
    board = db.get(OrgBoard, board_id)
    if board is None:
        raise not_found("게시판")
    if not permissions.can_post_to_board(db, actor, board.org_id):
        raise forbid("해당 게시판에 글을 올릴 권한이 없습니다.")

    data = payload.model_dump()
    posted_on = data.get("posted_on")
    post = BoardPost(
        board_id=board_id,
        **data,
        # 위젯이 기간으로 빠르게 거를 수 있도록 년/월/일을 분해해 둔다.
        year=posted_on.year if posted_on else None,
        month=posted_on.month if posted_on else None,
        day=posted_on.day if posted_on else None,
    )
    db.add(post)
    board.scrape_count = db.execute(
        select(func.count()).select_from(BoardPost).where(BoardPost.board_id == board_id)
    ).scalar_one() + 1
    db.commit()
    db.refresh(post)
    return _post_out(post)


@router.post(
    "/{board_id}/posts/{post_id}/attachments",
    response_model=AssetOut,
    status_code=status.HTTP_201_CREATED,
    summary="게시글에 이미지·동영상 붙이기",
)
async def attach_file(
    board_id: int,
    post_id: int,
    actor: CurrentUser,
    db: DbSession,
    file: UploadFile = File(...),
) -> AssetOut:
    """올린 파일을 자산으로 저장하고 게시글에 잇는다.

    ``/assets`` 를 그대로 쓰지 않는 이유는 권한이 다르기 때문이다. 자산 올리기는
    기관 관리 권한이 필요한데, 게시판은 커뮤니티 유저에게도 열려 있어야 한다.
    '이 글에 붙일 수 있는가' 로 판정하는 편이 뜻에도 맞는다.
    """
    post = _post_for_write(db, actor, board_id, post_id)
    board = db.get(OrgBoard, board_id)

    data = await file.read()
    if not data:
        raise bad_request("빈 파일입니다.")

    kind = asset_service.kind_of(file.content_type)
    if kind is None:
        raise bad_request(f"지원하지 않는 형식입니다: {file.content_type or '알 수 없음'}")

    limit = asset_service.max_bytes(kind)
    if len(data) > limit:
        raise bad_request(f"파일은 {limit // (1024 * 1024)}MB 이하여야 합니다.")

    stored = asset_service.store(data, kind, file.content_type)
    asset = Asset(
        org_id=board.org_id,
        uploaded_by=actor.id,
        kind=kind,
        filename=file.filename or f"board-{kind}",
        content_type=file.content_type,
        size_bytes=len(data),
        storage_path=stored,
    )
    db.add(asset)
    db.flush()
    # 올린 차례가 곧 보여 줄 차례다.
    post.attachment_links.append(
        BoardPostAsset(asset_id=asset.id, sort_order=len(post.attachment_links))
    )
    db.commit()
    db.refresh(asset)

    out = AssetOut.model_validate(asset)
    out.url = asset_service.public_url(asset)
    return out


@router.delete(
    "/{board_id}/posts/{post_id}/attachments/{asset_id}",
    response_model=Message,
    summary="첨부파일 떼기",
)
def detach_file(
    board_id: int, post_id: int, asset_id: int, actor: CurrentUser, db: DbSession
) -> Message:
    """글에서 뗀다. 파일 자체는 자산 관리에서 지운다 — 다른 곳에서도 쓸 수 있다."""
    post = _post_for_write(db, actor, board_id, post_id)
    link = next((one for one in post.attachment_links if one.asset_id == asset_id), None)
    if link is None:
        raise not_found("첨부파일")

    post.attachment_links.remove(link)
    # 뗀 자리를 메워 번호를 다시 매긴다. 비워 두면 다음에 붙일 때 순서가 겹친다.
    for at, remaining in enumerate(post.attachment_links):
        remaining.sort_order = at
    db.commit()
    return Message(detail="첨부파일을 떼었습니다.")


@router.delete("/{board_id}/posts/{post_id}", response_model=Message, summary="수집 데이터 삭제")
def delete_post(
    board_id: int, post_id: int, actor: CurrentUser, db: DbSession
) -> Message:
    post = db.get(BoardPost, post_id)
    if post is None or post.board_id != board_id:
        raise not_found("게시글")
    board = db.get(OrgBoard, board_id)
    if board is None or not permissions.can_manage_org(db, actor, board.org_id):
        raise forbid("해당 게시글을 삭제할 권한이 없습니다.")
    db.delete(post)
    db.commit()
    return Message(detail="삭제되었습니다.")
