"""CLIPTORA workflow node: ai.gemini.

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
        "label": "Google Gemini", "group": "AI", "description": "Use Google Gemini text, media understanding, File Search, image and video actions.",
        "actions": ["analyze_audio", "transcribe_recording", "analyze_document", "create_file_search_store", "delete_file_search_store", "list_file_search_stores", "upload_file_to_search_store", "analyze_image", "generate_image", "edit_image", "upload_media_file", "message_model", "analyze_video", "generate_video", "download_video"],
        "action_capabilities": {
            "analyze_audio": {"status": "unavailable", "group": "Audio actions", "label": "Analyze audio", "reason": "Gemini Files API binary uploads are not connected to workflow artifacts yet."},
            "transcribe_recording": {"status": "unavailable", "group": "Audio actions", "label": "Transcribe a recording", "reason": "Gemini Files API binary uploads are not connected to workflow artifacts yet."},
            "analyze_document": {"status": "unavailable", "group": "Document actions", "label": "Analyze document", "reason": "Document binary uploads are not connected to workflow artifacts yet."},
            "create_file_search_store": {"status": "implemented", "group": "File Search actions", "label": "Create a File Search store"},
            "delete_file_search_store": {"status": "implemented", "group": "File Search actions", "label": "Delete a File Search store"},
            "list_file_search_stores": {"status": "implemented", "group": "File Search actions", "label": "List all File Search stores"},
            "upload_file_to_search_store": {"status": "unavailable", "group": "File Search actions", "label": "Upload a file to a File Search store", "reason": "Binary document uploads and long-running import polling are not connected yet."},
            "analyze_image": {"status": "unavailable", "group": "Image actions", "label": "Analyze an image", "reason": "Gemini Files API binary uploads are not connected to workflow artifacts yet."},
            "generate_image": {"status": "implemented", "group": "Image actions", "label": "Generate an image"},
            "edit_image": {"status": "unavailable", "group": "Image actions", "label": "Edit an image", "reason": "Image binary inputs are not connected to workflow artifacts yet."},
            "upload_media_file": {"status": "unavailable", "group": "Media File actions", "label": "Upload a media file", "reason": "Binary media uploads are not connected to workflow artifacts yet."},
            "message_model": {"status": "implemented", "group": "Text actions", "label": "Message a model"},
            "analyze_video": {"status": "unavailable", "group": "Video actions", "label": "Analyze video", "reason": "Gemini Files API video uploads are not connected to workflow artifacts yet."},
            "generate_video": {"status": "unavailable", "group": "Video actions", "label": "Generate a video", "reason": "Gemini Omni video generation needs an asynchronous artifact pipeline that is not connected yet."},
            "download_video": {"status": "unavailable", "group": "Video actions", "label": "Download a video", "reason": "Generated video operations and file artifacts are not connected yet."},
        },
        "settings": {"action": "message_model", "model": "gemini-3.8-flash", "system_prompt": "You are a helpful assistant.", "prompt": "", "input_path": "", "max_output_tokens": 1000, "simplify_output": True, "display_name": "", "store_name": "", "image_aspect_ratio": "1:1"},
        "parameters_schema": {"type": "object", "properties": {
            "action": {"type": "string", "title": "Operation"},
            "model": {"type": "string", "title": "Model"},
            "system_prompt": {"type": "string", "title": "System instruction"},
            "prompt": {"type": "string", "title": "Text input"},
            "input_path": {"type": "string", "title": "Optional input path", "description": "Append JSON data from this upstream dot path to the prompt."},
            "max_output_tokens": {"type": "integer", "title": "Maximum output tokens", "minimum": 1, "maximum": 65536},
            "simplify_output": {"type": "boolean", "title": "Simplify Output", "default": True},
            "display_name": {"type": "string", "title": "Store display name"},
            "store_name": {"type": "string", "title": "File Search store name", "description": "Exact API resource name, for example fileSearchStores/my-store-id."},
            "image_aspect_ratio": {"type": "string", "title": "Aspect ratio", "enum": ["1:1", "3:2", "2:3", "4:3", "3:4", "16:9", "9:16"]},
        }},
        "credentials": ["GEMINI_API_KEY"],
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
    return gemini_action(cfg, outputs)

NODE = NodeDefinition(type='ai.gemini', metadata=metadata, execute=execute)
