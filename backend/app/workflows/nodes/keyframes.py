"""Native workflow node: KeyframesNode."""

from __future__ import annotations

from pathlib import Path

from typing import Any

from app.workflows.base import BaseNode

class KeyframesNode(BaseNode):
    type = 'animation.keyframes'

    @staticmethod
    def metadata() -> dict[str, Any]:
        return {"label": "Build Keyframe Plan", "group": "Creative", "settings": {"preset": "fade-pop"}}

    @staticmethod
    def execute(node: dict[str, Any], outputs: dict[str, Any], source: Path | None, workdir: Path) -> dict[str, Any]:
        from app.helpers.transcript import get_input
        cfg = node.get('settings', {})
        scenes = get_input(outputs, "scenes")
        if not scenes:
            raise ValueError("Keyframes requires storyboard")
        preset = str(cfg.get("preset", "fade-pop"))
        return {"keyframes": [{"scene": scene["index"], "start": scene["start"], "duration": scene["duration"], "text": scene["text"], "preset": preset, "from": {"opacity": 0, "scale": 0.88}, "to": {"opacity": 1, "scale": 1.0}} for scene in scenes]}

# Compatibility exports for older callers and imported test utilities.
metadata = KeyframesNode.metadata
execute = KeyframesNode.execute
NODE = KeyframesNode.definition()
