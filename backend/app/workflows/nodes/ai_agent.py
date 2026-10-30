"""CLIPTORA workflow node: ai.agent.

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
        "label": "AI Agent", "group": "AI", "description": "Use a connected chat model with optional memory and tool inputs.",
        "settings": {
            "prompt_source": "connected_chat_trigger", "prompt": "{{ $json.chatInput }}",
            "require_specific_output": False, "enable_fallback_model": False,
            "fallback_model": "", "system_message": "You are a helpful AI agent.",
            "__cliptora_ui_target_handles": {},
        },
        "parameters_schema": {"type": "object", "properties": {
            "prompt_source": {"type": "string", "title": "Source for Prompt (User Message)", "enum": ["connected_chat_trigger", "define_below"]},
            "prompt": {"type": "string", "title": "Prompt (User Message)"},
            "require_specific_output": {"type": "boolean", "title": "Require Specific Output Format"},
            "enable_fallback_model": {"type": "boolean", "title": "Enable Fallback Model"},
            "fallback_model": {"type": "string", "title": "Fallback model"},
            "system_message": {"type": "string", "title": "System message"},
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
    return execute_ai_agent(cfg, outputs)

NODE = NodeDefinition(type='ai.agent', metadata=metadata, execute=execute)
