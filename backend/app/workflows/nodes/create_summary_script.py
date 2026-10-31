"""Native workflow node: CreateSummaryScriptNode."""

from __future__ import annotations

from pathlib import Path

from typing import Any

from app.workflows.base import BaseNode

class CreateSummaryScriptNode(BaseNode):
    type = 'ai.summary'

    @staticmethod
    def metadata() -> dict[str, Any]:
        return {"label": "Create Summary Script", "group": "AI", "settings": {"mode": "offline", "language": "auto"}}

    @staticmethod
    def execute(node: dict[str, Any], outputs: dict[str, Any], source: Path | None, workdir: Path) -> dict[str, Any]:
        from app.helpers.transcript import SUMMARY_SCHEMA, get_input, group_words
        from app.providers.ai.openai import openai_json
        cfg = node.get('settings', {})
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

# Compatibility exports for older callers and imported test utilities.
metadata = CreateSummaryScriptNode.metadata
execute = CreateSummaryScriptNode.execute
NODE = CreateSummaryScriptNode.definition()
