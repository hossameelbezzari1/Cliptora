"""CLIPTORA item-aware execution for explicitly enabled workflow nodes.

Old node contracts remain untouched: a node runs once unless execution_mode is
'for_each' or 'batch'. The source collection is always explicitly selected.
"""
from __future__ import annotations

import hashlib
from concurrent.futures import ThreadPoolExecutor, as_completed
from contextvars import copy_context
import json
import re
from pathlib import Path
from typing import Any, Callable

from app.workflows.InputResolver import resolve_input_path

ITEM_MARKER = "__cliptora_item"
MAX_ITEMS = 2000
_PARALLEL_SAFE = {"ai.gemini", "ai.openai", "ai.ollama", "audio.edge_tts"}
_NON_REPEATABLE = {"ai.agent", "ai.chat_model", "core.manual_trigger"}


def execution_settings(settings: dict[str, Any], node_type: str, deps: list[str]) -> dict[str, Any]:
    mode = settings.get("execution_mode", "once")
    if mode not in {"once", "for_each", "batch"}:
        raise ValueError("Execution Mode must be Run Once, For Each, or Batch")
    path = settings.get("execution_input_path", "")
    if not isinstance(path, str):
        raise ValueError("Execution Input Collection must be a path")
    path = path.strip()
    if mode != "once":
        if node_type in _NON_REPEATABLE or node_type.endswith("trigger"):
            raise ValueError(f"{node_type} cannot be repeated per item")
        if not path:
            raise ValueError("Select Execution Input Collection to enable For Each or Batch")
        source = path.split(".", 1)[0].split("[", 1)[0]
        if source not in deps:
            raise ValueError("Execution Input Collection must start with a directly connected node ID")
    else:
        source = ""
    shape = settings.get("execution_input_shape", "item")
    if shape not in {"item", "collection"}:
        raise ValueError("Execution Input Shape must be item or collection")
    batch_size = settings.get("execution_batch_size", 10)
    if type(batch_size) is not int or not 1 <= batch_size <= 200:
        raise ValueError("Execution Batch Size must be from 1 to 200")
    max_items = settings.get("execution_max_items", 500)
    if type(max_items) is not int or not 1 <= max_items <= MAX_ITEMS:
        raise ValueError(f"Execution Max Items must be from 1 to {MAX_ITEMS}")
    fail_policy = settings.get("execution_error_policy", "stop")
    if fail_policy not in {"stop", "continue"}:
        raise ValueError("Execution Error Policy must be stop or continue")
    empty_policy = settings.get("execution_empty_policy", "stop")
    if empty_policy not in {"stop", "empty"}:
        raise ValueError("Execution Empty Policy must be stop or empty")
    parallelism = settings.get("execution_parallelism", 1)
    if type(parallelism) is not int or not 1 <= parallelism <= 4:
        raise ValueError("Execution Parallelism must be between 1 and 4")
    if mode == "once" and parallelism != 1:
        raise ValueError("Parallel execution requires For Each or Batch")
    if mode != "once" and parallelism > 1 and node_type not in _PARALLEL_SAFE:
        raise ValueError(f"Parallel execution not supported by {node_type}; use 1 worker")
    flatten = settings.get("execution_flatten", False)
    if type(flatten) is not bool:
        raise ValueError("Execution Flatten must be boolean")
    return {"mode": mode, "path": path, "source": source, "shape": shape,
            "batch_size": batch_size, "max_items": max_items,
            "error_policy": fail_policy, "empty_policy": empty_policy,
            "flatten": flatten, "parallelism": parallelism}


def _flatten(values: list[Any], *, depth: int = 0) -> list[Any]:
    if depth > 8:
        raise ValueError("Nested collection exceeds 8 levels")
    flattened: list[Any] = []
    for value in values:
        if isinstance(value, list):
            flattened.extend(_flatten(value, depth=depth + 1))
        else:
            flattened.append(value)
    return flattened


def _source_data(record: Any) -> tuple[Any, dict[str, Any]]:
    if isinstance(record, dict) and record.get(ITEM_MARKER) is True:
        return record.get("data"), {
            "id": record.get("id"), "label": record.get("label"),
            "parent_id": record.get("parent_id"), "source_path": record.get("source_path")}
    return record, {}


def _safe_id(value: Any, fallback: str) -> str:
    raw = str(value or "").strip()
    return raw[:120] if re.fullmatch(r"[A-Za-z0-9_-]{1,120}", raw) else fallback


def _item_record(item: Any, index: int, source: str, path: str) -> dict[str, Any]:
    data, inherited = _source_data(item)
    natural = data if isinstance(data, dict) else {}
    identifier = _safe_id(
        inherited.get("id") or natural.get("item_id") or natural.get("instance_id")
        or natural.get("id") or natural.get("group_id"),
        f"item_{index + 1:05d}",
    )
    parent = inherited.get("parent_id") or natural.get("parent_id") or natural.get("group_id")
    label = inherited.get("label") or natural.get("label") or natural.get("title") or identifier
    return {ITEM_MARKER: True, "id": identifier, "label": str(label)[:160],
            "parent_id": str(parent)[:120] if parent is not None else None,
            "index": index, "source_path": path, "source_node": source,
            "status": "pending", "data": data}


def collection_items(deps: dict[str, Any], options: dict[str, Any]) -> list[dict[str, Any]]:
    raw = resolve_input_path(deps, options["path"])
    if not isinstance(raw, list):
        raise ValueError("Execution Input Collection must resolve to a JSON array")
    if options["flatten"]:
        raw = _flatten(raw)
    elif any(isinstance(x, list) for x in raw):
        raise ValueError("Nested arrays need Execution Flatten or a more precise collection path")
    if len(raw) > options["max_items"]:
        raise ValueError(f"Input has {len(raw)} elements; max is {options['max_items']}")
    records = [_item_record(item, i, options["source"], options["path"])
               for i, item in enumerate(raw)]
    return records


def _set_subpath(source: Any, tokens: list[str | int], payload: Any) -> Any:
    """Copy only the affected branch; never change the original upstream output."""
    if not tokens:
        return payload
    head = tokens[0]
    tail = tokens[1:]
    if isinstance(head, int):
        if not isinstance(source, list) or head >= len(source):
            raise ValueError("Invalid collection index")
        result = list(source)
        result[head] = _set_subpath(source[head], tail, payload)
        return result
    if not isinstance(source, dict) or head not in source:
        raise ValueError("Invalid collection field path")
    result = dict(source)
    result[head] = _set_subpath(source[head], tail, payload)
    return result


def _text_value(data: Any) -> str | None:
    if isinstance(data, str) and data.strip():
        return data
    if isinstance(data, dict):
        for field in ("text", "selected_text", "narration_text", "script", "content"):
            value = data.get(field)
            if isinstance(value, str) and value.strip():
                return value
    return None


def iteration_deps(deps: dict[str, Any], options: dict[str, Any], items: list[dict[str, Any]],
                   batch_index: int) -> dict[str, Any]:
    source = options["source"]
    if options["shape"] == "collection":
        local = options["path"][len(source):].lstrip(".")
        if "[]" in local:
            raise ValueError("Collection Input Shape requires a path without [] wildcards")
        tokens: list[str | int] = []
        for part in local.replace("[", ".").replace("]", "").split("."):
            if part:
                tokens.append(int(part) if part.isdecimal() else part)
        output = _set_subpath(deps[source], tokens, [row["data"] for row in items])
    elif options["mode"] == "batch":
        data = [row["data"] for row in items]
        output = {"items": data, "batch_items": data, "batch_index": batch_index,
                  "batch_size": len(data)}
        texts = [_text_value(value) for value in data]
        if all(value is not None for value in texts):
            output["texts"] = texts
    else:
        item = items[0]
        data = item["data"]
        output = dict(data) if isinstance(data, dict) else {"value": data}
        text = _text_value(data)
        if text is not None:
            output.setdefault("text", text)
        output["__cliptora_item_context"] = {
            "id": item["id"], "index": item["index"],
            "parent_id": item["parent_id"], "label": item["label"]}
    modified = dict(deps)
    modified[source] = output
    return modified


def _digest(value: Any) -> str:
    return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=False,
                                     allow_nan=False, default=str).encode("utf-8")).hexdigest()


def _write_json(target: Path, data: dict[str, Any]) -> None:
    temporary = target.with_name(target.name + ".tmp")
    temporary.write_text(json.dumps(data, ensure_ascii=False, allow_nan=False), encoding="utf8")
    temporary.replace(target)


def run_item_execution(
    node: dict[str, Any], deps: dict[str, Any], source: Path | None, workspace: Path,
    invoke: Callable[[dict[str, Any], dict[str, Any]], dict[str, Any]],
    cancelled: Callable[[], bool], progress: Callable[[dict[str, Any]], None] | None,
) -> dict[str, Any]:
    options = execution_settings(node.get("settings") or {}, node["type"], node["depends_on"])
    if options["mode"] == "once":
        raise ValueError("Item execution requires For Each or Batch mode")
    records = collection_items(deps, options)
    if not records:
        if options["empty_policy"] == "stop":
            raise ValueError(f"Execution Input Collection '{options['path']}' contains 0 elements")
        return {"status": "empty", "items": [], "failed_items": [], "item_execution": {
            "mode": options["mode"], "source": options["path"], "input_elements": 0,
            "executions": 0, "completed": 0, "failed": 0, "output_items": 0}}

    size = options["batch_size"] if options["mode"] == "batch" else 1
    sets = [records[i:i + size] for i in range(0, len(records), size)]
    cache_dir = workspace / f".{node['id']}.item_cache"
    cache_enabled = bool(node.get("cache", True))
    if cache_enabled:
        cache_dir.mkdir(parents=True, exist_ok=True)

    source_fingerprint = None
    if source is not None and source.is_file():
        stat = source.stat()
        source_fingerprint = {"path": str(source), "size": stat.st_size,
                              "mtime_ns": stat.st_mtime_ns}

    def work(index: int, current: list[dict[str, Any]]) -> dict[str, Any]:
        if cancelled():
            raise RuntimeError("Item execution cancelled")
        input_data = iteration_deps(deps, options, current, index)
        digest = _digest({"node": {k: v for k, v in node.items() if not k.startswith("_")},
                          "items": current, "deps": input_data, "source": source_fingerprint})
        target = cache_dir / f"{index:06d}-{digest[:20]}.json"
        candidate: dict[str, Any] | None = None
        if cache_enabled and target.is_file():
            try:
                restored = json.loads(target.read_text(encoding="utf8"))
                if isinstance(restored, dict):
                    candidate = restored
            except (ValueError, OSError):
                pass
        if candidate is None:
            subnode = {**node, "id": f"{node['id'][:25]}_i{index:05d}_{digest[:8]}",
                       "settings": dict(node.get("settings") or {}),
                       "_progress_callback": None if options["parallelism"] > 1 else node.get("_progress_callback")}
            for key in ("input_path", "input_field"):
                if options["shape"] == "item" and subnode["settings"].get(key) == options["path"]:
                    subnode["settings"][key] = options["source"]
            candidate = invoke(subnode, input_data)
            if not isinstance(candidate, dict):
                raise ValueError("Each item execution must return a JSON object")
            json.dumps(candidate, ensure_ascii=False, allow_nan=False)
            if cache_enabled:
                _write_json(target, candidate)
        return candidate

    outcomes: dict[int, dict[str, Any] | Exception] = {}
    if options["parallelism"] == 1:
        for index, current in enumerate(sets):
            if callable(progress):
                progress({"stage": "items", "message": f"Processing iteration {index+1}/{len(sets)}",
                          "unit": "iterations", "processed": index, "total": len(sets),
                          "progress": round(index * 100 / len(sets), 2)})
            try:
                outcomes[index] = work(index, current)
            except Exception as exc:
                if options["error_policy"] == "stop":
                    raise ValueError(f"Item iteration {index+1}/{len(sets)} ({current[0]['id']}) failed: {exc}") from exc
                outcomes[index] = exc
    else:
        with ThreadPoolExecutor(max_workers=options["parallelism"]) as pool:
            futures = {pool.submit(copy_context().run, work, index, current): index
                       for index, current in enumerate(sets)}
            for future in as_completed(futures):
                index = futures[future]
                try:
                    outcomes[index] = future.result()
                except Exception as exc:
                    outcomes[index] = exc
                if callable(progress):
                    done = len(outcomes)
                    progress({"stage": "items", "message": f"Completed {done}/{len(sets)} iterations",
                              "unit": "iterations", "processed": done, "total": len(sets),
                              "progress": round(100 * done / len(sets), 2)})
        if cancelled():
            raise RuntimeError("Item execution cancelled")
        if options["error_policy"] == "stop":
            for index in range(len(sets)):
                outcome = outcomes[index]
                if isinstance(outcome, Exception):
                    raise ValueError(f"Item iteration {index+1}/{len(sets)} ({sets[index][0]['id']}) failed: {outcome}") from outcome

    completed: list[dict[str, Any]] = []
    failed: list[dict[str, Any]] = []
    for index, current in enumerate(sets):
        outcome = outcomes[index]
        if isinstance(outcome, Exception):
            for row in current:
                failed.append({**row, "status": "failed", "error": f"{type(outcome).__name__}: {outcome}"[:400]})
            continue
        if options["mode"] == "batch":
            completed.append({ITEM_MARKER: True, "id": f"batch_{index+1:05d}",
                              "label": f"Batch {index+1}", "parent_id": None, "index": index,
                              "status": "completed", "source_path": options["path"],
                              "input_item_ids": [r["id"] for r in current], "data": outcome})
        else:
            completed.append({**current[0], "status": "completed", "data": outcome})
    if callable(progress):
        progress({"stage": "items_complete", "message": "Item execution completed",
                  "unit": "iterations", "processed": len(sets), "total": len(sets),
                  "progress": 100, "force": True})
    return {"status": "partial" if failed else "completed",
            "items": completed, "failed_items": failed,
            "item_execution": {"mode": options["mode"], "source": options["path"],
                               "input_elements": len(records), "executions": len(sets),
                               "completed": len(completed), "failed": len(failed),
                               "output_items": len(completed), "batch_size": size,
                               "input_shape": options["shape"],
                               "parallelism": options["parallelism"]}}


def describe_collections(value: dict[str, Any]) -> list[dict[str, Any]]:
    """Report arrays without turning their elements into independent executions."""
    result: list[dict[str, Any]] = []

    def walk(data: Any, path: str, depth: int) -> None:
        if len(result) >= 40 or depth > 2:
            return
        if isinstance(data, list):
            result.append({"path": path, "elements": len(data)})
        elif isinstance(data, dict):
            for name, child in data.items():
                if name in {"provenance", "chunk_results", "usage"}:
                    continue
                if isinstance(child, (list, dict)):
                    walk(child, f"{path}.{name}" if path else name, depth + 1)
    walk(value, "", 0)
    return result