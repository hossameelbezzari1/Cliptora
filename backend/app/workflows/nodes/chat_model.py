"""CLIPTORA workflow node: ai.chat_model.

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
        "label": "OpenAI Chat Model", "group": "AI", "description": "Model configuration for AI Agent nodes.",
        "settings": {"model": "gpt-6.1-sol", "reasoning_effort": "none", "temperature": 0.2, "max_output_tokens": 1000},
        "parameters_schema": {"type": "object", "properties": {
            "model": {"type": "string", "title": "Model", "enum": list(OPENAI_TEXT_MODELS)},
            "reasoning_effort": {"type": "string", "title": "Reasoning effort", "enum": list(OPENAI_REASONING_EFFORTS), "default": "none"},
            "temperature": {"type": "number", "title": "Temperature", "minimum": 0, "maximum": 2},
            "max_output_tokens": {"type": "integer", "title": "Maximum output tokens", "minimum": 1, "maximum": 16000},
        }},
        "credentials": ["OPENAI_API_KEY"],
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
    model = str(cfg.get("model") or "gpt-6.1-sol").strip()
    temperature = float(cfg.get("temperature", 0.2))
    max_tokens = int(cfg.get("max_output_tokens", 1000))
    if not re.fullmatch(r"[A-Za-z0-9._:-]{1,100}", model):
        raise ValueError("OpenAI model name is invalid")
    if not math.isfinite(temperature) or not 0 <= temperature <= 2:
        raise ValueError("OpenAI temperature must be between 0 and 2")
    if not 1 <= max_tokens <= 16_000:
        raise ValueError("OpenAI maximum output tokens must be between 1 and 16,000")
    effort = str(cfg.get("reasoning_effort", "none"))
    if effort not in OPENAI_REASONING_EFFORTS:
        raise ValueError("OpenAI reasoning effort is invalid")
    return {"chat_model": {"model": model, "reasoning_effort": effort, "temperature": temperature, "max_output_tokens": max_tokens}}

NODE = NodeDefinition(type='ai.chat_model', metadata=metadata, execute=execute)
