"""업로드 자산(이미지·동영상) 저장과 콘텐츠 색인.

콘텐츠 편집기가 그림·영상을 받는 방법은 셋이다.

1. **링크** — 바깥 주소를 그대로 쓴다. 준비가 필요 없지만 폐쇄망에서는
   표출되지 않고, 원본이 사라지면 화면이 깨진다.
2. **업로드** — 여기서 다루는 방식. 장치가 이미 말을 트고 있는 이 서버에서
   내려받으므로 바깥으로 못 나가는 망에서도 나온다.
3. **AI 생성** — 아직 없다. 만들어진 결과물을 여기 자산으로 넣으면 2번과
   같은 경로를 타므로, 이 모듈은 그때 손대지 않아도 된다.

바이너리를 DB 가 아니라 파일 시스템에 두는 이유는 ``models/asset`` 의 주석에
적어 두었다 — 영상은 한 번 읽을 때마다 그 크기만큼 메모리에 올라온다.
"""

from __future__ import annotations

import secrets
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.asset import Asset, ContentAsset, PlaylistAsset
from app.models.content import Content
from app.models.playlist import Playlist
from app.services import thumbnails

#: 편집기가 <img> / <video> 로 바로 그릴 수 있는 형식만 받는다. 목록에 없는
#: 형식은 저장은 되어도 장치에서 안 나오므로, 받는 자리에서 막는 편이 낫다.
IMAGE_TYPES = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/gif": ".gif",
    "image/svg+xml": ".svg",
}

VIDEO_TYPES = {
    "video/mp4": ".mp4",
    "video/webm": ".webm",
    "video/ogg": ".ogv",
}

#: 서버 변환(ffmpeg)이 있어야만 받는 형식 — 저장 직후 MP4 로 바뀐다
#: (``services/video_transcode``). 변환기가 없으면 그 단계에서 거절된다.
TRANSCODE_ONLY_TYPES = {
    "video/quicktime": ".mov",
    "video/x-msvideo": ".avi",
    "video/x-matroska": ".mkv",
}

ALLOWED_TYPES: dict[str, str] = {**IMAGE_TYPES, **VIDEO_TYPES, **TRANSCODE_ONLY_TYPES}


def kind_of(content_type: str) -> str | None:
    """MIME 으로 갈래를 정한다. 모르는 형식이면 None."""
    if content_type in IMAGE_TYPES:
        return "image"
    if content_type in VIDEO_TYPES or content_type in TRANSCODE_ONLY_TYPES:
        return "video"
    return None


def max_bytes(kind: str) -> int:
    """갈래별 상한. 영상은 그림보다 훨씬 크다."""
    return settings.MAX_VIDEO_BYTES if kind == "video" else settings.MAX_IMAGE_BYTES


def media_root() -> Path:
    root = Path(settings.MEDIA_ROOT)
    if not root.is_absolute():
        root = Path(settings.BACKEND_DIR) / root
    return root


def _relative_path(kind: str, extension: str) -> str:
    """저장 경로. 날짜로 나눠 한 폴더에 파일이 수만 개 쌓이지 않게 한다.

    이름은 무작위로 짓는다. 올린 이름을 그대로 쓰면 같은 이름이 서로를 덮고,
    경로를 거슬러 올라가는 이름(``../``)을 막을 일도 생긴다.
    """
    today = datetime.now(UTC).strftime("%Y/%m")
    return f"{kind}/{today}/{secrets.token_hex(16)}{extension}"


class UploadRejected(Exception):
    """받을 수 없는 업로드. 메시지를 그대로 사용자에게 보여 준다."""


#: 한 번에 읽는 조각. 너무 작으면 왕복이 잦고, 너무 크면 메모리를 먹는다.
_CHUNK_BYTES = 4 * 1024 * 1024


async def store_stream(file, kind: str, content_type: str) -> tuple[str, int]:  # noqa: ANN001
    """업로드 파일을 조각으로 저장한다. (상대 경로, 크기)를 돌려준다.

    통째로 읽지 않는 이유는 동영상 상한이 10GB 이기 때문이다 — 한 번의
    업로드가 그만큼 메모리를 차지하면 서버가 먼저 쓰러진다. 조각으로 받아
    쓰고, 상한을 넘는 순간 쓰던 파일을 지우고 끊는다 — 끝까지 받고 나서
    거절하면 회선과 디스크를 10GB 어치 쓰고 버리는 셈이다.
    """
    limit = max_bytes(kind)
    relative = _relative_path(kind, ALLOWED_TYPES[content_type])
    path = media_root() / relative
    path.parent.mkdir(parents=True, exist_ok=True)

    size = 0
    try:
        with path.open("wb") as out:
            while chunk := await file.read(_CHUNK_BYTES):
                size += len(chunk)
                if size > limit:
                    raise UploadRejected(f"파일은 {limit // (1024 * 1024)}MB 이하여야 합니다.")
                out.write(chunk)
    except BaseException:
        # 반쯤 쓴 파일을 남기면 디스크에 유령이 쌓인다.
        path.unlink(missing_ok=True)
        raise

    if size == 0:
        path.unlink(missing_ok=True)
        raise UploadRejected("빈 파일입니다.")
    return relative, size


def store(data: bytes, kind: str, content_type: str) -> str:
    """파일을 저장하고 MEDIA_ROOT 기준 상대 경로를 돌려준다."""
    relative = _relative_path(kind, ALLOWED_TYPES[content_type])
    path = media_root() / relative
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)
    return relative


def absolute_path(asset: Asset) -> Path:
    return media_root() / asset.storage_path


def remove_file(asset: Asset) -> None:
    """파일을 지운다. 이미 없어도 오류로 보지 않는다.

    DB 행은 지워졌는데 파일이 없어 삭제가 실패하면, 지워진 자산이 목록에
    영영 남는다 — 실제로 곤란한 쪽은 그쪽이다.
    """
    absolute_path(asset).unlink(missing_ok=True)
    if asset.thumb_path:
        (media_root() / asset.thumb_path).unlink(missing_ok=True)


def attach_thumbnail(asset: Asset) -> None:
    """저장된 원본으로 썸네일을 만들어 자산에 적는다. 실패해도 조용하다.

    업로드 자리마다 부른다 — 목록은 원본 대신 이것을 그린다.
    """
    asset.thumb_path = thumbnails.generate(
        media_root(), asset.storage_path, asset.kind, asset.content_type
    )


def thumb_url(asset: Asset) -> str | None:
    """목록이 그릴 썸네일 주소. 없으면 None — 화면이 원본으로 물러난다."""
    if not asset.thumb_path:
        return None
    return f"{settings.API_V1_PREFIX}/assets/{asset.id}/{asset.token}/thumb"


def public_url(asset: Asset) -> str:
    """문서에 적어 넣는 주소.

    상대 경로라 서버 주소가 바뀌어도 따라가고, 열쇠(``Asset.token``)를 끼워
    넣어 인증 없이도 열 수 있게 한다 — ``<img>`` 와 ``<video>`` 는 헤더를
    붙이지 못한다.
    """
    return f"{settings.API_V1_PREFIX}/assets/{asset.id}/{asset.token}/file"


def asset_id_from_url(src: str | None) -> int | None:
    """문서의 ``src`` 가 우리 자산을 가리키면 그 id. 아니면 None.

    열쇠가 붙기 전에 저장된 문서(``/assets/7/file``)도 함께 읽는다 — 색인이
    끊기면 쓰이는 파일을 지울 수 있게 되어 화면이 깨진다.
    """
    if not src:
        return None
    marker = "/assets/"
    at = src.find(marker)
    if at < 0:
        return None
    head = src[at + len(marker) :].split("/", 1)[0]
    return int(head) if head.isdigit() else None


def option_asset_ids(options: dict[str, Any] | None) -> set[int]:
    """위젯 옵션이 가리키는 자산 id 들.

    이미지앨범처럼 옵션 안에 주소를 여러 개 들고 있는 위젯이 있다. 요소의
    ``src`` 만 세면 앨범이 쓰는 사진은 '아무도 안 쓰는 파일' 로 보여, 지운
    뒤에야 앨범이 빈 것을 알게 된다.

    키 이름을 열거하지 않고 값의 모양으로 판단한다 — 주소를 담는 위젯이
    늘어날 때마다 여기를 고치게 되면 결국 누군가 잊는다.
    """
    ids: set[int] = set()
    for value in (options or {}).values():
        candidates = value if isinstance(value, list) else [value]
        for candidate in candidates:
            # 앨범의 한 장은 {"src": ...} 이거나 주소 문자열이다.
            src = candidate.get("src") if isinstance(candidate, dict) else candidate
            if not isinstance(src, str):
                continue
            asset_id = asset_id_from_url(src)
            if asset_id is not None:
                ids.add(asset_id)
    return ids


def referenced_ids(document: dict[str, Any] | None) -> set[int]:
    """문서가 쓰는 자산 id 들.

    이미지·동영상 요소의 ``src`` 와, 위젯 옵션 안에 든 주소를 함께 본다.
    """
    ids: set[int] = set()
    for element in (document or {}).get("elements") or []:
        if not isinstance(element, dict):
            continue
        if element.get("type") in {"image", "video"}:
            asset_id = asset_id_from_url(element.get("src"))
            if asset_id is not None:
                ids.add(asset_id)
        elif element.get("type") == "widget":
            ids |= option_asset_ids(element.get("options"))
    return ids


def sync_links(db: Session, content: Content) -> None:
    """콘텐츠가 쓰는 자산 색인을 문서와 맞춘다.

    ``playlists.sync_links`` 와 같은 자리에서 같은 방식으로 부른다.
    """
    wanted = referenced_ids(content.document)
    if wanted:
        # 지워진 자산을 가리키는 문서도 있을 수 있다. 있는 것만 건다.
        existing = set(
            db.execute(select(Asset.id).where(Asset.id.in_(wanted))).scalars().all()
        )
        wanted &= existing

    current = {link.asset_id: link for link in content.asset_links}

    for asset_id in wanted - current.keys():
        content.asset_links.append(ContentAsset(asset_id=asset_id))
    for asset_id in current.keys() - wanted:
        content.asset_links.remove(current[asset_id])


def playlist_referenced_ids(playlist: Playlist) -> set[int]:
    """재생목록의 칸들이 쓰는 자산 id 들.

    칸의 옵션만 본다 — 재생목록은 위젯만 담고, 위젯이 주소를 들고 있다면
    그것은 옵션 안이다(이미지앨범).
    """
    ids: set[int] = set()
    for item in playlist.items:
        ids |= option_asset_ids(item.options)
    return ids


def sync_playlist_links(db: Session, playlist: Playlist) -> None:
    """재생목록이 쓰는 자산 색인을 칸 목록과 맞춘다. 커밋은 호출자가 한다.

    ``sync_links`` 의 재생목록판이다. 같은 자리에서 같은 방식으로 부른다.
    """
    wanted = playlist_referenced_ids(playlist)
    if wanted:
        # 지워진 자산을 가리키는 칸도 있을 수 있다. 있는 것만 건다 —
        # 없는 id 를 걸면 FK 위반으로 저장이 통째로 실패한다.
        existing = set(db.execute(select(Asset.id).where(Asset.id.in_(wanted))).scalars().all())
        wanted &= existing

    current = {link.asset_id: link for link in playlist.asset_links}

    for asset_id in wanted - current.keys():
        playlist.asset_links.append(PlaylistAsset(asset_id=asset_id))
    for asset_id in current.keys() - wanted:
        playlist.asset_links.remove(current[asset_id])


def usage_count(db: Session, asset_id: int) -> int:
    """이 자산을 쓰는 곳의 수. 삭제해도 되는지 판단하는 근거다.

    콘텐츠·재생목록·커뮤니티 재생목록을 함께 센다. 어느 하나를 빼면 그것이
    쓰는 파일이 '아무도 안 쓰는 파일' 로 보여, 지운 뒤에야 화면이 빈 것을
    알게 된다.
    """
    from app.models.community_playlist import CommunityPlaylistAsset

    contents = db.execute(
        select(ContentAsset.content_id).where(ContentAsset.asset_id == asset_id)
    ).scalars()
    playlists = db.execute(
        select(PlaylistAsset.playlist_id).where(PlaylistAsset.asset_id == asset_id)
    ).scalars()
    community_playlists = db.execute(
        select(CommunityPlaylistAsset.playlist_id).where(
            CommunityPlaylistAsset.asset_id == asset_id
        )
    ).scalars()
    return len(set(contents)) + len(set(playlists)) + len(set(community_playlists))
