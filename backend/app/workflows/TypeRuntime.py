"""CLIPTORA DTE V2 typed-input bridge, opt-in and side-effect-free.

The original upstream outputs are NEVER mutated. A declared source path is
copied to a declared destination path in a local input view only. This lets
legacy nodes consume an adapted document without rewriting their executors.
"""
from __future__ import annotations

from copy import deepcopy
from typing import Any

from .InputResolver import resolve_input_path
from .TypeEngine import TypeContractError, _check_schema, _valid_path, validate_value
from .TypeCompatibility import inspect_compatibility, apply_rule, validate_rule


def _connected_path(path: str, deps: list[str]) -> bool:
    from .InputResolver import _path_tokens
    if not isinstance(path, str) or not path.strip():
        return False
    tokens = _path_tokens(path)
    return bool(tokens and isinstance(tokens[0], str) and tokens[0] in deps)


def validate_type_settings(cfg: dict, deps: list[str], meta: dict | None = None) -> None:
    if not isinstance(cfg, dict):
        raise TypeContractError("Node settings must be a JSON object")
    mode = cfg.get("type_validation_mode", "legacy")
    if mode not in {"legacy", "strict", "adapt", "auto"}:
        raise TypeContractError("Type mode must be legacy, strict, adapt, or auto")
    if mode == "legacy":
        return
    path = cfg.get("type_input_path", "")
    input_contract = cfg.get("type_input_schema") or (meta or {}).get("input_contract") or {}
    output_contract = cfg.get("type_output_schema") or (meta or {}).get("output_contract") or {}
    for schema in (input_contract, output_contract, cfg.get("type_source_schema") or {}):
        _check_schema(schema)
    if input_contract or mode in ("adapt", "auto"):
        if not _connected_path(path, deps):
            raise TypeContractError("Typed input must reference a directly connected node")
    rule = cfg.get("type_adapter_rule") or {}
    if rule:
        validate_rule(rule)
    if mode == "adapt" and not rule:
        raise TypeContractError("Adapt mode needs an approved versioned type_adapter_rule")
    if mode == "auto" and not input_contract:
        raise TypeContractError("Auto mode needs expected type_input_schema or input_contract")
    target = cfg.get("type_target_path") or path
    if mode in ("adapt", "auto"):
        if not _connected_path(target, deps):
            raise TypeContractError("Typed target must be inside a connected source output")
        from .InputResolver import _path_tokens
        tokens = _path_tokens(target)
        # _inject only writes to object fields. Numeric array indices and
        # wildcards must be rejected at validation time, not during the run.
        if not tokens or any(
            not isinstance(part, str) or part.isdecimal() for part in tokens
        ):
            raise TypeContractError(
                "Typed target must use object fields only; array indexes "
                "and wildcards are not supported for injection"
            )


def _inject(data: dict, path: str, value: Any) -> dict:
    from .InputResolver import _path_tokens
    tokens = _path_tokens(path)
    if not tokens or any(not isinstance(x, str) or x.isdecimal() for x in tokens):
        raise TypeContractError("Typed target must use object fields, not indexes/wildcards")
    target = deepcopy(data)
    cursor: Any = target
    for key in tokens[:-1]:
        if not isinstance(cursor, dict):
            raise TypeContractError("Typed target conflicts with a non-object field")
        if key not in cursor:
            cursor[key] = {}
        cursor = cursor[key]
    if not isinstance(cursor, dict):
        raise TypeContractError("Typed target conflicts with a non-object field")
    cursor[tokens[-1]] = value
    return target


def prepare_typed_inputs(cfg: dict, meta: dict, outputs: dict[str, Any], deps: list[str]) -> tuple[dict[str, Any], dict | None]:
    validate_type_settings(cfg, deps, meta)
    mode = cfg.get("type_validation_mode", "legacy")
    if mode == "legacy":
        return outputs, None
    path = str(cfg.get("type_input_path") or "").strip()
    expected = cfg.get("type_input_schema") or meta.get("input_contract") or {}
    if not path:
        return outputs, None
    selected = resolve_input_path(outputs, path)
    if mode == "strict":
        if expected:
            report = validate_value(selected, expected)
            if not report["valid"]:
                raise TypeContractError("Input contract failed: " + "; ".join(report["errors"][:5]))
            semantic = inspect_compatibility(
                selected, expected,
                source_schema=cfg.get("type_source_schema") or None,
            )["semantic_issues"]
            if semantic:
                raise TypeContractError("Input semantics not proven: " + "; ".join(semantic[:4]))
        return outputs, None
    rule = cfg.get("type_adapter_rule") or {}
    if mode == "auto":
        provenance = (cfg.get("type_source_schema") or None)
        if provenance:
            _check_schema(provenance)
        plan = inspect_compatibility(selected, expected, source_schema=provenance)
        if plan["status"] == "compatible":
            return outputs, {"status": "compatible", "mode": "auto"}
        if not plan["auto_safe"]:
            raise TypeContractError("Automatic adaptation requires review: " + "; ".join(plan.get("issues", [])[:3] + plan.get("requires_review", [])[:3]))
        rule = {"id": "auto_exact", "version": 1, "mapping": plan["mapping"],
                "target_schema": expected}
    adapted = apply_rule(selected, rule)
    if expected:
        checked = validate_value(adapted, expected)
        if not checked["valid"]:
            raise TypeContractError("Adapted input does not match contract: " + "; ".join(checked["errors"][:4]))
    target_path = str(cfg.get("type_target_path") or path).strip()
    # This is an isolated view passed only to the current node executor.
    result = _inject(outputs, target_path, adapted)
    return result, {"status": "adapted", "mode": mode,
                    "rule_id": rule.get("id", "inline"), "rule_version": rule.get("version", 1),
                    "source_path": path, "target_path": target_path}
