"""CLIPTORA workflow node: ai.highlights.

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
    return {"label": "Select Best Moments", "group": "AI", "settings": {"mode": "offline", "target_duration": 90, "strategy": "story_recap"}}

def execute(node: dict[str, Any], outputs: dict[str, Any], source: Path | None, workdir: Path) -> dict[str, Any]:
    from app.services.workflow_core import (
        MAX_CUTS, MAX_TARGET_SECONDS, OPENAI_REASONING_EFFORTS,
        HIGHLIGHTS_SCHEMA, SUMMARY_SCHEMA, get_input, input_path, compare_value,
        tool, probe, as_words, group_words, normalize_highlights,
        offline_highlights, openai_json, openai_action, gemini_action,
        ollama_action, execute_ai_agent, execute_http_request, value_path,
    )
    kind, cfg = node['type'], node.get('settings', {})
    words = get_input(outputs, "words")
    if not words:
        raise ValueError("Highlights requires transcribed words")
    duration = max(5, min(MAX_TARGET_SECONDS, int(cfg.get("target_duration", 90))))
    mode = cfg.get("mode", "offline")
    if mode == "openai":
        segments = group_words(words, gap=0.8, limit=40)
        # Huge films: bound tokens; split text into chunks while retaining canonical word IDs.
        chunks: list[list[dict]] = []
        current = []
        count = 0
        for segment in segments:
            current.append(segment)
            count += len(segment["text"])
            if count > 14000:
                chunks.append(current)
                current, count = [], 0
        if current:
            chunks.append(current)
        proposals = []
        for part in chunks:
            text = "\n".join(f"[{s['start_word_id']}-{s['end_word_id']}] {s['text']}" for s in part)
            prompt = f"Select meaningful contiguous spoken moments for a {cfg.get('strategy', 'story_recap')} video edit, total budget ~{duration}s across all chunks. Answer as JSON. Use only supplied word IDs. Keep chronological context; avoid hallucinating silent/visual content. Each pick has start_word_id,end_word_id,score 0-100,reason. Up to 10 picks per chunk."
            proposals.extend(openai_json(prompt, text, HIGHLIGHTS_SCHEMA).get("highlights", []))
        ranked = normalize_highlights(proposals, words)
        chosen, total = [], 0.0
        for row in sorted(ranked, key=lambda x: -x["score"]):
            if total >= duration:
                break
            chosen.append(row)
            total += row["end"] - row["start"]
        moments = sorted(chosen, key=lambda x: x["start"])
    elif mode == "manual":
        moments = normalize_highlights(cfg.get("highlights", []), words)
    elif mode == "offline":
        moments = offline_highlights(words, duration, str(cfg.get("strategy", "story_recap")))
    else:
        raise ValueError("mode must be offline, manual or openai")
    return {"highlights": moments, "method": mode, "target_duration": duration}

NODE = NodeDefinition(type='ai.highlights', metadata=metadata, execute=execute)
