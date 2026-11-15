
"""CLIPTORA Dynamic Type Engine (DTE), v1.

Structural, value-based JSON Schema discovery; dynamic field mapping and bounded,
non-executable adapters. No hardcoded node IDs, no eval, no mutation of upstream
objects. Only a conservative subset of JSON Schema is accepted intentionally.

The operation metadata may declare input_contract / output_contract. Existing
nodes remain legacy until opting into a typed contract.
"""
from __future__ import annotations

from copy import deepcopy
from difflib import SequenceMatcher
import hashlib
import json
import math
import re
from typing import Any

MAX_DEPTH = 9
MAX_FIELDS = 128
MAX_ARRAY_SAMPLE = 32
MAX_ARRAY_VALIDATE = 5000
MAX_MAPPING_FIELDS = 128
MAX_JSON_BYTES = 4 * 1024 * 1024
SAFE_KEY = re.compile(r"[A-Za-z_][A-Za-z0-9_-]{0,79}\Z")
SCHEMA_TYPES = frozenset({"object", "array", "string", "number", "integer", "boolean", "null"})
BLOCKED_KEYS = frozenset({"__proto__", "prototype", "constructor"})

# Explicitly non-executable, extensible aliases. Unit names are deliberately not
# included: milliseconds must never be silently treated as seconds.
ALIASES: dict[str, tuple[str, ...]] = {
    "label": ("name", "title"),
    "text": ("speech", "selected_text", "content"),
    "start": ("from", "source_start"),
    "end": ("to", "source_end"),
    "id": ("item_id", "instance_id"),
}


class TypeContractError(ValueError):
    pass


def _size_guard(value: Any) -> None:
    try:
        encoded = json.dumps(value, ensure_ascii=False, allow_nan=False, separators=(",", ":"))
    except (TypeError, ValueError, RecursionError) as exc:
        raise TypeContractError("Type data must be finite JSON-compatible values") from exc
    if len(encoded.encode("utf-8")) > MAX_JSON_BYTES:
        raise TypeContractError("Type inspection/mapping exceeds 4 MiB")


def _kind(value: Any) -> str:
    if value is None: return "null"
    if isinstance(value, bool): return "boolean"
    if isinstance(value, int): return "integer"
    if isinstance(value, float): return "number"
    if isinstance(value, str): return "string"
    if isinstance(value, list): return "array"
    if isinstance(value, dict): return "object"
    raise TypeContractError(f"Unsupported JSON value: {type(value).__name__}")


def _merge(left: dict, right: dict) -> dict:
    if left == right: return deepcopy(left)
    if "anyOf" in left or "anyOf" in right:
        options = [*(left.get("anyOf") or [left]), *(right.get("anyOf") or [right])]
        unique = {json.dumps(option, sort_keys=True): option for option in options}
        return {"anyOf": list(unique.values())} if len(unique) <= 6 else {}
    lt, rt = left.get("type"), right.get("type")
    if {lt, rt} == {"number", "integer"}: return {"type": "number"}
    if lt != rt:
        choices = sorted({lt, rt})
        return {"anyOf": [{"type": choice} for choice in choices]}
    if lt == "array":
        return {"type": "array", "items": _merge(left.get("items", {}), right.get("items", {}))}
    if lt == "object":
        la, ra = left.get("properties", {}), right.get("properties", {})
        names = list(dict.fromkeys([*la, *ra]))[:MAX_FIELDS]
        props = {
            key: (
                _merge(la[key], ra[key])
                if key in la and key in ra
                else deepcopy(la.get(key, ra.get(key)))
            )
            for key in names
        }
        common = sorted(set(left.get("required", [])) & set(right.get("required", [])))
        return {"type": "object", "properties": props, "required": common}
    return {"type": lt}


def discover_schema(value: Any, *, depth: int = 0) -> dict[str, Any]:
    """Infer a bounded structural schema from actual JSON. Empty arrays are unknown."""
    if depth == 0: _size_guard(value)
    if depth > MAX_DEPTH: return {}
    kind = _kind(value)
    if kind == "array":
        items = [discover_schema(item, depth=depth + 1) for item in value[:MAX_ARRAY_SAMPLE]]
        merged: dict = {}
        if items:
            merged = items[0]
            for item in items[1:]:
                merged = _merge(merged, item)
        return {"type": "array", "items": merged}
    if kind == "object":
        names = list(value.keys())[:MAX_FIELDS]
        if any(not isinstance(key, str) for key in names):
            raise TypeContractError("JSON object keys must be strings")
        return {
            "type": "object",
            "properties": {
                key: discover_schema(value[key], depth=depth + 1)
                for key in names
            },
            "required": sorted(names),
        }
    return {"type": kind}


def _check_schema(schema: Any, depth: int = 0) -> dict:
    """Validate a bounded, safe subset of JSON Schema without remote refs."""
    if not isinstance(schema, dict) or depth > MAX_DEPTH:
        raise TypeContractError("Schema must be an object with limited nesting")
    if any(key in schema for key in ("$ref", "oneOf", "allOf", "not", "patternProperties")):
        raise TypeContractError("External refs and complex executable-style schemas are not supported")
    kind = schema.get("type")
    if kind is not None and kind not in SCHEMA_TYPES:
        raise TypeContractError("Unsupported schema type")
    if "anyOf" in schema:
        variants = schema["anyOf"]
        if not isinstance(variants, list) or not 1 <= len(variants) <= 6:
            raise TypeContractError("anyOf supports 1 to 6 variants")
        for variant in variants:
            _check_schema(variant, depth + 1)
    properties = schema.get("properties", {})
    if not isinstance(properties, dict) or len(properties) > MAX_FIELDS:
        raise TypeContractError("Schema has invalid properties")
    for name, child in properties.items():
        if (
            not isinstance(name, str)
            or not SAFE_KEY.fullmatch(name)
            or name in BLOCKED_KEYS
        ):
            raise TypeContractError(f"Unsafe schema property: {name!r}")
        _check_schema(child, depth + 1)
    required = schema.get("required", [])
    if (
        not isinstance(required, list)
        or len(required) > MAX_FIELDS
        or any(not isinstance(key, str) or key not in properties for key in required)
    ):
        raise TypeContractError("Required properties must exist in properties")
    if "items" in schema:
        _check_schema(schema["items"], depth + 1)
    if "x-unit" in schema and not isinstance(schema["x-unit"], str):
        raise TypeContractError("x-unit must be a string")
    return schema


def _accepts(
    schema: dict,
    value: Any,
    location: str,
    issues: list[str],
    depth: int = 0,
) -> None:
    if depth > MAX_DEPTH or len(issues) >= 30:
        return
    if not schema:
        return
    if "anyOf" in schema:
        if any(not validate_value(value, option)["errors"] for option in schema["anyOf"]):
            return
        issues.append(f"{location}: no anyOf variant matches")
        return
    expected = schema.get("type")
    actual = _kind(value)
    if (
        expected is not None
        and actual != expected
        and not (expected == "number" and actual == "integer")
    ):
        issues.append(f"{location}: expected {expected}, received {actual}")
        return
    if expected == "object":
        required = schema.get("required", [])
        for key in required:
            if key not in value:
                issues.append(f"{location}.{key}: required field missing")
        for key, sub in schema.get("properties", {}).items():
            if key in value:
                _accepts(sub, value[key], f"{location}.{key}", issues, depth + 1)
    if expected == "array":
        if len(value) > MAX_ARRAY_VALIDATE:
            issues.append(f"{location}: array exceeds {MAX_ARRAY_VALIDATE} validation items")
            return
        for i, item in enumerate(value):
            if len(issues) >= 30:
                break
            _accepts(schema.get("items", {}), item, f"{location}[{i}]", issues, depth + 1)


def validate_value(value: Any, schema: dict[str, Any]) -> dict[str, Any]:
    _check_schema(schema)
    _size_guard(value)
    issues: list[str] = []
    _accepts(schema, value, "$", issues)
    return {
        "valid": not issues,
        "errors": issues,
        "schema": deepcopy(schema),
    }


def collections(value: Any) -> list[dict[str, Any]]:
    """Report arrays and elements, not workflow iterations."""
    output: list[dict[str, Any]] = []

    def walk(item: Any, path: str, depth: int) -> None:
        if depth > 4 or len(output) >= 80:
            return
        if isinstance(item, list):
            output.append({
                "path": path,
                "elements": len(item),
                "item_schema": discover_schema(item[:MAX_ARRAY_SAMPLE]).get("items", {}),
            })
        elif isinstance(item, dict):
            for key, child in list(item.items())[:MAX_FIELDS]:
                if (
                    isinstance(child, (list, dict))
                    and isinstance(key, str)
                    and SAFE_KEY.fullmatch(key)
                ):
                    walk(child, f"{path}.{key}" if path else key, depth + 1)

    walk(value, "", 0)
    return output


def _get(data: dict, dotted: str) -> tuple[bool, Any]:
    item: Any = data
    for key in dotted.split("."):
        if not isinstance(item, dict) or key not in item:
            return False, None
        item = item[key]
    return True, item


def _put(data: dict, dotted: str, value: Any) -> None:
    segments = dotted.split(".")
    node = data
    for key in segments[:-1]:
        if key not in node:
            node[key] = {}
        if not isinstance(node[key], dict):
            raise TypeContractError("Conflicting nested mapping output")
        node = node[key]
    if segments[-1] in node:
        raise TypeContractError(f"Duplicate target field: {dotted}")
    node[segments[-1]] = deepcopy(value)


def _valid_path(path: Any) -> bool:
    return (
        isinstance(path, str)
        and 0 < len(path) <= 240
        and all(
            SAFE_KEY.fullmatch(x) and x not in BLOCKED_KEYS
            for x in path.split(".")
        )
    )


def validate_mapping(mapping: Any) -> dict[str, str]:
    """Mapping is source_field -> destination_field; both are safe dotted paths."""
    if not isinstance(mapping, dict) or len(mapping) > MAX_MAPPING_FIELDS:
        raise TypeContractError("Field mapping must be an object of at most 128 entries")
    if any(
        not _valid_path(source) or not _valid_path(target)
        for source, target in mapping.items()
    ):
        raise TypeContractError("Field mappings must use safe dotted field paths")
    if len(set(mapping.values())) != len(mapping):
        raise TypeContractError("Two source fields cannot map to the same destination")
    return mapping


def map_value(
    value: Any,
    mapping: dict[str, str],
    *,
    preserve_unmapped: bool = False,
    strict: bool = True,
) -> Any:
    """Pure object/array adapter. For arrays each object receives the same map."""
    mapping = validate_mapping(mapping)
    _size_guard(value)
    if isinstance(value, list):
        if len(value) > 2000:
            raise TypeContractError("Mapping supports up to 2000 elements")
        return [
            map_value(item, mapping, preserve_unmapped=preserve_unmapped, strict=strict)
            for item in value
        ]
    if not isinstance(value, dict):
        raise TypeContractError("Field mapping requires an object or object array")
    result = deepcopy(value) if preserve_unmapped else {}
    for source, target in mapping.items():
        exists, datum = _get(value, source)
        if not exists:
            if strict:
                raise TypeContractError(f"Input field '{source}' is missing")
            continue
        if preserve_unmapped:
            old, _ = _get(result, target)
            if old:
                raise TypeContractError(f"Target field '{target}' already exists")
        _put(result, target, datum)
    _size_guard(result)
    return result


def suggest_mapping(
    source: Any,
    expected_schema: dict,
    *,
    aliases: dict | None = None,
) -> dict:
    """Suggest deterministic top-level field matches. Never silently rename units."""
    _check_schema(expected_schema)
    example = source[0] if isinstance(source, list) and source else source
    if not isinstance(example, dict):
        return {
            "status": "incompatible",
            "mapping": {},
            "missing": ["object input expected"],
            "ambiguous": [],
        }
    target = (
        expected_schema.get("items", {})
        if expected_schema.get("type") == "array"
        else expected_schema
    )
    fields = target.get("properties", {})
    merged_aliases = {**ALIASES, **(aliases or {})}
    if any(
        not isinstance(v, (list, tuple))
        or any(not isinstance(s, str) for s in v)
        for v in merged_aliases.values()
    ):
        raise TypeContractError("Aliases must be lists of field names")
    mapping: dict[str, str] = {}
    ambiguous: list[str] = []
    missing: list[str] = []
    manual: list[str] = []
    for desired, child in fields.items():
        candidates = []
        for field, datum in list(example.items())[:MAX_FIELDS]:
            if not isinstance(field, str) or not SAFE_KEY.fullmatch(field):
                continue
            if field == desired or field in merged_aliases.get(desired, ()):
                if not validate_value(datum, child)["errors"]:
                    candidates.append(field)
        if desired in candidates:
            selected = desired
        elif len(candidates) == 1:
            selected = candidates[0]
            manual.append(desired)
        elif len(candidates) > 1:
            ambiguous.append(desired)
            continue
        else:
            approximate = sorted(
                (SequenceMatcher(None, desired, name).ratio(), name)
                for name in example
                if isinstance(name, str) and SAFE_KEY.fullmatch(name)
            )
            if approximate and approximate[-1][0] >= .84:
                manual.append(f"{desired} (possible: {approximate[-1][1]})")
            missing.append(desired)
            continue
        mapping[selected] = desired
    required = target.get("required", [])
    unmapped_required = [x for x in required if x not in mapping.values()]
    status = (
        "compatible"
        if not missing and not ambiguous and not manual
        else (
            "convertible"
            if not unmapped_required and not ambiguous
            else "requires_mapping"
        )
    )
    return {
        "status": status,
        "mapping": mapping,
        "missing": missing,
        "missing_required": unmapped_required,
        "ambiguous": ambiguous,
        "requires_review": manual,
        "auto_safe": status == "compatible",
    }


def describe(value: Any) -> dict:
    """Static-safe schema summary; caller controls whether it is attached to run output."""
    schema = discover_schema(value)
    packed = json.dumps(
        schema,
        sort_keys=True,
        ensure_ascii=False,
        separators=(",", ":"),
    )
    return {
        "version": 1,
        "schema": schema,
        "schema_id": hashlib.sha256(packed.encode()).hexdigest()[:20],
        "collections": collections(value),
    }
