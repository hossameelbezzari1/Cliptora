"""CLIPTORA workflow node: flow.switch.

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
        "label": "Switch", "group": "Flow",
        "settings": {"path": "", "operator": "equals", "rules": [{"value": "", "route": 0}]},
        "parameters_schema": {"type": "object", "properties": {
            "path": {"type": "string", "title": "Input path", "description": "Dot path including the upstream node ID."},
            "operator": {"type": "string", "title": "Operator", "enum": ["equals", "not_equals", "contains", "greater_than", "less_than", "exists", "truthy"]},
            "rules": {"type": "array", "title": "Routing rules", "description": "Ordered JSON rules: [{\"value\":\"paid\",\"route\":0}]. Routes 0-4 are supported."},
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
    actual = input_path(outputs, str(cfg.get("path", "")))
    operator = str(cfg.get("operator", "equals"))
    rules = cfg.get("rules", [])
    if not isinstance(rules, list) or not 1 <= len(rules) <= 20:
        raise ValueError("Switch requires between 1 and 20 rules")
    route = None
    for rule in rules:
        if not isinstance(rule, dict) or not isinstance(rule.get("route"), int) or not 0 <= rule["route"] <= 4:
            raise ValueError("Switch routes must be integers from 0 to 4")
        if compare_value(actual, operator, rule.get("value", "")):
            route = rule["route"]
            break
    return {"route": route, "matched": route is not None, "operator": operator, "actual": actual}

NODE = NodeDefinition(type='flow.switch', metadata=metadata, execute=execute)
