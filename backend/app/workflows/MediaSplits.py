"""Materialize CLIPTORA range references into actual audio/video files via FFmpeg.

Input ranges come from a connected collection. Media can only come from the
workflow's selected source or a connected file in CLIPTORA's media storage.
This node never downloads URLs and never executes shell commands.
"""
from __future__ import annotations

import hashlib
import json
import math
import re
import subprocess
import uuid
from pathlib import Path
from typing import Any

from app.workflows.InputResolver import resolve_input_path
from app.workflows.MediaStorage import media_root, run_media_dir
from app.workflows.ItemExecution import ITEM_MARKER


def _source_path(cfg: dict, outputs: dict, source: Path | None, workdir: Path) -> Path:
    selected = str(cfg.get("media_source_path") or "").strip()
    value = resolve_input_path(outputs, selected) if selected else source
    if isinstance(value, dict):
        value = value.get("path") or value.get("audio_path") or value.get("audio")
    if not isinstance(value, (str, Path)):
        raise ValueError("Choose a source media file or a connected Media Path")
    path = Path(value).expanduser().resolve()
    if not path.is_file() or path.is_symlink():
        raise ValueError("Source media file does not exist or is unsafe")
    allowed = [media_root().resolve(), run_media_dir(workdir).resolve()]
    if source is not None:
        if path == source.expanduser().resolve():
            return path
    if not any(path.is_relative_to(root) for root in allowed):
        raise ValueError("Source media must belong to the selected source or CLIPTORA media storage")
    return path


def _flatten_ranges(values: Any, *, max_clips: int) -> list[dict[str, Any]]:
    if not isinstance(values, list):
        raise ValueError("Split input must be an array of ranges/groups")
    result: list[dict[str, Any]] = []

    def visit(rows: list[Any], parent: str | None, depth: int) -> None:
        if depth > 12:
            raise ValueError("Nested split groups exceed 12 levels")
        for row in rows:
            if isinstance(row, dict) and row.get(ITEM_MARKER) is True:
                row = row.get("data")
            if not isinstance(row, dict):
                raise ValueError("Each split range must be an object")
            ident = str(row.get("id") or row.get("group_id") or f"clip_{len(result)+1}")
            label = str(row.get("label") or ident)
            descendants = row.get("children")
            if descendants is None:
                descendants = row.get("clips")
            if isinstance(descendants, list) and descendants:
                visit(descendants, ident, depth + 1)
                continue
            if not ("source_start" in row or "start" in row):
                raise ValueError(f"Split group {ident} has no time range")
            try:
                start = float(row.get("source_start", row.get("start")))
                end = float(row.get("source_end", row.get("end")))
            except (ValueError, TypeError) as exc:
                raise ValueError(f"Split group {ident} has invalid timestamps") from exc
            if (not math.isfinite(start) or not math.isfinite(end)
                or not 0 <= start < end <= 86400 or end - start < 0.05):
                raise ValueError(f"Split group {ident} has invalid duration")
            result.append({"id": ident, "label": label[:160],
                           "parent_id": str(row.get("parent_id") or parent or "") or None,
                           "source_start": round(start, 4), "source_end": round(end, 4)})
            if len(result) > max_clips:
                raise ValueError(f"Split exceeds Max Clips ({max_clips})")

    visit(values, None, 0)
    if not result:
        raise ValueError("No valid split segments found")
    return result


def _probe(path: Path) -> dict[str, Any]:
    try:
        finished = subprocess.run(
            ["ffprobe", "-v", "error", "-show_entries", "format=duration",
             "-of", "json", str(path)], capture_output=True, text=True,
            check=True, timeout=30,
        )
        return json.loads(finished.stdout)
    except (OSError, ValueError, subprocess.SubprocessError) as exc:
        raise RuntimeError("FFprobe could not read media duration") from exc


def _duration(path: Path) -> float:
    try:
        value = float(_probe(path)["format"]["duration"])
    except (KeyError, ValueError, TypeError) as exc:
        raise ValueError("FFprobe could not determine media duration") from exc
    if not math.isfinite(value) or value <= 0:
        raise ValueError("Media duration must be positive")
    return value


def materialize_splits(node: dict, outputs: dict, source: Path | None, workdir: Path) -> dict:
    cfg = node.get("settings") or {}
    path = str(cfg.get("input_path") or "").strip()
    if not path:
        raise ValueError("Select Split Groups input")
    ranges = resolve_input_path(outputs, path)
    limit = cfg.get("max_clips", 100)
    if type(limit) is not int or not 1 <= limit <= 200:
        raise ValueError("Maximum Clips must be from 1 to 200")
    records = _flatten_ranges(ranges, max_clips=limit)
    media = _source_path(cfg, outputs, source, workdir)
    total_seconds = _duration(media)
    fmt = cfg.get("output_format", "mp3")
    if fmt not in ("mp3", "wav", "mp4"):
        raise ValueError("Output Format must be mp3, wav or mp4")
    overwrite = cfg.get("overwrite", False)
    if type(overwrite) is not bool:
        raise ValueError("Overwrite must be a boolean")
    destination = run_media_dir(workdir) / "splits"
    destination.mkdir(parents=True, exist_ok=True)
    progress = node.get("_progress_callback")
    cancelled = node.get("_cancelled_callback")
    items: list[dict] = []
    source_stat = media.stat()
    for index, item in enumerate(records):
        if callable(cancelled) and cancelled():
            raise RuntimeError("Media splitting cancelled")
        start, end = item["source_start"], item["source_end"]
        if end > total_seconds + 0.15:
            raise ValueError(f"Range {item['label']} ends beyond source duration ({total_seconds:.3f}s)")
        item_hash = hashlib.sha256(json.dumps({
            "id": item["id"], "index": index, "start": start, "end": end,
            "source": str(media), "mtime": source_stat.st_mtime_ns,
            "size": source_stat.st_size, "fmt": fmt,
        }, sort_keys=True).encode()).hexdigest()[:16]
        safe_id = re.sub(r"[^A-Za-z0-9_-]", "_", item["id"])[:32] or f"segment_{index+1}"
        node_id = re.sub(r"[^A-Za-z0-9_-]", "_", str(node.get("id") or "split"))[:28]
        target = destination / f"{node_id}_{safe_id}_{item_hash}.{fmt}"
        cached = target.is_file() and target.stat().st_size > 0 and not overwrite
        if not cached:
            stage = destination / f".{uuid.uuid4().hex}.{fmt}"
            command = ["ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error", "-y",
                       "-ss", f"{start:.6f}", "-i", str(media), "-t", f"{end-start:.6f}"]
            if fmt == "mp4":
                command.extend(["-map", "0:v:0", "-map", "0:a:0?", "-c:v", "libx264",
                                "-preset", "veryfast", "-crf", "23", "-c:a", "aac",
                                "-movflags", "+faststart"])
            elif fmt == "wav":
                command.extend(["-map", "0:a:0", "-vn", "-c:a", "pcm_s16le"])
            else:
                command.extend(["-map", "0:a:0", "-vn", "-c:a", "libmp3lame", "-b:a", "192k"])
            command.append(str(stage))
            try:
                done = subprocess.run(command, capture_output=True, text=True, timeout=900, check=False)
                if done.returncode or not stage.is_file() or stage.stat().st_size == 0:
                    raise RuntimeError(f"FFmpeg split failed for {item['label']}: {done.stderr[-500:]}")
                stage.replace(target)
            finally:
                stage.unlink(missing_ok=True)
        actual_duration = round(_duration(target), 4)
        items.append({**item, "path": str(target.resolve()), "filename": target.name,
                      "duration": actual_duration, "format": fmt,
                      "mime_type": "video/mp4" if fmt == "mp4" else ("audio/wav" if fmt == "wav" else "audio/mpeg"),
                      "status": "reused" if cached else "generated"})
        if callable(progress):
            progress({"stage": "splitting", "message": f"Saved split {index+1}/{len(records)}",
                      "processed": index+1, "total": len(records), "unit": "clips",
                      "progress": round(100*(index+1)/len(records), 2)})
    return {"status": "completed", "items": items, "item_count": len(items),
            "format": fmt, "source_path": str(media),
            "files": [item["path"] for item in items],
            "note": "Physical media is saved in CLIPTORA project media storage (workflow-runs/<run>/splits)."}