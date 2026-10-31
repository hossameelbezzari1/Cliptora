from __future__ import annotations
import hashlib
import base64
import ipaddress
import json
import math
import os
import re
import socket
import subprocess
import tempfile
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any, Callable
from app.workflows.model_constants import (OPENAI_TEXT_MODELS, OPENAI_IMAGE_MODELS,
    OPENAI_MODERATION_MODELS, OPENAI_REASONING_EFFORTS, GEMINI_TEXT_MODELS, GEMINI_IMAGE_MODELS)

from app.workflows.catalog import NODE_TYPES
MAX_NODES = 100


def validate_workflow(nodes: list[dict]) -> list[dict]:
    if not isinstance(nodes, list) or not 1 <= len(nodes) <= MAX_NODES:
        raise ValueError(f"Workflow must have 1 to {MAX_NODES} nodes")
    by_id: dict[str, dict] = {}
    for node in nodes:
        if not isinstance(node, dict):
            raise ValueError("Each node must be an object")
        ident, kind = node.get("id"), node.get("type")
        if not isinstance(ident, str) or not re.fullmatch(r"[a-zA-Z][a-zA-Z0-9_-]{0,47}", ident):
            raise ValueError("Invalid node id")
        if ident in by_id:
            raise ValueError(f"Duplicate node: {ident}")
        if kind not in NODE_TYPES:
            raise ValueError(f"Unknown or unauthorized node: {kind}")
        deps = node.get("depends_on", [])
        if not isinstance(deps, list) or len(deps) > MAX_NODES or any(not isinstance(d, str) for d in deps) or len(deps) != len(set(deps)):
            raise ValueError(f"Invalid dependencies for {ident}")
        if node.get("when", "always") not in ("always", "has_video", "has_transcript", "ai_enabled", "condition_true", "condition_false", "route_0", "route_1", "route_2", "route_3", "route_4", "route_fallback"):
            raise ValueError(f"Invalid condition for {ident}")
        settings = node.get("settings", {})
        if not isinstance(settings, dict):
            raise ValueError(f"Settings must be an object for {ident}")
        try:
            encoded_settings = json.dumps(settings, ensure_ascii=False, allow_nan=False)
        except (TypeError, ValueError, OverflowError, RecursionError) as exc:
            raise ValueError(f"Settings must contain finite, JSON-compatible data for {ident}") from exc
        if len(encoded_settings.encode("utf-8")) > 200_000:
            raise ValueError(f"Settings too large for {ident}")
        position = node.get("position", {})
        if not isinstance(position, dict):
            raise ValueError(f"Invalid canvas position for {ident}")
        try:
            x, y = float(position.get("x", 0)), float(position.get("y", 0))
        except (TypeError, ValueError) as exc:
            raise ValueError(f"Invalid canvas position for {ident}") from exc
        if not math.isfinite(x) or not math.isfinite(y) or abs(x) > 100_000 or abs(y) > 100_000:
            raise ValueError(f"Invalid canvas position for {ident}")
        retry_limit = node.get("retry_limit", 1)
        if type(retry_limit) is not int or not 0 <= retry_limit <= 5:
            raise ValueError(f"Retry limit for {ident} must be between 0 and 5")
        if not isinstance(node.get("cache", True), bool):
            raise ValueError(f"Cache setting for {ident} must be boolean")
        by_id[ident] = {"id": ident, "type": kind, "depends_on": deps, "settings": settings,
                        "when": node.get("when", "always"), "retry_limit": retry_limit,
                        "cache": node.get("cache", True), "position": {"x": round(x, 2), "y": round(y, 2)}}
    for ident, node in by_id.items():
        if ident in node["depends_on"] or any(d not in by_id for d in node["depends_on"]):
            raise ValueError(f"Missing or self dependency for {ident}")
    ordered: list[dict] = []
    pending = dict(by_id)
    while pending:
        ready = [node for node in pending.values() if all(d not in pending for d in node["depends_on"])]
        if not ready:
            raise ValueError("Workflow has a dependency cycle")
        for node in ready:
            ordered.append(node)
            del pending[node["id"]]
    return ordered


def execution_nodes(nodes: list[dict[str, Any]], target_node_id: str | None) -> list[dict[str, Any]]:
    """Return the full validated graph, or one node and its transitive dependencies."""
    validated = validate_workflow(nodes)
    if target_node_id is None:
        return validated
    by_id = {node["id"]: node for node in validated}
    if target_node_id not in by_id:
        raise ValueError("Target node does not exist in this workflow")
    required: set[str] = set()

    def include(node_id: str) -> None:
        if node_id in required:
            return
        required.add(node_id)
        for dependency in by_id[node_id]["depends_on"]:
            include(dependency)

    include(target_node_id)
    return [node for node in validated if node["id"] in required]


class WorkflowValidator:
    def validate(self, nodes: list[dict]) -> list[dict]:
        return validate_workflow(nodes)

    def for_node(self, nodes: list[dict], node_id: str | None):
        return execution_nodes(nodes, node_id)
