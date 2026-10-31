"""Native workflow node: ExtractAudioNode."""

from __future__ import annotations

from pathlib import Path
from uuid import uuid4

from typing import Any

from app.workflows.base import BaseNode

class ExtractAudioNode(BaseNode):
    type = 'audio.extract'

    @staticmethod
    def metadata() -> dict[str, Any]:
        return {"label": "Extract Audio", "group": "Analysis", "settings": {}}

    @staticmethod
    def execute(node: dict[str, Any], outputs: dict[str, Any], source: Path | None, workdir: Path) -> dict[str, Any]:
        from app.helpers.media import tool
        cfg = node.get('settings', {})
        if source is None or not source.is_file():
            raise ValueError("Select an existing video source first")
        cached = source.parent / "derived"
        cached.mkdir(parents=True, exist_ok=True)
        target = cached / f"{source.stem}.mono16k.wav"
        valid_cache = (target.is_file() and target.stat().st_size >= 1000
                       and target.stat().st_mtime_ns >= source.stat().st_mtime_ns)
        if not valid_cache:
            temporary = cached / f"{source.stem}.{uuid4().hex}.tmp.wav"
            try:
                tool("ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error", "-y", "-i", str(source), "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", str(temporary), timeout=5400)
                if not temporary.is_file() or temporary.stat().st_size < 1000:
                    raise RuntimeError("FFmpeg did not produce valid audio")
                temporary.replace(target)
            finally:
                temporary.unlink(missing_ok=True)
        return {"audio": str(target)}

# Compatibility exports for older callers and imported test utilities.
metadata = ExtractAudioNode.metadata
execute = ExtractAudioNode.execute
NODE = ExtractAudioNode.definition()
