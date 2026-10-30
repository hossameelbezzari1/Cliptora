"""CLIPTORA workflow node: flow.if.

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
        "label": "IF", "group": "Flow",
        "settings": {"path": "", "operator": "truthy", "value": ""},
        "parameters_schema": {"type": "object", "properties": {
            "path": {"type": "string", "title": "Input path"},
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
    operator = str(cfg.get("operator", "truthy"))
    actual = input_path(outputs, str(cfg.get("path", "")))
    condition = compare_value(actual, operator, cfg.get("value", ""))
    return {"condition": condition, "operator": operator, "path": str(cfg.get("path", "")), "actual": actual}

NODE = NodeDefinition(type='flow.if', metadata=metadata, execute=execute)
