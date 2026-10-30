"""CLIPTORA composable video workflows. No arbitrary Python/shell execution nodes.

Node outputs are JSON artifacts in a project/run-scoped folder. The engine never
accepts filesystem paths or commands from the browser; source paths are resolved
and checked by the API. FFmpeg and faster-whisper are optional system dependencies.
"""
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

MAX_NODES = 100
MAX_CUTS = 36
MAX_TARGET_SECONDS = 1800
from app.workflows.model_constants import (
    OPENAI_TEXT_MODELS, OPENAI_IMAGE_MODELS, OPENAI_MODERATION_MODELS,
    OPENAI_REASONING_EFFORTS, GEMINI_TEXT_MODELS, GEMINI_IMAGE_MODELS,
)
# Node metadata is registered by discovery, not by a central hardcoded dictionary.
from app.workflows.registry import node_metadata, executor as node_executor
NODE_TYPES: dict[str, dict[str, Any]] = node_metadata()

# One declarative registry feeds the node picker. Entries without an executor are
# intentionally visible as planned capabilities, but validation/run_graph only
# accept NODE_TYPES. Adding a real tool means registering its schema here and
# implementing its backend executor in call_node.
def tool_catalog() -> list[dict[str, Any]]:
    """Only executable, registered nodes; no planned n8n inventory."""
    from app.workflows.schemas import node_catalog_entry
    return [node_catalog_entry(key, value) for key, value in NODE_TYPES.items()]


def _n(id: str, kind: str, depends: list[str] | None = None, settings: dict | None = None) -> dict:
    return {"id": id, "type": kind, "depends_on": depends or [], "when": "always", "retry_limit": 1,
            "cache": True, "settings": settings if settings is not None else dict(NODE_TYPES[kind]["settings"])}


def preset_templates() -> list[dict]:
    return [
        {"key": "movie-recap", "name": "Movie Recap", "description": "Full dialogue → highlights → recap script → editable cut plan and captions", "nodes": [
            _n("trigger", "core.manual_trigger"), _n("probe", "media.probe", ["trigger"]), _n("audio", "audio.extract", ["probe"]),
            _n("words", "audio.transcribe", ["audio"], {"model": "small", "language": None}),
            _n("moments", "ai.highlights", ["words"], {"mode": "offline", "target_duration": 600, "strategy": "story_recap"}),
            _n("cuts", "timeline.cut_plan", ["moments"], {"padding": 0.16}),
            _n("script", "ai.summary", ["moments", "words"], {"mode": "offline", "language": "auto"}),
            _n("captions", "caption.generate", ["words", "moments"], {"max_words": 6, "style": "karaoke"}),
            _n("render", "video.render", ["cuts", "probe"], {"enabled": False, "aspect_ratio": "original"}),
        ]},
        {"key": "shorts", "name": "Shorts / Reels", "description": "Find a strong hook → 9:16 crop → captions → short video", "nodes": [
            _n("trigger", "core.manual_trigger"), _n("probe", "media.probe", ["trigger"]), _n("audio", "audio.extract", ["probe"]),
            _n("words", "audio.transcribe", ["audio"], {"model": "small", "language": None}),
            _n("moments", "ai.highlights", ["words"], {"mode": "offline", "target_duration": 45, "strategy": "shorts_hook"}),
            _n("cuts", "timeline.cut_plan", ["moments"], {"padding": 0.12}),
            _n("captions", "caption.generate", ["words", "moments"], {"max_words": 3, "style": "word-pop"}),
            _n("render", "video.render", ["cuts", "probe"], {"enabled": False, "aspect_ratio": "9:16"}),
        ]},
        {"key": "mini-animation", "name": "Mini Animation", "description": "Script → editable scenes → animation keyframes; use the editor for final rendering", "nodes": [
            _n("trigger", "core.manual_trigger"),
            _n("storyboard", "animation.storyboard", ["trigger"], {"script": "Your first scene.\nYour second scene.", "scene_seconds": 4}),
            _n("keyframes", "animation.keyframes", ["storyboard"], {"preset": "fade-pop"}),
        ]},
        {"key": "podcast", "name": "Podcast Clips", "description": "Podcast video → word timestamps → strongest segments → captions → editable clips", "nodes": [
            _n("trigger", "core.manual_trigger"), _n("probe", "media.probe", ["trigger"]), _n("audio", "audio.extract", ["probe"]),
            _n("words", "audio.transcribe", ["audio"], {"model": "small", "language": None}),
            _n("moments", "ai.highlights", ["words"], {"mode": "offline", "target_duration": 120, "strategy": "podcast_clips"}),
            _n("cuts", "timeline.cut_plan", ["moments", "probe"], {"padding": 0.12}),
            _n("captions", "caption.generate", ["words", "moments"], {"max_words": 4, "style": "karaoke"}),
            _n("render", "video.render", ["cuts", "probe"], {"enabled": False, "aspect_ratio": "9:16"}),
        ]},
    ]


def validate_workflow(nodes: list[dict]) -> list[dict]:
    if not isinstance(nodes, list) or not 1 <= len(nodes) <= MAX_NODES:
        raise ValueError(f"Workflow must have 1 to {MAX_NODES} nodes")
    by_id: dict[str, dict] = {}
    for node in nodes:
        if not isinstance(node, dict):
            raise ValueError("Each node must be an object")
        ident, kind = node.get("id"), node.get("type")
        if not isinstance(ident, str) or not re.fullmatch(r"[a-zA-Z][a-zA-Z0-9_-]{0,47}", ident):
            raise ValueError("Invalid node id")
        if ident in by_id:
            raise ValueError(f"Duplicate node: {ident}")
        if kind not in NODE_TYPES:
            raise ValueError(f"Unknown or unauthorized node: {kind}")
        deps = node.get("depends_on", [])
        if not isinstance(deps, list) or len(deps) > MAX_NODES or any(not isinstance(d, str) for d in deps) or len(deps) != len(set(deps)):
            raise ValueError(f"Invalid dependencies for {ident}")
        if node.get("when", "always") not in ("always", "has_video", "has_transcript", "ai_enabled", "condition_true", "condition_false", "route_0", "route_1", "route_2", "route_3", "route_4", "route_fallback"):
            raise ValueError(f"Invalid condition for {ident}")
        settings = node.get("settings", {})
        if not isinstance(settings, dict) or len(json.dumps(settings, ensure_ascii=False)) > 200_000:
            raise ValueError(f"Settings too large for {ident}")
        position = node.get("position", {})
        if not isinstance(position, dict):
            raise ValueError(f"Invalid canvas position for {ident}")
        try:
            x, y = float(position.get("x", 0)), float(position.get("y", 0))
        except (TypeError, ValueError) as exc:
            raise ValueError(f"Invalid canvas position for {ident}") from exc
        if not math.isfinite(x) or not math.isfinite(y) or abs(x) > 100_000 or abs(y) > 100_000:
            raise ValueError(f"Invalid canvas position for {ident}")
        retry_limit = node.get("retry_limit", 1)
        if not isinstance(retry_limit, int) or not 0 <= retry_limit <= 5:
            raise ValueError(f"Retry limit for {ident} must be between 0 and 5")
        if not isinstance(node.get("cache", True), bool):
            raise ValueError(f"Cache setting for {ident} must be boolean")
        by_id[ident] = {"id": ident, "type": kind, "depends_on": deps, "settings": settings,
                        "when": node.get("when", "always"), "retry_limit": retry_limit,
                        "cache": node.get("cache", True), "position": {"x": round(x, 2), "y": round(y, 2)}}
    for ident, node in by_id.items():
        if ident in node["depends_on"] or any(d not in by_id for d in node["depends_on"]):
            raise ValueError(f"Missing or self dependency for {ident}")
    ordered: list[dict] = []
    pending = dict(by_id)
    while pending:
        ready = [node for node in pending.values() if all(d not in pending for d in node["depends_on"])]
        if not ready:
            raise ValueError("Workflow has a dependency cycle")
        for node in ready:
            ordered.append(node)
            del pending[node["id"]]
    return ordered


def execution_nodes(nodes: list[dict[str, Any]], target_node_id: str | None) -> list[dict[str, Any]]:
    """Return the full validated graph, or one node and its transitive dependencies."""
    validated = validate_workflow(nodes)
    if target_node_id is None:
        return validated
    by_id = {node["id"]: node for node in validated}
    if target_node_id not in by_id:
        raise ValueError("Target node does not exist in this workflow")
    required: set[str] = set()

    def include(node_id: str) -> None:
        if node_id in required:
            return
        required.add(node_id)
        for dependency in by_id[node_id]["depends_on"]:
            include(dependency)

    include(target_node_id)
    return [node for node in validated if node["id"] in required]


def tool(*args: str, timeout: int = 120) -> str:
    try:
        process = subprocess.run(list(args), capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=timeout, check=False)
    except FileNotFoundError as exc:
        raise RuntimeError(f"Missing media tool: {args[0]}. Install FFmpeg and add it to PATH") from exc
    except subprocess.TimeoutExpired as exc:
        raise RuntimeError(f"Media process exceeded {timeout}s") from exc
    if process.returncode != 0:
        raise RuntimeError(f"{args[0]} failed: {process.stderr[-1200:]}")
    return process.stdout


def probe(source: Path) -> dict:
    parsed = json.loads(tool("ffprobe", "-v", "error", "-show_entries", "format=duration,size:stream=codec_type,width,height", "-of", "json", str(source)))
    stream = next((s for s in parsed.get("streams", []) if s.get("codec_type") == "video"), {})
    fmt = parsed.get("format", {})
    return {"duration": float(fmt.get("duration") or 0), "width": int(stream.get("width") or 0), "height": int(stream.get("height") or 0), "has_audio": any(s.get("codec_type") == "audio" for s in parsed.get("streams", [])), "bytes": int(fmt.get("size") or 0)}


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


def openai_json(prompt: str, transcript: str, schema: dict) -> dict:
    key = os.environ.get("OPENAI_API_KEY", "").strip()
    if not key:
        raise RuntimeError("OPENAI_API_KEY is missing. Use mode=offline or configure the API key")
    model = os.environ.get("CLIPTORA_OPENAI_MODEL", "gpt-6.1-sol")
    payload = {"model": model, "messages": [{"role": "system", "content": prompt}, {"role": "user", "content": transcript}],
               "response_format": {"type": "json_schema", "json_schema": {"name": "cliptora_workflow", "strict": True, "schema": schema}}}
    req = urllib.request.Request("https://api.openai.com/v1/chat/completions", data=json.dumps(payload).encode(),
                                 headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"}, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=120) as response:
            result = json.load(response)
        return json.loads(result["choices"][0]["message"]["content"])
    except (urllib.error.HTTPError, urllib.error.URLError, ValueError, KeyError, IndexError) as exc:
        raise RuntimeError(f"AI provider failed: {str(exc)[:200]}") from exc


def openai_chat(cfg: dict[str, Any], outputs: dict[str, Any]) -> dict[str, Any]:
    key = os.environ.get("OPENAI_API_KEY", "").strip()
    if not key:
        raise RuntimeError("OPENAI_API_KEY is missing from the backend environment")
    model = str(cfg.get("model") or os.environ.get("CLIPTORA_OPENAI_MODEL", "gpt-6.1-sol")).strip()
    if not re.fullmatch(r"[A-Za-z0-9._:-]{1,100}", model):
        raise ValueError("OpenAI model name is invalid")
    prompt = str(cfg.get("prompt", "")).strip()
    input_path_value = str(cfg.get("input_path", "")).strip()
    if input_path_value:
        input_value = input_path(outputs, input_path_value)
        prompt = f"{prompt}\n\nInput data:\n{json.dumps(input_value, ensure_ascii=False, separators=(',', ':'))}"
    if not prompt or len(prompt) > 200_000:
        raise ValueError("OpenAI prompt must contain between 1 and 200,000 characters")
    system_prompt = str(cfg.get("system_prompt", "You are a helpful assistant."))[:20_000]
    temperature = float(cfg.get("temperature", 0.2))
    max_tokens = int(cfg.get("max_output_tokens", 1000))
    if not math.isfinite(temperature) or not 0 <= temperature <= 2:
        raise ValueError("OpenAI temperature must be between 0 and 2")
    if not 1 <= max_tokens <= 16_000:
        raise ValueError("OpenAI maximum output tokens must be between 1 and 16,000")
    payload: dict[str, Any] = {"model": model, "messages": [{"role": "system", "content": system_prompt}, {"role": "user", "content": prompt}], "max_completion_tokens": max_tokens}
    if model.startswith(("gpt-5", "gpt-6", "o1", "o3", "o4")):
        effort = str(cfg.get("reasoning_effort", "none"))
        if effort not in OPENAI_REASONING_EFFORTS:
            raise ValueError("OpenAI reasoning effort is invalid")
        payload["reasoning_effort"] = effort
    else:
        payload["temperature"] = temperature
    request = urllib.request.Request("https://api.openai.com/v1/chat/completions", data=json.dumps(payload).encode("utf-8"), headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json", "User-Agent": "CLIPTORA-Workflow/1.0"}, method="POST")
    try:
        with urllib.request.urlopen(request, timeout=120) as response:
            result = json.load(response)
        choice = result["choices"][0]
        return {"text": str(choice["message"]["content"]), "model": str(result.get("model", model)), "usage": result.get("usage", {}), "finish_reason": choice.get("finish_reason")}
    except (urllib.error.HTTPError, urllib.error.URLError, ValueError, KeyError, IndexError) as exc:
        raise RuntimeError(f"OpenAI request failed: {str(exc)[:200]}") from exc


def _find_named_value(value: Any, name: str, depth: int = 0) -> Any:
    """Find a bounded field in upstream JSON without evaluating expressions."""
    if depth > 8:
        return None
    if isinstance(value, dict):
        if name in value:
            return value[name]
        for nested in value.values():
            found = _find_named_value(nested, name, depth + 1)
            if found is not None:
                return found
    elif isinstance(value, list):
        for nested in value[:100]:
            found = _find_named_value(nested, name, depth + 1)
            if found is not None:
                return found
    return None


def execute_ai_agent(cfg: dict[str, Any], outputs: dict[str, Any]) -> dict[str, Any]:
    raw_handles = cfg.get("__cliptora_ui_target_handles", {})
    handles = raw_handles if isinstance(raw_handles, dict) else {}
    model_ids = [source_id for source_id, handle in handles.items() if handle == "chat_model" and source_id in outputs]
    if not model_ids:
        raise ValueError("AI Agent requires a Chat Model connection")
    model_output = outputs[model_ids[0]]
    model_cfg = model_output.get("chat_model", {}) if isinstance(model_output, dict) else {}
    if not isinstance(model_cfg, dict):
        raise ValueError("The connected Chat Model returned invalid configuration")

    prompt_source = str(cfg.get("prompt_source", "connected_chat_trigger"))
    if prompt_source == "connected_chat_trigger":
        prompt_value = _find_named_value({key: value for key, value in outputs.items() if key not in model_ids}, "chatInput")
        if prompt_value is None:
            raise ValueError("Connected Chat Trigger input is missing chatInput")
        prompt = str(prompt_value).strip()
    elif prompt_source == "define_below":
        prompt = str(cfg.get("prompt", "")).strip()
    else:
        raise ValueError("AI Agent prompt source must be connected_chat_trigger or define_below")
    if not prompt:
        raise ValueError("AI Agent prompt cannot be empty")

    memory = {key: outputs[key] for key, handle in handles.items() if handle == "memory" and key in outputs}
    tools = {key: outputs[key] for key, handle in handles.items() if handle == "tool" and key in outputs}
    if memory:
        prompt += "\n\nConversation memory:\n" + json.dumps(memory, ensure_ascii=False, separators=(",", ":"))
    if tools:
        prompt += "\n\nConnected tool results:\n" + json.dumps(tools, ensure_ascii=False, separators=(",", ":"))

    request_cfg = {
        **model_cfg,
        "prompt": prompt,
        "system_prompt": str(cfg.get("system_message", "You are a helpful AI agent.")),
    }
    try:
        result = openai_chat(request_cfg, {})
    except RuntimeError:
        fallback = str(cfg.get("fallback_model", "")).strip()
        if not cfg.get("enable_fallback_model") or not fallback:
            raise
        result = openai_chat({**request_cfg, "model": fallback}, {})
        result["fallback_used"] = True

    if cfg.get("require_specific_output"):
        try:
            result["structured_output"] = json.loads(str(result.get("text", "")))
        except ValueError as exc:
            raise ValueError("AI Agent required structured JSON output, but the model returned invalid JSON") from exc
    result["agent"] = {"chat_model_node": model_ids[0], "memory_inputs": list(memory), "tool_inputs": list(tools)}
    return result


def openai_request(path: str, payload: dict[str, Any], timeout: int = 120) -> dict[str, Any]:
    """Call a JSON OpenAI endpoint with the server-side credential only."""
    key = os.environ.get("OPENAI_API_KEY", "").strip()
    if not key:
        raise RuntimeError("OPENAI_API_KEY is missing from the backend environment")
    request = urllib.request.Request(
        f"https://api.openai.com/v1/{path.lstrip('/')}",
        data=json.dumps(payload).encode("utf-8"),
        headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json", "User-Agent": "CLIPTORA-Workflow/1.0"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            result = json.load(response)
        if not isinstance(result, dict):
            raise ValueError("OpenAI returned a non-object response")
        return result
    except urllib.error.HTTPError as exc:
        try:
            detail = exc.read(4096).decode("utf-8", errors="replace")
        except Exception:
            detail = str(exc)
        raise RuntimeError(f"OpenAI request failed ({exc.code}): {detail[:500]}") from exc
    except (urllib.error.URLError, ValueError) as exc:
        raise RuntimeError(f"OpenAI request failed: {str(exc)[:300]}") from exc


def fetch_public_image_bytes(raw_url: str, *, max_bytes: int = 10_000_000) -> tuple[bytes, str, str]:
    """Download one bounded public image without redirects or private-network access."""
    parsed = urllib.parse.urlsplit(raw_url.strip())
    if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password or parsed.fragment or parsed.port not in {None, 443}:
        raise ValueError("Image inputs must be public HTTPS URLs")
    addresses = socket.getaddrinfo(parsed.hostname, 443, type=socket.SOCK_STREAM)
    if not addresses or any(not ipaddress.ip_address(address[4][0]).is_global for address in addresses):
        raise ValueError("Image URL cannot resolve to a private, local or reserved address")
    request = urllib.request.Request(raw_url, headers={"Accept": "image/png,image/jpeg,image/webp", "User-Agent": "CLIPTORA-Workflow/1.0"})
    try:
        response = urllib.request.build_opener(NoWorkflowRedirect()).open(request, timeout=30)
        with response:
            content_type = response.headers.get_content_type()
            if content_type not in {"image/png", "image/jpeg", "image/webp"}:
                raise ValueError("Image URL returned an unsupported content type")
            raw = response.read(max_bytes + 1)
        if not raw or len(raw) > max_bytes:
            raise ValueError(f"Image must contain between 1 byte and {max_bytes // 1_000_000} MB")
        extension = {"image/png": "png", "image/jpeg": "jpg", "image/webp": "webp"}[content_type]
        return raw, content_type, f"input.{extension}"
    except urllib.error.HTTPError as exc:
        raise RuntimeError(f"Image download failed with status {exc.code}") from exc
    except urllib.error.URLError as exc:
        raise RuntimeError(f"Image download failed: {exc.reason}") from exc


def openai_multipart_request(path: str, fields: dict[str, str], files: list[tuple[str, str, str, bytes]], timeout: int = 180) -> dict[str, Any]:
    """Call a bounded multipart OpenAI endpoint using only the backend credential."""
    key = os.environ.get("OPENAI_API_KEY", "").strip()
    if not key:
        raise RuntimeError("OPENAI_API_KEY is missing from the backend environment")
    if path != "images/edits" or not files or len(files) > 5:
        raise ValueError("OpenAI multipart request is invalid")
    boundary = "----CLIPTORA" + hashlib.sha256(os.urandom(24)).hexdigest()[:32]
    chunks: list[bytes] = []
    for name, value in fields.items():
        if not re.fullmatch(r"[A-Za-z0-9_\[\]-]{1,80}", name) or "\r" in value or "\n" in name:
            raise ValueError("OpenAI multipart field is invalid")
        chunks.extend([f"--{boundary}\r\nContent-Disposition: form-data; name=\"{name}\"\r\n\r\n".encode(), value.encode("utf-8"), b"\r\n"])
    for name, filename, content_type, raw in files:
        if not re.fullmatch(r"[A-Za-z0-9_\[\]-]{1,80}", name) or not re.fullmatch(r"[A-Za-z0-9_.-]{1,120}", filename) or content_type not in {"image/png", "image/jpeg", "image/webp"}:
            raise ValueError("OpenAI multipart file is invalid")
        chunks.extend([f"--{boundary}\r\nContent-Disposition: form-data; name=\"{name}\"; filename=\"{filename}\"\r\nContent-Type: {content_type}\r\n\r\n".encode(), raw, b"\r\n"])
    chunks.append(f"--{boundary}--\r\n".encode())
    body = b"".join(chunks)
    if len(body) > 50_000_000:
        raise ValueError("OpenAI image edit request exceeds 50 MB")
    request = urllib.request.Request(
        f"https://api.openai.com/v1/{path}", data=body,
        headers={"Authorization": f"Bearer {key}", "Content-Type": f"multipart/form-data; boundary={boundary}", "User-Agent": "CLIPTORA-Workflow/1.0"}, method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            result = json.load(response)
        if not isinstance(result, dict):
            raise ValueError("OpenAI returned a non-object response")
        return result
    except urllib.error.HTTPError as exc:
        try:
            detail = exc.read(4096).decode("utf-8", errors="replace")
        except Exception:
            detail = str(exc)
        raise RuntimeError(f"OpenAI image edit failed ({exc.code}): {detail[:500]}") from exc
    except (urllib.error.URLError, ValueError) as exc:
        raise RuntimeError(f"OpenAI image edit failed: {str(exc)[:300]}") from exc


def openai_action(cfg: dict[str, Any], outputs: dict[str, Any]) -> dict[str, Any]:
    action = str(cfg.get("action") or "message_model")
    if action == "message_model":
        return openai_chat(cfg, outputs)

    prompt = str(cfg.get("prompt", "")).strip()
    input_path_value = str(cfg.get("input_path", "")).strip()
    if input_path_value:
        prompt = f"{prompt}\n\nInput data:\n{json.dumps(input_path(outputs, input_path_value), ensure_ascii=False, separators=(',', ':'))}"

    if action == "classify_violations":
        if not prompt or len(prompt) > 200_000:
            raise ValueError("Text input must contain between 1 and 200,000 characters")
        model = str(cfg.get("model") or "omni-moderation-latest")
        if not model.startswith("omni-moderation"):
            model = "omni-moderation-latest"
        result = openai_request("moderations", {"model": model, "input": prompt})
        moderation = (result.get("results") or [{}])[0]
        if bool(cfg.get("simplify_output", True)):
            return {"flagged": bool(moderation.get("flagged")), "categories": moderation.get("categories", {}), "category_scores": moderation.get("category_scores", {})}
        return result

    if action == "analyze_image":
        urls = [line.strip() for line in str(cfg.get("image_urls", "")).splitlines() if line.strip()]
        if not 1 <= len(urls) <= 10:
            raise ValueError("Analyze image requires between 1 and 10 HTTPS image URLs")
        for url in urls:
            parsed = urllib.parse.urlparse(url)
            if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password:
                raise ValueError("Every image URL must be a public HTTPS URL")
        if not prompt:
            prompt = "What's in this image?"
        if len(prompt) > 100_000:
            raise ValueError("Text input is too long")
        model = str(cfg.get("model") or os.environ.get("CLIPTORA_OPENAI_MODEL", "gpt-6.1-sol"))
        if model.startswith(("gpt-image", "omni-moderation")):
            model = "gpt-6.1-sol"
        content: list[dict[str, Any]] = [{"type": "text", "text": prompt}]
        content.extend({"type": "image_url", "image_url": {"url": url, "detail": "auto"}} for url in urls)
        vision_payload: dict[str, Any] = {"model": model, "messages": [{"role": "user", "content": content}], "max_completion_tokens": int(cfg.get("max_output_tokens", 1000))}
        if model.startswith(("gpt-5", "gpt-6", "o1", "o3", "o4")):
            effort = str(cfg.get("reasoning_effort", "none"))
            if effort not in OPENAI_REASONING_EFFORTS:
                raise ValueError("OpenAI reasoning effort is invalid")
            vision_payload["reasoning_effort"] = effort
        result = openai_request("chat/completions", vision_payload)
        choice = result["choices"][0]
        if bool(cfg.get("simplify_output", True)):
            return {"text": str(choice["message"]["content"]), "model": str(result.get("model", model)), "usage": result.get("usage", {}), "finish_reason": choice.get("finish_reason")}
        return result

    if action == "generate_image":
        if not prompt or len(prompt) > 32_000:
            raise ValueError("Image prompt must contain between 1 and 32,000 characters")
        size = str(cfg.get("image_size") or "1024x1024")
        if size not in {"1024x1024", "1536x1024", "1024x1536", "auto"}:
            raise ValueError("Unsupported image size")
        model = str(cfg.get("model") or "gpt-image-2.5-flare")
        if not model.startswith("gpt-image-"):
            model = "gpt-image-2.5-flare"
        result = openai_request("images/generations", {"model": model, "prompt": prompt, "size": size, "n": 1}, timeout=180)
        images = result.get("data") or []
        if bool(cfg.get("simplify_output", True)):
            return {"images": [{key: item[key] for key in ("url", "b64_json", "revised_prompt") if key in item} for item in images if isinstance(item, dict)]}
        return result

    if action == "edit_image":
        if not prompt or len(prompt) > 32_000:
            raise ValueError("Image edit prompt must contain between 1 and 32,000 characters")
        urls = [line.strip() for line in str(cfg.get("image_urls", "")).splitlines() if line.strip()]
        if not 1 <= len(urls) <= 4:
            raise ValueError("Edit image requires between 1 and 4 public HTTPS image URLs")
        model = str(cfg.get("model") or "gpt-image-2.5-sunburst")
        if model not in OPENAI_IMAGE_MODELS:
            model = "gpt-image-2.5-sunburst"
        size = str(cfg.get("image_size") or "1024x1024")
        if size not in {"1024x1024", "1536x1024", "1024x1536", "auto"}:
            raise ValueError("Unsupported image size")
        fields = {"model": model, "prompt": prompt, "size": size, "n": "1"}
        fidelity = str(cfg.get("image_input_fidelity") or "auto")
        if fidelity not in {"auto", "low", "high"}:
            raise ValueError("Unsupported image input fidelity")
        if fidelity != "auto" and model != "gpt-image-2":
            fields["input_fidelity"] = fidelity
        files: list[tuple[str, str, str, bytes]] = []
        for index, url in enumerate(urls):
            raw, content_type, filename = fetch_public_image_bytes(url)
            files.append(("image[]", f"input-{index + 1}.{filename.rsplit('.', 1)[-1]}", content_type, raw))
        mask_url = str(cfg.get("mask_image_url", "")).strip()
        if mask_url:
            raw, content_type, _ = fetch_public_image_bytes(mask_url)
            if content_type != "image/png":
                raise ValueError("OpenAI image edit mask must be a PNG image")
            files.append(("mask", "mask.png", content_type, raw))
        result = openai_multipart_request("images/edits", fields, files, timeout=180)
        images = result.get("data") or []
        if bool(cfg.get("simplify_output", True)):
            return {"images": [{key: item[key] for key in ("url", "b64_json", "revised_prompt") if key in item} for item in images if isinstance(item, dict)]}
        return result

    raise ValueError(f"OpenAI action '{action}' is not supported by this CLIPTORA backend")


def gemini_request(method: str, path: str, payload: dict[str, Any] | None = None, timeout: int = 120) -> dict[str, Any]:
    """Call a Gemini JSON endpoint using the backend-only API key."""
    key = os.environ.get("GEMINI_API_KEY", "").strip()
    if not key:
        raise RuntimeError("GEMINI_API_KEY is missing from the backend environment")
    if method not in {"GET", "POST", "DELETE"} or not re.fullmatch(r"[A-Za-z0-9._~:/?=&%-]{1,500}", path):
        raise ValueError("Gemini API request is invalid")
    data = None if payload is None else json.dumps(payload, ensure_ascii=False, allow_nan=False).encode("utf-8")
    request = urllib.request.Request(
        f"https://generativelanguage.googleapis.com/v1beta/{path.lstrip('/')}",
        data=data,
        headers={"x-goog-api-key": key, "Content-Type": "application/json", "User-Agent": "CLIPTORA-Workflow/1.0"},
        method=method,
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            raw = response.read()
        result = json.loads(raw) if raw else {}
        if not isinstance(result, dict):
            raise ValueError("Gemini returned a non-object response")
        return result
    except urllib.error.HTTPError as exc:
        try:
            detail = exc.read(4096).decode("utf-8", errors="replace")
        except Exception:
            detail = str(exc)
        raise RuntimeError(f"Gemini request failed ({exc.code}): {detail[:500]}") from exc
    except (urllib.error.URLError, ValueError) as exc:
        raise RuntimeError(f"Gemini request failed: {str(exc)[:300]}") from exc


def gemini_prompt(cfg: dict[str, Any], outputs: dict[str, Any]) -> str:
    prompt = str(cfg.get("prompt", "")).strip()
    input_path_value = str(cfg.get("input_path", "")).strip()
    if input_path_value:
        prompt = f"{prompt}\n\nInput data:\n{json.dumps(input_path(outputs, input_path_value), ensure_ascii=False, separators=(',', ':'))}"
    if not prompt or len(prompt) > 200_000:
        raise ValueError("Text input must contain between 1 and 200,000 characters")
    return prompt


def gemini_action(cfg: dict[str, Any], outputs: dict[str, Any]) -> dict[str, Any]:
    action = str(cfg.get("action") or "message_model")
    if action == "message_model":
        prompt = gemini_prompt(cfg, outputs)
        model = str(cfg.get("model") or "gemini-3.8-flash").strip()
        if model not in GEMINI_TEXT_MODELS:
            model = "gemini-3.8-flash"
        max_tokens = int(cfg.get("max_output_tokens", 1000))
        if not 1 <= max_tokens <= 65_536:
            raise ValueError("Gemini maximum output tokens must be between 1 and 65,536")
        payload: dict[str, Any] = {
            "contents": [{"role": "user", "parts": [{"text": prompt}]}],
            "generationConfig": {"maxOutputTokens": max_tokens},
        }
        system_prompt = str(cfg.get("system_prompt", "")).strip()
        if system_prompt:
            payload["systemInstruction"] = {"parts": [{"text": system_prompt[:100_000]}]}
        result = gemini_request("POST", f"models/{model}:generateContent", payload)
        if not bool(cfg.get("simplify_output", True)):
            return result
        candidates = result.get("candidates") or []
        parts = candidates[0].get("content", {}).get("parts", []) if candidates and isinstance(candidates[0], dict) else []
        text = "".join(str(part.get("text", "")) for part in parts if isinstance(part, dict))
        finish_reason = candidates[0].get("finishReason") if candidates and isinstance(candidates[0], dict) else None
        return {"text": text, "model": model, "usage": result.get("usageMetadata", {}), "finish_reason": finish_reason}

    if action == "generate_image":
        prompt = gemini_prompt(cfg, outputs)
        model = str(cfg.get("model") or "gemini-3.1-flash-image").strip()
        if model not in GEMINI_IMAGE_MODELS:
            model = "gemini-3.1-flash-image"
        aspect_ratio = str(cfg.get("image_aspect_ratio") or "1:1")
        if aspect_ratio not in {"1:1", "3:2", "2:3", "4:3", "3:4", "16:9", "9:16"}:
            raise ValueError("Unsupported Gemini image aspect ratio")
        result = gemini_request("POST", f"models/{model}:generateContent", {
            "contents": [{"role": "user", "parts": [{"text": prompt}]}],
            "generationConfig": {"responseModalities": ["TEXT", "IMAGE"], "imageConfig": {"aspectRatio": aspect_ratio}},
        }, timeout=180)
        if not bool(cfg.get("simplify_output", True)):
            return result
        candidates = result.get("candidates") or []
        parts = candidates[0].get("content", {}).get("parts", []) if candidates and isinstance(candidates[0], dict) else []
        images = []
        text_parts = []
        for part in parts:
            if not isinstance(part, dict):
                continue
            if part.get("text"):
                text_parts.append(str(part["text"]))
            inline = part.get("inlineData") or part.get("inline_data")
            if isinstance(inline, dict) and inline.get("data"):
                images.append({"mime_type": inline.get("mimeType") or inline.get("mime_type") or "image/png", "b64_json": inline["data"]})
        return {"images": images, "text": "".join(text_parts), "model": model, "usage": result.get("usageMetadata", {})}

    if action == "create_file_search_store":
        display_name = str(cfg.get("display_name", "")).strip()
        if not 1 <= len(display_name) <= 128:
            raise ValueError("File Search store display name must contain between 1 and 128 characters")
        return gemini_request("POST", "fileSearchStores", {"displayName": display_name, "embeddingModel": "models/gemini-embedding-2"})

    if action == "list_file_search_stores":
        return gemini_request("GET", "fileSearchStores?pageSize=100")

    if action == "delete_file_search_store":
        store_name = str(cfg.get("store_name", "")).strip()
        if not re.fullmatch(r"fileSearchStores/[A-Za-z0-9_-]{1,128}", store_name):
            raise ValueError("File Search store name must look like fileSearchStores/store-id")
        return gemini_request("DELETE", f"{store_name}?force=true")

    raise ValueError(f"Gemini action '{action}' is not supported by this CLIPTORA backend")


def ollama_base_url() -> str:
    raw = os.environ.get("OLLAMA_BASE_URL", "http://host.docker.internal:11434").strip().rstrip("/")
    parsed = urllib.parse.urlsplit(raw)
    allowed_hosts = {"localhost", "127.0.0.1", "host.docker.internal"}
    allowed_hosts.update(host.strip().casefold() for host in os.environ.get("CLIPTORA_OLLAMA_ALLOWED_HOSTS", "").split(",") if host.strip())
    if parsed.scheme not in {"http", "https"} or not parsed.hostname or parsed.hostname.casefold() not in allowed_hosts:
        raise ValueError("OLLAMA_BASE_URL must use an explicitly allowed local Ollama host")
    if parsed.username or parsed.password or parsed.query or parsed.fragment or parsed.path not in {"", "/"}:
        raise ValueError("OLLAMA_BASE_URL cannot contain credentials, a path, query or fragment")
    if parsed.port is not None and not 1 <= parsed.port <= 65535:
        raise ValueError("OLLAMA_BASE_URL port is invalid")
    return raw


def ollama_request(path: str, payload: dict[str, Any] | None = None, timeout: int = 180) -> dict[str, Any]:
    if path not in {"api/chat", "api/tags"}:
        raise ValueError("Ollama API path is not allowed")
    request = urllib.request.Request(
        f"{ollama_base_url()}/{path}",
        data=None if payload is None else json.dumps(payload, ensure_ascii=False, allow_nan=False).encode("utf-8"),
        headers={"Content-Type": "application/json", "User-Agent": "CLIPTORA-Workflow/1.0"},
        method="GET" if payload is None else "POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            result = json.load(response)
        if not isinstance(result, dict):
            raise ValueError("Ollama returned a non-object response")
        return result
    except urllib.error.HTTPError as exc:
        try:
            detail = exc.read(4096).decode("utf-8", errors="replace")
        except Exception:
            detail = str(exc)
        raise RuntimeError(f"Ollama request failed ({exc.code}): {detail[:500]}") from exc
    except (urllib.error.URLError, TimeoutError, ValueError) as exc:
        raise RuntimeError(f"Ollama is unavailable at {ollama_base_url()}: {str(exc)[:300]}") from exc


def ollama_status() -> dict[str, Any]:
    try:
        base_url = ollama_base_url()
        result = ollama_request("api/tags", timeout=3)
        models = [str(item.get("name") or item.get("model")) for item in result.get("models", []) if isinstance(item, dict) and (item.get("name") or item.get("model"))]
        return {"configured": True, "reachable": True, "base_url": base_url, "models": models[:200]}
    except (RuntimeError, ValueError):
        return {"configured": False, "reachable": False, "base_url": os.environ.get("OLLAMA_BASE_URL", "http://host.docker.internal:11434").strip(), "models": []}


def fetch_public_ollama_image(raw_url: str) -> str:
    parsed = urllib.parse.urlsplit(raw_url.strip())
    if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password or parsed.fragment or parsed.port not in {None, 443}:
        raise ValueError("Ollama image inputs must be public HTTPS URLs")
    addresses = socket.getaddrinfo(parsed.hostname, 443, type=socket.SOCK_STREAM)
    if not addresses or any(not ipaddress.ip_address(address[4][0]).is_global for address in addresses):
        raise ValueError("Ollama image URL cannot resolve to a private, local or reserved address")
    request = urllib.request.Request(raw_url, headers={"Accept": "image/png,image/jpeg,image/webp", "User-Agent": "CLIPTORA-Workflow/1.0"})
    try:
        response = urllib.request.build_opener(NoWorkflowRedirect()).open(request, timeout=30)
        with response:
            content_type = response.headers.get_content_type()
            if content_type not in {"image/png", "image/jpeg", "image/webp"}:
                raise ValueError("Ollama image URL returned an unsupported content type")
            raw = response.read(10_000_001)
        if not raw or len(raw) > 10_000_000:
            raise ValueError("Ollama image must contain between 1 byte and 10 MB")
        return base64.b64encode(raw).decode("ascii")
    except urllib.error.HTTPError as exc:
        raise RuntimeError(f"Ollama image download failed with status {exc.code}") from exc
    except urllib.error.URLError as exc:
        raise RuntimeError(f"Ollama image download failed: {exc.reason}") from exc


def ollama_action(cfg: dict[str, Any], outputs: dict[str, Any]) -> dict[str, Any]:
    action = str(cfg.get("action") or "message_model")
    if action not in {"message_model", "analyze_image"}:
        raise ValueError(f"Ollama action '{action}' is not supported by this CLIPTORA backend")
    model = str(cfg.get("model") or "gemma3").strip()
    if not re.fullmatch(r"[A-Za-z0-9._:/-]{1,160}", model):
        raise ValueError("Ollama model name is invalid")
    prompt = str(cfg.get("prompt", "")).strip()
    if action == "analyze_image" and not prompt:
        prompt = "What is in this image?"
    input_path_value = str(cfg.get("input_path", "")).strip()
    if input_path_value:
        prompt = f"{prompt}\n\nInput data:\n{json.dumps(input_path(outputs, input_path_value), ensure_ascii=False, separators=(',', ':'))}"
    if not prompt or len(prompt) > 200_000:
        raise ValueError("Ollama text input must contain between 1 and 200,000 characters")
    temperature = float(cfg.get("temperature", 0.2))
    max_tokens = int(cfg.get("max_output_tokens", 1000))
    if not math.isfinite(temperature) or not 0 <= temperature <= 2:
        raise ValueError("Ollama temperature must be between 0 and 2")
    if not 1 <= max_tokens <= 32_768:
        raise ValueError("Ollama maximum output tokens must be between 1 and 32,768")
    user_message: dict[str, Any] = {"role": "user", "content": prompt}
    if action == "analyze_image":
        urls = [line.strip() for line in str(cfg.get("image_urls", "")).splitlines() if line.strip()]
        if not 1 <= len(urls) <= 4:
            raise ValueError("Analyze image requires between 1 and 4 public HTTPS image URLs")
        user_message["images"] = [fetch_public_ollama_image(url) for url in urls]
    messages: list[dict[str, Any]] = []
    system_prompt = str(cfg.get("system_prompt", "")).strip()
    if system_prompt:
        messages.append({"role": "system", "content": system_prompt[:100_000]})
    messages.append(user_message)
    result = ollama_request("api/chat", {"model": model, "messages": messages, "stream": False, "options": {"temperature": temperature, "num_predict": max_tokens}})
    if not bool(cfg.get("simplify_output", True)):
        return result
    message = result.get("message") if isinstance(result.get("message"), dict) else {}
    return {"text": str(message.get("content", "")), "model": str(result.get("model", model)), "done_reason": result.get("done_reason"), "prompt_tokens": result.get("prompt_eval_count"), "output_tokens": result.get("eval_count"), "total_duration": result.get("total_duration")}


HIGHLIGHTS_SCHEMA = {"type": "object", "properties": {"highlights": {"type": "array", "items": {"type": "object", "properties": {"start_word_id": {"type": "integer"}, "end_word_id": {"type": "integer"}, "score": {"type": "integer"}, "reason": {"type": "string"}}, "required": ["start_word_id", "end_word_id", "score", "reason"], "additionalProperties": False}}}, "required": ["highlights"], "additionalProperties": False}
SUMMARY_SCHEMA = {"type": "object", "properties": {"summary": {"type": "string"}}, "required": ["summary"], "additionalProperties": False}


def value_path(value: Any, path: str) -> Any:
    """Resolve a bounded dot path inside JSON-compatible data without eval."""
    if not path:
        return value
    parts = path.strip().split(".")
    if len(parts) > 16 or any(not re.fullmatch(r"[A-Za-z0-9_-]{1,80}", part) for part in parts):
        raise ValueError("Field must be a safe dot path")
    for part in parts:
        if isinstance(value, dict) and part in value:
            value = value[part]
        elif isinstance(value, list) and part.isdigit() and int(part) < len(value):
            value = value[int(part)]
        else:
            return None
    return value


def safe_workflow_http_url(raw_url: str, query: Any = None) -> str:
    """Validate an outbound integration URL against an explicit HTTPS allowlist."""
    if not isinstance(raw_url, str) or len(raw_url) > 2048:
        raise ValueError("HTTP Request URL is invalid")
    parsed = urllib.parse.urlsplit(raw_url.strip())
    if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password or parsed.fragment:
        raise ValueError("HTTP Request requires an HTTPS URL without credentials or fragments")
    if parsed.port not in (None, 443):
        raise ValueError("HTTP Request only supports HTTPS port 443")
    allowed = {host.strip().casefold() for host in os.environ.get("CLIPTORA_WORKFLOW_HTTP_ALLOWED_HOSTS", "").split(",") if host.strip()}
    if parsed.hostname.casefold() not in allowed:
        raise ValueError("HTTP Request host is not in CLIPTORA_WORKFLOW_HTTP_ALLOWED_HOSTS")
    addresses = socket.getaddrinfo(parsed.hostname, 443, type=socket.SOCK_STREAM)
    if not addresses or any(not ipaddress.ip_address(address[4][0]).is_global for address in addresses):
        raise ValueError("HTTP Request blocks private, local, reserved and loopback addresses")
    pairs = urllib.parse.parse_qsl(parsed.query, keep_blank_values=True)
    if query not in (None, {}):
        if not isinstance(query, dict) or len(query) > 100:
            raise ValueError("HTTP Request query must be an object with at most 100 fields")
        for key, value in query.items():
            if isinstance(value, (dict, list)):
                value = json.dumps(value, ensure_ascii=False, separators=(",", ":"))
            pairs.append((str(key)[:200], str(value)[:4000]))
    return urllib.parse.urlunsplit((parsed.scheme, parsed.netloc, parsed.path or "/", urllib.parse.urlencode(pairs), ""))


class NoWorkflowRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise ValueError("HTTP Request redirects are disabled")


def execute_http_request(cfg: dict[str, Any]) -> dict[str, Any]:
    url = safe_workflow_http_url(str(cfg.get("url", "")), cfg.get("query", {}))
    method = str(cfg.get("method", "GET")).upper()
    if method not in {"GET", "POST", "PUT", "PATCH", "DELETE"}:
        raise ValueError("Unsupported HTTP method")
    timeout = int(cfg.get("timeout_seconds", 30))
    if not 1 <= timeout <= 120:
        raise ValueError("HTTP timeout must be between 1 and 120 seconds")
    raw_headers = cfg.get("headers", {})
    if not isinstance(raw_headers, dict) or len(raw_headers) > 50:
        raise ValueError("HTTP headers must be an object with at most 50 fields")
    blocked = {"authorization", "proxy-authorization", "cookie", "set-cookie", "host", "content-length"}
    headers = {"Accept": "application/json, text/plain;q=0.9", "User-Agent": "CLIPTORA-Workflow/1.0"}
    for key, value in raw_headers.items():
        name = str(key).strip()
        if not re.fullmatch(r"[A-Za-z0-9-]{1,80}", name) or name.casefold() in blocked:
            raise ValueError(f"HTTP header is not allowed: {name}")
        text = str(value)
        if "\r" in text or "\n" in text or len(text) > 4000:
            raise ValueError(f"HTTP header value is invalid: {name}")
        headers[name] = text
    data = None
    if method in {"POST", "PUT", "PATCH"}:
        data = json.dumps(cfg.get("body", {}), ensure_ascii=False, allow_nan=False).encode("utf-8")
        if len(data) > 1_000_000:
            raise ValueError("HTTP request body exceeds 1 MB")
        headers.setdefault("Content-Type", "application/json")
    request = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        response = urllib.request.build_opener(NoWorkflowRedirect()).open(request, timeout=timeout)
        with response:
            raw = response.read(5_000_001)
            if len(raw) > 5_000_000:
                raise ValueError("HTTP response exceeds 5 MB")
            content_type = response.headers.get_content_type()
            charset = response.headers.get_content_charset() or "utf-8"
            response_format = str(cfg.get("response_format", "auto"))
            if response_format not in {"auto", "json", "text"}:
                raise ValueError("HTTP response format must be auto, json or text")
            if response_format == "json" or (response_format == "auto" and content_type == "application/json"):
                body: Any = json.loads(raw.decode(charset)) if raw else None
            else:
                body = raw.decode(charset, errors="replace")
            return {"response": {"status": response.status, "url": url, "content_type": content_type, "body": body}}
    except urllib.error.HTTPError as exc:
        raise RuntimeError(f"HTTP Request failed with status {exc.code}") from exc
    except urllib.error.URLError as exc:
        raise RuntimeError(f"HTTP Request transport failed: {exc.reason}") from exc


def call_node(node: dict, outputs: dict[str, Any], source: Path | None, workdir: Path) -> dict:
    """Dispatch to the independent registered node module."""
    return node_executor(node["type"])(node, outputs, source, workdir)


def run_graph(nodes: list[dict], source: Path | None, workspace: Path, update: Callable[[int, str, dict], None], cancelled: Callable[[], bool] = lambda: False) -> dict:
    """Backward-compatible public entry point for FastAPI and worker callers."""
    from app.workflows.engine import run_graph as execute_graph
    return execute_graph(nodes, source, workspace, update, cancelled)
