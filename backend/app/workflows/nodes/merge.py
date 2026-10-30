"""CLIPTORA workflow node: flow.merge.

Executor logic and metadata were migrated from the existing workflow_core.py.
Shared pure helpers remain in workflow_core during compatibility refactor.
"""
from __future__ import annotations
import hashlib
import json
import math
import os
import re
import tempfile
from pathlib import Path
from typing import Any
from app.workflows.base import NodeDefinition

def metadata() -> dict[str, Any]:
    from app.workflows.model_constants import (
        OPENAI_TEXT_MODELS, OPENAI_IMAGE_MODELS, OPENAI_MODERATION_MODELS,
        OPENAI_REASONING_EFFORTS, GEMINI_TEXT_MODELS, GEMINI_IMAGE_MODELS,
    )
    return {
        "label": "Merge", "group": "Flow",
        "settings": {"mode": "append"},
        "parameters_schema": {"type": "object", "properties": {
            "mode": {"type": "string", "title": "Merge mode", "enum": ["append", "combine", "choose_first"]},
        }},
    }

def execute(node: dict[str, Any], outputs: dict[str, Any], source: Path | None, workdir: Path) -> dict[str, Any]:
    from app.services.workflow_core import (
        MAX_CUTS, MAX_TARGET_SECONDS, OPENAI_REASONING_EFFORTS,
        HIGHLIGHTS_SCHEMA, SUMMARY_SCHEMA, get_input, input_path, compare_value,
        tool, probe, as_words, group_words, normalize_highlights,
        offline_highlights, openai_json, openai_action, gemini_action,
        ollama_action, execute_ai_agent, execute_http_request, value_path,
    )
    kind, cfg = node['type'], node.get('settings', {})
    mode = str(cfg.get("mode", "append"))
    values = list(outputs.values())
    if len(values) < 2:
        raise ValueError("Merge requires at least two connected inputs")
    if mode == "choose_first":
        return {"items": values[0], "mode": mode, "input_count": len(values)}
    if mode == "combine":
        combined: dict[str, Any] = {}
        for dependency_id, value in outputs.items():
            if not isinstance(value, dict):
                raise ValueError(f"Merge combine requires object input from {dependency_id}")
            combined.update(value)
        return {"items": combined, "mode": mode, "input_count": len(values)}
    if mode == "append":
        appended: list[Any] = []
        for value in values:
            candidate = value.get("items") if isinstance(value, dict) and "items" in value else value
            appended.extend(candidate if isinstance(candidate, list) else [candidate])
        return {"items": appended, "mode": mode, "input_count": len(values)}
    raise ValueError("Merge mode must be append, combine or choose_first")

NODE = NodeDefinition(type='flow.merge', metadata=metadata, execute=execute)
