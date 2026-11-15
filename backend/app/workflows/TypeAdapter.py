
"""CLIPTORA Dynamic Type Engine nodes. Discovered automatically by Registry.

Inspect → suggest → map/convert → validate, without executable expressions.
No built-in dependency on particular video/AI node names or fixed type lists.
"""
from __future__ import annotations

from copy import deepcopy
from pathlib import Path
from typing import Any

from app.workflows.Node import Node
from app.workflows.InputResolver import resolve_input_path
from app.workflows.TypeEngine import (
    TypeContractError, describe, discover_schema, validate_value,
    validate_mapping, map_value, suggest_mapping,
)


def _object(value: Any, label: str) -> dict:
    if not isinstance(value, dict):
        raise TypeContractError(f"{label} must be a JSON object")
    return value


def _render(template: Any, value: Any, depth: int = 0) -> Any:
    """Only the exact token '$items' is substituted; no eval/interpolation."""
    if depth > 9:
        raise TypeContractError("Output template exceeds maximum depth")
    if template == "$items":
        return deepcopy(value)
    if isinstance(template, list):
        return [_render(x, value, depth + 1) for x in template]
    if isinstance(template, dict):
        from app.workflows.TypeEngine import SAFE_KEY, BLOCKED_KEYS
        if any(
            not isinstance(k, str)
            or not SAFE_KEY.fullmatch(k)
            or k in BLOCKED_KEYS
            for k in template
        ):
            raise TypeContractError("Output template contains an unsafe field name")
        return {k: _render(v, value, depth + 1) for k, v in template.items()}
    return deepcopy(template)


class TypeAdapterNode(Node):
    family = "dynamic_type"
    group = "Flow / Types"
    icon = "lucide:git-compare"

    operations = {
        "data.inspect_type": {
            "label": "Inspect Dynamic Type",
            "icon": "lucide:scan-search",
            "settings": {
                "input_path": "",
                "expected_schema": {},
                "aliases": {},
            },
            "input_types": ["json"],
            "output_types": ["json"],
        },
        "data.convert_type": {
            "label": "Dynamic Type Adapter",
            "icon": "lucide:arrow-left-right",
            "settings": {
                "input_path": "",
                "field_mapping": {},
                "target_schema": {},
                "aliases": {},
                "auto_map": False,
                "output_key": "items",
                "output_template": {},
                "preserve_unmapped": False,
                "strict": True,
            },
            "input_types": ["json"],
            "output_types": ["json"],
        },
        "data.validate_type": {
            "label": "Validate Dynamic Type",
            "icon": "lucide:shield-check",
            "settings": {
                "input_path": "",
                "expected_schema": {},
                "fail_on_error": True,
            },
            "input_types": ["json"],
            "output_types": ["json"],
        },
    }

    parameter_fields = {
        "data.inspect_type": {
            "input_path": {
                "type": "string",
                "widget": "upstream",
                "accepts": ["json"],
                "title": "Input Data",
            },
            "expected_schema": {
                "type": "object",
                "title": "Expected JSON Schema (optional)",
                "group": "Advanced",
            },
            "aliases": {
                "type": "object",
                "title": "Custom Field Aliases",
                "group": "Advanced",
            },
        },
        "data.convert_type": {
            "input_path": {
                "type": "string",
                "widget": "upstream",
                "accepts": ["json"],
                "title": "Input Data / Array",
            },
            "field_mapping": {
                "type": "object",
                "title": "Field Mapping: source → destination",
            },
            "target_schema": {
                "type": "object",
                "title": "Target JSON Schema",
                "group": "Advanced",
            },
            "aliases": {
                "type": "object",
                "title": "Extra Aliases",
                "group": "Advanced",
            },
            "auto_map": {
                "type": "boolean",
                "title": "Use Unambiguous Exact Field Mapping",
            },
            "output_key": {
                "type": "string",
                "title": "Output Field Name",
            },
            "output_template": {
                "type": "object",
                "title": "Output Template ($items placeholder)",
                "group": "Advanced",
            },
            "preserve_unmapped": {
                "type": "boolean",
                "title": "Preserve Unmapped Fields",
            },
            "strict": {
                "type": "boolean",
                "title": "Fail When a Mapped Input Field Is Missing",
            },
        },
        "data.validate_type": {
            "input_path": {
                "type": "string",
                "widget": "upstream",
                "accepts": ["json"],
                "title": "Input Data",
            },
            "expected_schema": {
                "type": "object",
                "title": "Expected JSON Schema",
            },
            "fail_on_error": {
                "type": "boolean",
                "title": "Stop Workflow on Type Error",
            },
        },
    }

    def execute_operation(
        self,
        operation: str,
        node: dict,
        outputs: dict,
        source: Path | None,
        workdir: Path,
    ) -> dict:
        cfg = node.get("settings") or {}
        path = cfg.get("input_path")
        if not isinstance(path, str) or not path.strip():
            raise TypeContractError("Select a connected Input Data path")
        raw = resolve_input_path(outputs, path)

        if operation == "data.inspect_type":
            report = describe(raw)
            expected = _object(cfg.get("expected_schema") or {}, "Expected Schema")
            if expected:
                report["compatibility"] = validate_value(raw, expected)
                report["suggestion"] = suggest_mapping(
                    raw,
                    expected,
                    aliases=cfg.get("aliases") or {},
                )
            return {
                "status": "completed",
                "input_path": path,
                **report,
            }

        if operation == "data.validate_type":
            expected = _object(cfg.get("expected_schema"), "Expected Schema")
            if not expected:
                raise TypeContractError("Expected JSON Schema must not be empty")
            report = validate_value(raw, expected)
            if report["errors"] and cfg.get("fail_on_error", True) is True:
                raise TypeContractError(
                    "Type validation failed: " + "; ".join(report["errors"][:5])
                )
            return {
                "status": "completed" if report["valid"] else "invalid",
                "valid": report["valid"],
                "errors": report["errors"],
                "input_path": path,
                "value": deepcopy(raw),
                "schema": discover_schema(raw),
            }

        if operation != "data.convert_type":
            raise ValueError(f"Unknown dynamic type operation: {operation}")

        mapping = validate_mapping(
            _object(cfg.get("field_mapping") or {}, "Field Mapping")
        )
        target_schema = _object(cfg.get("target_schema") or {}, "Target Schema")

        if cfg.get("auto_map") is True:
            if not target_schema:
                raise TypeContractError("Auto Map requires Target JSON Schema")
            suggestion = suggest_mapping(
                raw,
                target_schema,
                aliases=cfg.get("aliases") or {},
            )
            if not suggestion["auto_safe"]:
                raise TypeContractError(
                    "Automatic conversion requires an exact, unambiguous field match; "
                    "inspect suggestions and approve aliases explicitly. "
                    f"Missing: {suggestion['missing_required']}; "
                    f"review: {suggestion['requires_review']}"
                )
            mapping = {**suggestion["mapping"], **mapping}
            validate_mapping(mapping)

        converted = (
            map_value(
                raw,
                mapping,
                preserve_unmapped=cfg.get("preserve_unmapped") is True,
                strict=cfg.get("strict", True) is True,
            )
            if mapping
            else deepcopy(raw)
        )

        template = _object(cfg.get("output_template") or {}, "Output Template")
        rendered = _render(template, converted) if template else converted

        if target_schema:
            report = validate_value(rendered, target_schema)
            if not report["valid"]:
                raise TypeContractError(
                    "Converted data does not match target schema: "
                    + "; ".join(report["errors"][:5])
                )

        key = cfg.get("output_key", "items")
        if (
            not isinstance(key, str)
            or not key.isidentifier()
            or len(key) > 64
            or key.startswith("_")
        ):
            raise TypeContractError("Output Field Name must be a safe identifier")

        return {
            key: rendered,
            "type_conversion": {
                "source": path,
                "field_mapping": mapping,
                "output_key": key,
                "schema": discover_schema(rendered),
                "mapped_elements": len(raw) if isinstance(raw, list) else 1,
            },
        }
