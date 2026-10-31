"""Native workflow node: FilterItemsNode."""

from __future__ import annotations

from pathlib import Path

from typing import Any

from app.workflows.base import BaseNode

class FilterItemsNode(BaseNode):
    type = 'data.filter'

    @staticmethod
    def metadata() -> dict[str, Any]:
        return {
            "label": "Filter", "group": "Data transformation",
            "settings": {"path": "", "field": "", "operator": "truthy", "value": ""},
            "parameters_schema": {"type": "object", "properties": {
                "path": {"type": "string", "title": "Items path", "description": "Dot path to an array, including the upstream node ID."},
                "field": {"type": "string", "title": "Item field", "description": "Optional dot path inside each item."},
                "operator": {"type": "string", "title": "Operator", "enum": ["truthy", "exists", "equals", "not_equals", "contains", "greater_than", "less_than"]},
                "value": {"type": "string", "title": "Comparison value"},
            }},
        }

    @staticmethod
    def execute(node: dict[str, Any], outputs: dict[str, Any], source: Path | None, workdir: Path) -> dict[str, Any]:
        from app.helpers.transcript import input_path, compare_value
        from app.helpers.http import value_path
        cfg = node.get('settings', {})
        items = input_path(outputs, str(cfg.get("path", "")))
        if not isinstance(items, list):
            raise ValueError("Filter items path must resolve to an array")
        if len(items) > 100_000:
            raise ValueError("Filter input exceeds 100,000 items")
        field = str(cfg.get("field", ""))
        operator = str(cfg.get("operator", "truthy"))
        kept = [item for item in items if compare_value(value_path(item, field), operator, cfg.get("value", ""))]
        return {"items": kept, "matched_count": len(kept), "input_count": len(items)}

# Compatibility exports for older callers and imported test utilities.
metadata = FilterItemsNode.metadata
execute = FilterItemsNode.execute
NODE = FilterItemsNode.definition()
