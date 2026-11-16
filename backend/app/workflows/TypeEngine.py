"""CLIPTORA Dynamic Type Engine V2.

Bounded JSON inference, a deliberately supported JSON Schema subset, and pure
mapping. Unknown validation keywords fail closed (they are NEVER ignored).
Runtime Python and frontend contracts may be generated from the same metadata.
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
SCHEMA_KEYWORDS = frozenset({
    "type", "properties", "required", "items", "additionalProperties", "anyOf",
    "enum", "const", "minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum",
    "multipleOf", "minLength", "maxLength", "minItems", "maxItems",
    "uniqueItems", "minProperties", "maxProperties", "title", "description",
    "default", "examples", "x-unit", "x-semantic", "x-contract-version",
})
# Aliases are only SUGGESTIONS. They cannot be auto-applied without approval.
ALIASES: dict[str, tuple[str, ...]] = {
    "label": ("name", "title"), "text": ("speech", "selected_text", "content"),
    "start": ("from", "source_start"), "end": ("to", "source_end"),
    "id": ("item_id", "instance_id"),
}


class TypeContractError(ValueError):
    pass


def _size_guard(value: Any) -> None:
    try:
        packed = json.dumps(value, ensure_ascii=False, allow_nan=False, separators=(",", ":"))
    except (TypeError, ValueError, OverflowError, RecursionError) as exc:
        raise TypeContractError("Type data must contain finite JSON-compatible values") from exc
    if len(packed.encode("utf-8")) > MAX_JSON_BYTES:
        raise TypeContractError("Type input exceeds 4 MiB")


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
    if left == right:
        return deepcopy(left)
    lt, rt = left.get("type"), right.get("type")
    if lt == rt == "object":
        lprops, rprops = left.get("properties", {}), right.get("properties", {})
        keys = list(dict.fromkeys((*lprops, *rprops)))[:MAX_FIELDS]
        props = {k: _merge(lprops[k], rprops[k]) if k in lprops and k in rprops
                 else deepcopy(lprops.get(k, rprops.get(k))) for k in keys}
        required = sorted(set(left.get("required", [])) & set(right.get("required", [])))
        return {"type": "object", "properties": props, "required": required}
    if lt == rt == "array":
        return {"type": "array", "items": _merge(left.get("items", {}), right.get("items", {}))}
    if {lt, rt} == {"integer", "number"}:
        return {"type": "number"}
    variants = [*(left.get("anyOf") or [left]), *(right.get("anyOf") or [right])]
    unique = {json.dumps(s, sort_keys=True): s for s in variants}
    return {"anyOf": list(unique.values())} if len(unique) <= 6 else {}


def discover_schema(value: Any, *, depth: int = 0) -> dict[str, Any]:
    if depth == 0:
        _size_guard(value)
    if depth > MAX_DEPTH:
        return {}
    kind = _kind(value)
    if kind == "array":
        sampled = [discover_schema(x, depth=depth + 1) for x in value[:MAX_ARRAY_SAMPLE]]
        merged = sampled[0] if sampled else {}
        for item in sampled[1:]:
            merged = _merge(merged, item)
        return {"type": "array", "items": merged}
    if kind == "object":
        if any(not isinstance(key, str) for key in value):
            raise TypeContractError("JSON object keys must be strings")
        keys = list(value)[:MAX_FIELDS]
        return {"type": "object", "properties": {
            key: discover_schema(value[key], depth=depth + 1) for key in keys
        }, "required": sorted(keys)}
    return {"type": kind}


def _check_schema(schema: Any, depth: int = 0) -> dict:
    """Validate the *supported subset*. Reject unknown keywords, including $ref."""
    if not isinstance(schema, dict) or depth > MAX_DEPTH:
        raise TypeContractError("Schema must be an object with limited nesting")
    unknown = set(schema) - SCHEMA_KEYWORDS
    if unknown:
        raise TypeContractError("Unsupported JSON Schema keyword(s): " + ", ".join(sorted(unknown)[:6]))
    kind = schema.get("type")
    if kind is not None and kind not in SCHEMA_TYPES:
        raise TypeContractError("Unsupported JSON Schema type")
    if "anyOf" in schema:
        options = schema["anyOf"]
        if not isinstance(options, list) or not 1 <= len(options) <= 6:
            raise TypeContractError("anyOf must contain 1 to 6 alternatives")
        for option in options:
            _check_schema(option, depth + 1)
    if kind is not None and "anyOf" in schema:
        raise TypeContractError("Choose type or anyOf, not both")
    props = schema.get("properties", {})
    if not isinstance(props, dict) or len(props) > MAX_FIELDS:
        raise TypeContractError("Invalid properties")
    for name, child in props.items():
        if not isinstance(name, str) or not SAFE_KEY.fullmatch(name) or name in BLOCKED_KEYS:
            raise TypeContractError("Unsafe schema property name")
        _check_schema(child, depth + 1)
    required = schema.get("required", [])
    if (not isinstance(required, list) or len(required) > MAX_FIELDS
        or any(not isinstance(x, str) or x not in props for x in required)
        or len(required) != len(set(required))):
        raise TypeContractError("required must contain distinct declared properties")
    if "items" in schema:
        _check_schema(schema["items"], depth + 1)
    addition = schema.get("additionalProperties", True)
    if not isinstance(addition, (bool, dict)):
        raise TypeContractError("additionalProperties must be boolean or schema")
    if isinstance(addition, dict):
        _check_schema(addition, depth + 1)
    for name in ("minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "multipleOf"):
        if name in schema:
            v = schema[name]
            if isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v):
                raise TypeContractError(f"{name} must be a finite number")
            if name == "multipleOf" and v <= 0:
                raise TypeContractError("multipleOf must be positive")
    for name in ("minLength", "maxLength", "minItems", "maxItems", "minProperties", "maxProperties"):
        if name in schema and (type(schema[name]) is not int or schema[name] < 0):
            raise TypeContractError(f"{name} must be a nonnegative integer")
    for prefix in ("Length", "Items", "Properties"):
        low, high = f"min{prefix}", f"max{prefix}"
        if low in schema and high in schema and schema[low] > schema[high]:
            raise TypeContractError(f"{low} cannot exceed {high}")
    if "uniqueItems" in schema and type(schema["uniqueItems"]) is not bool:
        raise TypeContractError("uniqueItems must be boolean")
    if "enum" in schema:
        variants = schema["enum"]
        if not isinstance(variants, list) or not 1 <= len(variants) <= 200:
            raise TypeContractError("enum requires 1-200 values")
        _size_guard(variants)
    if "const" in schema:
        _size_guard(schema["const"])
    for key in ("x-unit", "x-semantic"):
        if key in schema and (not isinstance(schema[key], str) or len(schema[key]) > 100):
            raise TypeContractError(f"{key} must be a short string")
    if "x-contract-version" in schema and (type(schema["x-contract-version"]) is not int or schema["x-contract-version"] < 1):
        raise TypeContractError("x-contract-version must be positive")
    return schema


def _accepts(schema: dict, value: Any, location: str, issues: list[str], depth: int = 0) -> None:
    if len(issues) >= 30 or depth > MAX_DEPTH or not schema:
        return
    if "anyOf" in schema:
        for alt in schema["anyOf"]:
            alt_issues: list[str] = []
            _accepts(alt, value, location, alt_issues, depth + 1)
            if not alt_issues:
                return
        issues.append(f"{location}: no anyOf alternative matches")
        return
    expected, actual = schema.get("type"), _kind(value)
    if expected and actual != expected and not (expected == "number" and actual == "integer"):
        issues.append(f"{location}: expected {expected}, received {actual}")
        return
    if "enum" in schema and value not in schema["enum"]:
        issues.append(f"{location}: value not in enum")
    if "const" in schema and value != schema["const"]:
        issues.append(f"{location}: value differs from const")
    if actual in ("integer", "number"):
        if "minimum" in schema and value < schema["minimum"]:
            issues.append(f"{location}: below minimum")
        if "maximum" in schema and value > schema["maximum"]:
            issues.append(f"{location}: above maximum")
        if "exclusiveMinimum" in schema and value <= schema["exclusiveMinimum"]:
            issues.append(f"{location}: below exclusiveMinimum")
        if "exclusiveMaximum" in schema and value >= schema["exclusiveMaximum"]:
            issues.append(f"{location}: above exclusiveMaximum")
        if "multipleOf" in schema and not math.isclose(value / schema["multipleOf"], round(value / schema["multipleOf"]), rel_tol=1e-9, abs_tol=1e-9):
            issues.append(f"{location}: not a multipleOf")
    if actual == "string":
        if "minLength" in schema and len(value) < schema["minLength"]:
            issues.append(f"{location}: shorter than minLength")
        if "maxLength" in schema and len(value) > schema["maxLength"]:
            issues.append(f"{location}: longer than maxLength")
    if actual == "object":
        if "minProperties" in schema and len(value) < schema["minProperties"]:
            issues.append(f"{location}: fewer than minProperties")
        if "maxProperties" in schema and len(value) > schema["maxProperties"]:
            issues.append(f"{location}: more than maxProperties")
        props = schema.get("properties", {})
        for name in schema.get("required", []):
            if name not in value:
                issues.append(f"{location}.{name}: required field missing")
        additional = schema.get("additionalProperties", True)
        for name, item in value.items():
            if len(issues) >= 30: break
            if name in props:
                _accepts(props[name], item, f"{location}.{name}", issues, depth + 1)
            elif additional is False:
                issues.append(f"{location}.{name}: additional property not allowed")
            elif isinstance(additional, dict):
                _accepts(additional, item, f"{location}.{name}", issues, depth + 1)
    if actual == "array":
        if len(value) > MAX_ARRAY_VALIDATE:
            issues.append(f"{location}: array exceeds validation limit {MAX_ARRAY_VALIDATE}")
            return
        if "minItems" in schema and len(value) < schema["minItems"]:
            issues.append(f"{location}: fewer than minItems")
        if "maxItems" in schema and len(value) > schema["maxItems"]:
            issues.append(f"{location}: more than maxItems")
        if schema.get("uniqueItems"):
            keys = [json.dumps(x, sort_keys=True, ensure_ascii=False) for x in value]
            if len(keys) != len(set(keys)):
                issues.append(f"{location}: items are not unique")
        for index, item in enumerate(value):
            if len(issues) >= 30: break
            _accepts(schema.get("items", {}), item, f"{location}[{index}]", issues, depth + 1)


def validate_value(value: Any, schema: dict[str, Any]) -> dict[str, Any]:
    _check_schema(schema)
    _size_guard(value)
    issues: list[str] = []
    _accepts(schema, value, "$", issues)
    return {"valid": not issues, "errors": issues, "schema": deepcopy(schema)}


def collections(value: Any) -> list[dict[str, Any]]:
    output: list[dict[str, Any]] = []
    def walk(item: Any, path: str, depth: int) -> None:
        if depth > 4 or len(output) >= 80:
            return
        if isinstance(item, list):
            output.append({"path": path, "elements": len(item),
                           "item_schema": discover_schema(item[:MAX_ARRAY_SAMPLE]).get("items", {})})
        elif isinstance(item, dict):
            for key, child in list(item.items())[:MAX_FIELDS]:
                if isinstance(child, (list, dict)) and isinstance(key, str) and SAFE_KEY.fullmatch(key):
                    walk(child, f"{path}.{key}" if path else key, depth + 1)
    walk(value, "", 0)
    return output


def _valid_path(path: Any) -> bool:
    if not isinstance(path, str) or not 0 < len(path) <= 240:
        return False
    return all(SAFE_KEY.fullmatch(x.removesuffix("[]")) and x.removesuffix("[]") not in BLOCKED_KEYS
               for x in path.split("."))


def validate_mapping(mapping: Any) -> dict[str, str]:
    if not isinstance(mapping, dict) or len(mapping) > MAX_MAPPING_FIELDS:
        raise TypeContractError("Field mapping requires at most 128 source: target pairs")
    if any(not _valid_path(source) or not _valid_path(target) for source, target in mapping.items()):
        raise TypeContractError("Unsafe field path in mapping")
    if len(set(mapping.values())) != len(mapping):
        raise TypeContractError("Two source fields cannot map to the same destination")
    for source, target in mapping.items():
        if source.count("[]") != target.count("[]"):
            raise TypeContractError("Source and destination array depths must match")
    return mapping


def _tokens(path: str) -> list[str | None]:
    tokens: list[str | None] = []
    for part in path.split("."):
        tokens.append(part.removesuffix("[]"))
        if part.endswith("[]"):
            tokens.append(None)
    return tokens


def _read_many(data: Any, tokens: list[str | None], indexes: tuple[int, ...] = ()) -> list[tuple[tuple[int, ...], Any]]:
    if not tokens:
        return [(indexes, data)]
    head, tail = tokens[0], tokens[1:]
    if head is None:
        if not isinstance(data, list) or len(data) > 2000:
            return []
        result: list[tuple[tuple[int, ...], Any]] = []
        for i, item in enumerate(data):
            result.extend(_read_many(item, tail, (*indexes, i)))
        return result
    if not isinstance(data, dict) or head not in data:
        return []
    return _read_many(data[head], tail, indexes)


def _put_at(data: dict, tokens: list[str | None], indexes: tuple[int, ...], value: Any) -> None:
    cursor: Any = data
    ix = 0
    for pos, segment in enumerate(tokens):
        last = pos == len(tokens) - 1
        if segment is None:
            if not isinstance(cursor, list):
                raise TypeContractError("Mapping target is not an array")
            if ix >= len(indexes):
                raise TypeContractError("Missing array index")
            at = indexes[ix]; ix += 1
            if at >= 2000:
                raise TypeContractError("Mapping index exceeds limit")
            while len(cursor) <= at:
                cursor.append({})
            if last:
                cursor[at] = deepcopy(value)
            else:
                cursor = cursor[at]
            continue
        if not isinstance(cursor, dict):
            raise TypeContractError("Mapping target field conflicts with scalar")
        if last:
            cursor[segment] = deepcopy(value)
            continue
        following = tokens[pos + 1]
        if segment not in cursor:
            cursor[segment] = [] if following is None else {}
        cursor = cursor[segment]


def map_value(value: Any, mapping: dict[str, str], *, preserve_unmapped: bool = False,
              strict: bool = True) -> Any:
    """Map dotted paths including nested arrays: segments[].name -> clips[].label.

    Legacy list-of-objects mapping (name -> label) remains supported. No code eval.
    """
    validate_mapping(mapping)
    _size_guard(value)
    if isinstance(value, list):
        if len(value) > 2000:
            raise TypeContractError("Array mapping exceeds 2000 elements")
        if all("[]" not in key for key in mapping):
            return [map_value(item, mapping, preserve_unmapped=preserve_unmapped, strict=strict) for item in value]
        raise TypeContractError("For root lists use per-item field names without []")
    if not isinstance(value, dict):
        raise TypeContractError("Field mapping requires an object or array of objects")
    result = deepcopy(value) if preserve_unmapped else {}
    for source, target in mapping.items():
        matched = _read_many(value, _tokens(source))
        if not matched and strict:
            raise TypeContractError(f"Mapped input '{source}' missing or has invalid array shape")
        for indexes, item in matched:
            _put_at(result, _tokens(target), indexes, item)
    _size_guard(result)
    return result


def suggest_mapping(source: Any, expected_schema: dict, *, aliases: dict | None = None) -> dict:
    """Suggest exact and alias mappings. Aliases always require review."""
    _check_schema(expected_schema)
    original = source[0] if isinstance(source, list) and source else source
    if not isinstance(original, dict):
        return {"status": "incompatible", "mapping": {}, "missing": ["object required"],
                "missing_required": [], "ambiguous": [], "requires_review": [], "auto_safe": False}
    target = expected_schema.get("items", {}) if expected_schema.get("type") == "array" else expected_schema
    props = target.get("properties", {})
    custom = aliases or {}
    if not isinstance(custom, dict) or any(not isinstance(vals, (list, tuple))
        or any(not isinstance(x, str) or not SAFE_KEY.fullmatch(x) for x in vals)
        for vals in custom.values()):
        raise TypeContractError("Aliases must be dictionary of short field-name lists")
    merged = {**ALIASES, **custom}
    mapping: dict[str, str] = {}
    missing: list[str] = []; ambiguous: list[str] = []; review: list[str] = []
    for desired, schema in props.items():
        if desired in original and validate_value(original[desired], schema)["valid"]:
            mapping[desired] = desired
            continue
        candidates = [name for name in merged.get(desired, ()) if name in original
                      and validate_value(original[name], schema)["valid"]]
        if len(candidates) == 1:
            mapping[candidates[0]] = desired
            review.append(desired)
        elif len(candidates) > 1:
            ambiguous.append(desired)
        else:
            missing.append(desired)
            near = [(SequenceMatcher(None, desired, name).ratio(), name) for name in original if isinstance(name, str)]
            if near and max(near)[0] >= 0.84:
                review.append(f"{desired} (possibly {max(near)[1]})")
    required_missing = [x for x in target.get("required", []) if x not in mapping.values()]
    if not required_missing and not ambiguous and not review:
        status = "compatible"
    elif not required_missing and not ambiguous:
        status = "convertible"
    else:
        status = "requires_mapping"
    return {"status": status, "mapping": mapping, "missing": missing,
            "missing_required": required_missing, "ambiguous": ambiguous,
            "requires_review": review, "auto_safe": status == "compatible"}


def describe(value: Any) -> dict:
    schema = discover_schema(value)
    packed = json.dumps(schema, sort_keys=True, ensure_ascii=False, separators=(",", ":"))
    return {"version": 2, "schema": schema,
            "schema_id": hashlib.sha256(packed.encode("utf-8")).hexdigest()[:20],
            "collections": collections(value)}
