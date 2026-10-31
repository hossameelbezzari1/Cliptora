"""Native workflow node: ImportTranscriptNode."""

from __future__ import annotations

from pathlib import Path

from typing import Any

from app.workflows.base import BaseNode

class ImportTranscriptNode(BaseNode):
    type = 'transcript.import'

    @staticmethod
    def metadata() -> dict[str, Any]:
        return {"label": "Import Transcript JSON", "group": "Analysis", "settings": {"words": []}}

    @staticmethod
    def execute(node: dict[str, Any], outputs: dict[str, Any], source: Path | None, workdir: Path) -> dict[str, Any]:
        from app.helpers.transcript import as_words, group_words
        cfg = node.get('settings', {})
        words = as_words(cfg.get("words", []))
        return {"words": words, "language": cfg.get("language", "unknown"), "segments": group_words(words)}

# Compatibility exports for older callers and imported test utilities.
metadata = ImportTranscriptNode.metadata
execute = ImportTranscriptNode.execute
NODE = ImportTranscriptNode.definition()
