"""Bounded, acyclic subgraph loops for CLIPTORA.

The controller node executes connected body nodes internally. Body IDs must be
listed explicitly and remain part of the normal saved DAG (no feedback edges).
Each item/iteration gets a scoped `controller.current` value and independent
per-body results, while the outer DAG sees aggregated item outputs.
"""
from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path
from typing import Any, Callable

from app.workflows.InputResolver import resolve_input_path
from app.workflows.ItemExecution import ITEM_MARKER, _item_record, _text_value, _digest, _write_json, LiveItemTracker

CONTROLLERS = frozenset({"items.loop", "items.repeat_until"})
MAX_BODY_STEPS = 12
MAX_TOTAL_CALLS = 10000


def body_members(ordered: list[dict[str, Any]]) -> dict[str, str]:
    """Return {body_node_id: controller_id}; reject overlapping membership."""
    found: dict[str, str] = {}
    for node in ordered:
        if node["type"] not in CONTROLLERS:
            continue
        for member in (node.get("settings") or {}).get("body_node_ids", []):
            if member in found:
                raise ValueError(f"Body node {member} belongs to multiple loop controllers")
            found[member] = node["id"]
    return found


def validate_subgraphs(ordered: list[dict[str, Any]]) -> None:
    """Verify each controller body is a topologically valid, closed DAG segment."""
    by_id = {node["id"]: node for node in ordered}
    positions = {node["id"]: i for i, node in enumerate(ordered)}
    membership = body_members(ordered)
    for controller in ordered:
        if controller["type"] not in CONTROLLERS:
            continue
        ident = controller["id"]
        settings = controller["settings"]
        if settings.get("execution_mode", "once") != "once":
            raise ValueError(f"Loop controller {ident} must use Run Once")
        declared = settings.get("body_node_ids", [])
        if (not isinstance(declared, list) or not 1 <= len(declared) <= MAX_BODY_STEPS
                or any(not isinstance(value, str) for value in declared)
                or len(declared) != len(set(declared))):
            raise ValueError(f"Loop controller {ident} requires 1-{MAX_BODY_STEPS} distinct Body Node IDs")
        if any(not isinstance(value, str) or value not in by_id for value in declared):
            raise ValueError(f"Loop controller {ident} references a missing body node")
        if declared != sorted(declared, key=positions.__getitem__):
            raise ValueError(f"Body Node IDs for {ident} must follow workflow dependency order")
        for step_id in declared:
            step = by_id[step_id]
            if positions[step_id] <= positions[ident]:
                raise ValueError(f"Body node {step_id} must follow controller {ident}")
            if step["type"] in CONTROLLERS or step["type"].endswith("trigger") or step["type"] in {"ai.agent", "ai.chat_model"}:
                raise ValueError(f"{step['type']} cannot run inside a loop body")
            if (step["settings"] or {}).get("execution_mode", "once") != "once":
                raise ValueError(f"Body node {step_id} uses For Each; controller already controls iteration")
            if not any(dep == ident or dep in declared for dep in step["depends_on"]):
                raise ValueError(f"Body node {step_id} must connect to {ident} or an earlier body node")
            for dep in step["depends_on"]:
                if dep in declared and positions[dep] >= positions[step_id]:
                    raise ValueError(f"Body node {step_id} depends on a later loop step")
                if dep not in declared and dep != ident and positions[dep] >= positions[ident]:
                    raise ValueError(f"Body node {step_id} references a future external node {dep}")
                if dep in membership and membership[dep] != ident:
                    raise ValueError(f"Body node {step_id} cannot depend on another controller's body")
        max_iter = settings.get("max_iterations", 20)
        if type(max_iter) is not int or not 1 <= max_iter <= 2000:
            raise ValueError("Loop Max Iterations must be 1-2000")
        if max_iter * len(declared) > MAX_TOTAL_CALLS:
            raise ValueError("Loop body exceeds maximum possible execution calls")
        if controller["type"] == "items.loop":
            path = str(settings.get("input_path") or "").strip()
            root = path.split(".", 1)[0].split("[", 1)[0]
            if root not in controller["depends_on"]:
                raise ValueError(f"Loop {ident} input collection must reference a connected upstream node")
        else:
            cond_path = str(settings.get("condition_path") or "").strip()
            root = cond_path.split(".", 1)[0].split("[", 1)[0]
            if root not in declared:
                raise ValueError(f"Repeat Until {ident} condition must reference one of its body nodes")
            input_path = str(settings.get("input_path") or "").strip()
            if input_path and input_path.split(".", 1)[0].split("[", 1)[0] not in controller["depends_on"]:
                raise ValueError(f"Repeat Until {ident} initial value must reference a dependency")
            operator = settings.get("condition_operator", "truthy")
            if operator not in ("truthy", "equals", "not_equals", "greater_equal", "less_equal"):
                raise ValueError("Unsupported Repeat Until condition operator")
        if settings.get("error_policy", "stop") not in ("stop", "continue"):
            raise ValueError("Loop Error Policy must be stop or continue")
        if settings.get("on_limit", "error") not in ("error", "complete"):
            raise ValueError("On Limit must be error or complete")


def _predicate(actual: Any, operator: str, expected: Any) -> bool:
    if operator == "truthy":
        return bool(actual)
    if operator == "equals":
        return actual == expected
    if operator == "not_equals":
        return actual != expected
    if isinstance(actual, bool) or isinstance(expected, bool):
        raise ValueError("Numeric Repeat Until conditions cannot use booleans")
    try:
        left, right = float(actual), float(expected)
    except (TypeError, ValueError) as exc:
        raise ValueError("Numeric Repeat Until condition requires numbers") from exc
    import math
    if not math.isfinite(left) or not math.isfinite(right):
        raise ValueError("Numeric Repeat Until condition must be finite")
    return left >= right if operator == "greater_equal" else left <= right


def _scoped_current(item: dict, index: int, count: int, last: Any = None) -> dict[str, Any]:
    data = item["data"]
    output = dict(data) if isinstance(data, dict) else {"value": data}
    text = _text_value(data)
    if text is not None:
        output.setdefault("text", text)
    output["current"] = data
    output["item"] = {key: item.get(key) for key in ("id", "label", "parent_id", "index")}
    output["iteration"] = index + 1
    output["index"] = index
    output["count"] = count
    output["last"] = last
    return output


def run_loop_controller(
    controller: dict[str, Any], ordered: list[dict[str, Any]],
    outer_outputs: dict[str, dict], source: Path | None, workspace: Path,
    cancelled: Callable[[], bool], progress: Callable[[dict[str, Any]], None] | None,
) -> tuple[dict[str, Any], dict[str, dict]]:
    from app.workflows.Registry import executor
    from app.workflows.Credentials import bind_for_node

    cfg = controller["settings"]
    ident = controller["id"]
    body_ids = cfg["body_node_ids"]
    index_by_id = {step["id"]: step for step in ordered}
    body = [index_by_id[step_id] for step_id in body_ids]
    repeating = controller["type"] == "items.repeat_until"
    max_iterations = cfg.get("max_iterations", 20)
    cache_enabled = bool(controller.get("cache", True))
    cache_dir = workspace / f".{ident}.loop_steps"
    if cache_enabled:
        cache_dir.mkdir(parents=True, exist_ok=True)

    if repeating:
        path = str(cfg.get("input_path") or "").strip()
        initial = resolve_input_path(outer_outputs, path) if path else cfg.get("initial_value")
        data = [{"id": "repeat_0001", "data": initial, "label": "Repeat", "parent_id": None, "index": 0}]
    else:
        path = str(cfg.get("input_path") or "").strip()
        raw = resolve_input_path(outer_outputs, path)
        if not isinstance(raw, list):
            raise ValueError(f"Loop {ident} Input Collection must resolve to an array")
        if len(raw) > max_iterations:
            raise ValueError(f"Loop {ident} has {len(raw)} items; Maximum Iterations is {max_iterations}")
        data = [_item_record(value, i, path.split(".", 1)[0], path)
                for i, value in enumerate(raw)]
        if not data and not bool(cfg.get("allow_empty", False)):
            raise ValueError(f"Loop {ident} received an empty Input Collection")

    source_digest = None
    if source is not None and source.is_file():
        stat = source.stat()
        source_digest = [str(source), stat.st_size, stat.st_mtime_ns]
    previous: Any = None
    iterations = 0
    finished: list[dict[str, Any]] = []
    failures: list[dict[str, Any]] = []
    collected: dict[str, list[dict[str, Any]]] = {step: [] for step in body_ids}
    condition_met = False
    max_count = max_iterations if repeating else len(data)
    tracker = LiveItemTracker("repeat_until" if repeating else "for_each_subgraph", [
        {"id": str(data[i]["id"]), "label": str(data[i].get("label") or data[i]["id"])}
        for i in range(max_count) if not repeating
    ])
    if not repeating:
        tracker.emit(progress, stage="loop_ready", message=f"{max_count} loop items ready", force=True)

    for ix in range(max_count):
        if cancelled():
            raise RuntimeError("Loop cancelled")
        item = data[0].copy() if repeating else data[ix]
        if repeating and ix > 0:
            item["data"] = previous
        local: dict[str, Any] = dict(outer_outputs)
        local[ident] = _scoped_current(item, ix, max_count, previous if repeating else None)
        iterations += 1
        if repeating:
            tracker.append(f"repeat_{ix+1:04d}", f"Iteration {ix+1}")
        tracker.set(ix, "running")
        tracker.emit(progress, stage="loop", message=f"Loop iteration {ix+1}/{max_count} running", force=ix < 3)
        try:
            for body_index, step in enumerate(body):
                if cancelled():
                    raise RuntimeError("Loop cancelled")
                deps = {dep: local[dep] for dep in step["depends_on"]}
                if len(deps) != len(step["depends_on"]):
                    raise ValueError(f"Loop body {step['id']} is missing a dependency")
                digest = _digest({"step": step, "deps": deps, "source": source_digest,
                                  "controller": ident, "iteration": ix})
                target = cache_dir / f"{ix:04d}_{body_index:02d}_{digest[:24]}.json"
                result = None
                if cache_enabled and step.get("cache", True) and target.is_file():
                    try:
                        restored = json.loads(target.read_text(encoding="utf8"))
                        if isinstance(restored, dict):
                            result = restored
                    except (OSError, ValueError):
                        pass
                if result is None:
                    sub_id = f"{step['id'][:22]}_l{ix:04d}_{digest[:8]}"
                    execute_node = {**step, "id": sub_id, "_cancelled_callback": cancelled,
                                    "_progress_callback": None}
                    with bind_for_node(execute_node):
                        result = executor(step["type"])(execute_node, deps, source, workspace)
                    if not isinstance(result, dict):
                        raise TypeError(f"Loop body node {step['id']} must return a JSON object")
                    json.dumps(result, ensure_ascii=False, allow_nan=False)
                    if cache_enabled and step.get("cache", True):
                        _write_json(target, result)
                local[step["id"]] = result
                collected[step["id"]].append({ITEM_MARKER: True, "id": str(item["id"]),
                    "label": str(item.get("label") or item["id"]), "parent_id": item.get("parent_id"),
                    "index": ix, "status": "completed", "data": result})
            final = local[body_ids[-1]]
            finished.append({ITEM_MARKER: True, "id": str(item["id"]),
                "label": str(item.get("label") or item["id"]), "parent_id": item.get("parent_id"),
                "index": ix, "status": "completed", "data": final})
            if repeating:
                try:
                    actual = resolve_input_path(local, str(cfg["condition_path"]))
                except (TypeError, ValueError) as exc:
                    raise ValueError("Repeat Until condition path is missing in the body output") from exc
                condition_met = _predicate(actual, str(cfg.get("condition_operator", "truthy")),
                                           cfg.get("condition_value", True))
                previous = final
            tracker.set(ix, "completed")
        except Exception as exc:
            tracker.set(ix, "failed", f"{type(exc).__name__}: {exc}")
            tracker.emit(progress, stage="loop", message=f"Loop iteration {ix+1} failed", force=True)
            failures.append({"id": str(item["id"]), "index": ix,
                             "error": f"{type(exc).__name__}: {exc}"[:400]})
            if repeating or cfg.get("error_policy", "stop") == "stop":
                raise ValueError(f"Loop {ident} iteration {ix+1}/{max_count} failed: {exc}") from exc
        tracker.emit(progress, stage="loop", message=f"Loop {ix+1}/{max_count}", force=ix < 3)
        if repeating and condition_met:
            break

    tracker.emit(progress, stage="loop_complete", message=f"Loop finished after {iterations} iterations", force=True)
    if repeating and not condition_met and cfg.get("on_limit", "error") == "error":
        raise ValueError(f"Repeat Until {ident} exhausted {max_iterations} iterations without meeting condition")

    body_outputs = {step: {
        "status": "partial" if failures else "completed", "items": collected[step],
        "item_execution": {"mode": "loop_body", "controller": ident,
                           "executions": len(collected[step]), "failed": len(failures)}
    } for step in body_ids}
    outcome = {
        "status": "partial" if failures else ("limit_reached" if repeating and not condition_met else "completed"),
        "items": finished, "failed_items": failures, "body_outputs": body_outputs,
        "loop": {"mode": "repeat_until" if repeating else "for_each_subgraph",
                 "iterations": iterations, "input_elements": 1 if repeating else len(data),
                 "completed": len(finished), "failed": len(failures),
                 "body_node_ids": body_ids, "condition_met": condition_met if repeating else None},
    }
    if repeating:
        outcome["last_result"] = previous
    return outcome, body_outputs
