"""CLIPTORA DTE V2: structural and semantic compatibility, declarative adapters.

There is no code generation/eval. Rules are JSON values persisted with workflow
node settings (and therefore versioned by the existing workflow persistence).
A suggested alias is NEVER executed without an explicit saved mapping rule.
"""
from __future__ import annotations

from copy import deepcopy
import math
from typing import Any

from .TypeEngine import (
    TypeContractError, _check_schema, _size_guard, discover_schema,
    map_value, suggest_mapping, validate_mapping, validate_value,
    _tokens, _read_many, _put_at,
)

_UNIT_SCALE = {
    ("ms", "s"): 0.001,
    ("s", "ms"): 1000.0,
    ("seconds", "milliseconds"): 1000.0,
    ("milliseconds", "seconds"): 0.001,
    ("minutes", "seconds"): 60.0,
    ("seconds", "minutes"): 1 / 60.0,
    ("hz", "khz"): 0.001,
    ("khz", "hz"): 1000.0,
}


def _semantic_issues(left: dict, right: dict, path: str = "$", depth: int = 0) -> list[str]:
    if depth > 9 or not left or not right:
        return []
    issues: list[str] = []
    for key in ("x-unit", "x-semantic", "x-contract-version"):
        # Unknown provenance is NOT permission to assert semantic compatibility.
        if key in right and left.get(key) != right[key]:
            issues.append(f"{path}: {key} requires '{right[key]}', source declares {left.get(key)!r}")
    if right.get("type") == "object" and left.get("type") == "object":
        for name, child in right.get("properties", {}).items():
            if name in left.get("properties", {}):
                issues.extend(_semantic_issues(left["properties"][name], child, f"{path}.{name}", depth + 1))
    if right.get("type") == "array" and left.get("type") == "array":
        issues.extend(_semantic_issues(left.get("items", {}), right.get("items", {}), f"{path}[]", depth + 1))
    return issues


def inspect_compatibility(
    value: Any, expected: dict, *, source_schema: dict | None = None,
    aliases: dict | None = None,
) -> dict[str, Any]:
    """Plan a link: compatible, convertible, requires_mapping, incompatible.

    The complete runtime value is checked. Inferred metadata cannot prove units.
    """
    _check_schema(expected)
    _size_guard(value)
    if source_schema is not None:
        _check_schema(source_schema)
    else:
        source_schema = discover_schema(value)
    semantics = _semantic_issues(source_schema, expected)
    direct = validate_value(value, expected)
    if direct["valid"] and not semantics:
        return {"status": "compatible", "auto_safe": True, "mapping": {},
                "issues": [], "requires_review": [], "semantic_issues": []}
    suggested = suggest_mapping(value, expected, aliases=aliases)
    mapping = suggested.get("mapping", {})
    # A conversion that drops fields is not automatically safe, even when
    # a closed target schema would accept the reduced result.
    sample = value[0] if isinstance(value, list) and value else value
    dropped = (set(sample) - set(mapping)) if isinstance(sample, dict) else set()
    if mapping:
        try:
            candidate = map_value(value, mapping)
            fits = validate_value(candidate, expected)["valid"]
        except TypeContractError:
            fits = False
    else:
        fits = False
    if semantics or dropped:
        status = "requires_mapping"
    elif fits and suggested.get("auto_safe"):
        status = "convertible"
    elif fits:
        status = "requires_mapping"
    else:
        status = "incompatible" if not mapping else "requires_mapping"
    return {"status": status, "auto_safe": status == "convertible",
            "mapping": mapping, "issues": direct["errors"],
            "requires_review": suggested.get("requires_review", []),
            "missing_required": suggested.get("missing_required", []),
            "ambiguous": suggested.get("ambiguous", []),
            "semantic_issues": semantics, "dropped_fields": sorted(dropped)}


def validate_rule(rule: Any) -> dict:
    if not isinstance(rule, dict):
        raise TypeContractError("Adapter rule must be an object")
    allowed = {"id", "version", "mapping", "conversions", "target_schema", "source_schema", "preserve_unmapped"}
    if set(rule) - allowed:
        raise TypeContractError("Unsupported adapter rule keys")
    ident = rule.get("id", "inline")
    if not isinstance(ident, str) or not 1 <= len(ident) <= 80:
        raise TypeContractError("Adapter ID must be a short string")
    version = rule.get("version", 1)
    if type(version) is not int or not 1 <= version <= 1000:
        raise TypeContractError("Adapter version must be 1-1000")
    validate_mapping(rule.get("mapping", {}))
    if type(rule.get("preserve_unmapped", False)) is not bool:
        raise TypeContractError("preserve_unmapped must be boolean")
    for key in ("target_schema", "source_schema"):
        schema = rule.get(key) or {}
        _check_schema(schema)
    conversions = rule.get("conversions", [])
    if not isinstance(conversions, list) or len(conversions) > 128:
        raise TypeContractError("Conversions must be a list with <=128 entries")
    from .TypeEngine import _valid_path
    for spec in conversions:
        if not isinstance(spec, dict) or set(spec) != {"path", "from", "to"}:
            raise TypeContractError("Conversion needs path, from, to")
        if not _valid_path(spec["path"]):
            raise TypeContractError("Unsafe conversion field path")
        if (spec["from"], spec["to"]) not in _UNIT_SCALE:
            raise TypeContractError("Unsupported conversion units")
    return rule


def apply_rule(value: Any, rule: dict) -> Any:
    """Apply an explicit versioned rule, with optional unit conversions."""
    validate_rule(rule)
    _size_guard(value)
    input_schema = rule.get("source_schema") or {}
    if input_schema:
        result = validate_value(value, input_schema)
        if not result["valid"]:
            raise TypeContractError("Adapter source invalid: " + "; ".join(result["errors"][:3]))
    mapping = rule.get("mapping") or {}
    transformed = map_value(value, mapping, preserve_unmapped=rule.get("preserve_unmapped", False)) if mapping else deepcopy(value)
    if rule.get("conversions"):
        if not isinstance(transformed, dict):
            raise TypeContractError("Unit conversions need an object root")
        # Convert using a snapshot to avoid modifying the source while iterating.
        snapshot = deepcopy(transformed)
        for spec in rule["conversions"]:
            values = _read_many(snapshot, _tokens(spec["path"]))
            if not values:
                raise TypeContractError(f"Conversion path not found: {spec['path']}")
            scale = _UNIT_SCALE[(spec["from"], spec["to"])]
            for indexes, item in values:
                if isinstance(item, bool) or not isinstance(item, (float, int)) or not math.isfinite(item):
                    raise TypeContractError("Unit conversion needs finite numeric values")
                result = item * scale
                if not math.isfinite(result):
                    raise TypeContractError("Conversion produced non-finite value")
                _put_at(transformed, _tokens(spec["path"]), indexes, result)
    _size_guard(transformed)
    target = rule.get("target_schema") or {}
    if target:
        report = validate_value(transformed, target)
        if not report["valid"]:
            raise TypeContractError("Adapter output invalid: " + "; ".join(report["errors"][:4]))
    return transformed


