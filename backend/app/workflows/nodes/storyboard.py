"""CLIPTORA workflow node: animation.storyboard.

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
    return {"label": "Text Scene Storyboard", "group": "Creative", "settings": {"script": "", "scene_seconds": 4}}

def execute(node: dict[str, Any], outputs: dict[str, Any], source: Path | None, workdir: Path) -> dict[str, Any]:
    from app.services.workflow_core import (
        MAX_CUTS, MAX_TARGET_SECONDS, OPENAI_REASONING_EFFORTS,
        HIGHLIGHTS_SCHEMA, SUMMARY_SCHEMA, get_input, input_path, compare_value,
        tool, probe, as_words, group_words, normalize_highlights,
        offline_highlights, openai_json, openai_action, gemini_action,
        ollama_action, execute_ai_agent, execute_http_request, value_path,
    )
    kind, cfg = node['type'], node.get('settings', {})
    script = str(cfg.get("script", "")).strip()
    if not script:
        raise ValueError("Write a script in storyboard node settings")
    seconds = max(0.5, min(30, float(cfg.get("scene_seconds", 4))))
    lines = [line.strip() for line in script.splitlines() if line.strip()][:100]
    return {"scenes": [{"index": i, "start": round(i * seconds, 3), "duration": seconds, "text": line} for i, line in enumerate(lines)]}

NODE = NodeDefinition(type='animation.storyboard', metadata=metadata, execute=execute)
