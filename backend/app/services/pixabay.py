"""Pixabay 스톡 소재 검색(이미지·동영상).

콘텐츠 편집기가 배경·삽화·영상을 찾는다. **서버를 거쳐** 호출하는 이유는 API
키 때문이다 — 프론트엔드에 두면 번들에 그대로 실려 누구나 꺼내 쓸 수 있고,
우리 계정의 호출 한도가 남의 트래픽으로 소모된다.

무료 제공처 중 Pixabay 를 고른 이유:

* 이미지와 동영상을 **같은 키 하나**로 받는다. 제공처를 둘로 나누면 키도
  둘, 실패 처리도 둘이 된다.
* Pixabay 콘텐츠 라이선스가 상업적 이용과 수정을 허용하고 출처 표기를
  요구하지 않는다(권장은 한다). 학교·교육청 게시물에 그대로 쓸 수 있다.
* 가입만 하면 키가 즉시 나온다.

응답을 그대로 흘려보내지 않고 필요한 필드만 추려 내려준다. 외부 서비스의
필드 구성이 바뀌어도 편집기를 고칠 일이 없고, 무엇을 쓰는지가 이 파일 하나에
드러난다.
"""

from __future__ import annotations

import logging
from typing import Any

import httpx

from app.core.config import settings

logger = logging.getLogger(__name__)

IMAGE_API_URL = "https://pixabay.com/api/"
VIDEO_API_URL = "https://pixabay.com/api/videos/"

#: Pixabay 가 허용하는 per_page 범위. 벗어나면 400 을 돌려준다.
MIN_PER_PAGE = 3
MAX_PER_PAGE = 200

KINDS = ("image", "video")


class PixabayError(Exception):
    """검색을 수행할 수 없다. 사용자에게 그대로 보여 줄 문구를 담는다."""


class PixabayNotConfigured(PixabayError):
    """API 키가 없다. 설정 문제이지 사용자의 잘못이 아니다."""


def is_configured() -> bool:
    return bool(settings.PIXABAY_API_KEY)


def _to_image(hit: dict[str, Any]) -> dict[str, Any]:
    """이미지 한 건에서 편집기가 쓰는 값만 뽑는다.

    ``preview``  검색 목록의 썸네일(가볍다)
    ``url``      콘텐츠에 실제로 넣을 주소
    ``page``     출처 페이지. 저작자 표기를 남기려면 필요하다.
    """
    return {
        "kind": "image",
        "id": hit.get("id"),
        "preview": hit.get("previewURL"),
        # webformatURL 은 최대 640px 이라 DID 화면에는 작다. large 를 우선한다.
        "url": hit.get("largeImageURL") or hit.get("webformatURL"),
        "width": hit.get("imageWidth"),
        "height": hit.get("imageHeight"),
        "tags": hit.get("tags"),
        "author": hit.get("user"),
        "page": hit.get("pageURL"),
    }


def _to_video(hit: dict[str, Any]) -> dict[str, Any]:
    """동영상 한 건.

    Pixabay 는 화질별 주소를 묶어서 준다. DID 는 대개 1080p 이므로 ``large``
    를 먼저 쓰고, 없으면 한 단계씩 내려간다 — 없는 화질을 고르면 주소가
    비어 돌아온다.

    미리보기 그림은 영상 주소에서 유도한다(Pixabay 가 같은 규칙으로
    제공한다). 목록에 영상 자체를 걸면 수십 MB 가 한꺼번에 오간다.
    """
    videos = hit.get("videos") or {}
    best = None
    for quality in ("large", "medium", "small", "tiny"):
        candidate = videos.get(quality) or {}
        if candidate.get("url"):
            best = candidate
            break

    picture_id = hit.get("picture_id")
    preview = f"https://i.vimeocdn.com/video/{picture_id}_295x166.jpg" if picture_id else None

    return {
        "kind": "video",
        "id": hit.get("id"),
        "preview": preview,
        "url": (best or {}).get("url"),
        "width": (best or {}).get("width"),
        "height": (best or {}).get("height"),
        "duration": hit.get("duration"),
        "tags": hit.get("tags"),
        "author": hit.get("user"),
        "page": hit.get("pageURL"),
    }


async def search(
    query: str,
    *,
    kind: str = "image",
    page: int = 1,
    per_page: int = 24,
    orientation: str | None = None,
) -> dict[str, Any]:
    """스톡 소재를 검색한다.

    ``orientation`` 은 'horizontal' | 'vertical' | None. 콘텐츠가 세로형이면
    세로 소재만 보여 주는 편이 고르기 쉽다. **동영상에는 적용되지 않는다** —
    Pixabay 동영상 API 가 그 조건을 받지 않는다.
    """
    if kind not in KINDS:
        raise PixabayError(f"알 수 없는 갈래입니다: {kind}")

    if not is_configured():
        raise PixabayNotConfigured(
            "Pixabay API 키가 설정되지 않았습니다. 서버의 PIXABAY_API_KEY 를 지정하세요."
        )

    params: dict[str, Any] = {
        "key": settings.PIXABAY_API_KEY,
        "q": query,
        "page": page,
        "per_page": max(MIN_PER_PAGE, min(per_page, MAX_PER_PAGE)),
        # 공공장소에 표출되는 화면이다. 안전 필터를 끄지 않는다.
        "safesearch": "true",
    }
    if kind == "image":
        params["image_type"] = "photo"
        if orientation in {"horizontal", "vertical"}:
            params["orientation"] = orientation

    url = IMAGE_API_URL if kind == "image" else VIDEO_API_URL

    try:
        async with httpx.AsyncClient(timeout=settings.PIXABAY_TIMEOUT_SEC) as client:
            response = await client.get(url, params=params)
    except httpx.TimeoutException as exc:
        raise PixabayError("검색이 시간 내에 응답하지 않았습니다.") from exc
    except httpx.HTTPError as exc:
        # 폐쇄망이면 외부로 나갈 수 없다. 흔한 상황이라 원인을 남겨 둔다.
        logger.warning("Pixabay 호출 실패: %s", exc)
        raise PixabayError("검색 서버에 연결할 수 없습니다.") from exc

    if response.status_code == 429:
        raise PixabayError("검색 호출 한도를 초과했습니다. 잠시 후 다시 시도하세요.")
    if response.status_code >= 400:
        logger.warning("Pixabay 오류 응답 %s: %s", response.status_code, response.text[:200])
        raise PixabayError("검색에 실패했습니다.")

    body = response.json()
    convert = _to_image if kind == "image" else _to_video
    hits = [convert(hit) for hit in body.get("hits", [])]
    return {
        "items": [hit for hit in hits if hit["url"]],
        "total": body.get("totalHits", 0),
        "page": page,
        "per_page": params["per_page"],
    }


async def fetch(url: str) -> tuple[bytes, str]:
    """고른 소재를 서버가 직접 받아 온다.

    폐쇄망 장치는 pixabay.com 에 닿지 못한다. 주소를 그대로 문서에 넣으면
    CMS 화면에서만 보이고 정작 표출은 안 된다 — 그래서 받아서 우리 자산으로
    저장한다.

    바이트와 MIME 을 돌려주고, 저장·형식 검사는 부르는 쪽(자산 API)이 한다.
    """
    try:
        async with httpx.AsyncClient(timeout=settings.PIXABAY_TIMEOUT_SEC * 6) as client:
            response = await client.get(url, follow_redirects=True)
    except httpx.TimeoutException as exc:
        raise PixabayError("소재를 내려받는 데 시간이 너무 걸립니다.") from exc
    except httpx.HTTPError as exc:
        logger.warning("소재 내려받기 실패: %s", exc)
        raise PixabayError("소재를 내려받지 못했습니다.") from exc

    if response.status_code >= 400:
        raise PixabayError("소재를 내려받지 못했습니다.")

    content_type = (response.headers.get("content-type") or "").split(";")[0].strip()
    return response.content, content_type
