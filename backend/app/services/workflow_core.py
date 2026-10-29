"""CLIPTORA composable video workflows. No arbitrary Python/shell execution nodes.

Node outputs are JSON artifacts in a project/run-scoped folder. The engine never
accepts filesystem paths or commands from the browser; source paths are resolved
and checked by the API. FFmpeg and faster-whisper are optional system dependencies.
"""
from __future__ import annotations

import hashlib
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
from functools import lru_cache
from pathlib import Path
from typing import Any, Callable

MAX_NODES = 100
MAX_CUTS = 36
MAX_TARGET_SECONDS = 1800
NODE_TYPES: dict[str, dict[str, Any]] = {
    "core.manual_trigger": {"label": "Manual Trigger", "group": "Triggers", "settings": {}},
    "core.video_source": {
        "label": "Source Video", "group": "Video & Media", "settings": {"source_id": None},
        "actions": [],
        "parameters_schema": {"type": "object", "properties": {
            "source_id": {"type": "integer", "title": "Workflow source"},
        }},
    },
    "flow.if": {
        "label": "IF", "group": "Flow",
        "settings": {"path": "", "operator": "truthy", "value": ""},
        "parameters_schema": {"type": "object", "properties": {
            "path": {"type": "string", "title": "Input path"},
            "operator": {"type": "string", "title": "Operator", "enum": ["truthy", "exists", "equals", "not_equals", "contains", "greater_than", "less_than"]},
            "value": {"type": "string", "title": "Comparison value"},
        }},
    },
    "flow.switch": {
        "label": "Switch", "group": "Flow",
        "settings": {"path": "", "operator": "equals", "rules": [{"value": "", "route": 0}]},
        "parameters_schema": {"type": "object", "properties": {
            "path": {"type": "string", "title": "Input path", "description": "Dot path including the upstream node ID."},
            "operator": {"type": "string", "title": "Operator", "enum": ["equals", "not_equals", "contains", "greater_than", "less_than", "exists", "truthy"]},
            "rules": {"type": "array", "title": "Routing rules", "description": "Ordered JSON rules: [{\"value\":\"paid\",\"route\":0}]. Routes 0-4 are supported."},
        }},
    },
    "flow.merge": {
        "label": "Merge", "group": "Flow",
        "settings": {"mode": "append"},
        "parameters_schema": {"type": "object", "properties": {
            "mode": {"type": "string", "title": "Merge mode", "enum": ["append", "combine", "choose_first"]},
        }},
    },
    "data.filter": {
        "label": "Filter", "group": "Data transformation",
        "settings": {"path": "", "field": "", "operator": "truthy", "value": ""},
        "parameters_schema": {"type": "object", "properties": {
            "path": {"type": "string", "title": "Items path", "description": "Dot path to an array, including the upstream node ID."},
            "field": {"type": "string", "title": "Item field", "description": "Optional dot path inside each item."},
            "operator": {"type": "string", "title": "Operator", "enum": ["truthy", "exists", "equals", "not_equals", "contains", "greater_than", "less_than"]},
            "value": {"type": "string", "title": "Comparison value"},
        }},
    },
    "core.http_request": {
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
    },
    "ai.openai": {
        "label": "OpenAI", "group": "AI",
        "settings": {"model": "gpt-4o-mini", "system_prompt": "You are a helpful assistant.", "prompt": "", "input_path": "", "temperature": 0.2, "max_output_tokens": 1000},
        "parameters_schema": {"type": "object", "properties": {
            "model": {"type": "string", "title": "Model"},
            "system_prompt": {"type": "string", "title": "System prompt"},
            "prompt": {"type": "string", "title": "Prompt"},
            "input_path": {"type": "string", "title": "Optional input path", "description": "Append JSON data from this upstream dot path to the prompt."},
            "temperature": {"type": "number", "title": "Temperature", "minimum": 0, "maximum": 2},
            "max_output_tokens": {"type": "integer", "title": "Maximum output tokens", "minimum": 1, "maximum": 16000},
        }},
        "credentials": ["OPENAI_API_KEY"],
    },
    "media.probe": {"label": "Inspect Video", "group": "Analysis", "settings": {}},
    "audio.extract": {"label": "Extract Audio", "group": "Analysis", "settings": {}},
    "audio.transcribe": {"label": "Transcribe Every Word", "group": "Analysis", "settings": {"model": "small", "language": None}},
    "transcript.import": {"label": "Import Transcript JSON", "group": "Analysis", "settings": {"words": []}},
    "ai.highlights": {"label": "Select Best Moments", "group": "AI", "settings": {"mode": "offline", "target_duration": 90, "strategy": "story_recap"}},
    "ai.summary": {"label": "Create Summary Script", "group": "AI", "settings": {"mode": "offline", "language": "auto"}},
    "timeline.cut_plan": {"label": "Create Non-Destructive Cuts", "group": "Editing", "settings": {"padding": 0.15}},
    "caption.generate": {"label": "Word Timed Captions", "group": "Creative", "settings": {"max_words": 5, "style": "karaoke"}},
    "animation.storyboard": {"label": "Text Scene Storyboard", "group": "Creative", "settings": {"script": "", "scene_seconds": 4}},
    "animation.keyframes": {"label": "Build Keyframe Plan", "group": "Creative", "settings": {"preset": "fade-pop"}},
    "video.render": {"label": "Render Cut Video (FFmpeg)", "group": "Output", "settings": {"enabled": False, "aspect_ratio": "original"}},
}

# One declarative registry feeds the node picker. Entries without an executor are
# intentionally visible as planned capabilities, but validation/run_graph only
# accept NODE_TYPES. Adding a real tool means registering its schema here and
# implementing its backend executor in call_node.
PROPOSED_TOOL_GROUPS: dict[str, list[str]] = {
    "Captions & Subtitles": ["Generate Captions", "Import SRT/VTT", "Export SRT/VTT", "Word-by-Word Captions", "Animated Captions", "Caption Styling", "Subtitle Translation", "Subtitle Alignment", "Karaoke Effect", "Subtitle Position", "Highlight Spoken Words", "Burn Subtitles"],
    "Effects & Animations": ["Add Text", "Text Animation", "Keyframe Animation", "Transform", "Opacity Animation", "Motion Blur", "Blur Background", "Green Screen", "Color Correction", "LUT Filter", "Transitions", "Zoom & Pan", "Tracking", "Mask & Crop", "Shape Animation", "Particle Effect", "Apply Preset", "Animated Lower Third"],
    "Voiceover & Music": ["Text to Speech", "AI Voiceover", "Voice Clone", "Record Microphone", "Teleprompter Script", "Voice Synchronization", "Add Background Music", "Find Music", "Audio Fade In/Out", "Volume Automation", "Audio Ducking", "Mix Audio Tracks", "Sound Effects", "Audio Crossfade"],
    "Image & AI Generation": ["Generate Image", "Image to Video", "Text to Video", "Remove Background", "Upscale Image", "Upscale Video", "Inpaint Image", "Generate B-Roll", "Generate Thumbnail Art", "Object Detection", "Face Tracking", "Scene Detection", "AI Background Generation", "Animate Image"],
    "AI Providers": ["OpenAI", "Google Gemini", "Anthropic Claude", "Ollama", "Hugging Face", "Local LLM", "Whisper / faster-whisper", "WhisperX", "ElevenLabs", "Custom OpenAI-Compatible API", "Generic REST AI Provider", "ComfyUI Workflow"],
    "Apps & Integrations": ["Gmail", "Microsoft Outlook", "Microsoft Excel 365", "Google Sheets", "Google Drive", "OneDrive", "Dropbox", "YouTube", "TikTok API", "Instagram / Meta Graph API", "Telegram", "Discord", "Slack", "Notion", "Airtable", "WordPress", "AWS S3", "Cloudflare R2", "Supabase", "FTP / SFTP"],
    "Developer & Custom Tools": ["HTTP Request", "Webhook", "Python Function", "Custom Plugin", "Plugin Registry", "JavaScript Sandbox", "Run Approved Command", "API Credentials", "OAuth Connection", "Custom Header Auth", "Environment Variables", "Input/Output Schema", "Test Connection", "Node Logs", "Execution Metrics", "Cache Results", "Versioned Tool", "Custom Tool Import"],
}


@lru_cache(maxsize=1)
def n8n_node_catalog() -> list[dict[str, Any]]:
    manifest = Path(__file__).resolve().parents[1] / "workflows" / "registry" / "n8n_nodes.json"
    if not manifest.is_file():
        return []
    try:
        rows = json.loads(manifest.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        raise RuntimeError("The generated n8n node registry is invalid") from exc
    if not isinstance(rows, list) or any(not isinstance(item, dict) for item in rows):
        raise RuntimeError("The generated n8n node registry must be a list")
    return rows


def tool_catalog() -> list[dict[str, Any]]:
    implemented = [{
        "type": key, **value, "status": "implemented", "priority": "P0",
        "icon": key.split(".", 1)[0], "actions": value.get("actions", ["run"]),
        "input_types": [], "output_types": ["json"],
        "parameters_schema": value.get("parameters_schema", value.get("settings", {})), "credentials": value.get("credentials", []),
        "backend_executor": f"workflow_core.call_node:{key}",
    } for key, value in NODE_TYPES.items()]
    used_labels = {item["label"].casefold() for item in implemented}
    proposed: list[dict[str, Any]] = []
    for group, labels in PROPOSED_TOOL_GROUPS.items():
        for label in labels:
            if label.casefold() in used_labels:
                continue
            slug = re.sub(r"[^a-z0-9]+", ".", label.casefold()).strip(".")
            proposed.append({
                "type": f"planned.{slug}", "label": label, "group": group,
                "settings": {}, "status": "planned", "priority": "P1",
                "icon": group.casefold().replace(" & ", "."), "actions": [],
                "input_types": [], "output_types": [], "parameters_schema": {},
                "credentials": [], "backend_executor": None,
            })
    known_types = {item["type"] for item in implemented + proposed}
    compatible_inventory = [item for item in n8n_node_catalog() if item.get("type") not in known_types]
    return implemented + proposed + compatible_inventory


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
    model = os.environ.get("CLIPTORA_OPENAI_MODEL", "gpt-4o-mini")
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
    model = str(cfg.get("model") or os.environ.get("CLIPTORA_OPENAI_MODEL", "gpt-4o-mini")).strip()
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
    payload = {"model": model, "messages": [{"role": "system", "content": system_prompt}, {"role": "user", "content": prompt}], "temperature": temperature, "max_tokens": max_tokens}
    request = urllib.request.Request("https://api.openai.com/v1/chat/completions", data=json.dumps(payload).encode("utf-8"), headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json", "User-Agent": "CLIPTORA-Workflow/1.0"}, method="POST")
    try:
        with urllib.request.urlopen(request, timeout=120) as response:
            result = json.load(response)
        choice = result["choices"][0]
        return {"text": str(choice["message"]["content"]), "model": str(result.get("model", model)), "usage": result.get("usage", {}), "finish_reason": choice.get("finish_reason")}
    except (urllib.error.HTTPError, urllib.error.URLError, ValueError, KeyError, IndexError) as exc:
        raise RuntimeError(f"OpenAI request failed: {str(exc)[:200]}") from exc


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
    kind, cfg = node["type"], node.get("settings", {})
    if kind == "core.manual_trigger":
        return {"trigger": {"type": "manual", "status": "received"}}
    if kind == "core.video_source":
        if source is None:
            raise ValueError("Source Video requires a selected video")
        return {"source": {"filename": source.name, "size_bytes": source.stat().st_size}}
    if kind == "flow.if":
        operator = str(cfg.get("operator", "truthy"))
        actual = input_path(outputs, str(cfg.get("path", "")))
        condition = compare_value(actual, operator, cfg.get("value", ""))
        return {"condition": condition, "operator": operator, "path": str(cfg.get("path", "")), "actual": actual}
    if kind == "flow.switch":
        actual = input_path(outputs, str(cfg.get("path", "")))
        operator = str(cfg.get("operator", "equals"))
        rules = cfg.get("rules", [])
        if not isinstance(rules, list) or not 1 <= len(rules) <= 20:
            raise ValueError("Switch requires between 1 and 20 rules")
        route = None
        for rule in rules:
            if not isinstance(rule, dict) or not isinstance(rule.get("route"), int) or not 0 <= rule["route"] <= 4:
                raise ValueError("Switch routes must be integers from 0 to 4")
            if compare_value(actual, operator, rule.get("value", "")):
                route = rule["route"]
                break
        return {"route": route, "matched": route is not None, "operator": operator, "actual": actual}
    if kind == "flow.merge":
        mode = str(cfg.get("mode", "append"))
        values = list(outputs.values())
        if len(values) < 2:
            raise ValueError("Merge requires at least two connected inputs")
        if mode == "choose_first":
            return {"items": values[0], "mode": mode, "input_count": len(values)}
        if mode == "combine":
            combined: dict[str, Any] = {}
            for dependency_id, value in outputs.items():
                if not isinstance(value, dict):
                    raise ValueError(f"Merge combine requires object input from {dependency_id}")
                combined.update(value)
            return {"items": combined, "mode": mode, "input_count": len(values)}
        if mode == "append":
            appended: list[Any] = []
            for value in values:
                candidate = value.get("items") if isinstance(value, dict) and "items" in value else value
                appended.extend(candidate if isinstance(candidate, list) else [candidate])
            return {"items": appended, "mode": mode, "input_count": len(values)}
        raise ValueError("Merge mode must be append, combine or choose_first")
    if kind == "data.filter":
        items = input_path(outputs, str(cfg.get("path", "")))
        if not isinstance(items, list):
            raise ValueError("Filter items path must resolve to an array")
        if len(items) > 100_000:
            raise ValueError("Filter input exceeds 100,000 items")
        field = str(cfg.get("field", ""))
        operator = str(cfg.get("operator", "truthy"))
        kept = [item for item in items if compare_value(value_path(item, field), operator, cfg.get("value", ""))]
        return {"items": kept, "matched_count": len(kept), "input_count": len(items)}
    if kind == "core.http_request":
        return execute_http_request(cfg)
    if kind == "ai.openai":
        return openai_chat(cfg, outputs)
    if kind == "media.probe":
        if source is None:
            raise ValueError("Select a video source first")
        return {"probe": probe(source)}
    if kind == "audio.extract":
        if source is None:
            raise ValueError("Select a video source first")
        cached = source.parent / "derived"
        cached.mkdir(exist_ok=True)
        target = cached / f"{source.stem}.mono16k.wav"
        if not target.exists() or target.stat().st_size < 1000:
            temporary = cached / f"{source.stem}.tmp.wav"
            try:
                tool("ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error", "-y", "-i", str(source), "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", str(temporary), timeout=5400)
                temporary.replace(target)
            finally:
                temporary.unlink(missing_ok=True)
        return {"audio": str(target)}
    if kind == "audio.transcribe":
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
    if kind == "transcript.import":
        words = as_words(cfg.get("words", []))
        return {"words": words, "language": cfg.get("language", "unknown"), "segments": group_words(words)}
    if kind == "ai.highlights":
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
    if kind == "timeline.cut_plan":
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
    if kind == "ai.summary":
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
    if kind == "caption.generate":
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
    if kind == "animation.storyboard":
        script = str(cfg.get("script", "")).strip()
        if not script:
            raise ValueError("Write a script in storyboard node settings")
        seconds = max(0.5, min(30, float(cfg.get("scene_seconds", 4))))
        lines = [line.strip() for line in script.splitlines() if line.strip()][:100]
        return {"scenes": [{"index": i, "start": round(i * seconds, 3), "duration": seconds, "text": line} for i, line in enumerate(lines)]}
    if kind == "animation.keyframes":
        scenes = get_input(outputs, "scenes")
        if not scenes:
            raise ValueError("Keyframes requires storyboard")
        preset = str(cfg.get("preset", "fade-pop"))
        return {"keyframes": [{"scene": scene["index"], "start": scene["start"], "duration": scene["duration"], "text": scene["text"], "preset": preset, "from": {"opacity": 0, "scale": 0.88}, "to": {"opacity": 1, "scale": 1.0}} for scene in scenes]}
    if kind == "video.render":
        if not cfg.get("enabled", False):
            return {"render": {"state": "disabled", "hint": "Enable in node settings before rendering"}}
        if source is None:
            raise ValueError("Rendering requires uploaded video source")
        cuts = get_input(outputs, "cut_plan")
        if not cuts:
            raise ValueError("Rendering requires a cut plan")
        if len(cuts) > MAX_CUTS:
            raise ValueError("Too many cuts")
        aspect = cfg.get("aspect_ratio", "original")
        if aspect not in ("original", "9:16", "16:9", "1:1"):
            raise ValueError("Invalid render aspect ratio")
        output = workdir / "final.mp4"
        chunks = []
        with tempfile.TemporaryDirectory(prefix="cliptora_segments_", dir=str(workdir)) as directory:
            for index, part in enumerate(cuts):
                segment = Path(directory) / f"part_{index:03}.mp4"
                args = ["ffmpeg", "-nostdin", "-v", "error", "-y", "-ss", str(part["source_start"]), "-t", str(part["duration"]), "-i", str(source)]
                if aspect != "original":
                    width, height = {"9:16": (720, 1280), "16:9": (1280, 720), "1:1": (720, 720)}[aspect]
                    args.extend(["-vf", f"scale={width}:{height}:force_original_aspect_ratio=increase,crop={width}:{height},setsar=1"])
                args.extend(["-c:v", "libx264", "-preset", "veryfast", "-crf", "25", "-pix_fmt", "yuv420p", "-c:a", "aac", "-ar", "44100", "-movflags", "+faststart", str(segment)])
                tool(*args, timeout=3600)
                chunks.append(segment)
            concat = Path(directory) / "list.txt"
            concat.write_text("".join(f"file '{chunk.as_posix()}'\n" for chunk in chunks), encoding="utf-8")
            tool("ffmpeg", "-nostdin", "-v", "error", "-y", "-f", "concat", "-safe", "0", "-i", str(concat), "-c", "copy", str(output), timeout=3600)
        return {"render": {"state": "completed", "filename": "final.mp4", "bytes": output.stat().st_size}}
    raise ValueError(f"Unknown node {kind}")


def run_graph(nodes: list[dict], source: Path | None, workspace: Path, update: Callable[[int, str, dict], None], cancelled: Callable[[], bool] = lambda: False) -> dict:
    ordered = validate_workflow(nodes)
    workspace.mkdir(parents=True, exist_ok=True)
    outputs: dict[str, dict] = {}
    summary = {}
    for index, node in enumerate(ordered):
        if cancelled():
            return {"status": "cancelled", "nodes": summary}
        deps = {key: outputs[key] for key in node["depends_on"] if key in outputs}
        has_video = source is not None
        condition = node.get("when", "always")
        branch_condition = get_input(deps, "condition")
        switch_route = get_input(deps, "route")
        satisfied = condition == "always" or (condition == "has_video" and has_video) or (condition == "has_transcript" and get_input(deps, "words") is not None) or (condition == "ai_enabled" and bool(os.environ.get("OPENAI_API_KEY"))) or (condition == "condition_true" and branch_condition is True) or (condition == "condition_false" and branch_condition is False) or (condition.startswith("route_") and condition != "route_fallback" and switch_route == int(condition.removeprefix("route_"))) or (condition == "route_fallback" and switch_route is None)
        if not satisfied or len(deps) != len(node["depends_on"]):
            summary[node["id"]] = {"state": "skipped", "type": node["type"]}
            update(int(100 * (index + 1) / len(ordered)), node["id"], summary)
            continue
        artifact = workspace / f"{node['id']}.json"
        checkpoint = workspace / f".{node['id']}.sha256"
        source_fingerprint = None if source is None else {"path": str(source), "size": source.stat().st_size, "mtime": source.stat().st_mtime_ns}
        fingerprint = hashlib.sha256(json.dumps({"node": node, "deps": deps, "source": source_fingerprint}, sort_keys=True, ensure_ascii=False).encode()).hexdigest()
        result = None
        cached = False
        if node.get("cache", True) and artifact.is_file() and checkpoint.is_file() and checkpoint.read_text(encoding="ascii") == fingerprint:
            try:
                result = json.loads(artifact.read_text(encoding="utf-8"))
                cached = True
            except (OSError, ValueError):
                result = None
        attempts = 0
        last_error: Exception | None = None
        while result is None and attempts <= node.get("retry_limit", 1):
            attempts += 1
            try:
                result = call_node(node, deps, source, workspace)
            except Exception as exc:
                last_error = exc
        if result is None:
            raise RuntimeError(f"Node {node['id']} failed after {attempts} attempt(s): {last_error}") from last_error
        target = workspace / f".{node['id']}.tmp"
        if not cached:
            target.write_text(json.dumps(result, ensure_ascii=False, allow_nan=False), encoding="utf-8")
            target.replace(artifact)
            checkpoint.write_text(fingerprint, encoding="ascii")
        outputs[node["id"]] = result
        public = {"state": "completed", "type": node["type"], "artifact": True, "cached": cached, "attempts": attempts}
        for key in ("output_duration", "target_duration", "language", "method"):
            if key in result:
                public[key] = result[key]
        for key in ("words", "segments", "highlights", "cut_plan", "captions", "scenes", "keyframes"):
            if isinstance(result.get(key), list):
                public[f"{key}_count"] = len(result[key])
        if "render" in result:
            public["render"] = result["render"]
        summary[node["id"]] = public
        update(int(100 * (index + 1) / len(ordered)), node["id"], summary)
    return {"status": "completed", "nodes": summary}
