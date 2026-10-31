"""Native workflow node: InspectVideoNode."""

from __future__ import annotations

from pathlib import Path

from typing import Any

from app.workflows.base import BaseNode

class InspectVideoNode(BaseNode):
    type = 'media.probe'

    @staticmethod
    def metadata() -> dict[str, Any]:
        return {"label": "Inspect Video", "group": "Analysis", "settings": {}}

    @staticmethod
    def execute(node: dict[str, Any], outputs: dict[str, Any], source: Path | None, workdir: Path) -> dict[str, Any]:
        from app.helpers.media import probe
        cfg = node.get('settings', {})
        if source is None:
            raise ValueError("Select a video source first")
        return {"probe": probe(source)}

# Compatibility exports for older callers and imported test utilities.
metadata = InspectVideoNode.metadata
execute = InspectVideoNode.execute
NODE = InspectVideoNode.definition()
