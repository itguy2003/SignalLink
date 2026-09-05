"""자산 썸네일 생성.

공유 이미지·동영상 목록은 원본을 그대로 그리면 무겁다 — 사진 한 장이 수 MB,
동영상은 목록의 ``<video preload="metadata">`` 가 머리만 읽어도 원본을 연다.
그래서 올릴 때 **원본과 별도로** 작은 JPEG 을 만들어 두고 목록은 그것만 쓴다.

썸네일은 **없어도 되는 부가물**이다. 여기서 무엇이 실패하든 업로드는
성공해야 한다 — 그리지 못한 썸네일은 None 으로 남고, 화면이 원본으로
대신 그린다(예전과 같은 동작).

동영상은 ffmpeg 이 있을 때만 프레임을 뽑는다. 운영 서버에 ffmpeg 이 없으면
동영상 썸네일만 조용히 빠진다.
"""

from __future__ import annotations

import shutil
import subprocess
from pathlib import Path

from PIL import Image

#: 긴 변 상한(px). 목록 타일은 200px 안팎이라 HiDPI 를 감안해도 이 정도면 남는다.
THUMB_MAX = 480

#: JPEG 품질. 목록용이라 원본 화질일 필요가 없다.
_QUALITY = 82

#: Pillow 가 읽지 못하는 벡터 형식. 원본이 이미 작아 썸네일이 필요 없다.
_SKIP_TYPES = {"image/svg+xml"}

#: 프레임 추출이 이 시간을 넘으면 포기한다. 업로드 응답을 붙들면 안 된다.
_FFMPEG_TIMEOUT_SEC = 30


def thumb_relative(storage_path: str) -> str:
    """원본 옆에 붙는 썸네일의 상대 경로.

    원본 경로에서 파생하므로 별도 규칙을 기억할 필요가 없고, 원본을 지울 때
    같이 지우기 쉽다.
    """
    return f"{storage_path}.thumb.jpg"


def generate(root: Path, storage_path: str, kind: str, content_type: str) -> str | None:
    """썸네일을 만들고 상대 경로를 돌려준다. 못 만들면 None.

    실패 사유는 다양하다 — 깨진 파일, 지원하지 않는 코덱, ffmpeg 부재.
    어느 쪽이든 업로드를 막을 일이 아니므로 삼켜서 None 으로 만든다.
    """
    source = root / storage_path
    target = root / thumb_relative(storage_path)
    try:
        if kind == "image":
            if content_type in _SKIP_TYPES:
                return None
            with Image.open(source) as image:
                # 애니메이션 GIF 은 첫 프레임, 투명은 검정 위에 눕는다(convert).
                frame = image.convert("RGB")
                frame.thumbnail((THUMB_MAX, THUMB_MAX))
                frame.save(target, "JPEG", quality=_QUALITY)
        elif kind == "video":
            if not _extract_frame(source, target):
                return None
        else:
            return None
    except Exception:
        # 반쯤 쓴 썸네일을 남기면 목록에 깨진 그림이 뜬다.
        target.unlink(missing_ok=True)
        return None
    return thumb_relative(storage_path) if target.exists() else None


def _extract_frame(source: Path, target: Path) -> bool:
    """ffmpeg 으로 프레임 하나를 JPEG 으로 뽑는다."""
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        return False

    # 1초 지점을 먼저 시도한다 — 첫 프레임이 검은 화면인 영상이 많다.
    # 그보다 짧은 영상이면 처음 프레임으로 물러난다.
    for seek in (["-ss", "1"], []):
        result = subprocess.run(  # noqa: S603 — 인자 고정, 경로는 서버가 지은 것
            [
                ffmpeg,
                "-y",
                "-loglevel", "error",
                *seek,
                "-i", str(source),
                "-frames:v", "1",
                "-vf", f"scale='min({THUMB_MAX},iw)':-2",
                str(target),
            ],
            capture_output=True,
            timeout=_FFMPEG_TIMEOUT_SEC,
        )
        if result.returncode == 0 and target.exists() and target.stat().st_size > 0:
            return True
    target.unlink(missing_ok=True)
    return False
