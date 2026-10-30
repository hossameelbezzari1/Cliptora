"""CLIPTORA workflow node: video.render.

Executor logic and metadata were migrated from the existing workflow_core.py.
Shared pure helpers remain in workflow_core during compatibility refactor.
"""
from __future__ import annotations
import hashlib
import json
import math
import os
import re
import tempfile
from pathlib import Path
from typing import Any
from app.workflows.base import NodeDefinition

def metadata() -> dict[str, Any]:
    from app.workflows.model_constants import (
        OPENAI_TEXT_MODELS, OPENAI_IMAGE_MODELS, OPENAI_MODERATION_MODELS,
        OPENAI_REASONING_EFFORTS, GEMINI_TEXT_MODELS, GEMINI_IMAGE_MODELS,
    )
    return {"label": "Render Cut Video (FFmpeg)", "group": "Output", "settings": {"enabled": False, "aspect_ratio": "original"}}

def execute(node: dict[str, Any], outputs: dict[str, Any], source: Path | None, workdir: Path) -> dict[str, Any]:
    from app.services.workflow_core import (
        MAX_CUTS, MAX_TARGET_SECONDS, OPENAI_REASONING_EFFORTS,
        HIGHLIGHTS_SCHEMA, SUMMARY_SCHEMA, get_input, input_path, compare_value,
        tool, probe, as_words, group_words, normalize_highlights,
        offline_highlights, openai_json, openai_action, gemini_action,
        ollama_action, execute_ai_agent, execute_http_request, value_path,
    )
    kind, cfg = node['type'], node.get('settings', {})
    if not cfg.get("enabled", False):
        return {"render": {"state": "disabled", "hint": "Enable in node settings before rendering"}}
    if source is None:
        raise ValueError("Rendering requires uploaded video source")
    cuts = get_input(outputs, "cut_plan")
    if not cuts:
        raise ValueError("Rendering requires a cut plan")
    if len(cuts) > MAX_CUTS:
        raise ValueError("Too many cuts")
    aspect = cfg.get("aspect_ratio", "original")
    if aspect not in ("original", "9:16", "16:9", "1:1"):
        raise ValueError("Invalid render aspect ratio")
    output = workdir / "final.mp4"
    chunks = []
    with tempfile.TemporaryDirectory(prefix="cliptora_segments_", dir=str(workdir)) as directory:
        for index, part in enumerate(cuts):
            segment = Path(directory) / f"part_{index:03}.mp4"
            args = ["ffmpeg", "-nostdin", "-v", "error", "-y", "-ss", str(part["source_start"]), "-t", str(part["duration"]), "-i", str(source)]
            if aspect != "original":
                width, height = {"9:16": (720, 1280), "16:9": (1280, 720), "1:1": (720, 720)}[aspect]
                args.extend(["-vf", f"scale={width}:{height}:force_original_aspect_ratio=increase,crop={width}:{height},setsar=1"])
            args.extend(["-c:v", "libx264", "-preset", "veryfast", "-crf", "25", "-pix_fmt", "yuv420p", "-c:a", "aac", "-ar", "44100", "-movflags", "+faststart", str(segment)])
            tool(*args, timeout=3600)
            chunks.append(segment)
        concat = Path(directory) / "list.txt"
        concat.write_text("".join(f"file '{chunk.as_posix()}'\n" for chunk in chunks), encoding="utf-8")
        tool("ffmpeg", "-nostdin", "-v", "error", "-y", "-f", "concat", "-safe", "0", "-i", str(concat), "-c", "copy", str(output), timeout=3600)
    return {"render": {"state": "completed", "filename": "final.mp4", "bytes": output.stat().st_size}}

NODE = NodeDefinition(type='video.render', metadata=metadata, execute=execute)
