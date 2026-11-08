
from __future__ import annotations

from app.workflows.Node import Node
from app.helpers.Media import probe


class MediaNode(Node):
    family = "media"
    group = "Media"
    icon = "lucide:clapperboard"

    operations = {
        "core.video_source": {
            "icon": "lucide:video",
            "label": "Video Source",
            "settings": {
                "source_id": None,
            },
            "source_picker": True,
        },
        "media.probe": {
            "icon": "lucide:scan-search",
            "label": "Inspect Video",
            "settings": {
                "mode": "standard",
                "sections": [
                    "general",
                    "video",
                    "audio",
                    "subtitles",
                    "chapters",
                ],
                "include_tags": False,
                "include_raw": False,
            },
            "source_picker": True,
        },
    }

    _video_input = {
        "name": "video",
        "type": "media",
        "title": "Workflow video input",
        "label": "Video source",
        "accepts": ["video"],
        "required": True,
        "binding": "workflow_source",
        "preview": True,
        "description": (
            "This selects the workflow shared source video. "
            "Original files are not modified."
        ),
    }

    operations["core.video_source"]["inputs"] = [
        dict(_video_input, title="Source video")
    ]

    operations["media.probe"]["inputs"] = [
        dict(_video_input)
    ]

    parameter_fields = {
        "media.probe": {
            "mode": {
                "type": "string",
                "enum": [
                    "standard",
                    "detailed",
                ],
            },
            "sections": {
                "type": "array",
            },
            "include_tags": {
                "type": "boolean",
            },
            "include_raw": {
                "type": "boolean",
            },
            "include_empty": {
                "type": "boolean",
                "default": False,
            },
            "video_stream_index": {
                "type": "integer",
                "default": 0,
                "group": "Advanced",
            },
            "audio_stream_index": {
                "type": "integer",
                "default": 0,
                "group": "Advanced",
            },
            "timeout": {
                "type": "integer",
                "default": 120,
                "group": "Advanced",
            },
        }
    }

    def execute_operation(
        self,
        operation,
        node,
        outputs,
        source,
        workdir,
    ):
        if operation == "core.video_source":
            return self.video_source(source)

        if operation == "media.probe":
            return self.inspect_video(node, source)

        raise ValueError(
            f"Unsupported media operation: {operation}"
        )

    def video_source(self, source):
        if source is None or not source.is_file():
            raise ValueError(
                "Video Source requires a selected source video"
            )

        return {
            "video_path": str(source),
            "filename": source.name,
            "video_source": {
                "filename": source.name,
            },
        }

    def inspect_video(self, node, source):
        if source is None or not source.is_file():
            raise ValueError(
                "Inspect Video requires a selected source video"
            )

        settings = node.get("settings") or {}

        allowed = {
            "mode",
            "sections",
            "video_stream_index",
            "audio_stream_index",
            "include_tags",
            "include_raw",
            "include_empty",
            "timeout",
        }

        kwargs = {
            name: value
            for name, value in settings.items()
            if name in allowed
        }

        return {
            "probe": probe(source, **kwargs)
        }
