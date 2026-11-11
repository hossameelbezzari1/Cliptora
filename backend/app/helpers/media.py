"""Shared FFmpeg helpers and bounded, structured media inspection."""
from __future__ import annotations

import json
import math
import subprocess
import time
from collections import deque
from queue import Empty, Queue
from threading import Thread
from pathlib import Path
from typing import Any, Callable


def tool(*args: str, timeout: int = 120) -> str:
    """Execute a trusted local media tool with an argument list (never a shell)."""
    try:
        process = subprocess.run(
            list(args), capture_output=True, text=True, encoding="utf-8",
            errors="replace", timeout=timeout, check=False,
        )
    except FileNotFoundError as exc:
        raise RuntimeError(f"Missing media tool: {args[0]}. Install FFmpeg and add it to PATH") from exc
    except subprocess.TimeoutExpired as exc:
        raise RuntimeError(f"Media process exceeded {timeout}s") from exc
    if process.returncode != 0:
        raise RuntimeError(f"{args[0]} failed: {process.stderr[-1200:]}")
    return process.stdout


def tool_progress(
    *args: str,
    timeout: int = 3600,
    total_seconds: float | None = None,
    progress_callback: Callable[[dict[str, Any]], None] | None = None,
) -> str:
    """Execute FFmpeg and consume its machine-readable progress output."""

    if not args:
        raise ValueError("Media command is empty")

    if not isinstance(timeout, int) or timeout < 1:
        raise ValueError("Media timeout must be positive")

    duration = _number(total_seconds)

    if duration is not None and duration <= 0:
        duration = None

    try:
        process = subprocess.Popen(
            list(args),
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            encoding="utf-8",
            errors="replace",
            bufsize=1,
        )

    except FileNotFoundError as exc:
        raise RuntimeError(
            f"Missing media tool: {args[0]}. Install FFmpeg and add it to PATH"
        ) from exc

    stderr_tail = deque(maxlen=80)
    output_queue: Queue[str | None] = Queue()

    def read_stdout():
        try:
            if process.stdout is not None:
                for line in process.stdout:
                    output_queue.put(line)
        finally:
            output_queue.put(None)

    def read_stderr():
        if process.stderr is not None:
            for line in process.stderr:
                stderr_tail.append(line.rstrip())

    stdout_thread = Thread(
        target=read_stdout,
        daemon=True,
    )

    stderr_thread = Thread(
        target=read_stderr,
        daemon=True,
    )

    stdout_thread.start()
    stderr_thread.start()

    def stop_process():
        if process.poll() is None:
            try:
                process.terminate()
            except OSError:
                pass

            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                try:
                    process.kill()
                except OSError:
                    pass

                process.wait()

    started = time.monotonic()
    fields: dict[str, str] = {}

    try:
        while True:

            if time.monotonic() - started > timeout:
                raise RuntimeError(
                    f"Media process exceeded {timeout}s"
                )

            try:
                line = output_queue.get(timeout=0.25)

            except Empty:
                if process.poll() is not None and output_queue.empty():
                    break

                continue

            if line is None:
                break

            line = line.strip()

            if not line or "=" not in line:
                continue

            key, value = line.split("=", 1)
            fields[key] = value

            if key != "progress":
                continue

            processed = None

            for time_key in (
                "out_time_us",
                "out_time_ms",
            ):
                raw = fields.get(time_key)

                if raw:
                    try:
                        parsed = float(raw) / 1_000_000

                        if math.isfinite(parsed) and parsed >= 0:
                            processed = parsed
                            break

                    except (ValueError, TypeError):
                        pass

            if processed is None:
                raw = fields.get("out_time")

                if raw and raw != "N/A":
                    try:
                        hours, minutes, seconds = raw.split(":")

                        processed = (
                            float(hours) * 3600
                            + float(minutes) * 60
                            + float(seconds)
                        )

                    except (ValueError, TypeError):
                        pass

            speed = None

            speed_text = fields.get(
                "speed",
                "",
            ).strip().lower()

            if speed_text.endswith("x"):
                speed_text = speed_text[:-1]

            try:
                parsed_speed = float(speed_text)

                if math.isfinite(parsed_speed) and parsed_speed > 0:
                    speed = parsed_speed

            except (ValueError, TypeError):
                pass

            if (
                duration is not None
                and processed is not None
                and callable(progress_callback)
            ):
                processed = min(
                    duration,
                    max(0.0, processed),
                )

                percent = min(
                    99.0,
                    max(0.0, processed / duration * 100),
                )

                event = {
                    "stage": "rendering",
                    "message": "Rendering video with FFmpeg",
                    "progress": round(percent, 2),
                    "processed_seconds": round(processed, 3),
                    "total_seconds": round(duration, 3),
                    "unit": "seconds",
                }

                if speed is not None:
                    event["speed"] = round(speed, 3)

                    event["eta_seconds"] = round(
                        max(0.0, duration - processed) / speed,
                        2,
                    )

                progress_callback(event)

            fields.clear()

        return_code = process.wait(
            timeout=max(
                0.1,
                timeout - (time.monotonic() - started),
            )
        )

    except subprocess.TimeoutExpired as exc:
        stop_process()

        raise RuntimeError(
            f"Media process exceeded {timeout}s"
        ) from exc

    except BaseException:
        stop_process()
        raise

    finally:
        stdout_thread.join(timeout=1)
        stderr_thread.join(timeout=1)

        for stream in (
            process.stdout,
            process.stderr,
        ):
            if stream is not None:
                stream.close()

    if return_code != 0:
        details = "\n".join(stderr_tail).strip()

        if not details:
            details = f"exit code {return_code}"

        raise RuntimeError(
            f"{args[0]} failed: {details[-1200:]}"
        )

    return ""


def _number(value: Any) -> float | None:
    try:
        result = float(value)
        return result if math.isfinite(result) else None
    except (ValueError, TypeError, OverflowError):
        return None


def _integer(value: Any) -> int | None:
    number = _number(value)
    return int(number) if number is not None else None


def _ratio(value: Any) -> float | None:
    if value is None or (isinstance(value, str) and value in {"0/0", "N/A", "0:0"}):
        return None
    if isinstance(value, str) and "/" in value:
        left, right = value.split("/", 1)
        denominator = _number(right)
        numerator = _number(left)
        return numerator / denominator if numerator is not None and denominator else None
    return _number(value)


def _tags(value: Any) -> dict[str, str]:
    if not isinstance(value, dict):
        return {}
    # Containers can embed very long user-provided metadata: never expose it unbounded.
    return {str(k)[:100]: str(v)[:2000] for k, v in list(value.items())[:60]}


def _orientation(width: int, height: int) -> str | None:
    if not width or not height:
        return None
    if width == height:
        return "square"
    return "landscape" if width > height else "portrait"


def _stream_info(stream: dict[str, Any], include_tags: bool, quick: bool) -> dict[str, Any]:
    codec_type = stream.get("codec_type")
    tags = _tags(stream.get("tags"))
    disposition = stream.get("disposition") or {}
    data: dict[str, Any] = {
        "index": _integer(stream.get("index")),
        "type": codec_type,
        "codec": stream.get("codec_name"),
        "codec_long_name": stream.get("codec_long_name") if not quick else None,
        "duration": _number(stream.get("duration")),
        "bitrate": _integer(stream.get("bit_rate")),
        "language": tags.get("language"),
        "title": tags.get("title"),
        "default": bool(disposition.get("default")),
        "forced": bool(disposition.get("forced")),
    }
    if codec_type == "video":
        width = _integer(stream.get("width")) or 0
        height = _integer(stream.get("height")) or 0
        rotation = _integer(tags.get("rotate"))
        for item in stream.get("side_data_list") or []:
            if isinstance(item, dict) and "rotation" in item:
                rotation = _integer(item["rotation"])
        if rotation is None:
            rotation = 0
        rotation %= 360
        display_width, display_height = (height, width) if rotation in (90, 270) else (width, height)
        transfer = stream.get("color_transfer")
        data.update({
            "width": width,
            "height": height,
            "display_width": display_width,
            "display_height": display_height,
            "orientation": _orientation(display_width, display_height),
            "rotation": rotation,
            "fps": _ratio(stream.get("avg_frame_rate")) or _ratio(stream.get("r_frame_rate")),
            "frame_rate": stream.get("avg_frame_rate") or stream.get("r_frame_rate"),
            "aspect_ratio": stream.get("display_aspect_ratio") or (f"{display_width}:{display_height}" if display_height else None),
            "frame_count": _integer(stream.get("nb_frames")),
            "profile": stream.get("profile"),
            "pixel_format": stream.get("pix_fmt"),
            "bit_depth": _integer(stream.get("bits_per_raw_sample")),
            "color_space": stream.get("color_space"),
            "color_primaries": stream.get("color_primaries"),
            "color_transfer": transfer,
            "is_hdr": transfer in {"smpte2084", "arib-std-b67"} if transfer is not None else None,
        })
    elif codec_type == "audio":
        data.update({
            "sample_rate": _integer(stream.get("sample_rate")),
            "channels": _integer(stream.get("channels")),
            "channel_layout": stream.get("channel_layout"),
            "sample_format": stream.get("sample_fmt"),
        })
    if include_tags:
        data["tags"] = tags
    if quick:
        allowed = {"index", "type", "codec", "duration", "width", "height", "fps", "channels", "sample_rate", "language"}
        data = {key: value for key, value in data.items() if key in allowed}
    return data


def probe(
    source: Path,
    *,
    mode: str = "standard",
    sections: list[str] | None = None,
    video_stream_index: int = -1,
    audio_stream_index: int = -1,
    include_tags: bool = False,
    include_raw: bool = False,
    include_empty: bool = False,
    timeout: int = 120,
) -> dict[str, Any]:
    """Inspect without decoding or altering media. Legacy fields are always returned.

    The indexes refer to ffprobe's absolute stream indexes, not list offsets.
    No heavy frame/scene/audio scan is executed in this metadata node.
    """
    if mode not in {"quick", "standard"}:
        raise ValueError("Inspection mode must be quick or standard")
    valid_sections = {"general", "video", "audio", "subtitles", "chapters"}
    selected = set(sections if sections is not None else valid_sections)
    if not selected <= valid_sections or not selected:
        raise ValueError("Select at least one supported metadata section")
    if not isinstance(timeout, int) or not 5 <= timeout <= 300:
        raise ValueError("FFprobe timeout must be between 5 and 300 seconds")
    for index in (video_stream_index, audio_stream_index):
        if not isinstance(index, int) or index < -1 or index > 256:
            raise ValueError("Invalid stream index")
    if not source.is_file():
        raise ValueError("Selected video source is missing")

    raw_text = tool("ffprobe", "-v", "error", "-show_format", "-show_streams", "-show_chapters", "-of", "json", str(source), timeout=timeout)
    if len(raw_text) > 4_000_000:
        raise ValueError("Media metadata is too large")
    parsed = json.loads(raw_text)
    if not isinstance(parsed, dict):
        raise ValueError("Invalid ffprobe response")
    streams = [s for s in parsed.get("streams", []) if isinstance(s, dict)]
    fmt = parsed.get("format") if isinstance(parsed.get("format"), dict) else {}
    raw_videos = [s for s in streams if s.get("codec_type") == "video"]
    raw_audios = [s for s in streams if s.get("codec_type") == "audio"]
    raw_subtitles = [s for s in streams if s.get("codec_type") == "subtitle"]

    def choose(items: list[dict[str, Any]], wanted: int, label: str) -> dict[str, Any]:
        if wanted < 0:
            return next((item for item in items if (item.get("disposition") or {}).get("default")), items[0] if items else {})
        found = next((item for item in items if _integer(item.get("index")) == wanted), None)
        if found is None:
            raise ValueError(f"{label} stream index {wanted} does not exist")
        return found

    primary_video = choose(raw_videos, video_stream_index, "Video")
    primary_audio = choose(raw_audios, audio_stream_index, "Audio")
    duration = _number(fmt.get("duration"))
    if duration is None:
        duration = max((_number(s.get("duration")) or 0 for s in streams), default=0)
    duration = max(duration, 0)
    file_size = _integer(fmt.get("size"))
    if file_size is None:
        file_size = source.stat().st_size
    width = _integer(primary_video.get("width")) or 0
    height = _integer(primary_video.get("height")) or 0
    quick = mode == "quick"
    videos = [_stream_info(s, include_tags, quick) for s in raw_videos]
    audios = [_stream_info(s, include_tags, quick) for s in raw_audios]
    subtitles = [_stream_info(s, include_tags, quick) for s in raw_subtitles]
    chapters = []
    for item in parsed.get("chapters", []):
        if not isinstance(item, dict):
            continue
        tags = _tags(item.get("tags"))
        chapters.append({
            "id": _integer(item.get("id")), "start": _number(item.get("start_time")),
            "end": _number(item.get("end_time")), "title": tags.get("title"),
            **({"tags": tags} if include_tags else {}),
        })
    warnings: list[str] = []
    if not raw_videos:
        warnings.append("No video stream was detected")
    if not raw_audios:
        warnings.append("No audio stream was detected")
    if duration <= 0:
        warnings.append("Container duration is unavailable")

    result: dict[str, Any] = {
        "duration": round(duration, 6), "width": width, "height": height,
        "has_audio": bool(raw_audios), "bytes": file_size,
        "inspection_mode": mode,
        "format": {
            "container": fmt.get("format_name"),
            "long_name": fmt.get("format_long_name") if not quick else None,
            "bitrate": _integer(fmt.get("bit_rate")),
            "start_time": _number(fmt.get("start_time")),
            "filename": source.name,
            **({"tags": _tags(fmt.get("tags"))} if include_tags else {}),
        } if "general" in selected else None,
        "video": (_stream_info(primary_video, include_tags, quick) if primary_video else None) if "video" in selected else None,
        "videos": videos if "video" in selected else [],
        "audio": audios if "audio" in selected else [],
        "audio_primary": (_stream_info(primary_audio, include_tags, quick) if primary_audio else None) if "audio" in selected else None,
        "subtitles": subtitles if "subtitles" in selected else [],
        "chapters": chapters if "chapters" in selected else [],
        "stream_counts": {"video": len(raw_videos), "audio": len(raw_audios), "subtitles": len(raw_subtitles)},
        "warnings": warnings,
    }
    if include_raw and not quick:
        # Never return an absolute storage path through the artifact API.
        parsed.get("format", {}).update({"filename": source.name})
        result["raw_ffprobe"] = parsed
    if not include_empty:
        def compact(value: Any) -> Any:
            if isinstance(value, dict):
                return {key: compact(item) for key, item in value.items() if item is not None}
            if isinstance(value, list):
                return [compact(item) for item in value]
            return value

        result = compact(result)
    return result
