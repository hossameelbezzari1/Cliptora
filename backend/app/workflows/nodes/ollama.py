"""Native workflow node: OllamaNode."""

from __future__ import annotations

from pathlib import Path

from typing import Any

from app.workflows.base import BaseNode

class OllamaNode(BaseNode):
    type = 'ai.ollama'

    @staticmethod
    def metadata() -> dict[str, Any]:
        return {
            "label": "Ollama", "group": "AI", "description": "Run text and vision prompts through a local Ollama server.",
            "actions": ["analyze_image", "message_model"],
            "action_capabilities": {
                "analyze_image": {"status": "implemented", "group": "Image actions", "label": "Analyze image"},
                "message_model": {"status": "implemented", "group": "Text actions", "label": "Message a model"},
            },
            "settings": {"action": "message_model", "model": "gemma3", "system_prompt": "You are a helpful assistant.", "prompt": "", "image_urls": "", "input_path": "", "temperature": 0.2, "max_output_tokens": 1000, "simplify_output": True},
            "parameters_schema": {"type": "object", "properties": {
                "action": {"type": "string", "title": "Operation"},
                "model": {"type": "string", "title": "Ollama model", "description": "Exact installed model name returned by Ollama, for example gemma3."},
                "system_prompt": {"type": "string", "title": "System prompt"},
                "prompt": {"type": "string", "title": "Text input"},
                "image_urls": {"type": "string", "title": "Image URL(s)", "description": "One public HTTPS image URL per line; at most four images."},
                "input_path": {"type": "string", "title": "Optional input path", "description": "Append JSON data from this upstream dot path to the prompt."},
                "temperature": {"type": "number", "title": "Temperature", "minimum": 0, "maximum": 2},
                "max_output_tokens": {"type": "integer", "title": "Maximum output tokens", "minimum": 1, "maximum": 32768},
                "simplify_output": {"type": "boolean", "title": "Simplify Output", "default": True},
            }},
        }

    @staticmethod
    def execute(node: dict[str, Any], outputs: dict[str, Any], source: Path | None, workdir: Path) -> dict[str, Any]:
        from app.providers.ai.ollama import ollama_action
        cfg = node.get('settings', {})
        return ollama_action(cfg, outputs)

# Compatibility exports for older callers and imported test utilities.
metadata = OllamaNode.metadata
execute = OllamaNode.execute
NODE = OllamaNode.definition()
