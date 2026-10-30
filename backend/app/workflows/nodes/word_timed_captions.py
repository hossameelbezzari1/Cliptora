"""CLIPTORA workflow node: caption.generate.

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
    return {"label": "Word Timed Captions", "group": "Creative", "settings": {"max_words": 5, "style": "karaoke"}}

def execute(node: dict[str, Any], outputs: dict[str, Any], source: Path | None, workdir: Path) -> dict[str, Any]:
    from app.services.workflow_core import (
        MAX_CUTS, MAX_TARGET_SECONDS, OPENAI_REASONING_EFFORTS,
        HIGHLIGHTS_SCHEMA, SUMMARY_SCHEMA, get_input, input_path, compare_value,
        tool, probe, as_words, group_words, normalize_highlights,
        offline_highlights, openai_json, openai_action, gemini_action,
        ollama_action, execute_ai_agent, execute_http_request, value_path,
    )
    kind, cfg = node['type'], node.get('settings', {})
    words = get_input(outputs, "words") or []
    highlights = get_input(outputs, "highlights")
    if highlights is not None:
        words = [w for w in words if any(h["start_word_id"] <= w["id"] <= h["end_word_id"] for h in highlights)]
    max_words = max(1, min(12, int(cfg.get("max_words", 5))))
    result = []
    for offset in range(0, len(words), max_words):
        chunk = words[offset:offset + max_words]
        if chunk:
            result.append({"start": chunk[0]["start"], "end": chunk[-1]["end"], "text": " ".join(w["text"] for w in chunk), "style": cfg.get("style", "karaoke"), "word_ids": [w["id"] for w in chunk]})
    return {"captions": result}

NODE = NodeDefinition(type='caption.generate', metadata=metadata, execute=execute)
