"""Regression tests for Inspect Video. Run: python -m pytest tests/test_inspect_video_v4.py -q"""
from __future__ import annotations

import json
from pathlib import Path

import pytest

from app.helpers import media
from app.workflows.nodes.inspect_video import InspectVideoNode


@pytest.fixture
def video(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    path = tmp_path / "sample.mp4"
    path.write_bytes(b"test media")
    sample = {
        "format": {"filename": str(path), "duration": "10.2", "size": "999", "format_name": "mov,mp4,m4a", "bit_rate": "780"},
        "streams": [
            {"index": 0, "codec_type": "video", "codec_name": "h264", "width": 1920, "height": 1080,
             "avg_frame_rate": "30000/1001", "pix_fmt": "yuv420p", "color_transfer": "smpte2084"},
            {"index": 1, "codec_type": "audio", "codec_name": "aac", "sample_rate": "48000", "channels": 2,
             "tags": {"language": "fr"}},
            {"index": 2, "codec_type": "subtitle", "codec_name": "subrip", "tags": {"language": "en"}},
        ],
        "chapters": [{"id": 0, "start_time": "0", "end_time": "10.2", "tags": {"title": "Intro"}}],
    }
    monkeypatch.setattr(media, "tool", lambda *a, **k: json.dumps(sample))
    return path


def test_legacy_and_extended_metadata(video: Path):
    info = media.probe(video)
    assert {k: info[k] for k in ("duration", "width", "height", "has_audio", "bytes")} == {
        "duration": 10.2, "width": 1920, "height": 1080, "has_audio": True, "bytes": 999,
    }
    assert round(info["video"]["fps"], 2) == 29.97
    assert info["video"]["is_hdr"] is True
    assert info["audio"][0]["language"] == "fr"
    assert info["subtitles"][0]["language"] == "en"
    assert info["chapters"][0]["title"] == "Intro"
    assert json.dumps(info, allow_nan=False)


def test_quick_and_section_filter(video: Path):
    info = media.probe(video, mode="quick", sections=["video"])
    assert "format" not in info
    assert info["has_audio"] is True
    assert "pixel_format" not in info["video"]
    assert info["audio"] == []


def test_invalid_stream_rejected(video: Path):
    with pytest.raises(ValueError, match="does not exist"):
        media.probe(video, video_stream_index=33)
    with pytest.raises(ValueError, match="mode"):
        media.probe(video, mode="deep")
    with pytest.raises(ValueError, match="section"):
        media.probe(video, sections=["invalid"])


def test_node_registered_and_backwards_compatible(video: Path, tmp_path: Path):
    assert InspectVideoNode.type == "media.probe"
    settings = InspectVideoNode.metadata()["settings"]
    result = InspectVideoNode.execute({"type": "media.probe", "settings": settings}, {}, video, tmp_path)
    assert result["probe"]["width"] == 1920
    assert result["probe"]["has_audio"] is True
    assert InspectVideoNode.execute({"type": "media.probe", "settings": {}}, {}, video, tmp_path)["probe"]["width"] == 1920
