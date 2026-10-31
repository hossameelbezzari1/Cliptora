"""Native workflow node: MergeNode."""

from __future__ import annotations

from pathlib import Path

from typing import Any

from app.workflows.base import BaseNode

class MergeNode(BaseNode):
    type = 'flow.merge'

    @staticmethod
    def metadata() -> dict[str, Any]:
        return {
            "label": "Merge", "group": "Flow",
            "settings": {"mode": "append"},
            "parameters_schema": {"type": "object", "properties": {
                "mode": {"type": "string", "title": "Merge mode", "enum": ["append", "combine", "choose_first"]},
            }},
        }

    @staticmethod
    def execute(node: dict[str, Any], outputs: dict[str, Any], source: Path | None, workdir: Path) -> dict[str, Any]:

        cfg = node.get('settings', {})
        mode = str(cfg.get("mode", "append"))
        values = list(outputs.values())
        if len(values) < 2:
            raise ValueError("Merge requires at least two connected inputs")
        if mode == "choose_first":
            return {"items": values[0], "mode": mode, "input_count": len(values)}
        if mode == "combine":
            combined: dict[str, Any] = {}
            for dependency_id, value in outputs.items():
                if not isinstance(value, dict):
                    raise ValueError(f"Merge combine requires object input from {dependency_id}")
                combined.update(value)
            return {"items": combined, "mode": mode, "input_count": len(values)}
        if mode == "append":
            appended: list[Any] = []
            for value in values:
                candidate = value.get("items") if isinstance(value, dict) and "items" in value else value
                appended.extend(candidate if isinstance(candidate, list) else [candidate])
            return {"items": appended, "mode": mode, "input_count": len(values)}
        raise ValueError("Merge mode must be append, combine or choose_first")

# Compatibility exports for older callers and imported test utilities.
metadata = MergeNode.metadata
execute = MergeNode.execute
NODE = MergeNode.definition()
