"""Typed, multi-condition IF node. Old path/operator/value workflows remain supported."""
from __future__ import annotations

import json
import math
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from app.helpers.transcript import compare_value, input_path
from app.workflows.base import BaseNode

_MAX_CONDITIONS = 25
_MAX_VALUE_SIZE = 8192
_ALLOWED_TYPES = {"string", "number", "datetime", "boolean", "array", "object"}
_OPERATORS = {
    "string": {"truthy", "equals", "not_equals", "contains", "not_contains", "starts_with", "ends_with", "exists", "not_exists", "is_empty", "is_not_empty"},
    "number": {"truthy", "equals", "not_equals", "greater_than", "greater_or_equal", "less_than", "less_or_equal", "exists", "not_exists", "is_empty", "is_not_empty"},
    "datetime": {"truthy", "equals", "not_equals", "after", "before", "after_or_equal", "before_or_equal", "exists", "not_exists", "is_empty", "is_not_empty"},
    "boolean": {"truthy", "equals", "not_equals", "is_true", "is_false", "exists", "not_exists"},
    "array": {"truthy", "equals", "not_equals", "contains", "not_contains", "is_empty", "is_not_empty", "exists", "not_exists"},
    "object": {"truthy", "equals", "not_equals", "contains_key", "is_empty", "is_not_empty", "exists", "not_exists"},
}
_UNARY = {"truthy", "exists", "not_exists", "is_empty", "is_not_empty", "is_true", "is_false"}
_EXPRESSION = re.compile(r"^(?:=)?\{\{\s*(.*?)\s*\}\}$", re.DOTALL)


def _resolve(value: Any, outputs: dict[str, Any]) -> Any:
    """Resolve a bounded upstream path only. Never evaluate JavaScript/Python."""
    if not isinstance(value, dict):
        raise ValueError("Condition operand must be an object")
    raw = value.get("value", "")
    if not isinstance(raw, str) or len(raw) > _MAX_VALUE_SIZE:
        raise ValueError("Condition operand must be a short string")
    if value.get("mode", "fixed") == "fixed":
        return raw
    if value.get("mode") != "expression":
        raise ValueError("Operand mode must be fixed or expression")
    matched = _EXPRESSION.fullmatch(raw.strip())
    if not matched:
        raise ValueError("Use an expression like {{ $json.probe.duration }}")
    path = matched.group(1).strip()
    if path.startswith("$json."):
        if not outputs:
            return None
        # Current dependency's output; the last upstream dependency is the default.
        last_key = next(reversed(outputs))
        path = f"{last_key}.{path[6:]}"
    if path.startswith("$node."):
        path = path[6:]
    return input_path(outputs, path)


def _parse_json(raw: Any, category: str, convert: bool) -> Any:
    if isinstance(raw, (list, dict)):
        result = raw
    elif not convert or not isinstance(raw, str):
        raise ValueError(f"{category} comparison requires a JSON {category}")
    else:
        try:
            result = json.loads(raw)
        except (ValueError, TypeError) as exc:
            raise ValueError(f"{category} comparison requires valid JSON") from exc
    if category == "array" and not isinstance(result, list):
        raise ValueError("Expected a JSON array")
    if category == "object" and not isinstance(result, dict):
        raise ValueError("Expected a JSON object")
    return result


def _number(value: Any, convert: bool) -> float:
    if isinstance(value, bool) or (not isinstance(value, (int, float)) and not (convert and isinstance(value, str))):
        raise ValueError("Number comparison requires numbers (enable Convert types for text)")
    try:
        number = float(value)
    except (ValueError, OverflowError, TypeError) as exc:
        raise ValueError("Invalid numeric comparison") from exc
    if not math.isfinite(number):
        raise ValueError("Numeric values must be finite")
    return number


def _boolean(value: Any, convert: bool) -> bool:
    if isinstance(value, bool):
        return value
    if convert and isinstance(value, str) and value.strip().lower() in {"true", "false"}:
        return value.strip().lower() == "true"
    raise ValueError("Boolean comparison requires true/false (enable Convert types for text)")


def _datetime(value: Any) -> datetime:
    if not isinstance(value, str):
        raise ValueError("Date comparison requires an ISO 8601 date string")
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as exc:
        raise ValueError("Date comparison requires ISO 8601 (e.g. 2026-10-31T10:00:00Z)") from exc
    return parsed.replace(tzinfo=timezone.utc) if parsed.tzinfo is None else parsed.astimezone(timezone.utc)


def _empty(value: Any) -> bool:
    return value is None or value == "" or value == [] or value == {}


def _compare(actual: Any, expected: Any, category: str, operator: str, convert: bool, ignore_case: bool) -> bool:
    if operator == "truthy":
        return bool(actual)
    if operator == "exists":
        return actual is not None
    if operator == "not_exists":
        return actual is None
    if operator == "is_empty":
        return _empty(actual)
    if operator == "is_not_empty":
        return not _empty(actual)
    if operator in {"is_true", "is_false"}:
        return _boolean(actual, convert) is (operator == "is_true")
    if actual is None:
        return operator == "not_equals" and expected is not None

    if category == "number":
        left, right = _number(actual, convert), _number(expected, True)
        if operator == "greater_than": return left > right
        if operator == "greater_or_equal": return left >= right
        if operator == "less_than": return left < right
        if operator == "less_or_equal": return left <= right
    elif category == "datetime":
        left, right = _datetime(actual), _datetime(expected)
        if operator == "after": return left > right
        if operator == "after_or_equal": return left >= right
        if operator == "before": return left < right
        if operator == "before_or_equal": return left <= right
    elif category == "boolean":
        left, right = _boolean(actual, convert), _boolean(expected, True)
    elif category == "array":
        left = _parse_json(actual, "array", convert)
        right = _parse_json(expected, "array", True) if operator in {"equals", "not_equals"} else expected
        if operator in {"contains", "not_contains"}:
            matched = right in left
            return matched if operator == "contains" else not matched
    elif category == "object":
        left = _parse_json(actual, "object", convert)
        right = _parse_json(expected, "object", True) if operator in {"equals", "not_equals"} else expected
        if operator == "contains_key": return str(right) in left
    else:
        left, right = str(actual), str(expected)
        if ignore_case:
            left, right = left.casefold(), right.casefold()
        if operator == "contains": return right in left
        if operator == "not_contains": return right not in left
        if operator == "starts_with": return left.startswith(right)
        if operator == "ends_with": return left.endswith(right)

    if operator == "equals": return left == right
    if operator == "not_equals": return left != right
    raise ValueError(f"Unsupported {category} operator: {operator}")


class IfBranchNode(BaseNode):
    type = "flow.if"

    @staticmethod
    def metadata() -> dict[str, Any]:
        return {
            "label": "IF", "group": "Flow",
            "description": "Route a workflow using typed AND/OR conditions from upstream data.",
            # Do not modify legacy defaults, so existing saved workflows render unchanged.
            "settings": {"path": "", "operator": "truthy", "value": ""},
            "parameters_schema": {"type": "object", "properties": {
                "conditions": {"type": "array", "title": "Conditions", "description": "Up to 25 typed rules"},
                "combine": {"type": "string", "enum": ["all", "any"], "default": "all"},
                "convert_types": {"type": "boolean", "default": False},
                "ignore_case": {"type": "boolean", "default": False},
            }},
        }

    @staticmethod
    def execute(node: dict[str, Any], outputs: dict[str, Any], source: Path | None, workdir: Path) -> dict[str, Any]:
        cfg = node.get("settings", {})
        if "conditions" not in cfg:
            # Original single path/operator/value contract remains valid.
            operator = str(cfg.get("operator", "truthy"))
            path = str(cfg.get("path", ""))
            actual = input_path(outputs, path)
            condition = compare_value(actual, operator, cfg.get("value", ""))
            return {"condition": condition, "operator": operator, "path": path, "actual": actual}

        rules = cfg["conditions"]
        if not isinstance(rules, list) or not 1 <= len(rules) <= _MAX_CONDITIONS:
            raise ValueError("IF requires between 1 and 25 conditions")
        combine = cfg.get("combine", "all")
        if combine not in {"all", "any"}:
            raise ValueError("IF combine must be all or any")
        convert = cfg.get("convert_types", False)
        ignore_case = cfg.get("ignore_case", False)
        if not isinstance(convert, bool) or not isinstance(ignore_case, bool):
            raise ValueError("IF options must be booleans")

        results = []
        for index, rule in enumerate(rules):
            if not isinstance(rule, dict):
                raise ValueError(f"IF condition #{index + 1} must be an object")
            category = rule.get("type", "string")
            operator = rule.get("operator", "equals")
            if category not in _ALLOWED_TYPES or operator not in _OPERATORS[category]:
                raise ValueError(f"Invalid IF operator/type at condition #{index + 1}")
            left_operand = rule.get("left", {})
            actual = _resolve(left_operand, outputs)
            expected = None if operator in _UNARY else _resolve(rule.get("right", {}), outputs)
            # A fixed operand is entered as text in the UI and can be parsed as
            # its explicitly selected type even when upstream coercion is off.
            parse_fixed = isinstance(left_operand, dict) and left_operand.get("mode", "fixed") == "fixed"
            matched = _compare(actual, expected, category, operator, convert or parse_fixed, ignore_case)
            results.append({"index": index, "matched": matched, "type": category, "operator": operator, "actual": actual})

        condition = all(row["matched"] for row in results) if combine == "all" else any(row["matched"] for row in results)
        return {"condition": condition, "combine": combine, "conditions": results, "matched_count": sum(row["matched"] for row in results)}


metadata = IfBranchNode.metadata
execute = IfBranchNode.execute
NODE = IfBranchNode.definition()
