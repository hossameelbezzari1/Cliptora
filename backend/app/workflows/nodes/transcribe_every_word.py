"""Native workflow node: TranscribeEveryWordNode."""

from __future__ import annotations

import hashlib

import json

from pathlib import Path
from uuid import uuid4

from typing import Any

from app.workflows.base import BaseNode

class TranscribeEveryWordNode(BaseNode):
    type = 'audio.transcribe'

    @staticmethod
    def metadata() -> dict[str, Any]:
        return {"label": "Transcribe Every Word", "group": "Analysis", "settings": {"model": "small", "language": None}}

    @staticmethod
    def execute(node: dict[str, Any], outputs: dict[str, Any], source: Path | None, workdir: Path) -> dict[str, Any]:
        from app.helpers.transcript import get_input, as_words, group_words
        cfg = node.get('settings', {})
        wav = get_input(outputs, "audio")
        if not wav:
            raise ValueError("audio.transcribe requires audio.extract")
        if not isinstance(wav, str) or not Path(wav).is_file():
            raise ValueError("Extracted audio is missing from storage")
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
            try:
                cached = json.loads(cache_path.read_text(encoding="utf-8"))
                if isinstance(cached, dict) and isinstance(cached.get("words"), list) and isinstance(cached.get("segments"), list):
                    return cached
            except (OSError, ValueError, TypeError):
                pass  # Corrupt or interrupted cache: safely regenerate.
        model = WhisperModel(model_name, device="cpu", compute_type="int8")
        iterator, info = model.transcribe(wav, beam_size=5, word_timestamps=True, vad_filter=True, language=cfg.get("language") or None)
        words = []
        for segment in iterator:
            for word in (segment.words or []):
                if word.start is not None and word.end is not None:
                    words.append({"start": word.start, "end": word.end, "text": word.word.strip()})
        result = as_words(words)
        transcript = {"words": result, "language": info.language, "segments": group_words(result)}
        tmp_cache = cache_path.with_name(f"{cache_path.name}.{uuid4().hex}.tmp")
        try:
            tmp_cache.write_text(json.dumps(transcript, ensure_ascii=False, allow_nan=False), encoding="utf-8")
            tmp_cache.replace(cache_path)
        finally:
            tmp_cache.unlink(missing_ok=True)
        return transcript

# Compatibility exports for older callers and imported test utilities.
metadata = TranscribeEveryWordNode.metadata
execute = TranscribeEveryWordNode.execute
NODE = TranscribeEveryWordNode.definition()
