"""Native workflow node: WordTimedCaptionsNode."""

from __future__ import annotations

from pathlib import Path

from typing import Any

from app.workflows.base import BaseNode

class WordTimedCaptionsNode(BaseNode):
    type = 'caption.generate'

    @staticmethod
    def metadata() -> dict[str, Any]:
        return {"label": "Word Timed Captions", "group": "Creative", "settings": {"max_words": 5, "style": "karaoke"}}

    @staticmethod
    def execute(node: dict[str, Any], outputs: dict[str, Any], source: Path | None, workdir: Path) -> dict[str, Any]:
        from app.helpers.transcript import get_input
        cfg = node.get('settings', {})
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

# Compatibility exports for older callers and imported test utilities.
metadata = WordTimedCaptionsNode.metadata
execute = WordTimedCaptionsNode.execute
NODE = WordTimedCaptionsNode.definition()
