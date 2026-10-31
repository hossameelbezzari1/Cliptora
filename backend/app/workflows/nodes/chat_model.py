"""Native workflow node: ChatModelNode."""

from __future__ import annotations

import math

import re

from pathlib import Path

from typing import Any

from app.workflows.base import BaseNode

class ChatModelNode(BaseNode):
    type = 'ai.chat_model'

    @staticmethod
    def metadata() -> dict[str, Any]:
        from app.workflows.model_constants import OPENAI_TEXT_MODELS, OPENAI_REASONING_EFFORTS
        return {
            "label": "OpenAI Chat Model", "group": "AI", "description": "Model configuration for AI Agent nodes.",
            "settings": {"model": "gpt-6.1-sol", "reasoning_effort": "medium", "temperature": 0.2, "max_output_tokens": 1000},
            "parameters_schema": {"type": "object", "properties": {
                "model": {"type": "string", "title": "Model", "enum": list(OPENAI_TEXT_MODELS)},
                "reasoning_effort": {"type": "string", "title": "Reasoning effort", "enum": list(OPENAI_REASONING_EFFORTS), "default": "medium"},
                "temperature": {"type": "number", "title": "Temperature", "minimum": 0, "maximum": 2},
                "max_output_tokens": {"type": "integer", "title": "Maximum output tokens", "minimum": 1, "maximum": 16000},
            }},
            "credentials": ["OPENAI_API_KEY"],
        }

    @staticmethod
    def execute(node: dict[str, Any], outputs: dict[str, Any], source: Path | None, workdir: Path) -> dict[str, Any]:
        from app.workflows.model_constants import OPENAI_REASONING_EFFORTS
        cfg = node.get('settings', {})
        model = str(cfg.get("model") or "gpt-6.1-sol").strip()
        temperature = float(cfg.get("temperature", 0.2))
        max_tokens = int(cfg.get("max_output_tokens", 1000))
        if not re.fullmatch(r"[A-Za-z0-9._:-]{1,100}", model):
            raise ValueError("OpenAI model name is invalid")
        if not math.isfinite(temperature) or not 0 <= temperature <= 2:
            raise ValueError("OpenAI temperature must be between 0 and 2")
        if not 1 <= max_tokens <= 16_000:
            raise ValueError("OpenAI maximum output tokens must be between 1 and 16,000")
        effort = str(cfg.get("reasoning_effort", "medium"))
        # Existing saved workflows defaulted to an unsupported 'none' for Sol/Astra.
        if effort == "none" and model in {"gpt-6.1-sol", "gpt-6-astra"}:
            effort = "medium"
        if effort not in OPENAI_REASONING_EFFORTS:
            raise ValueError("OpenAI reasoning effort is invalid")
        return {"chat_model": {"model": model, "reasoning_effort": effort, "temperature": temperature, "max_output_tokens": max_tokens}}

# Compatibility exports for older callers and imported test utilities.
metadata = ChatModelNode.metadata
execute = ChatModelNode.execute
NODE = ChatModelNode.definition()
