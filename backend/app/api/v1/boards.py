"""기관게시판과 수집 데이터 관리.

게시판 위젯(공지사항/가정통신문/학사일정/급식/시간표)이 표출할 데이터의
수집원을 등록하고, 수집 결과를 조회·입력한다.
"""

from __future__ import annotations

from fastapi import APIRouter, Query, status
from sqlalchemy import func, select

from app.api.deps import CurrentUser, DbSession, bad_request, forbid, not_found
from app.models.board import BoardPost, OrgBoard
from app.models.organization import Organization
from app.schemas.board import (
    BoardPostCreate,
    BoardPostOut,
    OrgBoardCreate,
    OrgBoardOut,
    OrgBoardUpdate,
)
from app.schemas.common import Message, Page
from app.services import permissions

router = APIRouter(prefix="/boards", tags=["기관게시판"])


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
        items=[BoardPostOut.model_validate(r) for r in rows],
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
) -> BoardPost:
    """스크래핑이 어려운 게시판은 관리자가 직접 입력한다."""
    board = db.get(OrgBoard, board_id)
    if board is None:
        raise not_found("게시판")
    if not permissions.can_manage_org(db, actor, board.org_id):
        raise forbid("해당 게시판에 데이터를 입력할 권한이 없습니다.")

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
    return post


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
