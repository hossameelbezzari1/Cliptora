"""Native workflow node: VideoSourceNode."""

from __future__ import annotations

from pathlib import Path

from typing import Any

from app.workflows.base import BaseNode

class VideoSourceNode(BaseNode):
    type = 'core.video_source'

    @staticmethod
    def metadata() -> dict[str, Any]:
        return {
            "label": "Source Video", "group": "Video & Media", "settings": {"source_id": None},
            "actions": [],
            "parameters_schema": {"type": "object", "properties": {
                "source_id": {"type": "integer", "title": "Workflow source"},
            }},
        }

    @staticmethod
    def execute(node: dict[str, Any], outputs: dict[str, Any], source: Path | None, workdir: Path) -> dict[str, Any]:

        cfg = node.get('settings', {})
        if source is None:
            raise ValueError("Source Video requires a selected video")
        return {"source": {"filename": source.name, "size_bytes": source.stat().st_size}}

# Compatibility exports for older callers and imported test utilities.
metadata = VideoSourceNode.metadata
execute = VideoSourceNode.execute
NODE = VideoSourceNode.definition()
