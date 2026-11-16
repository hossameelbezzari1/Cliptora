"""CLIPTORA native Edge TTS workflow node.

One-file drop-in for backend/app/workflows/nodes/EdgeTTS.py.
Node registration, parameters, media output, and the existing run audio preview
all use CLIPTORA's current contracts. No new routes, services or UI files needed.

edge-tts connects to Microsoft's unofficial online Edge speech service. Network
access is needed; free/public endpoint availability is not guaranteed.
"""
from __future__ import annotations

import asyncio
import os
import uuid
import hashlib
import json
import math
import re
import shutil
import subprocess
import tempfile
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any, Callable

from app.workflows.Node import Node
from app.workflows.MediaStorage import run_media_dir
from app.workflows.InputResolver import resolve_input_path
from app.workflows.ItemExecution import LiveItemTracker
from app.workflows.nodes.VideoRemix import _manifest as _validated_clip_manifest

DEFAULT_VOICE = "ar-MA-JamalNeural"
MAX_MANAGED_CHARACTERS = 200_000
MAX_PARTS = 240
MAX_BATCH_ITEMS = 20
TICKS_PER_SECOND = 10_000_000

# This is a curated UI list, not the entire service catalog. With voice_mode
# 'auto', edge_tts.list_voices() discovers available voices at EXECUTION time.
VOICE_CHOICES = [
    ("ar-MA-JamalNeural", "Arabic / Morocco - Jamal (Male)"),
    ("ar-MA-MounaNeural", "Arabic / Morocco - Mouna (Female)"),
    ("ar-SA-HamedNeural", "Arabic / Saudi Arabia - Hamed (Male)"),
    ("ar-SA-ZariyahNeural", "Arabic / Saudi Arabia - Zariyah (Female)"),
    ("ar-EG-ShakirNeural", "Arabic / Egypt - Shakir (Male)"),
    ("ar-EG-SalmaNeural", "Arabic / Egypt - Salma (Female)"),
    ("ar-DZ-IsmaelNeural", "Arabic / Algeria - Ismael (Male)"),
    ("ar-DZ-AminaNeural", "Arabic / Algeria - Amina (Female)"),
    ("ar-TN-HediNeural", "Arabic / Tunisia - Hedi (Male)"),
    ("ar-TN-ReemNeural", "Arabic / Tunisia - Reem (Female)"),
    ("fr-FR-HenriNeural", "French / France - Henri (Male)"),
    ("fr-FR-DeniseNeural", "French / France - Denise (Female)"),
    ("fr-CA-JeanNeural", "French / Canada - Jean (Male)"),
    ("fr-CA-SylvieNeural", "French / Canada - Sylvie (Female)"),
    ("en-US-GuyNeural", "English / USA - Guy (Male)"),
    ("en-US-AriaNeural", "English / USA - Aria (Female)"),
    ("en-GB-RyanNeural", "English / UK - Ryan (Male)"),
    ("en-GB-SoniaNeural", "English / UK - Sonia (Female)"),
    ("es-ES-AlvaroNeural", "Spanish / Spain - Alvaro (Male)"),
    ("es-ES-ElviraNeural", "Spanish / Spain - Elvira (Female)"),
    ("de-DE-ConradNeural", "German / Germany - Conrad (Male)"),
    ("de-DE-KatjaNeural", "German / Germany - Katja (Female)"),
]

VOICE_PROFILES = {
    "custom": None,
    "natural": (0, 0, 100),
    "slow_narration": (-15, -2, 100),
    "fast_short": (18, 0, 100),
    "deep_narration": (-8, -12, 100),
    "bright_explainer": (8, 6, 100),
}


def _integer(value: Any, title: str, low: int, high: int) -> int:
    if isinstance(value, bool) or not re.fullmatch(r"[+-]?\d+", str(value).strip()):
        raise ValueError(f"{title} must be an integer")
    number = int(str(value).strip())
    if not low <= number <= high:
        raise ValueError(f"{title} must be between {low} and {high}")
    return number


def _flag(value: Any, default: bool = False) -> bool:
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    if isinstance(value, str) and value.lower() in {"true", "false"}:
        return value.lower() == "true"
    raise ValueError("A boolean parameter must be true or false")


def _choice(cfg: dict[str, Any], key: str, values: set[str], default: str) -> str:
    value = str(cfg.get(key, default) or default).strip()
    if value not in values:
        raise ValueError(f"Invalid {key}: {value}")
    return value


def _safe_name(value: Any, default: str, length: int = 54) -> str:
    return re.sub(r"[^A-Za-z0-9_-]", "_", str(value or default)).strip("_")[:length] or default


def _read_path(value: Any, dotted: str) -> Any:
    if not re.fullmatch(r"[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+){0,15}", dotted):
        raise ValueError("Input Field must be a safe dotted JSON path")
    for part in dotted.split("."):
        if isinstance(value, dict):
            value = value.get(part)
        elif isinstance(value, list) and part.isdigit() and int(part) < len(value):
            value = value[int(part)]
        else:
            return None
    return value


def _upstream_values(outputs: dict[str, Any], field: str, *, want_batch: bool) -> list[str]:
    # 'outputs' contains ONLY nodes connected through depends_on.
    if field != "auto":
        try:
            explicit = resolve_input_path(outputs, field)
        except ValueError:
            explicit = None  # Keep legacy path resolution below for old workflows.
        if isinstance(explicit, str) and explicit.strip():
            return [explicit.strip()]
        if want_batch and isinstance(explicit, list):
            items = [item if isinstance(item, str) else (item.get("text") if isinstance(item, dict) else None)
                     for item in explicit]
            if items and all(isinstance(item, str) for item in items):
                return [item.strip() for item in items if item.strip()]
    for output in reversed(list(outputs.values())):
        if not isinstance(output, dict):
            continue
        found: Any = None
        if field != "auto":
            found = _read_path(output, field)
        elif want_batch:
            for key in ("texts", "scripts", "items", "batch_texts"):
                if isinstance(output.get(key), list):
                    found = output[key]
                    break
        else:
            for key in ("text", "script", "summary", "transcript", "content", "output"):
                candidate = output.get(key)
                if isinstance(candidate, str) and candidate.strip():
                    found = candidate
                    break
                if isinstance(candidate, dict):
                    sub = candidate.get("text") or candidate.get("content")
                    if isinstance(sub, str) and sub.strip():
                        found = sub
                        break
        if isinstance(found, str) and found.strip():
            return [found.strip()]
        if want_batch and isinstance(found, list):
            result = []
            for item in found:
                text = item if isinstance(item, str) else (item.get("text") if isinstance(item, dict) else None)
                if isinstance(text, str) and text.strip():
                    result.append(text.strip())
            if result:
                return result
    return []


def _batch_lines(raw: Any) -> list[str]:
    if isinstance(raw, list):
        if not all(isinstance(item, str) for item in raw):
            raise ValueError("Batch Texts must be a list of strings")
        return [item.strip() for item in raw if item.strip()]
    if not isinstance(raw, str):
        raise ValueError("Batch Texts must be lines of text or JSON array")
    if raw.lstrip().startswith("["):
        try:
            parsed = json.loads(raw)
        except ValueError as exc:
            raise ValueError("Batch Texts JSON is invalid") from exc
        return _batch_lines(parsed)
    return [line.strip() for line in raw.splitlines() if line.strip()]


def _normal_text(value: str, clean: bool) -> str:
    text = value.replace("\r\n", "\n").replace("\r", "\n").strip()
    if clean:
        text = re.sub(r"[ \t\u00a0]+", " ", text)
        text = re.sub(r" *\n *", "\n", text)
        text = re.sub(r"\n{3,}", "\n\n", text)
    return text


def _split_text(text: str, maximum: int, mode: str, enabled: bool) -> list[str]:
    """Prefer paragraph/sentence/word breaks; edge-tts itself is UTF-8 byte-safe."""
    if not enabled or len(text) <= maximum:
        return [text]
    pieces: list[str] = []
    remaining = text
    while remaining:
        if len(remaining) <= maximum:
            pieces.append(remaining.strip())
            break
        prefix = remaining[:maximum]
        cut = maximum
        if mode != "characters":
            candidates = []
            if mode == "paragraph":
                candidates.extend(m.end() for m in re.finditer(r"\n\s*\n", prefix))
            else:
                candidates.extend(m.end() for m in re.finditer(r"[.!?؟。؛]\s+|\n", prefix))
            candidates.extend(m.end() for m in re.finditer(r"\s+", prefix))
            suitable = [position for position in candidates if position >= maximum // 2]
            if suitable:
                cut = max(suitable)
        piece = remaining[:cut].strip()
        if piece:
            pieces.append(piece)
        remaining = remaining[cut:].lstrip()
    if not pieces:
        raise ValueError("No speech segments were produced")
    if len(pieces) > MAX_PARTS:
        raise ValueError(f"Too many segments ({len(pieces)}); maximum is {MAX_PARTS}")
    return pieces


def _duration(path: Path) -> float | None:
    try:
        result = subprocess.run(
            ["ffprobe", "-v", "error", "-show_entries", "format=duration",
             "-of", "default=noprint_wrappers=1:nokey=1", str(path)],
            capture_output=True, text=True, timeout=20, check=True,
        )
        value = float(result.stdout.strip())
        return round(value, 4) if math.isfinite(value) and value > 0 else None
    except (OSError, subprocess.SubprocessError, ValueError):
        return None


def _ffmpeg(arguments: list[str], *, timeout: int = 900, cwd: Path | None = None) -> None:
    try:
        result = subprocess.run(
            ["ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error", "-y", *arguments],
            cwd=cwd, text=True, capture_output=True, timeout=timeout, check=False,
        )
    except FileNotFoundError as exc:
        raise RuntimeError("FFmpeg must be installed and available in PATH for this audio option") from exc
    except subprocess.TimeoutExpired as exc:
        raise RuntimeError("FFmpeg audio processing timed out") from exc
    if result.returncode:
        raise RuntimeError("FFmpeg audio processing failed: " + result.stderr[-1100:])


def _subtitle_time(seconds: float, *, vtt: bool) -> str:
    value = max(0, round(seconds * 1000))
    hh, value = divmod(value, 3_600_000)
    mm, value = divmod(value, 60_000)
    ss, ms = divmod(value, 1000)
    return f"{hh:02d}:{mm:02d}:{ss:02d}{'.' if vtt else ','}{ms:03d}"


def _captions(timings: list[dict[str, Any]], mode: str) -> list[dict[str, Any]]:
    if mode == "sentence":
        return [{"text": t["text"], "start": t["start"], "end": t["end"]} for t in timings]
    groups: list[dict[str, Any]] = []
    group: list[dict[str, Any]] = []
    def flush() -> None:
        if group:
            groups.append({"text": " ".join(i["text"] for i in group),
                           "start": group[0]["start"], "end": group[-1]["end"]})
            group.clear()
    for item in timings:
        if group and (item["start"] - group[-1]["end"] >= 1.0 or len(group) >= 9):
            flush()
        group.append(item)
        if re.search(r"[.!?؟。؛]$", item["text"]):
            flush()
    flush()
    return groups


def _subtitle_content(items: list[dict[str, Any]], fmt: str) -> str:
    if fmt == "json":
        return json.dumps(items, ensure_ascii=False, indent=2)
    lines = ["WEBVTT", ""] if fmt == "vtt" else []
    for i, item in enumerate(items, start=1):
        if fmt == "srt":
            lines.append(str(i))
        lines.extend([
            f"{_subtitle_time(item['start'], vtt=fmt == 'vtt')} --> "
            f"{_subtitle_time(item['end'], vtt=fmt == 'vtt')}",
            item["text"].replace("-->", "→"), "",
        ])
    return "\n".join(lines)


async def _list_voices() -> list[dict[str, Any]]:
    try:
        import edge_tts
    except ImportError as exc:
        raise RuntimeError("Install edge-tts in the active FastAPI environment") from exc
    return await edge_tts.list_voices()


def _async_run(factory: Callable[[], Any]) -> Any:
    try:
        asyncio.get_running_loop()
    except RuntimeError:
        return asyncio.run(factory())
    with ThreadPoolExecutor(max_workers=1) as executor:
        return executor.submit(lambda: asyncio.run(factory())).result()


def _resolve_voice(cfg: dict[str, Any]) -> str:
    mode = _choice(cfg, "voice_mode", {"selected", "auto"}, "selected")
    explicit = str(cfg.get("custom_voice") or cfg.get("voice") or DEFAULT_VOICE).strip()
    if mode == "selected":
        if not re.fullmatch(r"[a-z]{2,3}-[A-Za-z]{2,4}-[A-Za-z0-9]+Neural", explicit):
            raise ValueError("Voice identifier is invalid")
        return explicit
    language = str(cfg.get("language") or "ar").strip().lower()
    country = str(cfg.get("country") or "MA").strip().upper()
    gender = _choice(cfg, "gender", {"all", "Male", "Female"}, "all")
    voices = _async_run(_list_voices)
    candidates = [v for v in voices if str(v.get("Locale", "")).lower().startswith(language + "-")]
    if country != "ANY":
        regional = [v for v in candidates if str(v.get("Locale", "")).upper().endswith("-" + country)]
        if regional:
            candidates = regional
    if gender != "all":
        matching = [v for v in candidates if v.get("Gender") == gender]
        if matching:
            candidates = matching
    names = sorted(str(v.get("ShortName")) for v in candidates if v.get("ShortName"))
    if not names:
        raise ValueError("No Edge TTS voice matches the selected language")
    return names[0]


async def _generate(
    text: str, path: Path, *, voice: str, rate: int, pitch: int, volume: int,
    boundary: str, connect_timeout: int, receive_timeout: int,
) -> list[dict[str, Any]]:
    try:
        import edge_tts
    except ImportError as exc:
        raise RuntimeError(
            "edge-tts is missing from the FastAPI Python environment. "
            "Run: python -m pip install -U edge-tts"
        ) from exc
    client = edge_tts.Communicate(
        text, voice, rate=f"{rate:+d}%", pitch=f"{pitch:+d}Hz",
        volume=f"{volume - 100:+d}%", boundary=boundary,
        connect_timeout=connect_timeout, receive_timeout=receive_timeout,
    )
    timings: list[dict[str, Any]] = []
    with path.open("wb") as dest:
        async for event in client.stream():
            typ = event.get("type")
            if typ == "audio":
                dest.write(event["data"])
            elif typ in {"WordBoundary", "SentenceBoundary"}:
                start = float(event["offset"]) / TICKS_PER_SECOND
                duration = float(event["duration"]) / TICKS_PER_SECOND
                if duration > 0:
                    timings.append({"text": str(event.get("text") or ""),
                                    "start": round(start, 4), "end": round(start + duration, 4)})
    if not path.is_file() or path.stat().st_size == 0:
        raise RuntimeError("Edge TTS returned no audio")
    return timings


# The remix preview and renderer accept MP3 files only from this run's
# audio/voiceovers directory. Do not store per-clip speech under audio/.

def _clip_script(group: dict[str, Any], clip: dict[str, Any]) -> str:
    # An intentionally empty selected_text must remain silent after Split Clips.
    if "selected_text" in clip:
        return str(clip.get("selected_text") or "").strip()
    for field in ("text", "narration"):
        if isinstance(clip.get(field), str) and clip[field].strip():
            return clip[field].strip()
    if len(group.get("clips") or []) == 1:
        return str(group.get("selected_text") or "").strip()
    return ""


def _file_digest(path: Path) -> str:
    hasher = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            hasher.update(block)
    return hasher.hexdigest()


def _atomic_json(path: Path, payload: dict[str, Any]) -> None:
    temporary = path.with_name(f".{path.name}.{uuid.uuid4().hex}.tmp")
    try:
        temporary.write_text(json.dumps(payload, ensure_ascii=False, sort_keys=True), encoding="utf-8")
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def _read_voice_cache(
    path: Path, metadata: Path, fingerprint: str, clip_seconds: float
) -> tuple[float, list[dict[str, Any]]] | None:
    try:
        if path.is_symlink() or metadata.is_symlink() or not path.is_file():
            return None
        info = json.loads(metadata.read_text(encoding="utf-8"))
        if info.get("fingerprint") != fingerprint or info.get("bytes") != path.stat().st_size:
            return None
        if info.get("sha256") != _file_digest(path):
            return None
        duration = _duration(path)
        if duration is None or duration > clip_seconds + 0.12:
            return None
        timings = info.get("word_timings")
        if not isinstance(timings, list):
            return None
        return duration, timings
    except (OSError, ValueError, TypeError, KeyError):
        return None


def _atempo_filter(speedup: float) -> str:
    if not 1.0 <= speedup <= 4.0:
        raise ValueError("Narration speedup must be between 1x and 4x")
    remaining = speedup
    filters = []
    while remaining > 2.0:
        filters.append("atempo=2.0")
        remaining /= 2.0
    filters.append(f"atempo={remaining:.8f}")
    return ",".join(filters)


def _publish_clip_mp3(raw: Path, target: Path, clip_seconds: float,
                      fit: bool, max_speedup: float) -> tuple[float, float]:
    """Publish a verified MP3 atomically; never truncate spoken content."""
    original_duration = _duration(raw)
    if original_duration is None:
        raise ValueError("Edge TTS produced an unreadable MP3")
    if original_duration > clip_seconds + 0.12 and not fit:
        raise ValueError(
            f"Speech {original_duration:.2f}s exceeds clip {clip_seconds:.2f}s; "
            "enable Fit Speech to Clip or shorten the narration"
        )
    speedup = 1.0
    with tempfile.TemporaryDirectory(prefix=".edge_voice_", dir=target.parent) as folder:
        candidate = raw
        if original_duration > clip_seconds + 0.12:
            speedup = original_duration / clip_seconds
            if speedup > max_speedup + 1e-8:
                raise ValueError(
                    f"Speech {original_duration:.2f}s exceeds clip {clip_seconds:.2f}s; "
                    f"requires {speedup:.2f}x, maximum {max_speedup:.2f}x. "
                    "Increase clip duration or shorten the narration"
                )
            # Allow a little room for MP3 encoder delay; do not exceed user cap.
            speedup = min(max_speedup, speedup * 1.015)
            candidate = Path(folder) / "adjusted.mp3"
            _ffmpeg(["-i", str(raw), "-vn", "-af", _atempo_filter(speedup),
                     "-codec:a", "libmp3lame", "-b:a", "192k", str(candidate)], timeout=120)
        verified_duration = _duration(candidate)
        if verified_duration is None or verified_duration > clip_seconds + 0.12:
            raise ValueError(
                f"Speech still exceeds the {clip_seconds:.2f}s clip after processing; "
                "shorten text or extend clip duration"
            )
        temporary = Path(folder) / "published.mp3"
        shutil.copyfile(candidate, temporary)
        os.replace(temporary, target)
    return verified_duration, original_duration


def _clip_voiceovers(node: dict[str, Any], outputs: dict[str, Any], workdir: Path) -> dict[str, Any]:
    cfg = node.get("settings") or {}
    chosen_path = str(cfg.get("input_path") or "").strip()
    # Reuse the existing remix validation (unique instance_id, clip ranges,
    # manifest version) and the native upstream-input path semantics.
    manifest = _validated_clip_manifest(outputs, chosen_path)
    indexed = [
        (group, clip)
        for group in manifest["groups"]
        for clip in group["clips"]
    ]
    if sum(len(str(_clip_script(group, clip))) for group, clip in indexed) > MAX_MANAGED_CHARACTERS:
        raise ValueError("Total clip narration exceeds the 200,000-character safety limit")
    limit = _integer(cfg.get("clip_limit", 200), "Clip Limit", 1, 200)
    if not 1 <= len(indexed) <= limit:
        raise ValueError(f"Per-clip synthesis requires 1 to {limit} clips")

    voice = _resolve_voice(cfg)
    profile = _choice(cfg, "voice_profile", set(VOICE_PROFILES), "custom")
    if VOICE_PROFILES[profile] is None:
        rate = _integer(cfg.get("rate", 0), "Speed", -100, 100)
        pitch = _integer(cfg.get("pitch", 0), "Pitch", -100, 100)
        volume = _integer(cfg.get("volume", 100), "Volume", 0, 200)
    else:
        rate, pitch, volume = VOICE_PROFILES[profile]

    fit = _flag(cfg.get("fit_to_clip"), True)
    max_speedup = float(cfg.get("max_speedup", 2.0))
    if not math.isfinite(max_speedup) or not 1 <= max_speedup <= 4:
        raise ValueError("Maximum Speedup must be between 1x and 4x")
    include_timings = _flag(cfg.get("include_timestamps"), True)
    boundary_mode = _choice(cfg, "boundary_mode", {"word", "sentence"}, "word")
    clean = _flag(cfg.get("normalize_text"), True)
    allow_partial = _flag(cfg.get("allow_partial"), False)
    use_cache = _flag(cfg.get("cache_generated_audio"), True)
    retry = _flag(cfg.get("retry_on_fail"), True)
    retries = _integer(cfg.get("retry_limit_tts", 2), "Retries", 0, 5) if retry else 0
    retry_delay = _integer(cfg.get("retry_delay_seconds", 2), "Retry Delay", 0, 30)
    connect_timeout = _integer(cfg.get("connect_timeout", 10), "Connect Timeout", 3, 120)
    receive_timeout = _integer(cfg.get("receive_timeout", 60), "Receive Timeout", 10, 240)
    maximum = _integer(cfg.get("max_chars_per_clip", 5000), "Max Characters per Clip", 1, 5000)
    folder = (run_media_dir(workdir) / "audio" / "voiceovers").resolve()
    folder.mkdir(parents=True, exist_ok=True)
    workspace = Path(workdir).resolve()
    project_id, run_id = workspace.parent.parent.name, workspace.name
    if not project_id.isdecimal() or not run_id.isdecimal():
        raise ValueError("Per-clip voiceovers require a standard workflow run workspace")

    callback = node.get("_progress_callback")
    cancelled = node.get("_cancelled_callback")
    tracker = LiveItemTracker("edge_tts_clips", [
        {"id": str(clip.get("instance_id") or f"clip_{i+1}"),
         "label": f"Clip {i+1}: {str(clip.get('instance_id') or '')[:44]}"}
        for i, (_, clip) in enumerate(indexed)
    ])
    def progress(done: int, stage: str, message: str) -> None:
        if callable(callback):
            callback({"stage": stage, "message": message,
                      "progress": round(100 * done / len(indexed), 2),
                      "processed": done, "total": len(indexed), "unit": "clips",
                      "item_execution_live": tracker.snapshot(),
                      "force": stage in {"ready", "failed", "finished"} or done < 4})
    progress(0, "ready", f"{len(indexed)} clip tasks queued")

    voiceovers: list[dict[str, Any]] = []
    audio_files: list[dict[str, Any]] = []
    failed: list[dict[str, str]] = []
    skipped: list[dict[str, str]] = []
    generated = reused = 0
    seen: set[str] = set()
    for idx, (group, clip) in enumerate(indexed, 1):
        if callable(cancelled) and cancelled():
            raise RuntimeError("Edge TTS per-clip synthesis cancelled")
        ident = str(clip.get("instance_id") or "")
        if not re.fullmatch(r"[A-Za-z0-9_-]{1,120}", ident) or ident in seen:
            raise ValueError("Clip instance IDs must be unique, nonempty and safe")
        seen.add(ident)
        tracker.set(idx - 1, "running")
        progress(idx - 1, "synthesizing", f"Clip {idx}/{len(indexed)} running")
        clip.pop("voiceover", None)
        clip.pop("voiceover_error", None)
        script = _normal_text(_clip_script(group, clip), clean)
        clip["selected_text"] = script
        if not script:
            clip["voiceover_status"] = "skipped_no_text"
            tracker.set(idx - 1, "skipped")
            skipped.append({"instance_id": ident, "reason": "no_text"})
            progress(idx, "skipping", f"Clip {idx}/{len(indexed)}: no speech text")
            continue
        if len(script) > maximum:
            raise ValueError(f"Clip {ident} has {len(script)} characters (limit {maximum})")
        clip_seconds = float(clip["source_end"]) - float(clip["source_start"])
        if not 0.05 <= clip_seconds <= 86400:
            raise ValueError(f"Invalid duration for clip {ident}")

        target = folder / f"{ident}.mp3"
        metadata = folder / f"{ident}.json"
        fingerprint = hashlib.sha256(json.dumps({
            "version": 1, "instance_id": ident, "text": script,
            "clip_seconds": round(clip_seconds, 6), "voice": voice,
            "rate": rate, "pitch": pitch, "volume": volume,
            "fit": fit, "max_speedup": max_speedup,
            "boundary": boundary_mode, "include_timings": include_timings,
        }, ensure_ascii=False, sort_keys=True).encode("utf-8")).hexdigest()
        cached = _read_voice_cache(target, metadata, fingerprint, clip_seconds) if use_cache else None
        timings: list[dict[str, Any]] = []
        if cached is not None:
            duration, timings = cached
            reused += 1
            status = "reused"
        else:
            progress(idx - 1, "synthesizing", f"Generating voice for clip {idx}/{len(indexed)}")
            problem: Exception | None = None
            for attempt in range(retries + 1):
                if callable(cancelled) and cancelled():
                    raise RuntimeError("Edge TTS per-clip synthesis cancelled")
                try:
                    with tempfile.TemporaryDirectory(prefix=".edge_request_", dir=folder) as temp:
                        raw = Path(temp) / "speech.mp3"
                        raw_timings = _async_run(lambda: _generate(
                            script, raw, voice=voice, rate=rate, pitch=pitch,
                            volume=volume,
                            boundary="WordBoundary" if boundary_mode == "word" else "SentenceBoundary",
                            connect_timeout=connect_timeout, receive_timeout=receive_timeout,
                        ))
                        duration, original_duration = _publish_clip_mp3(
                            raw, target, clip_seconds, fit, max_speedup,
                        )
                        factor = duration / original_duration
                        if include_timings:
                            timings = [
                                {"text": str(t.get("text") or ""),
                                 "start": round(float(t["start"]) * factor, 4),
                                 "end": round(float(t["end"]) * factor, 4)}
                                for t in raw_timings
                            ]
                    _atomic_json(metadata, {
                        "fingerprint": fingerprint, "sha256": _file_digest(target),
                        "bytes": target.stat().st_size, "duration": duration,
                        "word_timings": timings,
                    })
                    problem = None
                    break
                except (ValueError, RuntimeError) as exc:
                    problem = exc
                    # A wrong format or an impossible speed ratio will not improve on retry.
                    if "requires" in str(exc) or "still exceeds" in str(exc) or "Enable Fit" in str(exc):
                        break
                    if attempt < retries and retry_delay:
                        time.sleep(retry_delay * (attempt + 1))
                except Exception as exc:
                    problem = exc
                    if attempt < retries and retry_delay:
                        time.sleep(retry_delay * (attempt + 1))
            if problem is not None:
                clip["voiceover_status"] = "failed"
                clip["voiceover_error"] = f"{type(problem).__name__}: {problem}"[:320]
                failed.append({"instance_id": ident, "error": clip["voiceover_error"]})
                tracker.set(idx - 1, "failed", clip["voiceover_error"])
                progress(idx, "failed", f"Clip {idx}/{len(indexed)} failed")
                if not allow_partial:
                    raise RuntimeError(
                        f"Failed voiceover for {ident}: {problem}; "
                        "previous completed clip MP3s remain cached for retry"
                    ) from problem
                continue
            generated += 1
            status = "generated"
        absolute = target.resolve()
        file_id = hashlib.sha256(str(absolute).encode("utf-8")).hexdigest()[:24]
        url = f"/api/v1/workflows/{project_id}/runs/{run_id}/audios/{file_id}"
        item = {
            "instance_id": ident, "path": str(absolute), "filename": absolute.name,
            "url": url, "mime_type": "audio/mpeg", "duration": round(duration, 4),
            "timeline_duration": round(clip_seconds, 4), "voice": voice,
            "text": script, "status": status,
        }
        if include_timings:
            item["word_timings" if boundary_mode == "word" else "sentence_timings"] = timings
        clip["voiceover"] = item
        clip["voiceover_status"] = status
        voiceovers.append(item)
        audio_files.append({
            "path": str(absolute), "filename": absolute.name, "url": url,
            "duration": item["duration"], "format": "mp3", "mime_type": "audio/mpeg",
            "instance_id": ident, "track": len(audio_files), "voice": voice,
        })
        tracker.set(idx - 1, "completed")
        progress(idx, "completed", f"Clip {idx}/{len(indexed)} ready")

    progress(len(indexed), "finished", "Clip narration tasks finished")
    if failed and not allow_partial:
        raise RuntimeError(f"{len(failed)} clip voiceovers failed")
    return {
        "status": "partial" if failed else "completed",
        "provider": "edge-tts", "voice": voice,
        "clip_manifest": manifest, "voiceovers": voiceovers,
        "audio_files": audio_files, "audio_file": audio_files[0] if audio_files else None,
        "voiceover_stats": {
            "total_clips": len(indexed), "generated": generated, "reused": reused,
            "skipped_no_text": len(skipped), "failed": len(failed),
        },
        "failed_voiceovers": failed, "skipped_voiceovers": skipped,
    }


class EdgeTTSNode(Node):
    family = "edge_tts"
    group = "Audio"
    icon = "lucide:mic-vocal"

    operations = {
        "audio.edge_tts": {
            "icon": "lucide:mic-vocal",
            "label": "Text to Speech (Edge TTS)",
            "input_types": ["text", "json"],
            "output_types": ["audio", "json", "text"],
            "settings": {
                "input_mode": "auto", "text": "", "input_field": "auto",
                "batch_mode": False, "batch_texts": "",
                "voice_mode": "selected", "language": "ar", "country": "MA",
                "gender": "all", "voice": DEFAULT_VOICE, "custom_voice": "",
                "voice_profile": "custom", "rate": 0, "pitch": 0, "volume": 100,
                "preview_only": False,
                "preview_text": "مرحباً بكم في كليبتورا، منصة إنشاء الفيديوهات.",
                "max_characters": "40000", "split_long_text": True,
                "split_by": "sentence", "chunk_size": 2000, "normalize_text": True,
                "pause_between_segments_ms": 0, "save_individual_segments": False,
                "generate_subtitles": True, "boundary_mode": "word",
                "subtitle_format": "srt", "include_timestamps": True,
                "output_format": "mp3", "sample_rate": 24000,
                "channels": "mono", "normalize_volume": False,
                "trim_silence": False, "output_filename": "speech",
                "connect_timeout": 10, "receive_timeout": 60,
                "retry_on_fail": True, "retry_limit_tts": 2,
                "retry_delay_seconds": 2, "cache_generated_audio": True,
            },
        },
        "audio.edge_tts_clips": {
            "icon": "lucide:audio-lines", "label": "Per-Clip Voice-over (Edge TTS)",
            "input_types": ["json"], "output_types": ["json", "audio"],
            "settings": {
                "input_path": "", "voice_mode": "selected",
                "language": "ar", "country": "MA", "gender": "all",
                "voice": DEFAULT_VOICE, "custom_voice": "", "voice_profile": "custom",
                "rate": 0, "pitch": 0, "volume": 100,
                "normalize_text": True, "max_chars_per_clip": 5000,
                "clip_limit": 200, "fit_to_clip": True, "max_speedup": 2.0,
                "include_timestamps": True, "boundary_mode": "word",
                "allow_partial": False, "cache_generated_audio": True,
                "connect_timeout": 10, "receive_timeout": 60,
                "retry_on_fail": True, "retry_limit_tts": 2,
                "retry_delay_seconds": 2,
            },
        },
    }

    # Declarative contracts. The actual manifest is still verified by VideoRemix.
    operations['audio.edge_tts_clips']['input_contract'] = {
        'type': 'object', 'x-semantic': 'clip_manifest', 'x-contract-version': 1,
        'properties': {
            'version': {'type': 'integer', 'const': 1},
            'groups': {'type': 'array', 'items': {'type': 'object'}},
        }, 'required': ['version', 'groups'],
    }
    operations['audio.edge_tts_clips']['output_contract'] = {
        'type': 'object', 'properties': {
            'clip_manifest': {'type': 'object', 'x-semantic': 'clip_manifest', 'x-contract-version': 1},
            'voiceovers': {'type': 'array', 'items': {'type': 'object'}},
            'audio_files': {'type': 'array', 'items': {'type': 'object'}},
        }, 'required': ['clip_manifest', 'voiceovers', 'audio_files'],
    }

    parameter_fields = {
        "audio.edge_tts": {
            "input_mode": {"type": "string", "title": "Input Mode", "enum": ["auto", "manual", "upstream"]},
            "text": {"type": "string", "title": "Text to Speak", "widget": "textarea"},
            "input_field": {"type": "string", "title": "Upstream JSON Field", "description": "auto or a dot path like output.text"},
            "batch_mode": {"type": "boolean", "title": "Batch Mode"},
            "batch_texts": {"type": "string", "title": "Batch Texts (line or JSON array)", "widget": "textarea"},
            "voice_mode": {"type": "string", "title": "Voice Selection", "enum": ["selected", "auto"]},
            "language": {"type": "string", "title": "Auto Voice Language", "enum": ["ar", "fr", "en", "es", "de", "pt", "it", "tr", "hi", "ja", "zh"]},
            "country": {"type": "string", "title": "Auto Voice Country", "description": "ISO country code, e.g. MA, FR, US; ANY for all"},
            "gender": {"type": "string", "title": "Auto Voice Gender", "enum": ["all", "Male", "Female"]},
            "voice": {"type": "string", "title": "Voice", "options": [
                {"value": name, "label": label} for name, label in VOICE_CHOICES
            ]},
            "custom_voice": {"type": "string", "title": "Custom Voice ID", "description": "Overrides Voice; useful for any voice not in the curated list"},
            "voice_profile": {"type": "string", "title": "Voice Profile", "enum": list(VOICE_PROFILES)},
            "rate": {"type": "integer", "title": "Speed (%)", "minimum": -100, "maximum": 100},
            "pitch": {"type": "integer", "title": "Pitch (Hz)", "minimum": -100, "maximum": 100},
            "volume": {"type": "integer", "title": "Volume (%)", "minimum": 0, "maximum": 200},
            "preview_only": {"type": "boolean", "title": "Generate Short Preview"},
            "preview_text": {"type": "string", "title": "Preview Phrase", "widget": "textarea"},
            "max_characters": {"type": "string", "title": "Maximum Characters", "options": [
                {"value": "5000", "label": "5,000"},
                {"value": "10000", "label": "10,000"},
                {"value": "40000", "label": "40,000 (Default)"},
                {"value": "100000", "label": "100,000"},
                {"value": "unlimited", "label": "Managed unlimited (cap 200,000)"},
            ]},
            "split_long_text": {"type": "boolean", "title": "Split Long Text Automatically"},
            "split_by": {"type": "string", "title": "Split On", "enum": ["sentence", "paragraph", "characters"]},
            "chunk_size": {"type": "integer", "title": "Characters per Segment", "minimum": 200, "maximum": 3000},
            "normalize_text": {"type": "boolean", "title": "Remove Extra Spaces"},
            "pause_between_segments_ms": {"type": "integer", "title": "Pause Between Segments (ms)", "minimum": 0, "maximum": 3000},
            "save_individual_segments": {"type": "boolean", "title": "Also Save Individual Segments"},
            "generate_subtitles": {"type": "boolean", "title": "Generate Subtitles"},
            "boundary_mode": {"type": "string", "title": "Timestamp Mode", "enum": ["word", "sentence"]},
            "subtitle_format": {"type": "string", "title": "Subtitle Format", "enum": ["srt", "vtt", "json"]},
            "include_timestamps": {"type": "boolean", "title": "Expose Timings to Next Nodes"},
            "output_format": {"type": "string", "title": "Output Format", "enum": ["mp3", "wav", "flac"]},
            "sample_rate": {"type": "integer", "title": "Sample Rate", "enum": [24000, 44100, 48000]},
            "channels": {"type": "string", "title": "Channels", "enum": ["mono", "stereo"]},
            "normalize_volume": {"type": "boolean", "title": "Normalize Volume"},
            "trim_silence": {"type": "boolean", "title": "Trim Silence", "description": "May shift subtitle timings; avoid when frame-accurate alignment is needed"},
            "output_filename": {"type": "string", "title": "Output Filename"},
            "connect_timeout": {"type": "integer", "title": "Connect Timeout (seconds)", "minimum": 3, "maximum": 120, "group": "Advanced"},
            "receive_timeout": {"type": "integer", "title": "Receive Timeout (seconds)", "minimum": 10, "maximum": 240, "group": "Advanced"},
            "retry_on_fail": {"type": "boolean", "title": "Retry Failed Segments", "group": "Advanced"},
            "retry_limit_tts": {"type": "integer", "title": "Retries per Segment", "minimum": 0, "maximum": 5, "group": "Advanced"},
            "retry_delay_seconds": {"type": "integer", "title": "Retry Delay (seconds)", "minimum": 0, "maximum": 30, "group": "Advanced"},
            "cache_generated_audio": {"type": "boolean", "title": "Reuse Generated Audio in This Run", "group": "Advanced"},
        },
        "audio.edge_tts_clips": {
            "input_path": {"type": "string", "title": "Input Data", "widget": "upstream", "accepts": ["json"]},
            "voice_mode": {"type": "string", "title": "Voice Selection", "enum": ["selected", "auto"]},
            "language": {"type": "string", "title": "Auto Voice Language", "enum": ["ar", "fr", "en", "es", "de", "pt", "it", "tr", "hi", "ja", "zh"]},
            "country": {"type": "string", "title": "Auto Voice Country", "description": "Country code MA/FR/US or ANY"},
            "gender": {"type": "string", "title": "Auto Voice Gender", "enum": ["all", "Male", "Female"]},
            "voice": {"type": "string", "title": "Voice", "options": [
                {"value": value, "label": label} for value, label in VOICE_CHOICES
            ]},
            "custom_voice": {"type": "string", "title": "Custom Voice ID"},
            "voice_profile": {"type": "string", "title": "Voice Profile", "enum": list(VOICE_PROFILES)},
            "rate": {"type": "integer", "title": "Speed (%)", "minimum": -100, "maximum": 100},
            "pitch": {"type": "integer", "title": "Pitch (Hz)", "minimum": -100, "maximum": 100},
            "volume": {"type": "integer", "title": "Volume (%)", "minimum": 0, "maximum": 200},
            "normalize_text": {"type": "boolean", "title": "Remove Extra Spaces"},
            "max_chars_per_clip": {"type": "integer", "title": "Max Characters per Clip", "minimum": 1, "maximum": 5000},
            "clip_limit": {"type": "integer", "title": "Maximum Clips per Run", "minimum": 1, "maximum": 200},
            "fit_to_clip": {"type": "boolean", "title": "Fit Speech to Clip (no truncation)"},
            "max_speedup": {"type": "number", "title": "Maximum Audio Speedup (x)", "minimum": 1, "maximum": 4},
            "include_timestamps": {"type": "boolean", "title": "Include Speech Timestamps"},
            "boundary_mode": {"type": "string", "title": "Timestamp Mode", "enum": ["word", "sentence"]},
            "allow_partial": {"type": "boolean", "title": "Continue if Some Clips Fail"},
            "cache_generated_audio": {"type": "boolean", "title": "Resume Already Generated Clips"},
            "connect_timeout": {"type": "integer", "title": "Connect Timeout", "minimum": 3, "maximum": 120, "group": "Advanced"},
            "receive_timeout": {"type": "integer", "title": "Receive Timeout", "minimum": 10, "maximum": 240, "group": "Advanced"},
            "retry_on_fail": {"type": "boolean", "title": "Retry Failed Clips", "group": "Advanced"},
            "retry_limit_tts": {"type": "integer", "title": "Retries per Clip", "minimum": 0, "maximum": 5, "group": "Advanced"},
            "retry_delay_seconds": {"type": "integer", "title": "Retry Delay", "minimum": 0, "maximum": 30, "group": "Advanced"},
        },
    }

    def execute_operation(
        self, operation: str, node: dict[str, Any], outputs: dict[str, Any],
        source: Path | None, workdir: Path,
    ) -> dict[str, Any]:
        if operation == "audio.edge_tts_clips":
            return _clip_voiceovers(node, outputs, workdir)
        if operation != "audio.edge_tts":
            raise ValueError(f"Unknown Edge TTS operation: {operation}")
        cfg = node.get("settings") or {}
        callback = node.get("_progress_callback")

        def report(stage: str, message: str, progress: float | None = None, **values: Any) -> None:
            if callable(callback):
                payload: dict[str, Any] = {"stage": stage, "message": message, **values}
                if progress is not None:
                    payload["progress"] = max(0, min(100, round(progress, 2)))
                callback(payload)

        preview = _flag(cfg.get("preview_only"), False)
        batch = _flag(cfg.get("batch_mode"), False) and not preview
        input_mode = _choice(cfg, "input_mode", {"auto", "manual", "upstream"}, "auto")
        field = str(cfg.get("input_field") or "auto").strip()
        manual = str(cfg.get("text") or "").strip()
        if preview:
            texts = [str(cfg.get("preview_text") or "").strip() or manual[:250]]
            if not texts[0]:
                raise ValueError("Preview Phrase is empty")
            texts = [texts[0][:250]]
        elif batch:
            texts = _batch_lines(cfg.get("batch_texts") or "")
            if not texts and input_mode != "manual":
                texts = _upstream_values(outputs, field, want_batch=True)
        elif input_mode == "manual":
            texts = [manual] if manual else []
        elif input_mode == "upstream":
            texts = _upstream_values(outputs, field, want_batch=False)
        else:
            texts = [manual] if manual else _upstream_values(outputs, field, want_batch=False)
        texts = [_normal_text(t, _flag(cfg.get("normalize_text"), True)) for t in texts]
        if not texts or any(not t for t in texts):
            raise ValueError("Enter text or connect a previous Node with text output")
        if len(texts) > (MAX_BATCH_ITEMS if batch else 1):
            raise ValueError(f"Batch Mode supports up to {MAX_BATCH_ITEMS} texts")

        maximum_raw = str(cfg.get("max_characters") or "40000").strip()
        if maximum_raw not in {"5000", "10000", "40000", "100000", "unlimited"}:
            raise ValueError("Maximum Characters must be 5k, 10k, 40k, 100k, or unlimited")
        maximum = MAX_MANAGED_CHARACTERS if maximum_raw == "unlimited" else int(maximum_raw)
        if any(len(t) > maximum for t in texts):
            raise ValueError(f"Text exceeds the configured {maximum:,}-character limit")
        if sum(map(len, texts)) > MAX_MANAGED_CHARACTERS:
            raise ValueError("Total Batch Text exceeds the 200,000-character safety limit")
        voice = _resolve_voice(cfg)
        profile = _choice(cfg, "voice_profile", set(VOICE_PROFILES), "custom")
        if VOICE_PROFILES[profile] is None:
            rate = _integer(cfg.get("rate", 0), "Speed", -100, 100)
            pitch = _integer(cfg.get("pitch", 0), "Pitch", -100, 100)
            volume = _integer(cfg.get("volume", 100), "Volume", 0, 200)
        else:
            rate, pitch, volume = VOICE_PROFILES[profile]

        split_enabled = _flag(cfg.get("split_long_text"), True)
        split_by = _choice(cfg, "split_by", {"sentence", "paragraph", "characters"}, "sentence")
        chunk_size = _integer(cfg.get("chunk_size", 2000), "Chunk Size", 200, 3000)
        pause_ms = _integer(cfg.get("pause_between_segments_ms", 0), "Pause", 0, 3000)
        save_parts = _flag(cfg.get("save_individual_segments"), False)
        subtitles = _flag(cfg.get("generate_subtitles"), True)
        timestamps = _flag(cfg.get("include_timestamps"), True)
        boundary = _choice(cfg, "boundary_mode", {"word", "sentence"}, "word")
        sub_format = _choice(cfg, "subtitle_format", {"srt", "vtt", "json"}, "srt")
        fmt = _choice(cfg, "output_format", {"mp3", "wav", "flac"}, "mp3")
        sample_rate = _integer(cfg.get("sample_rate", 24000), "Sample Rate", 8000, 48000)
        if sample_rate not in {24000, 44100, 48000}:
            raise ValueError("Sample Rate must be 24000, 44100 or 48000 Hz")
        channels = _choice(cfg, "channels", {"mono", "stereo"}, "mono")
        normalize = _flag(cfg.get("normalize_volume"), False)
        trim = _flag(cfg.get("trim_silence"), False)
        connect_timeout = _integer(cfg.get("connect_timeout", 10), "Connect Timeout", 3, 120)
        receive_timeout = _integer(cfg.get("receive_timeout", 60), "Receive Timeout", 10, 240)
        retry = _flag(cfg.get("retry_on_fail"), True)
        retries = _integer(cfg.get("retry_limit_tts", 2), "Retries", 0, 5) if retry else 0
        retry_delay = _integer(cfg.get("retry_delay_seconds", 2), "Retry Delay", 0, 30)
        use_cache = _flag(cfg.get("cache_generated_audio"), True)

        directory = run_media_dir(workdir) / "audio"
        directory.mkdir(parents=True, exist_ok=True)
        node_id = _safe_name(node.get("id"), "edge_tts", 48)
        basename = _safe_name(cfg.get("output_filename"), "speech", 52)
        if preview:
            basename += "_preview"
        path_parts = str(workdir).replace("\\", "/")
        match = re.search(r"/([0-9]+)/([0-9]+)/runs/([0-9]+)$", path_parts)
        url_root = (
            f"/api/v1/workflows/{match.group(2)}/runs/{match.group(3)}/audio/{node_id}"
            if match else None
        )

        parts_by_batch = [_split_text(text, chunk_size, split_by, split_enabled) for text in texts]
        tasks = [(batch_i, segment_i)
                 for batch_i, parts in enumerate(parts_by_batch)
                 for segment_i in range(len(parts))]
        tracker = LiveItemTracker("edge_tts_segments", [
            {"id": f"batch_{batch_i+1}_segment_{segment_i+1}",
             "label": f"Text {batch_i+1} · Segment {segment_i+1}"}
            for batch_i, segment_i in tasks
        ])
        tracker.emit(callback, stage="segments_ready", message=f"{len(tasks)} speech segments prepared", force=True)
        segment_offset = 0
        all_audio: list[dict[str, Any]] = []
        jobs: list[dict[str, Any]] = []
        track_index = 0
        for batch_index, text in enumerate(texts):
            parts = parts_by_batch[batch_index]
            if len(parts) > MAX_PARTS:
                raise ValueError("Too many text segments")
            track = track_index
            stem = f"{node_id}_{basename}_b{batch_index:02d}"
            target = directory / f"{stem}.{fmt}"
            captions_path = directory / f"{stem}.{sub_format}" if subtitles else None
            sidecar = directory / f"{stem}.edge-tts.json"
            signature = hashlib.sha256(json.dumps({
                "v": 3, "text": text, "parts": parts, "voice": voice, "rate": rate,
                "pitch": pitch, "volume": volume, "pause_ms": pause_ms,
                "format": fmt, "sample_rate": sample_rate, "channels": channels,
                "normalize": normalize, "trim": trim,
                "timestamps": timestamps, "boundary": boundary,
                "subtitles": subtitles, "subtitle_format": sub_format,
                "save_parts": save_parts,
            }, ensure_ascii=False, sort_keys=True).encode("utf8")).hexdigest()

            cached: dict[str, Any] | None = None
            if use_cache and target.is_file() and target.stat().st_size and sidecar.is_file():
                try:
                    data = json.loads(sidecar.read_text(encoding="utf8"))
                    result = data.get("result")
                    if data.get("signature") == signature and isinstance(result, dict):
                        entries = result.get("audio_files") or []
                        if all(isinstance(e, dict) and isinstance(e.get("path"), str) and Path(e["path"]).is_file() for e in entries):
                            if not subtitles or (captions_path and captions_path.is_file()):
                                cached = result
                except (ValueError, OSError, TypeError):
                    cached = None

            report("preparing", f"Preparing voiceover {batch_index + 1}/{len(texts)}", batch_index * 100 / len(texts),
                   batch_item=batch_index + 1, batch_total=len(texts), total_segments=len(parts))
            if cached is None:
                with tempfile.TemporaryDirectory(prefix=f".edge_tts_{node_id}_", dir=directory) as tempname:
                    tempdir = Path(tempname)
                    created: list[Path] = []
                    timings: list[dict[str, Any]] = []
                    segment_info: list[dict[str, Any]] = []
                    elapsed = 0.0
                    for segment_index, part_text in enumerate(parts):
                        task_index = segment_offset + segment_index
                        tracker.set(task_index, "running")
                        tracker.emit(callback, stage="synthesizing",
                                     message=f"Text {batch_index+1} segment {segment_index+1} running",
                                     force=task_index < 3)
                        source_mp3 = tempdir / f"part_{segment_index:03d}.mp3"
                        for attempt in range(retries + 1):
                            try:
                                report("synthesizing", f"Generating segment {segment_index + 1}/{len(parts)}",
                                       (batch_index + 0.8 * segment_index / len(parts)) * 100 / len(texts),
                                       batch_item=batch_index + 1, segment_index=segment_index + 1,
                                       total_segments=len(parts), attempt=attempt + 1)
                                new_timings = _async_run(lambda: _generate(
                                    part_text, source_mp3, voice=voice, rate=rate, pitch=pitch,
                                    volume=volume, boundary="WordBoundary" if boundary == "word" else "SentenceBoundary",
                                    connect_timeout=connect_timeout, receive_timeout=receive_timeout,
                                ))
                                break
                            except Exception:
                                source_mp3.unlink(missing_ok=True)
                                if attempt == retries:
                                    tracker.set(task_index, "failed", "Speech generation failed after retries")
                                    tracker.emit(callback, stage="synthesizing", message="Speech generation failed", force=True)
                                    raise
                                if retry_delay:
                                    time.sleep(retry_delay * (attempt + 1))
                        tracker.set(task_index, "completed")
                        tracker.emit(callback, stage="synthesizing",
                                     message=f"Speech segment {segment_index+1}/{len(parts)} ready",
                                     force=task_index < 3)
                        created.append(source_mp3)
                        seconds = _duration(source_mp3)
                        if seconds is None:
                            # edge-tts currently produces ~48 kbit/s CBR MP3.
                            seconds = source_mp3.stat().st_size / 6000.0
                        segment_info.append({
                            "index": segment_index, "text": part_text,
                            "start": round(elapsed, 4), "end": round(elapsed + seconds, 4),
                        })
                        for item in new_timings:
                            timings.append({"text": item["text"],
                                            "start": round(elapsed + item["start"], 4),
                                            "end": round(elapsed + item["end"], 4)})
                        elapsed += seconds
                        if segment_index < len(parts) - 1:
                            elapsed += pause_ms / 1000.0

                    report("processing", "Merging speech segments and applying output format",
                           (batch_index + 0.85) * 100 / len(texts), batch_item=batch_index + 1)
                    intermediate = tempdir / "assembled.mp3"
                    if len(created) == 1:
                        shutil.copyfile(created[0], intermediate)
                    else:
                        listing = tempdir / "concat.txt"
                        if pause_ms:
                            silence = tempdir / "silence.mp3"
                            _ffmpeg(["-f", "lavfi", "-i", "anullsrc=r=24000:cl=mono",
                                     "-t", str(pause_ms / 1000), "-c:a", "libmp3lame",
                                     "-ar", "24000", "-ac", "1", "-b:a", "48k", str(silence)], timeout=60)
                        lines = []
                        for idx, item in enumerate(created):
                            lines.append(f"file '{item.name}'")
                            if pause_ms and idx < len(created) - 1:
                                lines.append("file 'silence.mp3'")
                        listing.write_text("\n".join(lines) + "\n", encoding="utf-8")
                        _ffmpeg(["-f", "concat", "-safe", "1", "-i", str(listing),
                                 "-c:a", "libmp3lame", "-ar", "24000", "-ac", "1",
                                 "-b:a", "48k", str(intermediate)], timeout=1800, cwd=tempdir)

                    requires_processing = (
                        fmt != "mp3" or sample_rate != 24000 or channels != "mono"
                        or normalize or trim
                    )
                    produced = intermediate
                    if requires_processing:
                        filters: list[str] = []
                        if trim:
                            # Edge TTS metadata refers to PRE-TRIM positions.
                            filters.append("silenceremove=start_periods=1:start_duration=0.05:"
                                           "start_threshold=-50dB:stop_periods=1:stop_duration=0.15:"
                                           "stop_threshold=-50dB")
                        if normalize:
                            filters.append("loudnorm=I=-16:TP=-1.5:LRA=11")
                        produced = tempdir / f"processed.{fmt}"
                        ffargs = ["-i", str(intermediate), "-ar", str(sample_rate),
                                  "-ac", "1" if channels == "mono" else "2"]
                        if filters:
                            ffargs += ["-af", ",".join(filters)]
                        _ffmpeg([*ffargs, "-c:a", {"mp3": "libmp3lame", "wav": "pcm_s16le", "flac": "flac"}[fmt], str(produced)])
                    if not produced.is_file() or produced.stat().st_size == 0:
                        raise RuntimeError("Final audio is empty")
                    # Atomic replace only after the entire audio job has succeeded.
                    with tempfile.NamedTemporaryFile(dir=directory, prefix=".edge_out_", suffix=f".{fmt}", delete=False) as handle:
                        temp_target = Path(handle.name)
                    try:
                        shutil.copyfile(produced, temp_target)
                        temp_target.replace(target)
                    finally:
                        temp_target.unlink(missing_ok=True)
                    # Keep optional source MP3 parts as separate accessible tracks.
                    track_files = [target]
                    if save_parts:
                        for index, item in enumerate(created, start=1):
                            part_target = directory / f"{stem}_segment_{index:03d}.mp3"
                            shutil.copyfile(item, part_target)
                            track_files.append(part_target)
                    if len(track_files) + track_index > 256:
                        raise ValueError("Too many audio output tracks; disable Save Individual Segments")
                    current_audio: list[dict[str, Any]] = []
                    for item in track_files:
                        entry: dict[str, Any] = {
                            "path": str(item.resolve()), "filename": item.name,
                            "track": track_index, "format": item.suffix.lstrip("."),
                            "duration": _duration(item), "voice": voice,
                            "size_bytes": item.stat().st_size,
                        }
                        if url_root:
                            entry["url"] = f"{url_root}/{track_index}"
                        current_audio.append(entry)
                        track_index += 1
                    captions = _captions(timings, boundary) if subtitles or timestamps else []
                    words = [
                        {"id": index + 1, **item}
                        for index, item in enumerate(timings)
                    ] if boundary == "word" and timestamps else []
                    if captions_path is not None:
                        captions_path.write_text(_subtitle_content(captions, sub_format), encoding="utf8")
                    cached = {
                        "status": "completed", "provider": "edge-tts", "text": text,
                        "voice": voice, "preview": preview, "character_count": len(text),
                        "chunk_count": len(parts), "chunks": segment_info,
                        "duration": _duration(target), "format": fmt,
                        "audio": str(target.resolve()), "audio_path": str(target.resolve()),
                        "audio_file": current_audio[0], "audio_files": current_audio,
                        "words": words, "segments": captions if timestamps else [],
                        "word_count": len(words), "subtitle_format": sub_format if subtitles else None,
                        "subtitles_path": str(captions_path.resolve()) if captions_path else None,
                        "timestamps_alignment": "pre_trim" if trim else "approximate",
                        "note": "Trimming silence can shift timestamps" if trim else None,
                    }
                    sidecar.write_text(json.dumps({"signature": signature, "result": cached}, ensure_ascii=False), encoding="utf8")
            else:
                for task_index in range(segment_offset, segment_offset + len(parts)):
                    tracker.set(task_index, "completed")
                tracker.emit(callback, stage="cache_hit", message="Reused cached speech segments", force=batch_index == 0)
                # Re-map cached per-item tracks to the NEW batch track indices.
                remapped: list[dict[str, Any]] = []
                for old in cached.get("audio_files", []):
                    entry = dict(old, track=track_index)
                    if url_root:
                        entry["url"] = f"{url_root}/{track_index}"
                    remapped.append(entry)
                    track_index += 1
                cached = dict(cached, audio_files=remapped, audio_file=remapped[0])
                report("cache_hit", "Using existing generated speech", (batch_index + 1) * 100 / len(texts))
            segment_offset += len(parts)
            all_audio.extend(cached["audio_files"])
            jobs.append({**cached, "batch_index": batch_index})
            report("batch_item_completed", f"Voiceover {batch_index + 1}/{len(texts)} completed",
                   (batch_index + 1) * 100 / len(texts), batch_item=batch_index + 1, batch_total=len(texts))

        if not all_audio:
            raise RuntimeError("Edge TTS did not generate audio")
        first = jobs[0]
        result = dict(first)
        result["audio_file"] = all_audio[0]
        result["audio_files"] = all_audio
        result["batch_mode"] = batch
        result["batch_count"] = len(jobs)
        if batch:
            result["batch_items"] = jobs
        tracker.emit(callback, stage="segments_complete", message="Speech segments completed", force=True)
        report("completed", "Audio ready; open the workflow audio preview to listen", 100)
        return result

# CLIPTORA - Per-Group Continuous Edge TTS
# Append after the EdgeTTSNode class.

def _cliptora_group_tts(node, outputs, workdir):
    import hashlib
    import json
    import math
    import os
    import re
    import shutil
    import tempfile
    import time
    from pathlib import Path

    from app.workflows.InputResolver import resolve_input_path
    from app.workflows.nodes.VideoRemix import _manifest

    cfg = node.get("settings") or {}
    manifest = _manifest(outputs, str(cfg.get("input_path") or ""))
    groups = manifest["groups"]

    if not 1 <= len(groups) <= min(200, int(cfg.get("group_limit", 100))):
        raise ValueError("Invalid number of narration groups")

    narrations = None

    if cfg.get("narrations_path"):
        raw = resolve_input_path(
            outputs, str(cfg["narrations_path"])
        )
        if not isinstance(raw, list):
            raise ValueError(
                "AI narrations must be a list of {group_id, text}"
            )

        narrations = {}
        for item in raw:
            if not isinstance(item, dict) or not isinstance(
                item.get("text"), str
            ):
                raise ValueError("Invalid narration item")

            gid = str(item.get("group_id") or "")
            if gid in narrations:
                raise ValueError("Repeated group_id in AI narration")
            narrations[gid] = item["text"].strip()

        expected = {
            str(group.get("group_id")) for group in groups
        }
        if set(narrations) != expected:
            raise ValueError(
                "AI narration groups do not match the video groups"
            )

    voice = _resolve_voice(cfg)
    profile = str(cfg.get("voice_profile") or "natural")

    if profile not in VOICE_PROFILES:
        raise ValueError("Unknown voice profile")

    if VOICE_PROFILES[profile] is not None:
        rate, pitch, volume = VOICE_PROFILES[profile]
    else:
        rate = int(cfg.get("rate", 0))
        pitch = int(cfg.get("pitch", 0))
        volume = int(cfg.get("volume", 100))

    max_speedup = float(cfg.get("max_speedup", 1.5))
    if not math.isfinite(max_speedup) or not 1 <= max_speedup <= 4:
        raise ValueError("max_speedup must be between 1 and 4")

    chunk_size = int(cfg.get("chunk_size", 2000))
    if not 200 <= chunk_size <= 3000:
        raise ValueError("chunk_size must be between 200 and 3000")

    retries = (
        int(cfg.get("retry_limit_tts", 2))
        if cfg.get("retry_on_fail", True)
        else 0
    )
    if not 0 <= retries <= 5:
        raise ValueError("retry_limit_tts must be between 0 and 5")

    delay = max(
        0, min(30, int(cfg.get("retry_delay_seconds", 2)))
    )
    connect_timeout = int(cfg.get("connect_timeout", 10))
    receive_timeout = int(cfg.get("receive_timeout", 60))

    boundary = (
        "WordBoundary"
        if cfg.get("boundary_mode", "word") == "word"
        else "SentenceBoundary"
    )

    cache_enabled = bool(
        cfg.get("cache_generated_audio", True)
    )
    fit = bool(cfg.get("fit_to_group", True))
    progress = node.get("_progress_callback")
    cancelled = node.get("_cancelled_callback")
    tracker = LiveItemTracker("edge_tts_groups", [
        {"id": str(group.get("group_id") or f"group_{i+1}"),
         "label": f"Group {i+1}: {str(group.get('group_id') or '')[:40]}"}
        for i, group in enumerate(groups)
    ])
    tracker.emit(progress, stage="groups_ready", message=f"{len(groups)} narration groups prepared", force=True)

    workspace = Path(workdir).resolve()
    project_id = workspace.parent.parent.name
    run_id = workspace.name

    if not project_id.isdecimal() or not run_id.isdecimal():
        raise ValueError(
            "Expected a CLIPTORA workflow run folder"
        )

    directory = (
        run_media_dir(workspace) / "audio" / "voiceovers"
    ).resolve()
    directory.mkdir(parents=True, exist_ok=True)

    files = []
    voiceovers = []
    total_chars = 0

    for index, group in enumerate(groups, start=1):
        if callable(cancelled) and cancelled():
            raise RuntimeError("Group TTS cancelled")
        tracker.set(index - 1, "running")
        tracker.emit(progress, stage="group_narration", message=f"Group {index}/{len(groups)} running", force=index <= 3)

        gid = str(group.get("group_id") or "")
        if not re.fullmatch(r"[A-Za-z0-9_-]{1,120}", gid):
            raise ValueError("Unsafe group_id")

        if narrations is not None:
            text = narrations[gid]
        else:
            text = str(
                group.get("narration_text")
                or group.get("selected_text")
                or ""
            )

        text = _normal_text(
            text,
            bool(cfg.get("normalize_text", True)),
        )

        if not text:
            raise ValueError(f"Group {gid} has no narration")

        max_chars = int(
            cfg.get("max_chars_per_group", 20000)
        )
        if len(text) > max_chars:
            raise ValueError(
                f"Group {gid} narration is too long"
            )

        total_chars += len(text)
        if total_chars > 200000:
            raise ValueError(
                "Too many narration characters"
            )

        group_seconds = sum(
            float(clip["source_end"])
            - float(clip["source_start"])
            for clip in group["clips"]
        )

        if group_seconds <= 0:
            raise ValueError(
                f"Group {gid} has no video duration"
            )

        destination = directory / f"{gid}.mp3"
        meta_file = directory / f"{gid}.group.json"

        signature = hashlib.sha256(
            json.dumps(
                {
                    "text": text,
                    "duration": round(group_seconds, 4),
                    "voice": voice,
                    "rate": rate,
                    "pitch": pitch,
                    "volume": volume,
                    "max_speedup": max_speedup,
                    "fit": fit,
                    "boundary": boundary,
                },
                sort_keys=True,
                ensure_ascii=False,
            ).encode("utf-8")
        ).hexdigest()

        reusable = False

        if (
            cache_enabled
            and destination.is_file()
            and meta_file.is_file()
        ):
            try:
                metadata = json.loads(
                    meta_file.read_text(encoding="utf-8")
                )
                length = _duration(destination)
                reusable = (
                    metadata.get("signature") == signature
                    and length is not None
                    and length <= group_seconds + 0.12
                )
            except (ValueError, OSError):
                reusable = False

        if reusable:
            length = _duration(destination)
            status = "reused"

        else:
            if callable(progress):
                progress({
                    "stage": "synthesizing",
                    "message": f"Narrating {gid}",
                    "progress": round(
                        100 * (index - 1) / len(groups), 1
                    ),
                })

            parts = _split_text(
                text, chunk_size, "sentence", True
            )

            with tempfile.TemporaryDirectory(
                prefix="edge-group-",
                dir=directory,
            ) as tmp:
                temporary = Path(tmp)
                mp3_parts = []

                for part_index, part_text in enumerate(parts):
                    mp3 = (
                        temporary
                        / f"part_{part_index:04d}.mp3"
                    )

                    for attempt in range(retries + 1):
                        try:
                            _async_run(
                                lambda: _generate(
                                    part_text,
                                    mp3,
                                    voice=voice,
                                    rate=rate,
                                    pitch=pitch,
                                    volume=volume,
                                    boundary=boundary,
                                    connect_timeout=connect_timeout,
                                    receive_timeout=receive_timeout,
                                )
                            )
                            break

                        except Exception:
                            if attempt == retries:
                                raise
                            time.sleep(
                                delay * (attempt + 1)
                            )

                    mp3_parts.append(mp3)

                joined = temporary / "joined.mp3"

                if len(mp3_parts) == 1:
                    shutil.copyfile(
                        mp3_parts[0], joined
                    )
                else:
                    concat_list = temporary / "files.txt"
                    concat_list.write_text(
                        "\n".join(
                            f"file '{part.name}'"
                            for part in mp3_parts
                        ),
                        encoding="utf-8",
                    )

                    _ffmpeg(
                        [
                            "-f", "concat",
                            "-safe", "1",
                            "-i", str(concat_list),
                            "-codec:a", "libmp3lame",
                            "-b:a", "192k",
                            str(joined),
                        ],
                        cwd=temporary,
                    )

                original_seconds = _duration(joined)

                if original_seconds is None:
                    raise ValueError(
                        f"Unreadable voiceover for {gid}"
                    )

                candidate = joined

                if original_seconds > group_seconds + 0.12:
                    required_speed = (
                        original_seconds / group_seconds
                    )

                    if (
                        not fit
                        or required_speed > max_speedup
                    ):
                        raise ValueError(
                            f"Narration {gid}: "
                            f"{original_seconds:.2f}s "
                            f"exceeds group "
                            f"{group_seconds:.2f}s; "
                            "shorten the AI script or "
                            "increase group duration"
                        )

                    candidate = (
                        temporary / "fitted.mp3"
                    )
                    speed = min(
                        max_speedup,
                        required_speed * 1.01,
                    )

                    _ffmpeg([
                        "-i", str(joined),
                        "-af", f"atempo={speed:.8f}",
                        "-codec:a", "libmp3lame",
                        "-b:a", "192k",
                        str(candidate),
                    ])

                length = _duration(candidate)

                if (
                    length is None
                    or length > group_seconds + 0.12
                ):
                    raise ValueError(
                        f"Narration {gid} still "
                        "exceeds its group"
                    )

                staged = (
                    directory
                    / f".{gid}.{os.getpid()}.mp3"
                )

                try:
                    shutil.copyfile(
                        candidate, staged
                    )
                    os.replace(
                        staged, destination
                    )
                finally:
                    staged.unlink(missing_ok=True)

            meta_file.write_text(
                json.dumps({
                    "signature": signature,
                    "duration": length,
                }),
                encoding="utf-8",
            )
            status = "generated"

        final_path = destination.resolve()
        file_id = hashlib.sha256(
            str(final_path).encode("utf-8")
        ).hexdigest()[:24]

        url = (
            f"/api/v1/workflows/{project_id}"
            f"/runs/{run_id}/audios/{file_id}"
        )

        voiceover = {
            "group_id": gid,
            "path": str(final_path),
            "filename": destination.name,
            "url": url,
            "duration": round(length, 4),
            "mime_type": "audio/mpeg",
            "timeline_duration": round(
                group_seconds, 4
            ),
            "text": text,
            "status": status,
        }

        group["narration_text"] = text
        group["voiceover"] = voiceover

        voiceovers.append(voiceover)
        files.append({
            "group_id": gid,
            "path": str(final_path),
            "filename": destination.name,
            "url": url,
            "duration": round(length, 4),
            "format": "mp3",
            "mime_type": "audio/mpeg",
            "track": len(files),
        })

        tracker.set(index - 1, "completed")
        tracker.emit(progress, stage="group_narration",
                     message=f"Narration {index}/{len(groups)} ready", force=index <= 3)

    tracker.emit(progress, stage="groups_complete", message="Narration groups completed", force=True)
    return {
        "status": "completed",
        "provider": "edge-tts",
        "voice": voice,
        "clip_manifest": manifest,
        "voiceovers": voiceovers,
        "audio_files": files,
        "audio_file": files[0] if files else None,
    }


EdgeTTSNode.operations["audio.edge_tts_groups"] = {
    "icon": "lucide:audio-lines",
    "label": "Per-Group Continuous Voice-over (Edge TTS)",
    "input_types": ["json"],
    "output_types": ["audio", "json"],
    "settings": {
        "input_path": "",
        "narrations_path": "",
        "voice_mode": "selected",
        "voice": DEFAULT_VOICE,
        "voice_profile": "natural",
        "rate": 0,
        "pitch": 0,
        "volume": 100,
        "normalize_text": True,
        "chunk_size": 2000,
        "group_limit": 100,
        "max_chars_per_group": 20000,
        "fit_to_group": True,
        "max_speedup": 1.5,
        "cache_generated_audio": True,
        "boundary_mode": "word",
        "retry_on_fail": True,
        "retry_limit_tts": 2,
        "retry_delay_seconds": 2,
        "connect_timeout": 10,
        "receive_timeout": 60,
    },
}

EdgeTTSNode.parameter_fields["audio.edge_tts_groups"] = {
    "input_path": {
        "type": "string",
        "title": "Clip Manifest",
        "widget": "upstream",
        "accepts": ["json"],
    },
    "narrations_path": {
        "type": "string",
        "title": "AI Narrations",
        "widget": "upstream",
        "accepts": ["json"],
    },
    "voice": {
        "type": "string",
        "title": "Voice",
        "options": [
            {"value": name, "label": title}
            for name, title in VOICE_CHOICES
        ],
    },
    "voice_profile": {
        "type": "string",
        "title": "Voice Profile",
        "enum": list(VOICE_PROFILES),
    },
    "max_speedup": {
        "type": "number",
        "title": "Maximum Voice Speedup",
        "minimum": 1,
        "maximum": 4,
    },
    "chunk_size": {
        "type": "integer",
        "title": "Characters per Chunk",
        "minimum": 200,
        "maximum": 3000,
    },
    "group_limit": {
        "type": "integer",
        "title": "Maximum Groups",
        "minimum": 1,
        "maximum": 200,
    },
    "max_chars_per_group": {
        "type": "integer",
        "title": "Max Text per Group",
        "minimum": 100,
        "maximum": 40000,
    },
    "fit_to_group": {
        "type": "boolean",
        "title": "Fit Audio to Group",
    },
    "cache_generated_audio": {
        "type": "boolean",
        "title": "Reuse Cached Audio",
    },
    "rate": {
        "type": "integer",
        "title": "Speed (%)",
        "minimum": -100,
        "maximum": 100,
    },
    "pitch": {
        "type": "integer",
        "title": "Pitch (Hz)",
        "minimum": -100,
        "maximum": 100,
    },
    "volume": {
        "type": "integer",
        "title": "Volume (%)",
        "minimum": 0,
        "maximum": 200,
    },
    "retry_on_fail": {
        "type": "boolean",
        "title": "Retry Failed Audio",
    },
    "retry_limit_tts": {
        "type": "integer",
        "title": "Retries",
        "minimum": 0,
        "maximum": 5,
    },
}

_original_edge_tts_execute = EdgeTTSNode.execute_operation


def _cliptora_edge_dispatch(
    self, operation, node, outputs, source, workdir
):
    if operation == "audio.edge_tts_groups":
        return _cliptora_group_tts(
            node, outputs, workdir
        )

    return _original_edge_tts_execute(
        self, operation, node, outputs, source, workdir
    )


EdgeTTSNode.execute_operation = _cliptora_edge_dispatch
