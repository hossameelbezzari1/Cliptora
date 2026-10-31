"""Native workflow node: CreateCutPlanNode."""

from __future__ import annotations

import math
from pathlib import Path

from typing import Any

from app.workflows.base import BaseNode

class CreateCutPlanNode(BaseNode):
    type = 'timeline.cut_plan'

    @staticmethod
    def metadata() -> dict[str, Any]:
        return {"label": "Create Non-Destructive Cuts", "group": "Editing", "settings": {"padding": 0.15}}

    @staticmethod
    def execute(node: dict[str, Any], outputs: dict[str, Any], source: Path | None, workdir: Path) -> dict[str, Any]:
        from app.helpers.transcript import MAX_CUTS, get_input
        cfg = node.get('settings', {})
        highlights = get_input(outputs, "highlights") or []
        if not highlights:
            raise ValueError("Cut plan requires highlights")
        try:
            padding = float(cfg.get("padding", 0.15))
        except (TypeError, ValueError) as exc:
            raise ValueError("Cut padding must be a number") from exc
        if not math.isfinite(padding):
            raise ValueError("Cut padding must be finite")
        padding = max(0, min(1.5, padding))
        source_duration = (get_input(outputs, "probe") or {}).get("duration")
        if source_duration is not None:
            source_duration = float(source_duration)
            if not math.isfinite(source_duration) or source_duration <= 0:
                raise ValueError("Source video duration is invalid")
        cuts = []
        at = 0.0
        for index, h in enumerate(highlights[:MAX_CUTS]):
            try:
                start = float(h["start"])
                end = float(h["end"])
            except (KeyError, TypeError, ValueError) as exc:
                raise ValueError(f"Invalid highlight timing at index {index}") from exc
            if not math.isfinite(start) or not math.isfinite(end) or start < 0 or end <= start:
                raise ValueError(f"Invalid highlight timing at index {index}")
            beginning = max(0.0, start - padding)
            ending = end + padding
            if source_duration is not None:
                if beginning >= source_duration:
                    continue
                ending = min(source_duration, ending)
            if ending <= beginning:
                continue
            length = round(ending - beginning, 3)
            if length <= 0:
                continue
            cuts.append({"source_start": round(beginning, 3), "source_end": round(ending, 3), "timeline_start": round(at, 3), "duration": length, "reason": h.get("reason", "")})
            at += length
        return {"cut_plan": cuts, "output_duration": round(at, 3)}

# Compatibility exports for older callers and imported test utilities.
metadata = CreateCutPlanNode.metadata
execute = CreateCutPlanNode.execute
NODE = CreateCutPlanNode.definition()
