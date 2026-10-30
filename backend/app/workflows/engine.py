"""Workflow execution engine extracted from legacy workflow_core.

Maintains validated ordering, per-node cache/checkpoints, branch routing,
retries, cancellation and JSON artifact format.
"""
from __future__ import annotations
import hashlib
import json
import os
from pathlib import Path
from typing import Callable

def run_graph(nodes: list[dict], source: Path | None, workspace: Path, update: Callable[[int, str, dict], None], cancelled: Callable[[], bool] = lambda: False) -> dict:
    from app.services.workflow_core import validate_workflow, get_input, call_node
    ordered = validate_workflow(nodes)
    workspace.mkdir(parents=True, exist_ok=True)
    outputs: dict[str, dict] = {}
    summary = {}
    for index, node in enumerate(ordered):
        if cancelled():
            return {"status": "cancelled", "nodes": summary}
        deps = {key: outputs[key] for key in node["depends_on"] if key in outputs}
        has_video = source is not None
        condition = node.get("when", "always")
        branch_condition = get_input(deps, "condition")
        switch_route = get_input(deps, "route")
        satisfied = condition == "always" or (condition == "has_video" and has_video) or (condition == "has_transcript" and get_input(deps, "words") is not None) or (condition == "ai_enabled" and bool(os.environ.get("OPENAI_API_KEY"))) or (condition == "condition_true" and branch_condition is True) or (condition == "condition_false" and branch_condition is False) or (condition.startswith("route_") and condition != "route_fallback" and switch_route == int(condition.removeprefix("route_"))) or (condition == "route_fallback" and switch_route is None)
        if not satisfied or len(deps) != len(node["depends_on"]):
            summary[node["id"]] = {"state": "skipped", "type": node["type"]}
            update(int(100 * (index + 1) / len(ordered)), node["id"], summary)
            continue
        artifact = workspace / f"{node['id']}.json"
        checkpoint = workspace / f".{node['id']}.sha256"
        source_fingerprint = None if source is None else {"path": str(source), "size": source.stat().st_size, "mtime": source.stat().st_mtime_ns}
        fingerprint = hashlib.sha256(json.dumps({"node": node, "deps": deps, "source": source_fingerprint}, sort_keys=True, ensure_ascii=False).encode()).hexdigest()
        result = None
        cached = False
        if node.get("cache", True) and artifact.is_file() and checkpoint.is_file() and checkpoint.read_text(encoding="ascii") == fingerprint:
            try:
                result = json.loads(artifact.read_text(encoding="utf-8"))
                cached = True
            except (OSError, ValueError):
                result = None
        attempts = 0
        last_error: Exception | None = None
        while result is None and attempts <= node.get("retry_limit", 1):
            attempts += 1
            try:
                result = call_node(node, deps, source, workspace)
            except Exception as exc:
                last_error = exc
        if result is None:
            raise RuntimeError(f"Node {node['id']} failed after {attempts} attempt(s): {last_error}") from last_error
        target = workspace / f".{node['id']}.tmp"
        if not cached:
            target.write_text(json.dumps(result, ensure_ascii=False, allow_nan=False), encoding="utf-8")
            target.replace(artifact)
            checkpoint.write_text(fingerprint, encoding="ascii")
        outputs[node["id"]] = result
        public = {"state": "completed", "type": node["type"], "artifact": True, "cached": cached, "attempts": attempts}
        for key in ("output_duration", "target_duration", "language", "method"):
            if key in result:
                public[key] = result[key]
        for key in ("words", "segments", "highlights", "cut_plan", "captions", "scenes", "keyframes"):
            if isinstance(result.get(key), list):
                public[f"{key}_count"] = len(result[key])
        if "render" in result:
            public["render"] = result["render"]
        summary[node["id"]] = public
        update(int(100 * (index + 1) / len(ordered)), node["id"], summary)
    return {"status": "completed", "nodes": summary}

