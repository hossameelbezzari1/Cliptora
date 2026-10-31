"""Native workflow node: IfBranchNode."""

from __future__ import annotations

from pathlib import Path

from typing import Any

from app.workflows.base import BaseNode

class IfBranchNode(BaseNode):
    type = 'flow.if'

    @staticmethod
    def metadata() -> dict[str, Any]:
        return {
            "label": "IF", "group": "Flow",
            "settings": {"path": "", "operator": "truthy", "value": ""},
            "parameters_schema": {"type": "object", "properties": {
                "path": {"type": "string", "title": "Input path"},
                "operator": {"type": "string", "title": "Operator", "enum": ["truthy", "exists", "equals", "not_equals", "contains", "greater_than", "less_than"]},
                "value": {"type": "string", "title": "Comparison value"},
            }},
        }

    @staticmethod
    def execute(node: dict[str, Any], outputs: dict[str, Any], source: Path | None, workdir: Path) -> dict[str, Any]:
        from app.helpers.transcript import input_path, compare_value
        cfg = node.get('settings', {})
        operator = str(cfg.get("operator", "truthy"))
        actual = input_path(outputs, str(cfg.get("path", "")))
        condition = compare_value(actual, operator, cfg.get("value", ""))
        return {"condition": condition, "operator": operator, "path": str(cfg.get("path", "")), "actual": actual}

# Compatibility exports for older callers and imported test utilities.
metadata = IfBranchNode.metadata
execute = IfBranchNode.execute
NODE = IfBranchNode.definition()
