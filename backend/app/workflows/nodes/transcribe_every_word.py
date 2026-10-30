"""CLIPTORA workflow node: audio.transcribe.

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
    return {"label": "Transcribe Every Word", "group": "Analysis", "settings": {"model": "small", "language": None}}

def execute(node: dict[str, Any], outputs: dict[str, Any], source: Path | None, workdir: Path) -> dict[str, Any]:
    from app.services.workflow_core import (
        MAX_CUTS, MAX_TARGET_SECONDS, OPENAI_REASONING_EFFORTS,
        HIGHLIGHTS_SCHEMA, SUMMARY_SCHEMA, get_input, input_path, compare_value,
        tool, probe, as_words, group_words, normalize_highlights,
        offline_highlights, openai_json, openai_action, gemini_action,
        ollama_action, execute_ai_agent, execute_http_request, value_path,
    )
    kind, cfg = node['type'], node.get('settings', {})
    wav = get_input(outputs, "audio")
    if not wav:
        raise ValueError("audio.transcribe requires audio.extract")
    try:
        from faster_whisper import WhisperModel
    except ImportError as exc:
        raise RuntimeError("Install optional package: pip install faster-whisper") from exc
    model_name = str(cfg.get("model") or "small")
    if model_name not in ("tiny", "base", "small", "medium", "large-v3", "turbo"):
        raise ValueError("Unsupported Whisper model")
    cache_key = hashlib.sha256(json.dumps({"wav": wav, "mtime": Path(wav).stat().st_mtime_ns, "model": model_name, "language": cfg.get("language")}, sort_keys=True).encode()).hexdigest()[:24]
    cache_path = Path(wav).parent / f"transcript_{cache_key}.json"
    if cache_path.is_file():
        return json.loads(cache_path.read_text(encoding="utf-8"))
    model = WhisperModel(model_name, device="cpu", compute_type="int8")
    iterator, info = model.transcribe(wav, beam_size=5, word_timestamps=True, vad_filter=True, language=cfg.get("language") or None)
    words = []
    for segment in iterator:
        for word in (segment.words or []):
            if word.start is not None and word.end is not None:
                words.append({"start": word.start, "end": word.end, "text": word.word.strip()})
    result = as_words(words)
    transcript = {"words": result, "language": info.language, "segments": group_words(result)}
    tmp_cache = cache_path.with_suffix(".tmp")
    tmp_cache.write_text(json.dumps(transcript, ensure_ascii=False), encoding="utf-8")
    tmp_cache.replace(cache_path)
    return transcript

NODE = NodeDefinition(type='audio.transcribe', metadata=metadata, execute=execute)
