"""CLIPTORA workflow node: ai.openai.

Executor logic and metadata were migrated from the existing workflow_core.py.
Shared pure helpers remain in workflow_core during compatibility refactor.
"""
from __future__ import annotations
import hashlib
import json
import math
import os
import re
import tempfile
from pathlib import Path
from typing import Any
from app.workflows.base import NodeDefinition

def metadata() -> dict[str, Any]:
    from app.workflows.model_constants import (
        OPENAI_TEXT_MODELS, OPENAI_IMAGE_MODELS, OPENAI_MODERATION_MODELS,
        OPENAI_REASONING_EFFORTS, GEMINI_TEXT_MODELS, GEMINI_IMAGE_MODELS,
    )
    return {
        "label": "OpenAI", "group": "AI", "description": "Use OpenAI text, vision, image, audio, file, conversation and video actions.",
        "actions": ["message_model", "classify_violations", "analyze_image", "generate_image", "edit_image", "generate_audio", "transcribe_recording", "translate_recording", "delete_file", "list_files", "upload_file", "create_conversation", "get_conversation", "remove_conversation", "update_conversation", "generate_video"],
        "action_capabilities": {
            "message_model": {"status": "implemented", "group": "Text actions", "label": "Message a model"},
            "classify_violations": {"status": "implemented", "group": "Text actions", "label": "Classify text for violations"},
            "analyze_image": {"status": "implemented", "group": "Image actions", "label": "Analyze image"},
            "generate_image": {"status": "implemented", "group": "Image actions", "label": "Generate an image"},
            "edit_image": {"status": "implemented", "group": "Image actions", "label": "Edit image"},
            "generate_audio": {"status": "unavailable", "group": "Audio actions", "label": "Generate audio", "reason": "Binary audio artifacts are not connected yet."},
            "transcribe_recording": {"status": "unavailable", "group": "Audio actions", "label": "Transcribe a recording", "reason": "Binary audio inputs are not connected yet."},
            "translate_recording": {"status": "unavailable", "group": "Audio actions", "label": "Translate a recording", "reason": "Binary audio inputs are not connected yet."},
            "delete_file": {"status": "unavailable", "group": "File actions", "label": "Delete a file", "reason": "OpenAI file management is not enabled."},
            "list_files": {"status": "unavailable", "group": "File actions", "label": "List files", "reason": "OpenAI file management is not enabled."},
            "upload_file": {"status": "unavailable", "group": "File actions", "label": "Upload a file", "reason": "Binary file uploads are not connected yet."},
            "create_conversation": {"status": "unavailable", "group": "Conversation actions", "label": "Create a conversation", "reason": "OpenAI conversation persistence is not enabled yet."},
            "get_conversation": {"status": "unavailable", "group": "Conversation actions", "label": "Get a conversation", "reason": "OpenAI conversation persistence is not enabled yet."},
            "remove_conversation": {"status": "unavailable", "group": "Conversation actions", "label": "Remove a conversation", "reason": "OpenAI conversation persistence is not enabled yet."},
            "update_conversation": {"status": "unavailable", "group": "Conversation actions", "label": "Update a conversation", "reason": "OpenAI conversation persistence is not enabled yet."},
            "generate_video": {"status": "unavailable", "group": "Video actions", "label": "Generate a video", "reason": "Video generation artifacts are not connected yet."},
        },
        "settings": {"action": "message_model", "model": "gpt-6.1-sol", "system_prompt": "You are a helpful assistant.", "prompt": "", "image_urls": "", "mask_image_url": "", "input_path": "", "reasoning_effort": "none", "temperature": 0.2, "max_output_tokens": 1000, "simplify_output": True, "image_size": "1024x1024", "image_input_fidelity": "auto"},
        "parameters_schema": {"type": "object", "properties": {
            "action": {"type": "string", "title": "Operation"},
            "model": {"type": "string", "title": "Model"},
            "reasoning_effort": {"type": "string", "title": "Reasoning effort", "enum": list(OPENAI_REASONING_EFFORTS), "default": "none"},
            "system_prompt": {"type": "string", "title": "System prompt"},
            "prompt": {"type": "string", "title": "Text input"},
            "image_urls": {"type": "string", "title": "URL(s)", "description": "One HTTPS image URL per line."},
            "mask_image_url": {"type": "string", "title": "Optional mask URL", "description": "Public HTTPS URL of a PNG mask. Transparent areas are replaced."},
            "image_input_fidelity": {"type": "string", "title": "Input fidelity", "enum": ["auto", "low", "high"], "default": "auto"},
            "input_path": {"type": "string", "title": "Optional input path", "description": "Append JSON data from this upstream dot path to the prompt."},
            "temperature": {"type": "number", "title": "Temperature", "minimum": 0, "maximum": 2},
            "max_output_tokens": {"type": "integer", "title": "Maximum output tokens", "minimum": 1, "maximum": 16000},
            "simplify_output": {"type": "boolean", "title": "Simplify Output", "default": True},
            "image_size": {"type": "string", "title": "Image size", "enum": ["1024x1024", "1536x1024", "1024x1536", "auto"]},
        }},
        "credentials": ["OPENAI_API_KEY"],
    }

def execute(node: dict[str, Any], outputs: dict[str, Any], source: Path | None, workdir: Path) -> dict[str, Any]:
    from app.services.workflow_core import (
        MAX_CUTS, MAX_TARGET_SECONDS, OPENAI_REASONING_EFFORTS,
        HIGHLIGHTS_SCHEMA, SUMMARY_SCHEMA, get_input, input_path, compare_value,
        tool, probe, as_words, group_words, normalize_highlights,
        offline_highlights, openai_json, openai_action, gemini_action,
        ollama_action, execute_ai_agent, execute_http_request, value_path,
    )
    kind, cfg = node['type'], node.get('settings', {})
    return openai_action(cfg, outputs)

NODE = NodeDefinition(type='ai.openai', metadata=metadata, execute=execute)
