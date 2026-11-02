"""Gemini text/JSON/highlights executor for CLIPTORA native workflows.

This module uses only Python's standard library. It never stores API keys in
workflow settings or execution artifacts. Other Gemini actions remain handled
by the existing app.providers.ai.gemini implementation.
"""
from __future__ import annotations

import json
import math
import os
import re
import urllib.error
import urllib.request
from typing import Any, Callable

API_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta"
MODEL_PATTERN = re.compile(r"^(?:models/)?([a-zA-Z0-9][a-zA-Z0-9._-]{0,100})$")
FREE_TIER_CANDIDATES = {"gemini-2.5-flash", "gemini-2.5-flash-lite", "gemini-3.5-flash-lite"}

_HIGHLIGHTS_SCHEMA: dict[str, Any] = {
    "type": "OBJECT",
    "properties": {
        "highlights": {
            "type": "ARRAY",
            "items": {
                "type": "OBJECT",
                "properties": {
                    "start_word_id": {"type": "INTEGER"},
                    "end_word_id": {"type": "INTEGER"},
                    "score": {"type": "NUMBER"},
                    "reason": {"type": "STRING"},
                },
                "required": ["start_word_id", "end_word_id", "score", "reason"],
            },
        }
    },
    "required": ["highlights"],
}


def _notify(node: dict[str, Any], *, stage: str, message: str, progress: float | None = None,
            processed: int | None = None, total: int | None = None) -> None:
    callback = node.get("_progress_callback")
    if not callable(callback):
        return
    event: dict[str, Any] = {"stage": stage, "message": message}
    if progress is not None:
        event["progress"] = max(0, min(99, round(progress, 2)))
    if processed is not None and total is not None:
        event.update({"processed": processed, "total": total, "unit": "chunks"})
    callback(event)


def _model_name(cfg: dict[str, Any]) -> str:
    selected = str(cfg.get("model_by_id") or cfg.get("model") or "gemini-2.5-flash").strip()
    match = MODEL_PATTERN.fullmatch(selected)
    if not match:
        raise ValueError("Invalid Gemini model ID")
    model = match.group(1)
    allowed = os.environ.get("GEMINI_ALLOWED_MODELS", "").strip()
    if allowed:
        allowlist = {item.strip().removeprefix("models/") for item in allowed.split(",") if item.strip()}
        if model not in allowlist:
            raise ValueError(f"Model '{model}' is not in GEMINI_ALLOWED_MODELS")
    if os.environ.get("GEMINI_FREE_MODELS_ONLY", "1").strip().lower() not in {"0", "false", "no"}:
        if model not in FREE_TIER_CANDIDATES:
            raise ValueError(f"Model '{model}' is not in CLIPTORA's free-tier candidate list. Set GEMINI_FREE_MODELS_ONLY=0 only after confirming billing.")
    return model


def _int_setting(cfg: dict[str, Any], key: str, default: int, low: int, high: int) -> int:
    try:
        n = int(cfg.get(key, default))
    except (TypeError, ValueError) as exc:
        raise ValueError(f"{key} must be an integer") from exc
    if n < low or n > high:
        raise ValueError(f"{key} must be between {low} and {high}")
    return n


def _float_setting(cfg: dict[str, Any], key: str, default: float, low: float, high: float) -> float:
    try:
        n = float(cfg.get(key, default))
    except (TypeError, ValueError) as exc:
        raise ValueError(f"{key} must be a number") from exc
    if not math.isfinite(n) or not low <= n <= high:
        raise ValueError(f"{key} must be between {low} and {high}")
    return n


def _extract_input(outputs: dict[str, Any], path: str) -> Any:
    """Read an upstream value. Accept `nodeId.words` or a field in one upstream node.

    No eval, Python expressions, attribute access or external network reads.
    """
    if not path:
        return None
    parts = path.strip().split(".")
    if any(not re.fullmatch(r"[a-zA-Z0-9_-]{1,64}", part) for part in parts):
        raise ValueError("input_path must be a dot-separated upstream JSON field")
    if parts[0] in outputs:
        value: Any = outputs[parts[0]]
        parts = parts[1:]
    else:
        matches = [data for data in outputs.values() if isinstance(data, dict) and parts[0] in data]
        if len(matches) != 1:
            raise ValueError("input_path must identify an existing, unambiguous upstream field")
        value = matches[0]
    for part in parts:
        if not isinstance(value, dict) or part not in value:
            raise ValueError(f"Input path field not found: {path}")
        value = value[part]
    return value


def _upstream_words(outputs: dict[str, Any]) -> list[dict[str, Any]]:
    matches = [item["words"] for item in outputs.values()
               if isinstance(item, dict) and isinstance(item.get("words"), list)]
    if len(matches) != 1:
        raise ValueError("Gemini Highlights requires exactly one connected Transcribe Every Word output containing 'words'")
    raw_words = matches[0]
    words: list[dict[str, Any]] = []
    previous = -1
    for item in raw_words:
        if not isinstance(item, dict):
            raise ValueError("Invalid transcript word item")
        try:
            idx, start, end = int(item["id"]), float(item["start"]), float(item["end"])
        except (KeyError, TypeError, ValueError) as exc:
            raise ValueError("Transcript words require id/start/end") from exc
        if idx <= previous or not math.isfinite(start) or not math.isfinite(end) or start < 0 or end < start:
            raise ValueError("Transcript words must have increasing IDs and valid timestamps")
        words.append({"id": idx, "start": start, "end": end, "text": str(item.get("text") or "")})
        previous = idx
    if not words:
        raise ValueError("Transcript contains no words")
    return words


def _chunk_words(words: list[dict[str, Any]], max_chars: int) -> list[list[dict[str, Any]]]:
    chunks: list[list[dict[str, Any]]] = []
    current: list[dict[str, Any]] = []
    size = 0
    for word in words:
        line = f"{word['id']}:{word['text']}"
        if current and size + len(line) + 1 > max_chars:
            chunks.append(current)
            current, size = [], 0
        current.append(word)
        size += len(line) + 1
    if current:
        chunks.append(current)
    if len(chunks) > 60:
        raise ValueError("Transcript would require more than 60 Gemini requests; increase chunk_chars")
    return chunks


def _sanitize_api_error(status: int, raw: bytes, api_key: str) -> RuntimeError:
    try:
        detail = json.loads(raw[:4096].decode("utf-8", errors="replace"))
        message = str(detail.get("error", {}).get("message", ""))[:450]
    except (ValueError, TypeError, AttributeError):
        message = ""
    message = message.replace(api_key, "[REDACTED]")
    if status == 429:
        return RuntimeError("Gemini API rate limit or free quota exceeded (429). " + message)
    if status in (401, 403):
        return RuntimeError("Gemini API key rejected, unavailable model, or project permission error. " + message)
    return RuntimeError(f"Gemini API request failed (HTTP {status}). " + message)


def _request(model: str, cfg: dict[str, Any], user_prompt: str, system_prompt: str,
             *, json_schema: dict[str, Any] | None = None) -> dict[str, Any]:
    api_key = os.environ.get("GEMINI_API_KEY", "").strip()
    if not api_key:
        raise ValueError("GEMINI_API_KEY is missing from the backend environment")
    # Multi-message format (n8n-style) is optional; a plain prompt still works.
    contents: list[dict[str, Any]] = []
    messages = cfg.get("messages") or []
    if not isinstance(messages, list) or len(messages) > 30:
        raise ValueError("messages must be an array with up to 30 entries")
    total_message_chars = 0
    for item in messages:
        if not isinstance(item, dict):
            raise ValueError("Each message must be an object")
        role = str(item.get("role") or "user").lower()
        content = str(item.get("text") or item.get("content") or "").strip()
        if not content:
            continue
        total_message_chars += len(content)
        if role == "system":
            system_prompt = (system_prompt + "\n" + content).strip()
            continue
        if role not in ("user", "model", "assistant"):
            raise ValueError("Message role must be user, model, assistant, or system")
        contents.append({"role": "model" if role == "assistant" else role,
                         "parts": [{"text": content}]})
    if total_message_chars > 900_000:
        raise ValueError("Too much text in Gemini messages")
    if user_prompt.strip():
        contents.append({"role": "user", "parts": [{"text": user_prompt}]})
    if not contents:
        raise ValueError("Gemini requires a prompt or at least one nonempty user message")
    body: dict[str, Any] = {"contents": contents}
    if system_prompt:
        body["systemInstruction"] = {"parts": [{"text": system_prompt}]}
    generation: dict[str, Any] = {
        "maxOutputTokens": _int_setting(cfg, "max_output_tokens", 2048, 128, 32768),
        "temperature": _float_setting(cfg, "temperature", 0.2, 0, 2),
    }
    if json_schema is not None or bool(cfg.get("output_content_as_json")):
        generation["responseMimeType"] = "application/json"
        if json_schema is not None:
            generation["responseSchema"] = json_schema
    body["generationConfig"] = generation
    request = urllib.request.Request(
        f"{API_ENDPOINT}/models/{model}:generateContent",
        data=json.dumps(body, ensure_ascii=False).encode("utf-8"),
        headers={"Content-Type": "application/json", "X-goog-api-key": api_key},
        method="POST",
    )
    timeout = _int_setting(cfg, "timeout_seconds", 120, 15, 300)
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            payload = response.read(8_000_001)
    except urllib.error.HTTPError as exc:
        raise _sanitize_api_error(exc.code, exc.read(4096), api_key) from None
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        raise RuntimeError(f"Cannot reach Gemini API: {type(exc).__name__}. Check Docker DNS/internet access.") from exc
    if len(payload) > 8_000_000:
        raise ValueError("Gemini response too large")
    try:
        data = json.loads(payload)
        candidates = data.get("candidates") or []
        if not candidates:
            raise ValueError(f"Gemini returned no candidates (block reason: {data.get('promptFeedback', {}).get('blockReason', 'unknown')})")
        candidate = candidates[0]
        parts = candidate.get("content", {}).get("parts", [])
        message = "".join(part["text"] for part in parts if isinstance(part, dict) and isinstance(part.get("text"), str))
        if not message.strip():
            raise ValueError(f"Gemini returned no text (finish reason: {candidate.get('finishReason', 'unknown')})")
        return {"text": message, "usage": data.get("usageMetadata") or {}, "finish_reason": candidate.get("finishReason")}
    except (ValueError, TypeError, KeyError, AttributeError) as exc:
        raise ValueError("Gemini returned an invalid or empty response") from exc


def _json_content(value: str) -> Any:
    try:
        return json.loads(value)
    except json.JSONDecodeError as exc:
        raise ValueError("Gemini response is not valid JSON. Enable JSON response or simplify the prompt.") from exc


def _select_highlights(raw: list[dict[str, Any]], words: list[dict[str, Any]],
                       target_seconds: int, min_seconds: float, max_seconds: float,
                       max_highlights: int) -> list[dict[str, Any]]:
    by_id = {word["id"]: i for i, word in enumerate(words)}
    candidates = []
    for item in raw:
        if not isinstance(item, dict):
            continue
        try:
            first, last = int(item["start_word_id"]), int(item["end_word_id"])
            start_idx, end_idx = by_id[first], by_id[last]
            score = float(item.get("score", 0))
        except (KeyError, ValueError, TypeError):
            continue
        if end_idx < start_idx or not math.isfinite(score):
            continue
        score = max(0.0, min(1.0, score / 100 if score > 1 else score))
        start = words[start_idx]["start"]
        end = words[end_idx]["end"]
        # Shorten long candidates strictly at word boundaries.
        if end - start > max_seconds:
            valid_ends = [i for i in range(start_idx, end_idx + 1)
                          if 0 < words[i]["end"] - start <= max_seconds]
            if not valid_ends:
                continue
            end_idx = valid_ends[-1]
            end = words[end_idx]["end"]
            last = words[end_idx]["id"]
        if not min_seconds <= end - start <= max_seconds:
            continue
        candidates.append({"start_word_id": first, "end_word_id": last,
                           "start": round(start, 3), "end": round(end, 3),
                           "score": round(score, 3), "reason": str(item.get("reason") or "Selected passage")[:240]})
    ranked = sorted(candidates, key=lambda x: (-x["score"], x["start"]))
    accepted: list[dict[str, Any]] = []
    total = 0.0
    for item in ranked:
        if len(accepted) >= max_highlights:
            break
        if any(item["start"] < old["end"] and old["start"] < item["end"] for old in accepted):
            continue
        remaining = target_seconds - total
        if remaining < min_seconds:
            break
        if item["end"] - item["start"] > remaining:
            continue
        accepted.append(item)
        total += item["end"] - item["start"]
    return sorted(accepted, key=lambda x: x["start"])


def _highlights(node: dict[str, Any], cfg: dict[str, Any], outputs: dict[str, Any], model: str) -> dict[str, Any]:
    words = _upstream_words(outputs)
    target_seconds = _int_setting(cfg, "target_duration", 120, 10, 7200)
    max_highlights = _int_setting(cfg, "max_highlights", 12, 1, 100)
    chunk_chars = _int_setting(cfg, "chunk_chars", 14000, 2000, 50000)
    min_seconds = _float_setting(cfg, "min_clip_seconds", 3, 0.1, 300)
    max_seconds = _float_setting(cfg, "max_clip_seconds", 35, 1, 900)
    if max_seconds < min_seconds:
        raise ValueError("max_clip_seconds must be >= min_clip_seconds")
    chunks = _chunk_words(words, chunk_chars)
    system = str(cfg.get("system_prompt") or "You are a precise transcript-only video editor.")
    goal = str(cfg.get("prompt") or "Choose the most informative, impactful moments for a concise chronological recap.")[:8000]
    proposals: list[dict[str, Any]] = []
    input_tokens = output_tokens = 0
    for i, chunk in enumerate(chunks):
        _notify(node, stage="analyzing_transcript", message=f"Analyzing transcript chunk {i+1}/{len(chunks)}", progress=(i / len(chunks)) * 95,
                processed=i, total=len(chunks))
        lines = " ".join(f"[{word['id']}] {word['text']}" for word in chunk)
        prompt = (f"Editing goal: {goal}\nTotal desired final duration: {target_seconds} seconds. "
                  f"Minimum clip {min_seconds} sec; maximum clip {max_seconds} sec. "
                  f"Select up to {min(12, max_highlights)} meaningful continuous spoken excerpts from THIS CHUNK, "
                  f"in the chronological order of the source. Use ONLY actual word IDs present in this text. "
                  "Do not invent events, word IDs, or scenes. The source is text-only and may not describe visuals. "
                  "Prefer coherent sentence boundaries and preserve context. "
                  "Return JSON with highlights array; score from 0 to 100 and a brief reason. "
                  f"\n\nTRANSCRIPT:\n{lines}")
        response = _request(model, cfg, prompt, system, json_schema=_HIGHLIGHTS_SCHEMA)
        parsed = _json_content(response["text"])
        if not isinstance(parsed, dict) or not isinstance(parsed.get("highlights"), list):
            raise ValueError("Gemini Highlights returned JSON without a highlights array")
        low, high = chunk[0]["id"], chunk[-1]["id"]
        proposals.extend(item for item in parsed["highlights"] if isinstance(item, dict)
                         and str(item.get("start_word_id", "")).isdigit()
                         and str(item.get("end_word_id", "")).isdigit()
                         and low <= int(item["start_word_id"]) <= int(item["end_word_id"]) <= high)
        input_tokens += int(response["usage"].get("promptTokenCount") or 0)
        output_tokens += int(response["usage"].get("candidatesTokenCount") or 0)
    highlights = _select_highlights(proposals, words, target_seconds, min_seconds, max_seconds, max_highlights)
    _notify(node, stage="finalizing", message="Validating exact word timestamps", progress=99, processed=len(chunks), total=len(chunks))
    return {"highlights": highlights, "method": "gemini", "model": model,
            "target_duration": target_seconds, "selected_duration": round(sum(h["end"] - h["start"] for h in highlights), 3),
            "chunks_processed": len(chunks), "usage": {"input_tokens": input_tokens, "output_tokens": output_tokens},
            "word_count": len(words)}


def message_model(node: dict[str, Any], outputs: dict[str, Any]) -> dict[str, Any]:
    cfg = node.get("settings") or {}
    if not isinstance(cfg, dict):
        raise ValueError("Gemini node settings must be an object")
    model = _model_name(cfg)
    mode = str(cfg.get("output_mode") or "text").lower()
    if mode == "highlights":
        return _highlights(node, cfg, outputs, model)
    if mode not in ("text", "json"):
        raise ValueError("output_mode must be text, json, or highlights")
    prompt = str(cfg.get("prompt") or "")
    system = str(cfg.get("system_prompt") or "")
    chosen_path = str(cfg.get("input_path") or "")
    if chosen_path:
        value = _extract_input(outputs, chosen_path)
        prompt = f"{prompt}\n\nUPSTREAM DATA:\n{json.dumps(value, ensure_ascii=False)}".strip()
    if not prompt.strip() and not cfg.get("messages"):
        raise ValueError("Gemini Message a model requires a prompt, messages, or an input_path")
    if len(prompt) > 900000:
        raise ValueError("Gemini prompt exceeds 900K characters; use Highlights mode for automatic chunking")
    _notify(node, stage="requesting", message="Waiting for Gemini API response")
    if mode == "json":
        cfg = {**cfg, "output_content_as_json": True}
    response = _request(model, cfg, prompt, system)
    result: dict[str, Any] = {"model": model, "text": response["text"], "usage": response["usage"],
                              "finish_reason": response["finish_reason"]}
    if mode == "json" or bool(cfg.get("output_content_as_json")):
        parsed = _json_content(response["text"])
        result["json"] = parsed
        if isinstance(parsed, dict):
            for key, value in parsed.items():
                if key not in {"model", "text", "usage", "finish_reason", "json"}:
                    result[key] = value
    _notify(node, stage="finalizing", message="Gemini response received", progress=99)
    return result
