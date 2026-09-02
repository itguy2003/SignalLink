"""업로드 자산(이미지·동영상).

콘텐츠 편집기가 그림·영상을 받는 방법 중 **파일 업로드** 쪽이다. 링크 방식은
클라이언트가 주소를 문서에 적어 넣을 뿐이라 서버가 할 일이 없고, AI 생성은
아직 없다(만들어지면 결과물을 여기 자산으로 넣어 같은 경로를 타게 한다).

파일 내려받기는 **장치도 부른다**. 장치는 사용자 토큰이 아니라
``X-Device-Token`` 으로 말하므로 둘 다 받는다 — 그러지 않으면 올린 파일이
CMS 에서만 보이고 정작 화면에는 안 나온다.
"""

from __future__ import annotations

from fastapi import APIRouter, File, Query, Response, UploadFile, status
from fastapi.responses import FileResponse
from sqlalchemy import func, select

from app.api.deps import CurrentUser, DbSession, bad_request, forbid, not_found
from app.models.asset import Asset
from app.models.organization import Organization
from app.schemas.asset import AssetOut, AssetUpdate
from app.schemas.common import Message, Page
from app.services import assets as asset_service
from app.services import org_tree, permissions

router = APIRouter(prefix="/assets", tags=["자산"])


def _to_out(db: DbSession, asset: Asset) -> AssetOut:
    out = AssetOut.model_validate(asset)
    out.url = asset_service.public_url(asset)
    org = db.get(Organization, asset.org_id)
    out.org_name = org.name if org else None
    # 콘텐츠와 재생목록을 함께 센다(``asset_service.usage_count`` 와 같은 규칙).
    # 재생목록을 빼면 이미지앨범이 쓰는 사진이 '아무도 안 쓰는 파일' 로 보인다.
    out.usage_count = asset_service.usage_count(db, asset.id)
    return out


def _assert_can_manage(db: DbSession, actor, asset: Asset) -> None:  # noqa: ANN001
    """자산은 기관 자원이다. 기관을 관리하거나 본인이 올린 것이면 다룰 수 있다."""
    if permissions.can_manage_org(db, actor, asset.org_id):
        return
    if asset.uploaded_by == actor.id:
        return
    raise forbid("해당 파일을 다룰 권한이 없습니다.")


@router.get("", response_model=Page[AssetOut], summary="자산 목록")
def list_assets(
    actor: CurrentUser,
    db: DbSession,
    q: str | None = None,
    kind: str | None = Query(None, description="image | video"),
    org_id: int | None = None,
    page: int = Query(1, ge=1),
    size: int = Query(24, ge=1, le=200),
) -> Page[AssetOut]:
    stmt = select(Asset)
    scope = permissions.managed_org_ids(db, actor)
    if scope is not None:
        stmt = stmt.where(Asset.org_id.in_(scope))
    if q:
        stmt = stmt.where(Asset.filename.ilike(f"%{q}%"))
    if kind:
        if kind not in {"image", "video"}:
            raise bad_request(f"알 수 없는 갈래입니다: {kind}")
        stmt = stmt.where(Asset.kind == kind)
    if org_id is not None:
        if not permissions.can_view_org(db, actor, org_id):
            raise forbid("해당 기관의 파일을 조회할 권한이 없습니다.")
        stmt = stmt.where(Asset.org_id.in_(org_tree.descendant_ids(db, org_id)))

    total = db.execute(
        select(func.count()).select_from(stmt.order_by(None).subquery())
    ).scalar_one()
    rows = list(
        db.execute(stmt.order_by(Asset.created_at.desc()).offset((page - 1) * size).limit(size))
        .scalars()
        .all()
    )
    return Page(items=[_to_out(db, a) for a in rows], total=total, page=page, size=size)


@router.post(
    "",
    response_model=AssetOut,
    status_code=status.HTTP_201_CREATED,
    summary="파일 업로드",
)
async def upload_asset(
    actor: CurrentUser,
    db: DbSession,
    file: UploadFile = File(..., description="이미지 또는 동영상"),
    org_id: int | None = Query(None, description="없으면 올리는 사람의 기관"),
) -> AssetOut:
    """이미지·동영상을 올린다.

    형식과 크기를 받는 자리에서 막는다. 저장은 됐는데 장치에서 안 나오는
    파일이 쌓이면, 왜 안 나오는지 화면에서는 알 수 없다.
    """
    kind = asset_service.kind_of(file.content_type or "")
    if kind is None:
        raise bad_request(f"지원하지 않는 형식입니다: {file.content_type}")

    target_org = org_id if org_id is not None else actor.org_id
    if not permissions.can_manage_org(db, actor, target_org):
        raise forbid("해당 기관에 파일을 올릴 권한이 없습니다.")

    data = await file.read()
    if not data:
        raise bad_request("빈 파일입니다.")

    limit = asset_service.max_bytes(kind)
    if len(data) > limit:
        raise bad_request(f"파일은 {limit // (1024 * 1024)}MB 이하여야 합니다.")

    stored = asset_service.store(data, kind, file.content_type)
    asset = Asset(
        org_id=target_org,
        uploaded_by=actor.id,
        kind=kind,
        filename=file.filename or "upload",
        content_type=file.content_type,
        size_bytes=len(data),
        storage_path=stored,
    )
    db.add(asset)
    db.commit()
    db.refresh(asset)
    return _to_out(db, asset)


@router.get("/{asset_id}", response_model=AssetOut, summary="자산 상세")
def get_asset(asset_id: int, actor: CurrentUser, db: DbSession) -> AssetOut:
    asset = db.get(Asset, asset_id)
    if asset is None:
        raise not_found("파일")
    if not permissions.can_view_org(db, actor, asset.org_id):
        raise forbid("해당 파일을 조회할 권한이 없습니다.")
    return _to_out(db, asset)


@router.get("/{asset_id}/{token}/file", summary="자산 파일 내려받기")
def download_asset(asset_id: int, token: str, db: DbSession) -> Response:
    """올린 파일을 그대로 내려준다.

    **인증을 요구하지 않는다.** 브라우저의 ``<img>``·``<video>`` 는 헤더를
    붙일 수 없어서, 인증을 요구하면 CMS 화면에서도 장치에서도 그림이 뜨지
    않는다. 대신 주소에 알아맞힐 수 없는 열쇠(``Asset.token``)를 넣어 id 를
    훑는 방식으로 남의 파일을 가져가지 못하게 한다.

    파일 시스템에서 스트리밍하므로 영상도 통째로 메모리에 올리지 않는다.
    """
    asset = db.get(Asset, asset_id)
    # 열쇠가 틀리면 '없다' 고 답한다. '있지만 열쇠가 틀렸다' 고 알려 주면
    # 어떤 id 가 존재하는지가 드러난다.
    if asset is None or token != asset.token:
        raise not_found("파일")

    path = asset_service.absolute_path(asset)
    if not path.exists():
        raise not_found("파일")

    return FileResponse(
        path,
        media_type=asset.content_type,
        filename=asset.filename,
        # 내용이 바뀌지 않는 파일이다(바꾸려면 새로 올린다). 장치가 매번
        # 다시 받으면 폐쇄망의 좁은 회선을 그만큼 잡아먹는다.
        headers={"Cache-Control": "public, max-age=604800, immutable"},
    )


@router.put("/{asset_id}", response_model=AssetOut, summary="자산 이름 수정")
def update_asset(
    asset_id: int, payload: AssetUpdate, actor: CurrentUser, db: DbSession
) -> AssetOut:
    asset = db.get(Asset, asset_id)
    if asset is None:
        raise not_found("파일")
    _assert_can_manage(db, actor, asset)

    asset.filename = payload.filename.strip()
    db.commit()
    db.refresh(asset)
    return _to_out(db, asset)


@router.delete("/{asset_id}", response_model=Message, summary="자산 삭제")
def delete_asset(asset_id: int, actor: CurrentUser, db: DbSession) -> Message:
    """쓰는 콘텐츠가 있으면 막는다.

    지우고 나서야 화면이 깨진 것을 알게 되면 어느 콘텐츠였는지 되짚을 수 없다.
    """
    asset = db.get(Asset, asset_id)
    if asset is None:
        raise not_found("파일")
    _assert_can_manage(db, actor, asset)

    used = asset_service.usage_count(db, asset.id)
    if used:
        raise bad_request(f"콘텐츠 {used}건에서 사용 중이라 삭제할 수 없습니다.")

    asset_service.remove_file(asset)
    db.delete(asset)
    db.commit()
    return Message(detail="파일을 삭제했습니다.")
