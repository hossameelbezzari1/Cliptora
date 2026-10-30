"""CLIPTORA workflow node: core.http_request.

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
        "label": "HTTP Request", "group": "Action in an app",
        "settings": {"method": "GET", "url": "", "query": {}, "headers": {}, "body": {}, "timeout_seconds": 30, "response_format": "auto"},
        "parameters_schema": {"type": "object", "properties": {
            "method": {"type": "string", "title": "Method", "enum": ["GET", "POST", "PUT", "PATCH", "DELETE"]},
            "url": {"type": "string", "title": "HTTPS URL", "description": "The hostname must be listed in CLIPTORA_WORKFLOW_HTTP_ALLOWED_HOSTS."},
            "query": {"type": "object", "title": "Query parameters"},
            "headers": {"type": "object", "title": "Headers", "description": "Secret-bearing headers are blocked; use the credential vault when available."},
            "body": {"type": "object", "title": "JSON body"},
            "timeout_seconds": {"type": "integer", "title": "Timeout (seconds)", "minimum": 1, "maximum": 120},
            "response_format": {"type": "string", "title": "Response format", "enum": ["auto", "json", "text"]},
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
    return execute_http_request(cfg)

NODE = NodeDefinition(type='core.http_request', metadata=metadata, execute=execute)
