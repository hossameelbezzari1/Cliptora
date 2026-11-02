
"""CLIPTORA - Inspect Video Node."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from app.workflows.base import BaseNode

DEFAULT_SECTIONS = [
    "general",
    "video",
    "audio",
    "subtitles",
    "chapters",
]


def first_value(*values: Any) -> Any:
    for value in values:
        if value is not None and value != "":
            return value
    return None


def as_dict(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def as_list(value: Any) -> list[Any]:
    return value if isinstance(value, list) else []


def to_number(value: Any) -> int | float | None:
    if value is None:
        return None

    try:
        if isinstance(value, str) and "/" in value:
            numerator, denominator = value.split("/", 1)
            denominator_float = float(denominator)

            if denominator_float == 0:
                return None

            number = float(numerator) / denominator_float
        else:
            number = float(value)

        if not (
            float("-inf") < number < float("inf")
        ):
            return None

        if number.is_integer():
            return int(number)

        return round(number, 4)
    except (ValueError, TypeError, OverflowError):
        return None


def clean(value: Any, include_empty: bool = False) -> Any:
    if isinstance(value, dict):
        result = {
            key: clean(item, include_empty)
            for key, item in value.items()
            if include_empty or item is not None
        }

        return result

    if isinstance(value, list):
        return [
            clean(item, include_empty)
            for item in value
        ]

    return value


def extract_source_id(
    node: dict[str, Any],
    outputs: dict[str, Any],
) -> Any:
    candidates = [
        node.get("source_id"),
        as_dict(node.get("settings")).get("source_id"),
        as_dict(node.get("data")).get("source_id"),
    ]

    for key in ("source", "video_source", "input"):
        value = outputs.get(key)

        if isinstance(value, dict):
            candidates.extend([
                value.get("source_id"),
                as_dict(value.get("source")).get("id"),
            ])

    candidates.append(outputs.get("source_id"))

    return first_value(*candidates)


class InspectVideoNode(BaseNode):
    type = "media.probe"

    @staticmethod
    def metadata() -> dict[str, Any]:
        return {
            "label": "Inspect Video",
            "description": (
                "Inspect video, audio, subtitles and "
                "container metadata without modifying "
                "the original media."
            ),
            "group": "Analysis",
            "settings": {
                "mode": "standard",
                "sections": DEFAULT_SECTIONS.copy(),
                "video_stream_index": -1,
                "audio_stream_index": -1,
                "include_tags": False,
                "include_raw": False,
                "include_empty": False,
                "timeout_seconds": 120,
            },
            "parameters_schema": {
                "type": "object",
                "properties": {
                    "mode": {
                        "type": "string",
                        "title": "Inspection mode",
                        "enum": ["quick", "standard"],
                    },
                    "sections": {
                        "type": "array",
                        "title": "Metadata sections",
                        "items": {
                            "type": "string",
                            "enum": DEFAULT_SECTIONS,
                        },
                    },
                    "video_stream_index": {
                        "type": "integer",
                        "title": "Video stream index",
                        "minimum": -1,
                    },
                    "audio_stream_index": {
                        "type": "integer",
                        "title": "Audio stream index",
                        "minimum": -1,
                    },
                    "include_tags": {
                        "type": "boolean",
                        "title": "Include metadata tags",
                    },
                    "include_raw": {
                        "type": "boolean",
                        "title": "Include raw FFprobe JSON",
                    },
                    "include_empty": {
                        "type": "boolean",
                        "title": "Include null fields",
                    },
                    "timeout_seconds": {
                        "type": "integer",
                        "title": "FFprobe timeout",
                        "minimum": 5,
                        "maximum": 300,
                    },
                },
            },
            "output_types": ["application/json"],
        }

    @staticmethod
    def execute(
        node: dict[str, Any],
        outputs: dict[str, Any],
        source: Path | None,
        workdir: Path,
    ) -> dict[str, Any]:

        from app.helpers.media import probe

        if source is None:
            raise ValueError(
                "Inspect Video requires a video source."
            )

        source = Path(source)

        if not source.is_file():
            raise FileNotFoundError(
                f"Video source not found: {source}"
            )

        cfg = as_dict(node.get("settings"))

        sections = cfg.get(
            "sections",
            DEFAULT_SECTIONS.copy(),
        )

        if (
            not isinstance(sections, list)
            or any(
                not isinstance(section, str)
                for section in sections
            )
            or any(
                section not in DEFAULT_SECTIONS
                for section in sections
            )
        ):
            raise ValueError(
                "Invalid metadata sections."
            )

        include_empty = cfg.get("include_empty") is True
        include_tags = cfg.get("include_tags") is True
        include_raw = cfg.get("include_raw") is True

        metadata = probe(
            source,
            mode=str(cfg.get("mode", "standard")),
            sections=sections,
            video_stream_index=int(
                cfg.get("video_stream_index", -1)
            ),
            audio_stream_index=int(
                cfg.get("audio_stream_index", -1)
            ),
            include_tags=include_tags,
            include_raw=include_raw,
            include_empty=include_empty,
            timeout=int(
                cfg.get("timeout_seconds", 120)
            ),
        )

        if not isinstance(metadata, dict):
            raise ValueError(
                "FFprobe returned an invalid result."
            )

        # Support both flat and nested probe responses.
        probe_data = as_dict(
            metadata.get("probe", metadata)
        )

        general = as_dict(
            first_value(
                probe_data.get("general"),
                probe_data.get("format"),
                {},
            )
        )

        video_data = as_dict(
            first_value(
                probe_data.get("video"),
                {},
            )
        )

        streams = as_list(
            probe_data.get("streams")
        )

        video_streams = [
            stream
            for stream in streams
            if isinstance(stream, dict)
            and stream.get("codec_type") == "video"
        ]

        audio_streams_raw = as_list(
            first_value(
                probe_data.get("audio_streams"),
                probe_data.get("audio"),
                [],
            )
        )

        audio_streams_raw = [
            stream
            for stream in audio_streams_raw
            if isinstance(stream, dict)
        ]

        if not audio_streams_raw:
            audio_streams_raw = [
                stream
                for stream in streams
                if isinstance(stream, dict)
                and stream.get("codec_type") == "audio"
            ]

        if not video_data and video_streams:
            video_data = video_streams[0]

        video = {
            "filename": source.name,
            "duration": to_number(
                first_value(
                    video_data.get("duration"),
                    general.get("duration"),
                    probe_data.get("duration"),
                )
            ),
            "width": to_number(
                first_value(
                    video_data.get("width"),
                    probe_data.get("width"),
                )
            ),
            "height": to_number(
                first_value(
                    video_data.get("height"),
                    probe_data.get("height"),
                )
            ),
            "fps": to_number(
                first_value(
                    video_data.get("fps"),
                    video_data.get("avg_frame_rate"),
                    video_data.get("r_frame_rate"),
                    probe_data.get("fps"),
                )
            ),
            "codec": first_value(
                video_data.get("codec"),
                video_data.get("codec_name"),
                probe_data.get("codec"),
            ),
            "format": first_value(
                general.get("format"),
                general.get("format_name"),
                probe_data.get("container"),
                source.suffix.lstrip(".").lower(),
            ),
        }

        normalized_audio = []

        for stream in audio_streams_raw:
            normalized_audio.append(
                clean(
                    {
                        "index": first_value(
                            stream.get("index"),
                            stream.get("stream_index"),
                        ),
                        "codec": first_value(
                            stream.get("codec"),
                            stream.get("codec_name"),
                        ),
                        "channels": to_number(
                            stream.get("channels")
                        ),
                        "sample_rate": to_number(
                            stream.get("sample_rate")
                        ),
                    },
                    include_empty,
                )
            )

        result: dict[str, Any] = {
            "status": "completed",
            "source_id": extract_source_id(
                node, outputs
            ),
            "video": clean(
                video,
                include_empty,
            ),
            "audio_streams": normalized_audio,
        }

        if "general" in sections:
            result["general"] = clean(
                general,
                include_empty,
            )

        if "subtitles" in sections:
            subtitles = first_value(
                probe_data.get("subtitles"),
                probe_data.get("subtitle_streams"),
                [
                    stream
                    for stream in streams
                    if isinstance(stream, dict)
                    and stream.get("codec_type")
                    == "subtitle"
                ],
            )
            result["subtitles"] = subtitles

        if "chapters" in sections:
            result["chapters"] = as_list(
                probe_data.get("chapters")
            )

        if include_tags:
            result["tags"] = first_value(
                probe_data.get("tags"),
                general.get("tags"),
                {},
            )

        if include_raw:
            result["raw"] = metadata

        return clean(result, include_empty)


metadata = InspectVideoNode.metadata
execute = InspectVideoNode.execute
NODE = InspectVideoNode.definition()
