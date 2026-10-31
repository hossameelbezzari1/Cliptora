"""Native workflow node: StoryboardNode."""

from __future__ import annotations

import math
from pathlib import Path

from typing import Any

from app.workflows.base import BaseNode

class StoryboardNode(BaseNode):
    type = 'animation.storyboard'

    @staticmethod
    def metadata() -> dict[str, Any]:
        return {"label": "Text Scene Storyboard", "group": "Creative", "settings": {"script": "", "scene_seconds": 4}}

    @staticmethod
    def execute(node: dict[str, Any], outputs: dict[str, Any], source: Path | None, workdir: Path) -> dict[str, Any]:

        cfg = node.get('settings', {})
        script = str(cfg.get("script", "")).strip()
        if not script:
            raise ValueError("Write a script in storyboard node settings")
        try:
            seconds = float(cfg.get("scene_seconds", 4))
        except (TypeError, ValueError) as exc:
            raise ValueError("Scene duration must be a number") from exc
        if not math.isfinite(seconds) or seconds <= 0:
            raise ValueError("Scene duration must be finite and positive")
        seconds = max(0.5, min(30.0, seconds))
        lines = [line.strip() for line in script.splitlines() if line.strip()][:100]
        return {"scenes": [{"index": i, "start": round(i * seconds, 3), "duration": seconds, "text": line} for i, line in enumerate(lines)]}

# Compatibility exports for older callers and imported test utilities.
metadata = StoryboardNode.metadata
execute = StoryboardNode.execute
NODE = StoryboardNode.definition()
