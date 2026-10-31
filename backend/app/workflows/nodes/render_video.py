"""Native workflow node: RenderVideoNode."""

from __future__ import annotations

import math
import tempfile

from pathlib import Path

from typing import Any

from app.workflows.base import BaseNode

class RenderVideoNode(BaseNode):
    type = 'video.render'

    @staticmethod
    def metadata() -> dict[str, Any]:
        return {"label": "Render Cut Video (FFmpeg)", "group": "Output", "settings": {"enabled": False, "aspect_ratio": "original"}}

    @staticmethod
    def execute(node: dict[str, Any], outputs: dict[str, Any], source: Path | None, workdir: Path) -> dict[str, Any]:
        from app.helpers.transcript import MAX_CUTS, get_input
        from app.helpers.media import tool
        cfg = node.get('settings', {})
        if not cfg.get("enabled", False):
            return {"render": {"state": "disabled", "hint": "Enable in node settings before rendering"}}
        if source is None:
            raise ValueError("Rendering requires uploaded video source")
        cuts = get_input(outputs, "cut_plan")
        if not isinstance(cuts, list) or not cuts:
            raise ValueError("Rendering requires a non-empty cut plan")
        if len(cuts) > MAX_CUTS:
            raise ValueError("Too many cuts")
        aspect = cfg.get("aspect_ratio", "original")
        if aspect not in ("original", "9:16", "16:9", "1:1"):
            raise ValueError("Invalid render aspect ratio")
        if not source.is_file():
            raise ValueError("The source video file is missing")
        validated = []
        for index, part in enumerate(cuts):
            if not isinstance(part, dict):
                raise ValueError(f"Cut {index + 1} is invalid")
            try:
                beginning = float(part["source_start"])
                duration = float(part["duration"])
            except (KeyError, TypeError, ValueError) as exc:
                raise ValueError(f"Cut {index + 1} has invalid timing") from exc
            if not math.isfinite(beginning) or not math.isfinite(duration) or beginning < 0 or duration <= 0 or duration > 14400:
                raise ValueError(f"Cut {index + 1} has invalid timing")
            validated.append((beginning, duration))

        output = workdir / "final.mp4"
        with tempfile.TemporaryDirectory(prefix="workflow_segments_", dir=str(workdir)) as directory:
            segment_dir = Path(directory)
            segments = []
            for index, (beginning, duration) in enumerate(validated):
                segment_name = f"part_{index:03}.mp4"
                segment_path = segment_dir / segment_name
                args = ["ffmpeg", "-nostdin", "-v", "error", "-y", "-ss", str(beginning), "-t", str(duration), "-i", str(source)]
                if aspect != "original":
                    width, height = {"9:16": (720, 1280), "16:9": (1280, 720), "1:1": (720, 720)}[aspect]
                    args.extend(["-vf", f"scale={width}:{height}:force_original_aspect_ratio=increase,crop={width}:{height},setsar=1"])
                args.extend(["-map", "0:v:0", "-map", "0:a:0?", "-c:v", "libx264", "-preset", "veryfast", "-crf", "25", "-pix_fmt", "yuv420p", "-c:a", "aac", "-ar", "44100", "-movflags", "+faststart", str(segment_path)])
                tool(*args, timeout=3600)
                segments.append(segment_name)
            concat = segment_dir / "list.txt"
            # Relative filenames avoid FFmpeg concat quoting issues in Windows paths.
            concat.write_text("".join(f"file '{name}'\n" for name in segments), encoding="utf-8")
            temporary_output = segment_dir / "rendered.mp4"
            tool("ffmpeg", "-nostdin", "-v", "error", "-y", "-f", "concat", "-safe", "1", "-i", str(concat), "-c", "copy", str(temporary_output), timeout=3600)
            if not temporary_output.is_file() or temporary_output.stat().st_size == 0:
                raise RuntimeError("FFmpeg returned an empty rendered video")
            temporary_output.replace(output)
        return {"render": {"state": "completed", "filename": "final.mp4", "bytes": output.stat().st_size}}

# Compatibility exports for older callers and imported test utilities.
metadata = RenderVideoNode.metadata
execute = RenderVideoNode.execute
NODE = RenderVideoNode.definition()
