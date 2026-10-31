"""Native workflow node: AiAgentNode."""

from __future__ import annotations

from pathlib import Path

from typing import Any

from app.workflows.base import BaseNode

class AIAgentNode(BaseNode):
    type = 'ai.agent'

    @staticmethod
    def metadata() -> dict[str, Any]:
        return {
            "label": "AI Agent", "group": "AI", "description": "Use a connected chat model with optional memory and tool inputs.",
            "settings": {
                "prompt_source": "connected_chat_trigger", "prompt": "{{ $json.chatInput }}",
                "require_specific_output": False, "enable_fallback_model": False,
                "fallback_model": "", "system_message": "You are a helpful AI agent.",
                "__cliptora_ui_target_handles": {},
            },
            "parameters_schema": {"type": "object", "properties": {
                "prompt_source": {"type": "string", "title": "Source for Prompt (User Message)", "enum": ["connected_chat_trigger", "define_below"]},
                "prompt": {"type": "string", "title": "Prompt (User Message)"},
                "require_specific_output": {"type": "boolean", "title": "Require Specific Output Format"},
                "enable_fallback_model": {"type": "boolean", "title": "Enable Fallback Model"},
                "fallback_model": {"type": "string", "title": "Fallback model"},
                "system_message": {"type": "string", "title": "System message"},
            }},
            "credentials": ["OPENAI_API_KEY"],
        }

    @staticmethod
    def execute(node: dict[str, Any], outputs: dict[str, Any], source: Path | None, workdir: Path) -> dict[str, Any]:
        from app.providers.ai.openai import execute_ai_agent
        cfg = node.get('settings', {})
        return execute_ai_agent(cfg, outputs)

# Compatibility exports for older callers and imported test utilities.
metadata = AIAgentNode.metadata
execute = AIAgentNode.execute
NODE = AIAgentNode.definition()

AiAgentNode = AIAgentNode  # Legacy Python import compatibility
