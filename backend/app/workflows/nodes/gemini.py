"""Native workflow node: GeminiNode."""

from __future__ import annotations

from pathlib import Path

from typing import Any

from app.workflows.base import BaseNode

class GeminiNode(BaseNode):
    type = 'ai.gemini'

    @staticmethod
    def metadata() -> dict[str, Any]:
        return {
            "label": "Google Gemini", "group": "AI", "description": "Use Google Gemini text, media understanding, File Search, image and video actions.",
            "actions": ["analyze_audio", "transcribe_recording", "analyze_document", "create_file_search_store", "delete_file_search_store", "list_file_search_stores", "upload_file_to_search_store", "analyze_image", "generate_image", "edit_image", "upload_media_file", "message_model", "analyze_video", "generate_video", "download_video"],
            "action_capabilities": {
                "analyze_audio": {"status": "implemented", "group": "Audio actions", "label": "Analyze audio"},
                "transcribe_recording": {"status": "implemented", "group": "Audio actions", "label": "Transcribe a recording"},
                "analyze_document": {"status": "implemented", "group": "Document actions", "label": "Analyze document"},
                "create_file_search_store": {"status": "implemented", "group": "File Search actions", "label": "Create a File Search store"},
                "delete_file_search_store": {"status": "implemented", "group": "File Search actions", "label": "Delete a File Search store"},
                "list_file_search_stores": {"status": "implemented", "group": "File Search actions", "label": "List all File Search stores"},
                "upload_file_to_search_store": {"status": "implemented", "group": "File Search actions", "label": "Upload a file to a File Search store"},
                "analyze_image": {"status": "implemented", "group": "Image actions", "label": "Analyze an image"},
                "generate_image": {"status": "implemented", "group": "Image actions", "label": "Generate an image"},
                "edit_image": {"status": "implemented", "group": "Image actions", "label": "Edit an image"},
                "upload_media_file": {"status": "implemented", "group": "Media File actions", "label": "Upload a media file"},
                "message_model": {"status": "implemented", "group": "Text actions", "label": "Message a model"},
                "analyze_video": {"status": "implemented", "group": "Video actions", "label": "Analyze video"},
                "generate_video": {"status": "implemented", "group": "Video actions", "label": "Generate a video"},
                "download_video": {"status": "implemented", "group": "Video actions", "label": "Download a video"},
            },
            "settings": {"action": "message_model", "resource": "Text", "model": "gemini-2.5-flash", "model_by_id": "", "system_prompt": "You are a helpful assistant.", "prompt": "", "messages": [], "input_path": "", "output_mode": "text", "output_content_as_json": False, "temperature": 0.2, "max_output_tokens": 2048, "timeout_seconds": 120, "target_duration": 120, "max_highlights": 12, "chunk_chars": 14000, "min_clip_seconds": 3, "max_clip_seconds": 35, "simplify_output": True, "display_name": "", "store_name": "", "image_aspect_ratio": "1:1", "image_model": "gemini-3.1-flash-image-preview", "video_model": "gemini-omni-1.1-flash", "video_aspect_ratio": "16:9", "media_input_path": "", "file_path": "", "file_uri": "", "mime_type": "", "file_display_name": "", "interaction_id": "", "generated_video_uri": "", "poll_seconds": 180, "allow_paid_action": False},
            "parameters_schema": {"type": "object", "properties": {
                "action": {"type": "string", "title": "Operation", "enum": ["message_model", "analyze_audio", "transcribe_recording", "analyze_document", "create_file_search_store", "delete_file_search_store", "list_file_search_stores", "upload_file_to_search_store", "analyze_image", "generate_image", "edit_image", "upload_media_file", "analyze_video", "generate_video", "download_video"]},
                "resource": {"type": "string", "title": "Resource", "enum": ["Text", "Audio", "Document", "File Search", "Image", "Media File", "Video"]},
                "model": {"type": "string", "title": "Model", "enum": ["gemini-2.5-flash", "gemini-2.5-flash-lite", "gemini-3.5-flash-lite"], "description": "Models with a documented free tier. Actual free access depends on your API project."},
                "model_by_id": {"type": "string", "title": "Model by ID (optional)", "description": "Exact model ID; overrides Model when set. Free-model restrictions remain enforced."},
                "system_prompt": {"type": "string", "title": "System instruction"},
                "prompt": {"type": "string", "title": "Text input"},
                "messages": {"type": "array", "title": "Messages (optional)", "description": "Optional multi-turn messages: [{role: user|model|system, text: ...}]. Leave empty when using Text input.", "items": {"type": "object", "properties": {"role": {"type": "string", "enum": ["user", "model", "system"]}, "text": {"type": "string"}}}},
                "input_path": {"type": "string", "title": "Optional input path", "description": "Reference upstream node output, e.g. words.text or words.words. Highlights mode reads a connected words array automatically."},
                "output_mode": {"type": "string", "title": "Output mode", "enum": ["text", "json", "highlights"], "description": "Highlights produces validated word-timed segments for the next Cut Plan node."},
                "output_content_as_json": {"type": "boolean", "title": "Output content as JSON", "default": False},
                "temperature": {"type": "number", "title": "Temperature", "minimum": 0, "maximum": 2},
                "timeout_seconds": {"type": "integer", "title": "Request timeout (seconds)", "minimum": 15, "maximum": 300},
                "target_duration": {"type": "integer", "title": "Highlights target duration (seconds)", "minimum": 10, "maximum": 7200},
                "max_highlights": {"type": "integer", "title": "Maximum highlights", "minimum": 1, "maximum": 100},
                "chunk_chars": {"type": "integer", "title": "Transcript chunk size (characters)", "minimum": 2000, "maximum": 50000},
                "min_clip_seconds": {"type": "number", "title": "Minimum clip length (seconds)", "minimum": 0.1, "maximum": 300},
                "max_clip_seconds": {"type": "number", "title": "Maximum clip length (seconds)", "minimum": 1, "maximum": 900},
                "max_output_tokens": {"type": "integer", "title": "Maximum output tokens", "minimum": 1, "maximum": 65536},
                "simplify_output": {"type": "boolean", "title": "Simplify Output", "default": True},
                "display_name": {"type": "string", "title": "Store display name"},
                "store_name": {"type": "string", "title": "File Search store name", "description": "Exact API resource name, for example fileSearchStores/my-store-id."},
                "image_aspect_ratio": {"type": "string", "title": "Aspect ratio", "enum": ["1:1", "3:2", "2:3", "4:3", "3:4", "16:9", "9:16"]},
                "media_input_path": {"type": "string", "title": "Upstream file path", "description": "E.g. previousNode.audio or previousNode.file_path"},
                "file_path": {"type": "string", "title": "Local media file path in CLIPTORA storage"},
                "file_uri": {"type": "string", "title": "Existing Gemini Files URI"},
                "mime_type": {"type": "string", "title": "MIME type (when reusing Gemini Files URI)"},
                "file_display_name": {"type": "string", "title": "Uploaded file display name"},
                "poll_seconds": {"type": "integer", "title": "Processing wait (seconds)", "minimum": 30, "maximum": 900},
                "image_model": {"type": "string", "title": "Gemini image edit model"},
                "video_model": {"type": "string", "title": "Gemini Omni video model"},
                "video_aspect_ratio": {"type": "string", "enum": ["16:9", "9:16"]},
                "interaction_id": {"type": "string", "title": "Gemini interaction ID"},
                "generated_video_uri": {"type": "string", "title": "Gemini generated video URI"},
                "allow_paid_action": {"type": "boolean", "title": "I understand Google may charge for this operation", "default": False},
            }},
            "credentials": ["GEMINI_API_KEY"],
        }

    @staticmethod
    def execute(node: dict[str, Any], outputs: dict[str, Any], source: Path | None, workdir: Path) -> dict[str, Any]:
        cfg = node.get('settings', {})
        if cfg.get('action', 'message_model') == 'message_model':
            from app.providers.ai.gemini_message import message_model
            return message_model(node, outputs)
        if cfg.get('action') in {'create_file_search_store', 'delete_file_search_store', 'list_file_search_stores', 'generate_image'}:
            from app.providers.ai.gemini import gemini_action
            return gemini_action(cfg, outputs)
        from app.providers.ai.gemini_actions import run_action
        return run_action(node, outputs, source, workdir)

# Compatibility exports for older callers and imported test utilities.
metadata = GeminiNode.metadata
execute = GeminiNode.execute
NODE = GeminiNode.definition()
