"""Native workflow node: SelectBestMomentsNode."""

from __future__ import annotations

from pathlib import Path

from typing import Any

from app.workflows.base import BaseNode

class SelectBestMomentsNode(BaseNode):
    type = 'ai.highlights'

    @staticmethod
    def metadata() -> dict[str, Any]:
        return {"label": "Select Best Moments", "group": "AI", "settings": {"mode": "offline", "target_duration": 90, "strategy": "story_recap"}}

    @staticmethod
    def _limit_duration(moments: list[dict], words: list[dict], budget: float) -> list[dict]:
        """Keep ranked, non-overlapping whole-word excerpts within the duration budget."""
        ranked = sorted(moments, key=lambda item: (-item.get("score", 0), item["start"]))
        accepted: list[dict] = []
        used = 0.0
        for moment in ranked:
            available = budget - used
            if available <= 0.001:
                break
            item = dict(moment)
            length = item["end"] - item["start"]
            if length > available:
                # Shorten at a real word boundary, without inventing timestamps.
                candidates = [word for word in words if item["start_word_id"] <= word["id"] <= item["end_word_id"]
                              and word["end"] - item["start"] <= available + 1e-8]
                if not candidates:
                    continue
                final_word = max(candidates, key=lambda word: word["end"])
                item["end"] = final_word["end"]
                item["end_word_id"] = final_word["id"]
                length = item["end"] - item["start"]
            if length <= 0 or length > available + 1e-8:
                continue
            accepted.append(item)
            used += length
        return sorted(accepted, key=lambda item: item["start"])

    @staticmethod
    def execute(node: dict[str, Any], outputs: dict[str, Any], source: Path | None, workdir: Path) -> dict[str, Any]:
        from app.helpers.transcript import MAX_TARGET_SECONDS, HIGHLIGHTS_SCHEMA, get_input, group_words, normalize_highlights, offline_highlights
        from app.providers.ai.openai import openai_json
        cfg = node.get('settings', {})
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
            moments = normalize_highlights(proposals, words)
        elif mode == "manual":
            moments = normalize_highlights(cfg.get("highlights", []), words)
        elif mode == "offline":
            moments = offline_highlights(words, duration, str(cfg.get("strategy", "story_recap")))
        else:
            raise ValueError("mode must be offline, manual or openai")
        moments = SelectBestMomentsNode._limit_duration(moments, words, float(duration))
        return {"highlights": moments, "method": mode, "target_duration": duration}

# Compatibility exports for older callers and imported test utilities.
metadata = SelectBestMomentsNode.metadata
execute = SelectBestMomentsNode.execute
NODE = SelectBestMomentsNode.definition()
