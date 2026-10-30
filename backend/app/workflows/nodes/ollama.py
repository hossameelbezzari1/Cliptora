"""CLIPTORA workflow node: ai.ollama.

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
        "label": "Ollama", "group": "AI", "description": "Run text and vision prompts through a local Ollama server.",
        "actions": ["analyze_image", "message_model"],
        "action_capabilities": {
            "analyze_image": {"status": "implemented", "group": "Image actions", "label": "Analyze image"},
            "message_model": {"status": "implemented", "group": "Text actions", "label": "Message a model"},
        },
        "settings": {"action": "message_model", "model": "gemma3", "system_prompt": "You are a helpful assistant.", "prompt": "", "image_urls": "", "input_path": "", "temperature": 0.2, "max_output_tokens": 1000, "simplify_output": True},
        "parameters_schema": {"type": "object", "properties": {
            "action": {"type": "string", "title": "Operation"},
            "model": {"type": "string", "title": "Ollama model", "description": "Exact installed model name returned by Ollama, for example gemma3."},
            "system_prompt": {"type": "string", "title": "System prompt"},
            "prompt": {"type": "string", "title": "Text input"},
            "image_urls": {"type": "string", "title": "Image URL(s)", "description": "One public HTTPS image URL per line; at most four images."},
            "input_path": {"type": "string", "title": "Optional input path", "description": "Append JSON data from this upstream dot path to the prompt."},
            "temperature": {"type": "number", "title": "Temperature", "minimum": 0, "maximum": 2},
            "max_output_tokens": {"type": "integer", "title": "Maximum output tokens", "minimum": 1, "maximum": 32768},
            "simplify_output": {"type": "boolean", "title": "Simplify Output", "default": True},
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
    return ollama_action(cfg, outputs)

NODE = NodeDefinition(type='ai.ollama', metadata=metadata, execute=execute)
