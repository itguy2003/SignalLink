"""동영상 웹 변환 검증.

업로드된 동영상은 저장 직후 H.264/AAC MP4(faststart)로 정규화된다 — 규칙은
``services/video_transcode`` 참조. 실제 ffmpeg 으로 소형 영상을 만들어
돌리므로, ffmpeg 이 없는 환경에서는 통째로 건너뛴다.
"""

from __future__ import annotations

import shutil
import subprocess
from pathlib import Path

import pytest

from app.services import assets as asset_service
from app.services import video_transcode

pytestmark = pytest.mark.skipif(
    not video_transcode.is_available(), reason="ffmpeg/ffprobe 가 없다"
)


@pytest.fixture(autouse=True)
def media_root(tmp_path: Path, monkeypatch) -> Path:  # noqa: ANN001
    monkeypatch.setattr(asset_service.settings, "MEDIA_ROOT", str(tmp_path))
    return tmp_path


def _make_video(path: Path, *, codec_args: list[str]) -> bytes:
    """0.4초짜리 소형 시험 영상."""
    path.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(
        [
            shutil.which("ffmpeg"), "-y",
            "-f", "lavfi", "-i", "testsrc=duration=0.4:size=64x64:rate=10",
            *codec_args, str(path),
        ],
        capture_output=True,
        timeout=120,
        check=True,
    )
    return path.read_bytes()


def _codecs(path: Path):  # noqa: ANN202
    return video_transcode._probe_codecs(path)  # noqa: SLF001


@pytest.fixture
def school_id(client, super_headers, root_org_id) -> int:  # noqa: ANN001
    return client.post(
        "/api/v1/organizations",
        headers=super_headers,
        json={"name": "변환초등학교", "parent_id": root_org_id, "org_type": "학교"},
    ).json()["id"]


def test_webm_is_transcoded_to_web_mp4(tmp_path: Path):
    data = _make_video(tmp_path / "src.webm", codec_args=["-c:v", "libvpx"])
    stored = asset_service.store(data, "video", "video/webm")

    relative, size, content_type = video_transcode.ensure_web_video(stored, "video/webm")

    assert content_type == "video/mp4"
    assert relative.endswith(".mp4")
    assert size > 0
    # 원본은 지우고 변환본만 남는다.
    assert not (asset_service.media_root() / stored).exists()
    assert _codecs(asset_service.media_root() / relative)[0] == "h264"


def test_web_ready_mp4_is_kept_as_mp4(tmp_path: Path):
    # 이미 H.264 MP4 — 재인코딩 없이 remux(faststart)만 한다.
    data = _make_video(tmp_path / "src.mp4", codec_args=["-c:v", "libx264", "-pix_fmt", "yuv420p"])
    stored = asset_service.store(data, "video", "video/mp4")

    relative, _size, content_type = video_transcode.ensure_web_video(stored, "video/mp4")

    assert content_type == "video/mp4"
    assert _codecs(asset_service.media_root() / relative)[0] == "h264"


def test_broken_file_is_rejected(tmp_path: Path):  # noqa: ARG001
    # 영상이 아닌 바이트 — 변환 전용 형식(.mov)이라 원본을 남길 수도 없다.
    stored = asset_service.store(b"not a video", "video", "video/quicktime")

    with pytest.raises(asset_service.UploadRejected):
        video_transcode.ensure_web_video(stored, "video/quicktime")
    assert not (asset_service.media_root() / stored).exists()


def test_upload_api_returns_normalized_video(client, super_headers, school_id, tmp_path: Path):  # noqa: ANN001
    """업로드 API 끝까지 — 올린 webm 이 mp4 자산으로 돌아온다."""
    data = _make_video(tmp_path / "clip.webm", codec_args=["-c:v", "libvpx"])

    response = client.post(
        f"/api/v1/assets?org_id={school_id}",
        headers=super_headers,
        files={"file": ("clip.webm", data, "video/webm")},
    )
    body = response.json()
    assert response.status_code == 201, body
    assert body["content_type"] == "video/mp4"
    assert body["kind"] == "video"


def test_mov_is_accepted_and_transcoded(client, super_headers, school_id, tmp_path: Path):  # noqa: ANN001
    """휴대폰 영상(.mov) — 예전에는 거절했지만 이제 변환을 전제로 받는다."""
    data = _make_video(tmp_path / "clip.mov", codec_args=["-c:v", "mpeg4"])

    response = client.post(
        f"/api/v1/assets?org_id={school_id}",
        headers=super_headers,
        files={"file": ("clip.mov", data, "video/quicktime")},
    )
    body = response.json()
    assert response.status_code == 201, body
    assert body["content_type"] == "video/mp4"
