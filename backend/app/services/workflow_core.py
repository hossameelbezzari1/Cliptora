"""CLIPTORA composable video workflows. No arbitrary Python/shell execution nodes.

Node outputs are JSON artifacts in a project/run-scoped folder. The engine never
accepts filesystem paths or commands from the browser; source paths are resolved
and checked by the API. FFmpeg and faster-whisper are optional system dependencies.
"""
from __future__ import annotations

import hashlib
import json
import math
import os
import re
import subprocess
import tempfile
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any, Callable

MAX_NODES = 28
MAX_CUTS = 36
MAX_TARGET_SECONDS = 1800
NODE_TYPES: dict[str, dict[str, Any]] = {
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


def _n(id: str, kind: str, depends: list[str] | None = None, settings: dict | None = None) -> dict:
    return {"id": id, "type": kind, "depends_on": depends or [], "when": "always", "settings": settings if settings is not None else dict(NODE_TYPES[kind]["settings"])}


def preset_templates() -> list[dict]:
    return [
        {"key": "movie-recap", "name": "Movie Recap", "description": "Full dialogue → highlights → recap script → editable cut plan and captions", "nodes": [
            _n("probe", "media.probe"), _n("audio", "audio.extract", ["probe"]),
            _n("words", "audio.transcribe", ["audio"], {"model": "small", "language": None}),
            _n("moments", "ai.highlights", ["words"], {"mode": "offline", "target_duration": 600, "strategy": "story_recap"}),
            _n("cuts", "timeline.cut_plan", ["moments"], {"padding": 0.16}),
            _n("script", "ai.summary", ["moments", "words"], {"mode": "offline", "language": "auto"}),
            _n("captions", "caption.generate", ["words", "moments"], {"max_words": 6, "style": "karaoke"}),
            _n("render", "video.render", ["cuts", "probe"], {"enabled": False, "aspect_ratio": "original"}),
        ]},
        {"key": "shorts", "name": "Shorts / Reels", "description": "Find a strong hook → 9:16 crop → captions → short video", "nodes": [
            _n("probe", "media.probe"), _n("audio", "audio.extract", ["probe"]),
            _n("words", "audio.transcribe", ["audio"], {"model": "small", "language": None}),
            _n("moments", "ai.highlights", ["words"], {"mode": "offline", "target_duration": 45, "strategy": "shorts_hook"}),
            _n("cuts", "timeline.cut_plan", ["moments"], {"padding": 0.12}),
            _n("captions", "caption.generate", ["words", "moments"], {"max_words": 3, "style": "word-pop"}),
            _n("render", "video.render", ["cuts", "probe"], {"enabled": False, "aspect_ratio": "9:16"}),
        ]},
        {"key": "mini-animation", "name": "Mini Animation", "description": "Script → editable scenes → animation keyframes; use the editor for final rendering", "nodes": [
            _n("storyboard", "animation.storyboard", [], {"script": "Your first scene.\nYour second scene.", "scene_seconds": 4}),
            _n("keyframes", "animation.keyframes", ["storyboard"], {"preset": "fade-pop"}),
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
        if node.get("when", "always") not in ("always", "has_video", "has_transcript", "ai_enabled"):
            raise ValueError(f"Invalid condition for {ident}")
        settings = node.get("settings", {})
        if not isinstance(settings, dict) or len(json.dumps(settings, ensure_ascii=False)) > 200_000:
            raise ValueError(f"Settings too large for {ident}")
        by_id[ident] = {"id": ident, "type": kind, "depends_on": deps, "settings": settings, "when": node.get("when", "always")}
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


HIGHLIGHTS_SCHEMA = {"type": "object", "properties": {"highlights": {"type": "array", "items": {"type": "object", "properties": {"start_word_id": {"type": "integer"}, "end_word_id": {"type": "integer"}, "score": {"type": "integer"}, "reason": {"type": "string"}}, "required": ["start_word_id", "end_word_id", "score", "reason"], "additionalProperties": False}}}, "required": ["highlights"], "additionalProperties": False}
SUMMARY_SCHEMA = {"type": "object", "properties": {"summary": {"type": "string"}}, "required": ["summary"], "additionalProperties": False}


def call_node(node: dict, outputs: dict[str, Any], source: Path | None, workdir: Path) -> dict:
    kind, cfg = node["type"], node.get("settings", {})
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
        satisfied = condition == "always" or (condition == "has_video" and has_video) or (condition == "has_transcript" and get_input(deps, "words") is not None) or (condition == "ai_enabled" and bool(os.environ.get("OPENAI_API_KEY")))
        if not satisfied or len(deps) != len(node["depends_on"]):
            summary[node["id"]] = {"state": "skipped", "type": node["type"]}
            update(int(100 * (index + 1) / len(ordered)), node["id"], summary)
            continue
        result = call_node(node, deps, source, workspace)
        artifact = workspace / f"{node['id']}.json"
        target = workspace / f".{node['id']}.tmp"
        target.write_text(json.dumps(result, ensure_ascii=False, allow_nan=False), encoding="utf-8")
        target.replace(artifact)
        outputs[node["id"]] = result
        public = {"state": "completed", "type": node["type"], "artifact": True}
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
