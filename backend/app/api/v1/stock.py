"""스톡 소재 검색(외부 무료 제공처).

콘텐츠 편집기가 배경·삽화·영상을 바깥에서 찾아 쓴다. 외부 호출을 서버가
대신하는 이유는 ``services/pixabay.py`` 참조 — 요약하면 API 키를 브라우저에
내려보내지 않기 위해서다.

로그인한 사용자만 쓸 수 있다. 인증 없이 열어 두면 우리 서버가 남의 검색
창구가 된다.

고른 소재는 **우리 자산으로 받아 저장한다**(``/stock/save``). 바깥 주소를
그대로 문서에 넣으면 폐쇄망 장치에서 표출되지 않고, 원본이 사라지면 화면이
깨진다 — 그 두 가지가 이 시스템에서 가장 흔한 사고다.
"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query, status
from pydantic import BaseModel, Field

from app.api.deps import CurrentUser, DbSession, bad_request, forbid
from app.models.asset import Asset
from app.schemas.asset import AssetOut
from app.services import assets as asset_service
from app.services import permissions, pixabay

router = APIRouter(prefix="/stock", tags=["스톡 소재"])


class StockHit(BaseModel):
    #: 'image' | 'video'
    kind: str = "image"
    id: int | None = None
    #: 검색 목록에 그릴 썸네일. 본 소재를 목록에 쓰면 수십 MB 가 오간다.
    preview: str | None = None
    #: 내려받을 주소
    url: str
    width: int | None = None
    height: int | None = None
    #: 동영상 길이(초). 이미지에는 없다.
    duration: int | None = None
    tags: str | None = None
    author: str | None = None
    #: 출처 페이지. 저작자 표기를 남기려면 필요하다.
    page: str | None = None


class StockSearchResult(BaseModel):
    items: list[StockHit] = Field(default_factory=list)
    total: int = 0
    page: int = 1
    per_page: int = 24


class StockStatus(BaseModel):
    """검색을 쓸 수 있는 상태인지. 편집기가 탭을 켤지 결정한다."""

    configured: bool
    provider: str = "pixabay"


class StockSaveRequest(BaseModel):
    url: str = Field(min_length=1, max_length=2000)
    kind: str = "image"
    filename: str | None = Field(default=None, max_length=255)
    author: str | None = Field(default=None, max_length=100)
    page: str | None = Field(default=None, max_length=1000)
    org_id: int | None = None


@router.get("/status", response_model=StockStatus, summary="스톡 검색 사용 가능 여부")
def search_status(user: CurrentUser) -> StockStatus:  # noqa: ARG001
    """키가 없으면 편집기가 눌러 보기 전에 알 수 있어야 한다."""
    return StockStatus(configured=pixabay.is_configured())


def _wrap(exc: pixabay.PixabayError) -> HTTPException:
    if isinstance(exc, pixabay.PixabayNotConfigured):
        # 설정 문제다. 사용자가 검색어를 고쳐도 해결되지 않으므로 503 으로 구분한다.
        return HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc))
    return HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc))


@router.get("/search", response_model=StockSearchResult, summary="스톡 소재 검색")
async def search_stock(
    user: CurrentUser,  # noqa: ARG001 - 인증만 요구한다
    q: str = Query(..., min_length=1, max_length=100, description="검색어"),
    kind: str = Query("image", description="image | video"),
    page: int = Query(1, ge=1, le=100),
    per_page: int = Query(24, ge=3, le=60),
    orientation: str | None = Query(
        default=None, description="horizontal | vertical. 이미지에만 적용된다."
    ),
) -> StockSearchResult:
    if kind not in pixabay.KINDS:
        raise bad_request("kind 는 image 또는 video 여야 합니다.")
    if orientation not in (None, "horizontal", "vertical"):
        raise bad_request("orientation 은 horizontal 또는 vertical 이어야 합니다.")

    try:
        result = await pixabay.search(
            q, kind=kind, page=page, per_page=per_page, orientation=orientation
        )
    except pixabay.PixabayError as exc:
        raise _wrap(exc) from exc

    return StockSearchResult(**result)


@router.post(
    "/save",
    response_model=AssetOut,
    status_code=status.HTTP_201_CREATED,
    summary="고른 소재를 자산으로 저장",
)
async def save_stock(payload: StockSaveRequest, actor: CurrentUser, db: DbSession) -> AssetOut:
    """바깥 소재를 받아 우리 자산으로 저장한다.

    업로드와 같은 자리에 같은 모양으로 들어가므로, 이후 경로(라이브러리·
    삭제 보호·장치 배포)가 완전히 같아진다.
    """
    target_org = payload.org_id if payload.org_id is not None else actor.org_id
    if not permissions.can_manage_org(db, actor, target_org):
        raise forbid("해당 기관에 파일을 올릴 권한이 없습니다.")

    try:
        data, content_type = await pixabay.fetch(payload.url)
    except pixabay.PixabayError as exc:
        raise _wrap(exc) from exc

    if not data:
        raise bad_request("빈 파일입니다.")

    kind = asset_service.kind_of(content_type)
    if kind is None:
        # 제공처가 알려 준 형식을 그대로 믿지 않는다. 우리가 그릴 수 있는
        # 형식이 아니면 저장해 봐야 장치에서 안 나온다.
        raise bad_request(f"지원하지 않는 형식입니다: {content_type or '알 수 없음'}")

    limit = asset_service.max_bytes(kind)
    if len(data) > limit:
        raise bad_request(f"파일은 {limit // (1024 * 1024)}MB 이하여야 합니다.")

    stored = asset_service.store(data, kind, content_type)
    asset = Asset(
        org_id=target_org,
        uploaded_by=actor.id,
        kind=kind,
        filename=payload.filename or f"pixabay-{kind}",
        content_type=content_type,
        size_bytes=len(data),
        storage_path=stored,
    )
    asset_service.attach_thumbnail(asset)
    db.add(asset)
    db.commit()
    db.refresh(asset)

    out = AssetOut.model_validate(asset)
    out.url = asset_service.public_url(asset)
    out.thumb_url = asset_service.thumb_url(asset)
    return out
