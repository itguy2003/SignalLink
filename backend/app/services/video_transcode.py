"""업로드 동영상을 웹 표준으로 정규화 — .NET(Services/VideoTranscode.cs)의 짝.

브라우저(플레이어)가 <video> 로 그리는 것은 사실상 H.264+AAC MP4 하나다.
휴대폰·캠코더가 만드는 .mov(HEVC)·.mkv·.avi 는 올려도 장치에서 안 나온다 —
그래서 저장 직후 서버가 ffmpeg 으로 변환해 **항상 재생되는 파일**만 남긴다.

규칙(파리티 계약):
  * 이미 웹 호환(H.264 + AAC/무음 + .mp4)이면 재인코딩하지 않고 **remux**
    만 한다(``-c copy -movflags +faststart``) — 순간 시작(faststart)을 보장
    하면서 화질 손실이 없다.
  * 그 외에는 H.264(veryfast, crf 23) + AAC 128k 로 변환한다.
  * ffmpeg/ffprobe 는 썸네일과 같은 관례로 PATH 에서 찾는다. 없으면:
    mp4/webm/ogv 는 원본 그대로 두고(재생 가능성이 있다), 변환 전용
    형식(.mov 등)은 거절한다 — 안 나오는 파일을 받아 두면 안 된다.
  * 변환 실패도 같은 규칙이다. 어떤 경우에도 업로드 요청이 ffmpeg 때문에
    죽지는 않는다.
"""

from __future__ import annotations

import asyncio
import json
import logging
import shutil
import subprocess
from pathlib import Path

logger = logging.getLogger(__name__)

#: 서버 변환이 있어야만 받는 형식. 브라우저가 직접 못 그리는 컨테이너다.
TRANSCODE_ONLY_TYPES = {
    "video/quicktime": ".mov",
    "video/x-msvideo": ".avi",
    "video/x-matroska": ".mkv",
}

#: 10GB 상한의 파일도 있으니 넉넉히. 넘기면 변환을 포기한다(원본 유지/거절).
_TRANSCODE_TIMEOUT_SEC = 1800

_NO_FFMPEG_MESSAGE = (
    "이 형식은 서버 변환(ffmpeg)이 필요합니다. MP4/WebM/OGG 로 올려 주세요."
)
_FAILED_MESSAGE = "동영상을 변환하지 못했습니다. 파일이 손상되지 않았는지 확인하세요."


def is_available() -> bool:
    return bool(shutil.which("ffmpeg") and shutil.which("ffprobe"))


def _probe_codecs(path: Path) -> tuple[str | None, str | None] | None:
    """(비디오 코덱, 오디오 코덱). 못 읽으면 None — 웹 호환이 아니라고 본다."""
    ffprobe = shutil.which("ffprobe")
    try:
        result = subprocess.run(
            [
                ffprobe, "-v", "error",
                "-show_entries", "stream=codec_type,codec_name",
                "-of", "json", str(path),
            ],
            capture_output=True,
            timeout=60,
            check=True,
        )
        streams = json.loads(result.stdout).get("streams", [])
    except (subprocess.SubprocessError, OSError, json.JSONDecodeError):
        return None
    video = next((s.get("codec_name") for s in streams if s.get("codec_type") == "video"), None)
    audio = next((s.get("codec_name") for s in streams if s.get("codec_type") == "audio"), None)
    return video, audio


def _run_ffmpeg(source: Path, target: Path, *, copy: bool) -> bool:
    ffmpeg = shutil.which("ffmpeg")
    codec_args = (
        ["-c", "copy"]
        if copy
        else [
            "-c:v", "libx264", "-preset", "veryfast", "-crf", "23",
            # 4:2:2/10bit 소스도 있어 강제한다 — 브라우저 디코더는 4:2:0 만 본다.
            "-pix_fmt", "yuv420p",
            "-c:a", "aac", "-b:a", "128k",
        ]
    )
    try:
        result = subprocess.run(
            [ffmpeg, "-y", "-i", str(source), *codec_args, "-movflags", "+faststart", str(target)],
            capture_output=True,
            timeout=_TRANSCODE_TIMEOUT_SEC,
        )
    except (subprocess.SubprocessError, OSError):
        target.unlink(missing_ok=True)
        return False
    if result.returncode != 0 or not target.exists() or target.stat().st_size == 0:
        logger.warning("ffmpeg 변환 실패(%s): %s", source.name, result.stderr[-400:])
        target.unlink(missing_ok=True)
        return False
    return True


def ensure_web_video(relative: str, content_type: str) -> tuple[str, int, str]:
    """저장된 동영상을 웹 호환 MP4 로 바꾼다. (상대 경로, 크기, MIME).

    성공하면 원본을 지우고 새 .mp4 경로를 돌려준다. ffmpeg 이 없거나
    실패하면 규칙대로 원본 유지 또는 거절(UploadRejected)한다.
    """
    from app.services import assets as asset_service

    root = asset_service.media_root()
    source = root / relative
    transcode_only = content_type in TRANSCODE_ONLY_TYPES

    if not is_available():
        if transcode_only:
            source.unlink(missing_ok=True)
            raise asset_service.UploadRejected(_NO_FFMPEG_MESSAGE)
        return relative, source.stat().st_size, content_type

    codecs = _probe_codecs(source)
    web_ready = (
        codecs is not None
        and codecs[0] == "h264"
        and codecs[1] in (None, "aac")
        and relative.endswith(".mp4")
    )

    target_relative = asset_service._relative_path("video", ".mp4")  # noqa: SLF001
    target = root / target_relative
    target.parent.mkdir(parents=True, exist_ok=True)

    if not _run_ffmpeg(source, target, copy=web_ready):
        if transcode_only:
            source.unlink(missing_ok=True)
            raise asset_service.UploadRejected(_FAILED_MESSAGE)
        # 표준 형식(mp4/webm/ogv)은 기존 정책대로 관대하다 —
        # 깨진 파일이라도 업로드는 성공하고(썸네일만 빠진다) 원본을 남긴다.
        return relative, source.stat().st_size, content_type

    source.unlink(missing_ok=True)
    return target_relative, target.stat().st_size, "video/mp4"


async def ensure_web_video_async(relative: str, content_type: str) -> tuple[str, int, str]:
    """업로드 요청 안에서 부른다 — 변환이 이벤트 루프를 막지 않게 스레드로."""
    return await asyncio.to_thread(ensure_web_video, relative, content_type)
