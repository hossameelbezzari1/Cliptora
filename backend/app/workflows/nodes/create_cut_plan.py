"""CLIPTORA workflow node: timeline.cut_plan.

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
    return {"label": "Create Non-Destructive Cuts", "group": "Editing", "settings": {"padding": 0.15}}

def execute(node: dict[str, Any], outputs: dict[str, Any], source: Path | None, workdir: Path) -> dict[str, Any]:
    from app.services.workflow_core import (
        MAX_CUTS, MAX_TARGET_SECONDS, OPENAI_REASONING_EFFORTS,
        HIGHLIGHTS_SCHEMA, SUMMARY_SCHEMA, get_input, input_path, compare_value,
        tool, probe, as_words, group_words, normalize_highlights,
        offline_highlights, openai_json, openai_action, gemini_action,
        ollama_action, execute_ai_agent, execute_http_request, value_path,
    )
    kind, cfg = node['type'], node.get('settings', {})
    highlights = get_input(outputs, "highlights") or []
    if not highlights:
        raise ValueError("Cut plan requires highlights")
    padding = max(0, min(1.5, float(cfg.get("padding", 0.15))))
    source_duration = (get_input(outputs, "probe") or {}).get("duration")
    cuts = []
    at = 0.0
    for h in highlights[:MAX_CUTS]:
        beginning = max(0, float(h["start"]) - padding)
        ending = min(float(source_duration), float(h["end"]) + padding) if source_duration else float(h["end"]) + padding
        if ending <= beginning:
            continue
        duration = round(ending - beginning, 3)
        cuts.append({"source_start": round(beginning, 3), "source_end": round(ending, 3), "timeline_start": round(at, 3), "duration": duration, "reason": h.get("reason", "")})
        at += duration
    return {"cut_plan": cuts, "output_duration": round(at, 3)}

NODE = NodeDefinition(type='timeline.cut_plan', metadata=metadata, execute=execute)
