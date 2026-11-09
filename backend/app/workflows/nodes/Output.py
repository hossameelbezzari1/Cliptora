
from __future__ import annotations

import math
import tempfile
from pathlib import Path
from typing import Any

from app.workflows.Node import Node
from app.workflows.MediaStorage import run_media_dir
from app.helpers.Transcript import get_input
from app.helpers import Media as media


def _finite_number(value: Any, label: str) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError, OverflowError) as exc:
        raise ValueError(f"Invalid {label}") from exc

    if not math.isfinite(number):
        raise ValueError(f"Invalid {label}")

    return number


def _srt_timestamp(seconds: float) -> str:
    milliseconds = max(0, round(seconds * 1000))

    hours, remainder = divmod(milliseconds, 3_600_000)
    minutes, remainder = divmod(remainder, 60_000)
    whole_seconds, milliseconds = divmod(remainder, 1000)

    return (
        f"{hours:02d}:{minutes:02d}:"
        f"{whole_seconds:02d},{milliseconds:03d}"
    )


def _caption_segments(
    captions: Any,
    fragments: list[tuple[float, float]],
) -> list[dict[str, Any]]:

    if isinstance(captions, dict):
        captions = captions.get("captions")

    if not isinstance(captions, list):
        return []

    result = []
    timeline_offset = 0.0

    for source_start, duration in fragments:
        source_end = source_start + duration

        for caption in captions:
            if not isinstance(caption, dict):
                continue

            try:
                caption_start = _finite_number(
                    caption.get("start"),
                    "caption start",
                )
                caption_end = _finite_number(
                    caption.get("end"),
                    "caption end",
                )
            except ValueError:
                continue

            overlap_start = max(source_start, caption_start)
            overlap_end = min(source_end, caption_end)

            if overlap_end <= overlap_start:
                continue

            text = ""
            words = caption.get("words")

            if isinstance(words, list):
                selected_words = []

                for word in words:
                    if not isinstance(word, dict):
                        continue

                    try:
                        word_start = _finite_number(
                            word.get("start"),
                            "word start",
                        )
                        word_end = _finite_number(
                            word.get("end"),
                            "word end",
                        )
                    except ValueError:
                        continue

                    if (
                        word_end > overlap_start
                        and word_start < overlap_end
                    ):
                        value = str(
                            word.get("text") or ""
                        ).strip()

                        if value:
                            selected_words.append(value)

                text = " ".join(selected_words)

            if not text:
                text = str(
                    caption.get("text") or ""
                ).strip()

            if not text:
                continue

            result.append({
                "start": (
                    timeline_offset
                    + overlap_start
                    - source_start
                ),
                "end": (
                    timeline_offset
                    + overlap_end
                    - source_start
                ),
                "text": text,
            })

        timeline_offset += duration

    result.sort(
        key=lambda item: (
            item["start"],
            item["end"],
        )
    )

    return result


def _write_srt(
    path: Path,
    captions: list[dict[str, Any]],
) -> None:

    lines = []

    for index, caption in enumerate(captions, start=1):
        lines.extend([
            str(index),
            (
                f"{_srt_timestamp(caption['start'])}"
                f" --> "
                f"{_srt_timestamp(caption['end'])}"
            ),
            caption["text"].replace(
                "\r", " "
            ).replace("\n", " "),
            "",
        ])

    path.write_text(
        "\n".join(lines),
        encoding="utf-8-sig",
    )


def _filter_path(path: Path) -> str:
    return (
        path.resolve()
        .as_posix()
        .replace(":", r"\:")
        .replace("'", r"\'")
    )


class OutputNode(Node):

    family = "output"
    group = "Output"
    icon = "lucide:film"

    operations = {
        "caption.generate": {
            "icon": "lucide:captions",
            "label": "Generate Captions",
            "settings": {
                "max_words": 6,
                "style": "karaoke",
            },
        },
        "video.render": {
            "icon": "lucide:film",
            "label": "Render Video",
            "settings": {
                "enabled": False,
                "aspect_ratio": "original",
                "audio_track": "0",
                "burn_captions": True,
            },
        },
    }

    parameter_fields = {
        "video.render": {
            "enabled": {
                "type": "boolean",
            },
            "aspect_ratio": {
                "type": "string",
                "enum": [
                    "original",
                    "16:9",
                    "9:16",
                    "1:1",
                ],
            },
            "audio_track": {
                "type": "string",
                "enum": [
                    "0", "1", "2", "3",
                    "4", "5", "6", "7",
                    "none",
                ],
                "group": "Audio",
            },
            "burn_captions": {
                "type": "boolean",
                "default": True,
                "group": "Captions",
            },
        },
        "caption.generate": {
            "style": {
                "type": "string",
                "enum": [
                    "karaoke",
                    "word-pop",
                    "classic",
                ],
            },
            "max_words": {
                "type": "integer",
                "minimum": 1,
                "maximum": 30,
            },
        },
    }

    @staticmethod
    def _audio_index(
        settings: dict,
        details: dict,
    ) -> int | None:

        tracks = details.get("audio") or []

        if not tracks:
            return None

        value = str(
            settings.get("audio_track", "0")
        ).strip().lower()

        if value in {"none", "off", "disabled"}:
            return None

        if not value.isdecimal():
            raise ValueError(
                "Audio track must be a nonnegative index or none"
            )

        index = int(value)

        if index >= len(tracks):
            raise ValueError(
                "Selected audio track is not available in the source video"
            )

        return index

    @staticmethod
    def _aspect_filter(aspect: str) -> str | None:

        dimensions = {
            "16:9": (1920, 1080),
            "9:16": (1080, 1920),
            "1:1": (1080, 1080),
        }

        if aspect == "original":
            return None

        width, height = dimensions[aspect]

        return (
            f"scale={width}:{height}:"
            "force_original_aspect_ratio=increase,"
            f"crop={width}:{height},"
            "setsar=1"
        )

    def execute_operation(
        self,
        operation,
        node,
        outputs,
        source,
        workdir,
    ):

        cfg = node.get("settings") or {}

        # --------------------------------------------------
        # Generate Captions
        # --------------------------------------------------

        if operation == "caption.generate":

            words = get_input(outputs, "words") or []

            max_words = int(
                cfg.get("max_words", 6)
            )

            if not 1 <= max_words <= 30:
                raise ValueError(
                    "max_words out of range"
                )

            chunks = [
                words[index:index + max_words]
                for index in range(
                    0,
                    len(words),
                    max_words,
                )
            ]

            return {
                "captions": [
                    {
                        "start": chunk[0]["start"],
                        "end": chunk[-1]["end"],
                        "text": " ".join(
                            word.get("text", "")
                            for word in chunk
                        ),
                        "words": chunk,
                    }
                    for chunk in chunks
                    if chunk
                ],
                "style": str(
                    cfg.get("style", "karaoke")
                ),
            }

        if operation != "video.render":
            raise ValueError(
                f"Unsupported output operation: {operation}"
            )

        # --------------------------------------------------
        # Render Video
        # --------------------------------------------------

        if not cfg.get("enabled", False):
            return {
                "render": {
                    "enabled": False,
                    "status": "disabled",
                }
            }

        if source is None or not source.is_file():
            raise ValueError(
                "Render Video requires a source video"
            )

        cuts = get_input(outputs, "cut_plan") or []

        if not cuts:
            raise ValueError(
                "Render Video requires a nonempty Cut Plan"
            )

        if not isinstance(cuts, list) or len(cuts) > 200:
            raise ValueError(
                "Cut Plan must contain between 1 and 200 cuts"
            )

        fragments: list[tuple[float, float]] = []

        for item in cuts:

            if not isinstance(item, dict):
                raise ValueError("Invalid cut timing")

            start = _finite_number(
                item.get("source_start"),
                "cut start",
            )

            duration = _finite_number(
                item.get("duration"),
                "cut duration",
            )

            if (
                start < 0
                or duration <= 0
                or start + duration > 86400
            ):
                raise ValueError(
                    "Invalid cut timing"
                )

            fragments.append((start, duration))

        aspect = str(
            cfg.get("aspect_ratio", "original")
        )

        if aspect not in {
            "original",
            "16:9",
            "9:16",
            "1:1",
        }:
            raise ValueError(
                "Invalid render aspect ratio"
            )

        # --------------------------------------------------
        # Probe source
        # --------------------------------------------------

        probe_error = None

        try:
            details = media.probe(source)

        except Exception as exc:
            details = {}
            probe_error = str(exc)[:240]

        source_duration = details.get("duration")

        if source_duration is not None:

            try:
                known_duration = _finite_number(
                    source_duration,
                    "source duration",
                )
            except ValueError:
                known_duration = None

            if known_duration is not None and known_duration > 0:

                if any(
                    start + duration > known_duration + 0.05
                    for start, duration in fragments
                ):
                    raise ValueError(
                        "A Cut Plan segment extends beyond the source video duration"
                    )

        audio_index = self._audio_index(
            cfg,
            details,
        )

        # --------------------------------------------------
        # Build FFmpeg filter graph
        # --------------------------------------------------

        graph = []
        concat_inputs = []

        for index, (start, duration) in enumerate(fragments):

            graph.append(
                f"[0:v:0]trim="
                f"start={start:.6f}:"
                f"duration={duration:.6f},"
                f"setpts=PTS-STARTPTS[v{index}]"
            )

            concat_inputs.append(
                f"[v{index}]"
            )

            if audio_index is not None:

                graph.append(
                    f"[0:a:{audio_index}]atrim="
                    f"start={start:.6f}:"
                    f"duration={duration:.6f},"
                    "asetpts=PTS-STARTPTS,"
                    "aformat="
                    "sample_fmts=fltp:"
                    "sample_rates=48000:"
                    "channel_layouts=stereo"
                    f"[a{index}]"
                )

                concat_inputs.append(
                    f"[a{index}]"
                )

        graph.append(
            "".join(concat_inputs)
            + (
                f"concat=n={len(fragments)}:"
                f"v=1:a={1 if audio_index is not None else 0}"
                "[outv]"
                + ("[outa]" if audio_index is not None else "")
            )
        )

        video_label = "[outv]"

        # --------------------------------------------------
        # Aspect ratio
        # --------------------------------------------------

        aspect_filter = self._aspect_filter(aspect)

        if aspect_filter:

            graph.append(
                f"{video_label}{aspect_filter}[scaledv]"
            )

            video_label = "[scaledv]"

        # --------------------------------------------------
        # Captions
        # --------------------------------------------------

        caption_output = get_input(
            outputs,
            "captions",
        )

        caption_result = next(
            (
                value
                for value in outputs.values()
                if isinstance(value, dict)
                and isinstance(value.get("captions"), list)
            ),
            None,
        )

        if isinstance(caption_result, dict):
            caption_output = caption_result.get("captions")

        burn_captions = bool(
            cfg.get("burn_captions", True)
        )

        caption_style = (
            str(caption_result.get("style") or "classic")
            if isinstance(caption_result, dict)
            else "classic"
        )

        caption_segments = (
            _caption_segments(
                caption_output,
                fragments,
            )
            if burn_captions
            else []
        )

        styles = {
            "classic": (
                "FontName=Arial,FontSize=26,"
                "PrimaryColour=&H00FFFFFF,"
                "OutlineColour=&H00000000,"
                "BorderStyle=1,Outline=2,"
                "Shadow=1,Alignment=2,MarginV=48"
            ),
            "karaoke": (
                "FontName=Arial,FontSize=30,"
                "PrimaryColour=&H00FFFFFF,"
                "OutlineColour=&H00000000,"
                "BorderStyle=1,Outline=3,"
                "Shadow=1,Alignment=2,MarginV=56"
            ),
            "word-pop": (
                "FontName=Arial,FontSize=32,"
                "PrimaryColour=&H0000FFFF,"
                "OutlineColour=&H00101010,"
                "BorderStyle=1,Outline=3,"
                "Shadow=1,Alignment=2,MarginV=60"
            ),
        }

        style = styles.get(
            caption_style,
            styles["classic"],
        )

        # --------------------------------------------------
        # Output directory
        # --------------------------------------------------

        try:
            media_run_dir = run_media_dir(workdir)

            target_dir = (
                media_run_dir / "videos"
            )

            target = target_dir / "final.mp4"

        except ValueError:
            # Support isolated node execution and unit tests.
            target_dir = Path(workdir).resolve()
            target = target_dir / "final.mp4"

        target_dir.mkdir(
            parents=True,
            exist_ok=True,
        )

        # --------------------------------------------------
        # Atomic rendering
        # --------------------------------------------------

        with tempfile.TemporaryDirectory(
            prefix="cliptora-render-",
            dir=target_dir,
        ) as temporary:

            temporary_dir = Path(temporary)

            temporary_video = (
                temporary_dir / "rendered.mp4"
            )

            if caption_segments:

                subtitle_file = (
                    temporary_dir / "captions.srt"
                )

                _write_srt(
                    subtitle_file,
                    caption_segments,
                )

                graph.append(
                    f"{video_label}"
                    f"subtitles=filename="
                    f"'{_filter_path(subtitle_file)}':"
                    f"force_style='{style}'"
                    "[captionedv]"
                )

                video_label = "[captionedv]"

            args = [
                "ffmpeg",
                "-nostdin",
                "-hide_banner",
                "-loglevel",
                "error",
                "-y",
                "-i",
                str(source),
                "-filter_complex",
                ";".join(graph),
                "-map",
                video_label,
            ]

            if audio_index is not None:
                args.extend([
                    "-map",
                    "[outa]",
                ])
            else:
                args.append("-an")

            args.extend([
                "-c:v",
                "libx264",
                "-preset",
                "medium",
                "-crf",
                "20",
                "-pix_fmt",
                "yuv420p",
            ])

            if audio_index is not None:
                args.extend([
                    "-c:a",
                    "aac",
                    "-b:a",
                    "192k",
                ])

            args.extend([
                "-movflags",
                "+faststart",
                str(temporary_video),
            ])

            media.tool(
                *args,
                timeout=3600,
            )

            if (
                not temporary_video.is_file()
                or temporary_video.stat().st_size <= 0
            ):
                raise RuntimeError(
                    "FFmpeg returned an empty video"
                )

            temporary_video.replace(target)

        # --------------------------------------------------
        # Result
        # --------------------------------------------------

        size = target.stat().st_size

        duration = round(
            sum(length for _, length in fragments),
            3,
        )

        return {
            "render": {
                "enabled": True,
                "status": "completed",
                "filename": target.name,
                "file_path": str(target),
                "video_path": str(target),
                "mime_type": "video/mp4",
                "size_bytes": size,
                "duration": duration,
                "cuts": len(fragments),
                "aspect_ratio": aspect,
                "audio_included": audio_index is not None,
                "audio_track": audio_index,
                "captions_burned": bool(caption_segments),
                "audio_warning": (
                    f"Audio metadata could not be read: {probe_error}"
                    if probe_error
                    else None
                ),
            },
            "file_path": str(target),
            "video_path": str(target),
            "mime_type": "video/mp4",
        }
