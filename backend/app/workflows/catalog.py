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

from app.workflows.registry import node_metadata
from app.workflows.schemas import node_catalog_entry
NODE_TYPES: dict[str, dict[str, Any]] = node_metadata()


def _n(id: str, kind: str, depends: list[str] | None = None, settings: dict | None = None) -> dict:
    return {"id": id, "type": kind, "depends_on": depends or [], "when": "always", "retry_limit": 1,
            "cache": True, "settings": settings if settings is not None else dict(NODE_TYPES[kind]["settings"])}


def tool_catalog() -> list[dict[str, Any]]:
    """Only executable, registered nodes; no incomplete inventory."""
    from app.workflows.schemas import node_catalog_entry
    return [node_catalog_entry(key, value) for key, value in NODE_TYPES.items()]


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


class WorkflowTemplates:
    def all(self):
        return preset_templates()

class WorkflowCatalog:
    def list(self):
        return tool_catalog()
