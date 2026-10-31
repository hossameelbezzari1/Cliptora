from __future__ import annotations
import hashlib
import base64
import ipaddress
import json
import math
import os
import re
import socket
import subprocess
import tempfile
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any, Callable
from app.workflows.model_constants import (OPENAI_TEXT_MODELS, OPENAI_IMAGE_MODELS,
    OPENAI_MODERATION_MODELS, OPENAI_REASONING_EFFORTS, GEMINI_TEXT_MODELS, GEMINI_IMAGE_MODELS)

MAX_CUTS = 36
MAX_TARGET_SECONDS = 1800
HIGHLIGHTS_SCHEMA = {"type": "object", "properties": {"highlights": {"type": "array", "items": {"type": "object", "properties": {"start_word_id": {"type": "integer"}, "end_word_id": {"type": "integer"}, "score": {"type": "integer"}, "reason": {"type": "string"}}, "required": ["start_word_id", "end_word_id", "score", "reason"], "additionalProperties": False}}}, "required": ["highlights"], "additionalProperties": False}
SUMMARY_SCHEMA = {"type": "object", "properties": {"summary": {"type": "string"}}, "required": ["summary"], "additionalProperties": False}


def get_input(outputs: dict[str, Any], key: str) -> Any:
    for item in reversed(list(outputs.values())):
        if isinstance(item, dict) and key in item:
            return item[key]
    return None


def input_path(outputs: dict[str, Any], path: str) -> Any:
    """Resolve a bounded dot path from dependency output, including the dependency ID."""
    parts = [part for part in path.strip().split(".") if part]
    if not parts or len(parts) > 16 or any(not re.fullmatch(r"[A-Za-z0-9_-]{1,80}", part) for part in parts):
        raise ValueError("IF input path must be a dot path such as node_id.result.value")
    value: Any = outputs
    for part in parts:
        if isinstance(value, dict) and part in value:
            value = value[part]
        elif isinstance(value, list) and part.isdigit() and int(part) < len(value):
            value = value[int(part)]
        else:
            return None
    return value


def compare_value(actual: Any, operator: str, expected: Any) -> bool:
    if operator == "exists":
        return actual is not None
    if operator == "truthy":
        return bool(actual)
    if operator == "contains":
        return str(expected) in str(actual) if actual is not None else False
    if operator in ("greater_than", "less_than"):
        try:
            left, right = float(actual), float(expected)
        except (TypeError, ValueError) as exc:
            raise ValueError("IF numeric comparison requires numeric values") from exc
        if not math.isfinite(left) or not math.isfinite(right):
            raise ValueError("IF numeric comparison requires finite values")
        return left > right if operator == "greater_than" else left < right
    if isinstance(actual, bool):
        normalized = str(expected).strip().casefold()
        if normalized not in ("true", "false"):
            raise ValueError("IF boolean comparison value must be true or false")
        expected = normalized == "true"
    elif isinstance(actual, (int, float)) and not isinstance(actual, bool):
        try:
            expected = float(expected)
        except (TypeError, ValueError) as exc:
            raise ValueError("IF comparison value must be numeric") from exc
    equal = actual == expected
    if operator == "equals":
        return equal
    if operator == "not_equals":
        return not equal
    raise ValueError("Unsupported IF operator")


def as_words(items: Any) -> list[dict]:
    if not isinstance(items, list):
        raise ValueError("Transcript must contain a words[] array")
    output = []
    for index, item in enumerate(items):
        if not isinstance(item, dict):
            raise ValueError("Invalid transcript word")
        start, end = float(item["start"]), float(item["end"])
        if not math.isfinite(start) or not math.isfinite(end) or start < 0 or end <= start or end > 86400:
            raise ValueError(f"Invalid word timing #{index}")
        word = str(item.get("text", item.get("word", ""))).strip()[:140]
        if word:
            output.append({"id": index + 1, "text": word, "start": round(start, 3), "end": round(end, 3)})
    if len(output) > 150_000:
        raise ValueError("Too many words")
    return sorted(output, key=lambda w: w["start"])


def group_words(words: list[dict], gap: float = 0.9, limit: int = 26) -> list[dict]:
    segments: list[dict] = []
    bucket: list[dict] = []
    for word in words:
        if bucket and (word["start"] - bucket[-1]["end"] > gap or len(bucket) >= limit or bucket[-1]["text"].endswith((".", "!", "?", "؟"))):
            segments.append({"start": bucket[0]["start"], "end": bucket[-1]["end"], "text": " ".join(w["text"] for w in bucket), "start_word_id": bucket[0]["id"], "end_word_id": bucket[-1]["id"]})
            bucket = []
        bucket.append(word)
    if bucket:
        segments.append({"start": bucket[0]["start"], "end": bucket[-1]["end"], "text": " ".join(w["text"] for w in bucket), "start_word_id": bucket[0]["id"], "end_word_id": bucket[-1]["id"]})
    return segments


def normalize_highlights(items: Any, words: list[dict], max_items: int = MAX_CUTS) -> list[dict]:
    if not isinstance(items, list):
        raise ValueError("AI output requires highlights[]")
    lookup = {w["id"]: w for w in words}
    cleaned: list[dict] = []
    for candidate in items[:100]:
        if not isinstance(candidate, dict):
            continue
        try:
            a, b = int(candidate["start_word_id"]), int(candidate["end_word_id"])
        except (ValueError, KeyError, TypeError):
            continue
        if a not in lookup or b not in lookup or a > b:
            continue
        start, end = lookup[a]["start"], lookup[b]["end"]
        if end <= start:
            continue
        cleaned.append({"start_word_id": a, "end_word_id": b, "start": start, "end": end, "score": max(0, min(100, int(candidate.get("score", 70)))), "reason": str(candidate.get("reason", "Chosen segment"))[:150]})
    cleaned.sort(key=lambda c: (-c["score"], c["start"]))
    accepted: list[dict] = []
    for entry in cleaned:
        if all(entry["end"] <= prev["start"] or entry["start"] >= prev["end"] for prev in accepted):
            accepted.append(entry)
        if len(accepted) >= max_items:
            break
    return sorted(accepted, key=lambda x: x["start"])


def offline_highlights(words: list[dict], target_duration: int, strategy: str) -> list[dict]:
    """Fallback is a TEXT HEURISTIC, not semantic AI and never advertised as such."""
    segments = group_words(words, gap=0.65, limit=45)
    if not segments:
        return []
    good = []
    for segment in segments:
        duration = segment["end"] - segment["start"]
        text = segment["text"]
        density = len(text.split()) / max(duration, 0.2)
        hook = any(k in text.lower() for k in ("why", "how", "secret", "best", "never", "imagine", "because", "but", "important", "surprise", "كيف", "علاش"))
        score = round(max(1, min(100, 55 + min(density, 6) * 3 + (19 if hook else 0) - (18 if duration < 2 else 0))))
        if strategy == "shorts_hook" and segment["start"] < 25:
            score = min(100, score + 5)
        good.append({**segment, "score": score})
    good.sort(key=lambda x: (-x["score"], x["start"]))
    chosen, total = [], 0.0
    for segment in good:
        if total >= target_duration or len(chosen) >= MAX_CUTS:
            break
        if any(not (segment["end"] <= c["start"] or segment["start"] >= c["end"]) for c in chosen):
            continue
        chosen.append({**segment, "reason": "Offline text heuristic (not AI analysis)"})
        total += segment["end"] - segment["start"]
    return normalize_highlights(chosen, words)
