"""CLIPTORA workflow node: data.filter.

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
        "label": "Filter", "group": "Data transformation",
        "settings": {"path": "", "field": "", "operator": "truthy", "value": ""},
        "parameters_schema": {"type": "object", "properties": {
            "path": {"type": "string", "title": "Items path", "description": "Dot path to an array, including the upstream node ID."},
            "field": {"type": "string", "title": "Item field", "description": "Optional dot path inside each item."},
            "operator": {"type": "string", "title": "Operator", "enum": ["truthy", "exists", "equals", "not_equals", "contains", "greater_than", "less_than"]},
            "value": {"type": "string", "title": "Comparison value"},
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
    items = input_path(outputs, str(cfg.get("path", "")))
    if not isinstance(items, list):
        raise ValueError("Filter items path must resolve to an array")
    if len(items) > 100_000:
        raise ValueError("Filter input exceeds 100,000 items")
    field = str(cfg.get("field", ""))
    operator = str(cfg.get("operator", "truthy"))
    kept = [item for item in items if compare_value(value_path(item, field), operator, cfg.get("value", ""))]
    return {"items": kept, "matched_count": len(kept), "input_count": len(items)}

NODE = NodeDefinition(type='data.filter', metadata=metadata, execute=execute)
