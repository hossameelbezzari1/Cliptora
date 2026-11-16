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
from datetime import datetime, timezone
from queue import SimpleQueue
from concurrent.futures import wait, FIRST_COMPLETED
from pathlib import Path
from typing import Any, Callable

from app.workflows.InputResolver import resolve_input_path

class LiveItemTracker:
    """Bounded, public per-task state. No input payloads or credentials are emitted.

    Every transition originates in the real executor. The UI never guesses
    whether a task has started. Running summaries stay small for large loops.
    """

    VISIBLE_FIRST = 40
    VISIBLE_RECENT = 20

    def __init__(self, mode: str, items: list[dict[str, Any]]) -> None:
        self.mode = mode
        self.items: list[dict[str, Any]] = [
            {"id": str(item.get("id") or f"item_{i+1}")[:120],
             "label": str(item.get("label") or item.get("id") or f"Item {i+1}")[:100],
             "index": i, "state": "waiting"}
            for i, item in enumerate(items)
        ]
        self._recent: list[int] = []
        self._counts = {"waiting": len(items), "running": 0,
                        "completed": 0, "failed": 0, "skipped": 0}

    def append(self, identifier: str, label: str) -> int:
        """Announce an iteration only after a Repeat Until loop actually starts it."""
        index = len(self.items)
        self.items.append({"id": str(identifier)[:120], "label": str(label)[:100],
                           "index": index, "state": "waiting"})
        self._counts["waiting"] += 1
        return index

    def set(self, index: int, state: str, error: str | None = None) -> None:
        if not 0 <= index < len(self.items):
            return
        if state not in self._counts:
            raise ValueError(f"Unknown live task state: {state}")
        row = self.items[index]
        old = str(row["state"])
        if old != state:
            self._counts[old] -= 1
            self._counts[state] += 1
        row["state"] = state
        stamp = datetime.now(timezone.utc).isoformat()
        if state == "running":
            row["started_at"] = stamp
        if state in {"completed", "failed", "skipped"}:
            row["finished_at"] = stamp
        if error:
            row["error"] = str(error)[:240]
        if index >= self.VISIBLE_FIRST:
            if index in self._recent:
                self._recent.remove(index)
            self._recent.append(index)
            del self._recent[:-self.VISIBLE_RECENT]

    def snapshot(self) -> dict[str, Any]:
        visible = set(range(min(self.VISIBLE_FIRST, len(self.items))))
        visible.update(self._recent)
        return {
            "mode": self.mode, "total": len(self.items), **self._counts,
            "items": [dict(self.items[index]) for index in sorted(visible)],
            "truncated": len(visible) < len(self.items),
        }

    def emit(self, progress: Callable[[dict[str, Any]], None] | None,
             *, stage: str, message: str, force: bool = False,
             **extra: Any) -> None:
        if not callable(progress):
            return
        completed = self._counts["completed"] + self._counts["failed"] + self._counts["skipped"]
        progress({"stage": stage, "message": message[:200],
                  "unit": "iterations", "processed": completed,
                  "total": len(self.items),
                  "progress": round(completed * 100 / max(1, len(self.items)), 2),
                  "item_execution_live": self.snapshot(), "force": force,
                  **extra})


def live_snapshot_from_result(value: dict[str, Any]) -> dict[str, Any] | None:
    """Make cached run artifacts inspectable without faking live transitions."""
    if not isinstance(value, dict):
        return None
    completed = value.get("items")
    failed = value.get("failed_items")
    if not isinstance(completed, list) or not isinstance(failed, list):
        # Historical/cached Edge TTS artifacts are reported as completed tasks,
        # never as simulated "running" events.
        voiceovers = value.get("voiceovers")
        voice_failures = value.get("failed_voiceovers")
        voice_skipped = value.get("skipped_voiceovers")
        if isinstance(voiceovers, list):
            voice_failures = voice_failures if isinstance(voice_failures, list) else []
            voice_skipped = voice_skipped if isinstance(voice_skipped, list) else []
            all_rows = [(row, "completed") for row in voiceovers] + [
                (row, "failed") for row in voice_failures] + [
                (row, "skipped") for row in voice_skipped]
            if not all_rows:
                return None
            tracker = LiveItemTracker("edge_tts_voiceovers", [
                {"id": row.get("instance_id") or row.get("group_id") or f"item_{i+1}",
                 "label": row.get("instance_id") or row.get("group_id") or f"Voice {i+1}"}
                if isinstance(row, dict) else {"id": f"item_{i+1}"}
                for i, (row, _) in enumerate(all_rows)
            ])
            for i, (row, state) in enumerate(all_rows):
                error = str(row.get("error") or "") if isinstance(row, dict) else None
                tracker.set(i, state, error)
            return tracker.snapshot()
        return None
    stats = value.get("item_execution") if isinstance(value.get("item_execution"), dict) else {}
    loop = value.get("loop") if isinstance(value.get("loop"), dict) else {}
    tracker = LiveItemTracker(str(stats.get("mode") or loop.get("mode") or "items"), [
        {"id": item.get("id", f"item_{i+1}"), "label": item.get("label", item.get("id", f"Item {i+1}"))}
        if isinstance(item, dict) else {"id": f"item_{i+1}"}
        for i, item in enumerate(completed + failed)
    ])
    for i, item in enumerate(completed):
        tracker.set(i, "completed")
    for i, item in enumerate(failed, start=len(completed)):
        tracker.set(i, "failed", str(item.get("error", "")) if isinstance(item, dict) else None)
    return tracker.snapshot()


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

    tracker = LiveItemTracker(options["mode"], [
        {"id": (current[0]["id"] if options["mode"] != "batch" else f"batch_{i+1:05d}"),
         "label": (current[0]["label"] if options["mode"] != "batch" else f"Batch {i+1} ({len(current)} items)")}
        for i, current in enumerate(sets)
    ])
    tracker.emit(progress, stage="items_ready", message=f"{len(sets)} iterations queued", force=True)
    outcomes: dict[int, dict[str, Any] | Exception] = {}
    if options["parallelism"] == 1:
        for index, current in enumerate(sets):
            if cancelled():
                raise RuntimeError("Item execution cancelled")
            tracker.set(index, "running")
            tracker.emit(progress, stage="items", message=f"Processing iteration {index+1}/{len(sets)}",
                         force=index < 4)
            try:
                outcomes[index] = work(index, current)
                tracker.set(index, "completed")
            except Exception as exc:
                outcomes[index] = exc
                tracker.set(index, "failed", f"{type(exc).__name__}: {exc}")
                tracker.emit(progress, stage="items", message=f"Iteration {index+1} failed", force=True)
                if options["error_policy"] == "stop":
                    raise ValueError(f"Item iteration {index+1}/{len(sets)} ({current[0]['id']}) failed: {exc}") from exc
            tracker.emit(progress, stage="items", message=f"Processed {index+1}/{len(sets)} iterations",
                         force=index < 4)
    else:
        # Workers announce actual start through a thread-safe queue. Only the
        # coordinating thread emits progress to Engine/MySQL, avoiding races.
        started: SimpleQueue[int] = SimpleQueue()
        def tracked_work(index: int, current: list[dict[str, Any]]) -> dict[str, Any]:
            started.put(index)
            return work(index, current)

        with ThreadPoolExecutor(max_workers=options["parallelism"]) as pool:
            futures = {
                pool.submit(copy_context().run, tracked_work, index, current): index
                for index, current in enumerate(sets)
            }
            remaining = set(futures)
            while remaining:
                done, remaining = wait(remaining, timeout=0.25, return_when=FIRST_COMPLETED)
                while not started.empty():
                    index = started.get()
                    tracker.set(index, "running")
                    tracker.emit(progress, stage="items", message=f"Iteration {index+1} running",
                                 force=index < 4)
                for future in done:
                    index = futures[future]
                    try:
                        outcomes[index] = future.result()
                        tracker.set(index, "completed")
                    except Exception as exc:
                        outcomes[index] = exc
                        tracker.set(index, "failed", f"{type(exc).__name__}: {exc}")
                    tracker.emit(progress, stage="items", message=f"Processed {len(outcomes)}/{len(sets)} iterations",
                                 force=isinstance(outcomes[index], Exception) or len(outcomes) <= 4)
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
    tracker.emit(progress, stage="items_complete", message="Item execution completed", force=True)
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
