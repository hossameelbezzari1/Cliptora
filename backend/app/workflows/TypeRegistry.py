"""Declarative CLIPTORA DTE V2 registry and static connection preflight.

Any Node operation can contribute its contracts through existing metadata.
No hardcoded operation names. Missing contracts report 'unknown' rather than
pretending JSON is compatible with every other JSON structure.
"""
from __future__ import annotations

import hashlib
import json
from typing import Any

from .TypeEngine import _check_schema, TypeContractError


def contract_id(schema: dict[str, Any]) -> str:
    _check_schema(schema)
    encoded = json.dumps(schema, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(encoded.encode("utf-8")).hexdigest()[:20]


def typed_ports(schema: dict[str, Any], direction: str, *, max_depth: int = 7) -> list[dict[str, Any]]:
    """Generate typed data ports from a schema, including nested array fields."""
    _check_schema(schema)
    if direction not in {"input", "output"}:
        raise TypeContractError("Port direction must be input or output")
    result: list[dict[str, Any]] = []
    def walk(item: dict, path: str, depth: int, required: bool) -> None:
        if depth > max_depth or len(result) >= 120:
            return
        kind = item.get("type", "unknown")
        if path:
            result.append({"path": path, "direction": direction, "type": kind,
                           "required": required, "unit": item.get("x-unit"),
                           "semantic": item.get("x-semantic")})
        if kind == "array":
            walk(item.get("items", {}), path + "[]", depth + 1, required)
        elif kind == "object":
            keys = set(item.get("required", []))
            for name, child in item.get("properties", {}).items():
                walk(child, (path + "." if path else "") + name, depth + 1,
                     required and name in keys)
    walk(schema, "", 0, True)
    return result


def compare_contracts(output_contract: dict, input_contract: dict) -> dict:
    """Conservative STATIC check. Runtime validation remains authoritative."""
    _check_schema(output_contract)
    _check_schema(input_contract)
    if not output_contract or not input_contract:
        return {"status": "unknown", "issues": ["A producer or consumer contract is not declared"]}
    issues: list[str] = []
    unknown: list[str] = []
    def check(source: dict, target: dict, path: str, depth: int) -> None:
        if depth > 8:
            unknown.append(path + " exceeds static analysis depth")
            return
        left, right = source.get("type"), target.get("type")
        if left and right and left != right and not (left == "integer" and right == "number"):
            issues.append(f"{path}: {left} cannot satisfy {right}")
            return
        if left is None or right is None or source.get("anyOf") or target.get("anyOf"):
            unknown.append(f"{path}: dynamic union or unspecified type")
        for tag in ("x-unit", "x-semantic", "x-contract-version"):
            if tag in target and source.get(tag) != target[tag]:
                issues.append(f"{path}: {tag} mismatch")
        if right == "object":
            available = source.get("properties", {})
            guarantees = set(source.get("required", []))
            for name in target.get("required", []):
                if name not in available:
                    issues.append(f"{path}.{name}: required output field missing")
                elif name not in guarantees:
                    unknown.append(f"{path}.{name}: output field is optional")
            for name, sub in target.get("properties", {}).items():
                if name in available:
                    check(available[name], sub, f"{path}.{name}", depth + 1)
        if right == "array":
            check(source.get("items", {}), target.get("items", {}), path + "[]", depth + 1)
        # Numeric/text bounds are dynamic unless the producer has a stronger
        # invariant. This is not a full type-theoretic subtyping proof.
        if any(key in target for key in ("minimum", "maximum", "minLength", "maxLength", "enum", "const", "additionalProperties")):
            unknown.append(f"{path}: runtime constraints must be checked")
    check(output_contract, input_contract, "$", 0)
    return {"status": "requires_mapping" if issues else "runtime_check" if unknown else "compatible",
            "issues": issues, "unknowns": unknown}


def node_type_catalog(
    metadata: dict[str, dict] | None = None, *, include_unknown: bool = False,
) -> list[dict[str, Any]]:
    """Return all declared contracts for any registered Node, old or new."""
    if metadata is None:
        from .Registry import node_metadata
        metadata = node_metadata()
    entries = []
    for node_type, meta in sorted(metadata.items()):
        inputs = meta.get("input_contract") or {}
        outputs = meta.get("output_contract") or {}
        if not inputs and not outputs and not include_unknown:
            continue
        entry = {
            "node_type": node_type,
            "input_contract": inputs, "output_contract": outputs,
            "input_ports": typed_ports(inputs, "input") if inputs else [],
            "output_ports": typed_ports(outputs, "output") if outputs else [],
            "input_contract_id": contract_id(inputs) if inputs else None,
            "output_contract_id": contract_id(outputs) if outputs else None,
        }
        if include_unknown:
            entry["contract_status"] = "declared" if inputs or outputs else "undeclared"
        entries.append(entry)
    return entries


def typescript_catalog(metadata: dict[str, dict] | None = None) -> str:
    """Generate stable TypeScript data for the frontend from live Python metadata.

    This is a CLI/export helper, not a production API route; it needs no TS build.
    """
    payload = json.dumps(node_type_catalog(metadata), ensure_ascii=False, indent=2)
    return "// Generated from CLIPTORA Python Node contracts. Do not edit manually.\n" + \
           "export const workflowTypeCatalog = " + payload + " as const;\n"

def _subschema(schema: dict, tokens: list) -> dict:
    """Derive the declared type produced by an InputResolver subpath.

    Array wildcards `[]` retain collection cardinality while numbered access
    `[0]` selects one element. This matches resolve_input_path exactly.
    """
    if not tokens:
        return schema
    if not schema:
        return {}
    head, rest = tokens[0], tokens[1:]
    if head is None:
        if schema.get("type") != "array":
            return {}
        inside = _subschema(schema.get("items") or {}, rest)
        return {"type": "array", "items": inside} if inside else {}
    if isinstance(head, int):
        if schema.get("type") != "array":
            return {}
        return _subschema(schema.get("items") or {}, rest)
    if schema.get("type") != "object":
        return {}
    field = (schema.get("properties") or {}).get(head) or {}
    return _subschema(field, rest)


def preflight_graph_connections(ordered: list[dict], metadata: dict[str, dict]) -> list[dict]:
    """Preflight explicit Strict/Auto links with declared source/destination types.

    Unknown contracts remain unknown, not incompatible. Approved Adapt rules
    are verified at runtime and do not trigger an invalid static rejection.
    """
    from .InputResolver import _path_tokens

    by_id = {row["id"]: row for row in ordered}
    reports: list[dict] = []
    for node in ordered:
        cfg = node.get("settings") or {}
        mode = cfg.get("type_validation_mode", "legacy")
        if mode not in {"strict", "auto"}:
            continue
        chosen = str(cfg.get("type_input_path") or "").strip()
        if not chosen:
            continue
        tokens = _path_tokens(chosen)
        if not tokens or tokens[0] not in node["depends_on"]:
            continue  # Existing Validation / TypeRuntime raises an explicit error.
        upstream = by_id.get(tokens[0])
        if not upstream:
            continue
        source_contract = (upstream.get("settings") or {}).get("type_output_schema") or \
            (metadata.get(upstream["type"]) or {}).get("output_contract") or {}
        target_contract = cfg.get("type_input_schema") or \
            (metadata.get(node["type"]) or {}).get("input_contract") or {}
        if not source_contract or not target_contract:
            reports.append({"source": upstream["id"], "target": node["id"], "status": "unknown"})
            continue
        source_schema = _subschema(source_contract, tokens[1:])
        if not source_schema:
            reports.append({"source": upstream["id"], "target": node["id"], "status": "unknown"})
            continue
        plan = compare_contracts(source_schema, target_contract)
        reports.append({"source": upstream["id"], "target": node["id"], **plan})
        if plan["status"] == "requires_mapping":
            detail = "; ".join(plan.get("issues", [])[:3])
            raise TypeContractError(
                f"Typed connection {upstream['id']} -> {node['id']} is incompatible: {detail}. "
                "Use Adapt mode with an approved adapter rule, or fix the contract."
            )
    return reports


def registered_connection_report(
    source_type: str,
    target_type: str,
    *,
    source_path: str = "",
    target_path: str = "",
    metadata: dict[str, dict] | None = None,
) -> dict[str, Any]:
    """Check a proposed Canvas link using LIVE registered Python contracts.

    Paths are relative to each node's declared output/input contract. Unknown
    contracts return unknown, never a fabricated compatible result.
    Runtime checks remain authoritative, especially for actual values/units.
    """
    from .InputResolver import _path_tokens

    if metadata is None:
        from .Registry import node_metadata
        metadata = node_metadata()

    if source_type not in metadata:
        raise ValueError(f"Unknown source node type: {source_type}")
    if target_type not in metadata:
        raise ValueError(f"Unknown target node type: {target_type}")

    src = metadata[source_type].get("output_contract") or {}
    dst = metadata[target_type].get("input_contract") or {}
    if not isinstance(src, dict) or not isinstance(dst, dict):
        raise TypeContractError("Registered node contracts must be JSON Schema objects")
    _check_schema(src)
    _check_schema(dst)

    if source_path:
        src = _subschema(src, _path_tokens(source_path))
    if target_path:
        dst = _subschema(dst, _path_tokens(target_path))

    result = compare_contracts(src, dst)
    return {
        "source_type": source_type,
        "target_type": target_type,
        "source_path": source_path,
        "target_path": target_path,
        **result,
    }
