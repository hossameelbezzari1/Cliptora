"""CLIPTORA workflow node: ai.summary.

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
    return {"label": "Create Summary Script", "group": "AI", "settings": {"mode": "offline", "language": "auto"}}

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
    words = get_input(outputs, "words") or []
    chosen = [w["text"] for h in highlights for w in words if h["start_word_id"] <= w["id"] <= h["end_word_id"]]
    speech = " ".join(chosen)[:20000]
    if not speech:
        raise ValueError("Summary needs selected spoken highlights")
    if cfg.get("mode", "offline") == "openai":
        text = openai_json("Summarize only the supplied spoken highlight text. Do not invent visuals or silent film actions. Return editable narration in JSON key summary. No copyrighted verbatim replication beyond brief necessary phrases.", speech, SUMMARY_SCHEMA)["summary"]
        return {"summary": str(text), "method": "openai"}
    if cfg.get("mode", "offline") != "offline":
        raise ValueError("Summary mode must be offline or openai")
    # Extractive fallback: not a generative or semantic summary.
    segments = group_words([w for w in words if any(h["start_word_id"] <= w["id"] <= h["end_word_id"] for h in highlights)])
    return {"summary": " ".join(s["text"] for s in segments[:12])[:3500], "method": "extractive_fallback"}

NODE = NodeDefinition(type='ai.summary', metadata=metadata, execute=execute)
