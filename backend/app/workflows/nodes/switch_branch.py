"""Native workflow node: SwitchBranchNode."""

from __future__ import annotations

from pathlib import Path

from typing import Any

from app.workflows.base import BaseNode

class SwitchBranchNode(BaseNode):
    type = 'flow.switch'

    @staticmethod
    def metadata() -> dict[str, Any]:
        return {
            "label": "Switch", "group": "Flow",
            "settings": {"path": "", "operator": "equals", "rules": [{"value": "", "route": 0}]},
            "parameters_schema": {"type": "object", "properties": {
                "path": {"type": "string", "title": "Input path", "description": "Dot path including the upstream node ID."},
                "operator": {"type": "string", "title": "Operator", "enum": ["equals", "not_equals", "contains", "greater_than", "less_than", "exists", "truthy"]},
                "rules": {"type": "array", "title": "Routing rules", "description": "Ordered JSON rules: [{\"value\":\"paid\",\"route\":0}]. Routes 0-4 are supported."},
            }},
        }

    @staticmethod
    def execute(node: dict[str, Any], outputs: dict[str, Any], source: Path | None, workdir: Path) -> dict[str, Any]:
        from app.helpers.transcript import input_path, compare_value
        cfg = node.get('settings', {})
        actual = input_path(outputs, str(cfg.get("path", "")))
        operator = str(cfg.get("operator", "equals"))
        rules = cfg.get("rules", [])
        if not isinstance(rules, list) or not 1 <= len(rules) <= 20:
            raise ValueError("Switch requires between 1 and 20 rules")
        route = None
        for rule in rules:
            if not isinstance(rule, dict) or not isinstance(rule.get("route"), int) or not 0 <= rule["route"] <= 4:
                raise ValueError("Switch routes must be integers from 0 to 4")
            if compare_value(actual, operator, rule.get("value", "")):
                route = rule["route"]
                break
        return {"route": route, "matched": route is not None, "operator": operator, "actual": actual}

# Compatibility exports for older callers and imported test utilities.
metadata = SwitchBranchNode.metadata
execute = SwitchBranchNode.execute
NODE = SwitchBranchNode.definition()
