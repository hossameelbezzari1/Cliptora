
"""CLIPTORA - Centralized Nodes Catalog.

Logo inheritance:
    Sub-node logo -> Parent logo -> Family logo

This file owns node names, types, categories, icons,
credentials, default settings, and sub-node definitions.
"""

from __future__ import annotations

from copy import deepcopy
from typing import Any


FAMILIES: dict[str, dict[str, str]] = {
    "animation": {
        "category": "Animation",
        "logo": "lucide:wand-sparkles",
    },
    "audio": {
        "category": "Audio",
        "logo": "lucide:audio-lines",
    },
    "data": {
        "category": "Data / Integrations",
        "logo": "lucide:database",
    },
    "gemini": {
        "category": "AI",
        "logo": "brand:gemini",
    },
    "logic": {
        "category": "Logic",
        "logo": "lucide:git-branch",
    },
    "media": {
        "category": "Media",
        "logo": "lucide:clapperboard",
    },
    "ollama": {
        "category": "AI",
        "logo": "brand:ollama",
    },
    "openai": {
        "category": "AI",
        "logo": "brand:openai",
    },
    "output": {
        "category": "Output",
        "logo": "lucide:film",
    },
    "timeline": {
        "category": "Timeline / AI Editing",
        "logo": "lucide:scissors",
    },
    "transcription": {
        "category": "Audio",
        "logo": "lucide:captions",
    },
    "triggers": {
        "category": "Triggers",
        "logo": "lucide:zap",
    },
}


LIST_NODES: list[dict[str, Any]] = [
    {
        "family": "animation",
        "id": "animation.storyboard",
        "name": "Storyboard",
        "logo": "lucide:book-open",
        "settings": {
            "script": "",
            "scene_seconds": 4,
        },
    },
    {
        "family": "animation",
        "id": "animation.keyframes",
        "name": "Keyframes",
        "settings": {
            "preset": "fade-pop",
        },
    },
    {
        "family": "audio",
        "id": "audio.extract",
        "name": "Extract Audio",
        "settings": {
            "audio_track": "0",
            "output_format": "wav",
            "sample_rate": 16000,
            "channels": "mono",
            "trim_enabled": False,
        },
    },
    {
        "family": "data",
        "id": "data.json_extract",
        "name": "JSON Extract",
        "logo": "lucide:braces",
        "settings": {
            "path": "",
        },
    },
    {
        "family": "data",
        "id": "integration.http_request",
        "name": "HTTP Request",
        "logo": "lucide:globe",
        "settings": {
            "method": "GET",
            "url": "",
            "response_format": "auto",
        },
    },
    {
        "family": "gemini",
        "id": "ai.gemini",
        "name": "Google Gemini",
        "settings": {
            "action": "message_model",
            "credential_id": None,
            "model": "gemini-2.5-flash",
            "prompt": "",
        },
        "credentials": ["gemini"],
        "sub_nodes": [
            {
                "id": "message_model",
                "name": "Message a Model",
                "logo": "lucide:message-square-text",
            },
            {
                "id": "analyze_audio",
                "name": "Analyze Audio",
                "logo": "lucide:audio-lines",
            },
            {
                "id": "transcribe_recording",
                "name": "Transcribe Recording",
                "logo": "lucide:mic",
            },
            {
                "id": "analyze_video",
                "name": "Analyze Video",
                "logo": "lucide:video",
            },
            {
                "id": "analyze_image",
                "name": "Analyze Image",
                "logo": "lucide:image",
            },
            {
                "id": "analyze_document",
                "name": "Analyze Document",
                "logo": "lucide:file-text",
            },
            {
                "id": "upload_media_file",
                "name": "Upload Media",
                "logo": "lucide:file-up",
            },
            {
                "id": "generate_image",
                "name": "Generate Image",
                "logo": "lucide:image-plus",
            },
            {
                "id": "edit_image",
                "name": "Edit Image",
                "logo": "lucide:images",
            },
            {
                "id": "generate_video",
                "name": "Generate Video",
                "logo": "lucide:clapperboard",
            },
            {
                "id": "download_video",
                "name": "Download Video",
                "logo": "lucide:download",
            },
            {
                "id": "create_file_search_store",
                "name": "Create File Search Store",
                "logo": "lucide:folder-plus",
            },
            {
                "id": "list_file_search_stores",
                "name": "List File Search Stores",
                "logo": "lucide:folder-search",
            },
            {
                "id": "upload_file_to_search_store",
                "name": "Upload File to Search Store",
                "logo": "lucide:file-up",
            },
            {
                "id": "delete_file_search_store",
                "name": "Delete File Search Store",
                "logo": "lucide:folder-x",
            },
        ],
    },
    {
        "family": "logic",
        "id": "flow.if",
        "name": "IF",
        "settings": {
            "path": "",
            "operator": "truthy",
            "value": "",
        },
    },
    {
        "family": "logic",
        "id": "flow.merge",
        "name": "Merge",
        "logo": "lucide:git-merge",
        "settings": {
            "mode": "append",
        },
    },
    {
        "family": "logic",
        "id": "flow.switch",
        "name": "Switch",
        "logo": "lucide:split",
        "settings": {
            "path": "",
            "cases": [],
            "fallback": True,
        },
    },
    {
        "family": "media",
        "id": "core.video_source",
        "name": "Video Source",
        "logo": "lucide:video",
        "settings": {
            "source_id": None,
        },
    },
    {
        "family": "media",
        "id": "media.probe",
        "name": "Inspect Video",
        "logo": "lucide:scan-search",
        "settings": {
            "mode": "standard",
            "sections": [
                "general",
                "video",
                "audio",
                "subtitles",
                "chapters",
            ],
            "include_tags": False,
            "include_raw": False,
        },
    },
    {
        "family": "ollama",
        "id": "ai.ollama",
        "name": "Ollama",
        "settings": {
            "action": "message_model",
            "model": "gemma3",
            "credential_id": None,
            "prompt": "",
        },
        "credentials": ["ollama"],
        "sub_nodes": [
            {
                "id": "message_model",
                "name": "Message Model",
                "logo": "lucide:message-square-text",
            },
            {
                "id": "analyze_image",
                "name": "Analyze Image",
                "logo": "lucide:image",
            },
        ],
    },
    {
        "family": "openai",
        "id": "ai.openai",
        "name": "OpenAI",
        "settings": {
            "action": "message_model",
            "credential_id": None,
            "model": "gpt-5.5",
            "prompt": "",
        },
        "credentials": ["openai"],
        "sub_nodes": [
            {
                "id": "message_model",
                "name": "Message Model",
                "logo": "lucide:message-square-text",
            },
            {
                "id": "classify_violations",
                "name": "Classify Violations",
                "logo": "lucide:shield-alert",
            },
            {
                "id": "analyze_image",
                "name": "Analyze Image",
                "logo": "lucide:image",
            },
            {
                "id": "generate_image",
                "name": "Generate Image",
                "logo": "lucide:image-plus",
            },
            {
                "id": "edit_image",
                "name": "Edit Image",
                "logo": "lucide:images",
            },
        ],
    },
    {
        "family": "openai",
        "id": "ai.chat_model",
        "name": "Chat Model",
        "logo": "lucide:brain-circuit",
        "settings": {
            "provider": "openai",
            "model": "gpt-5.5",
            "reasoning_effort": "medium",
            "credential_id": None,
        },
        "credentials": ["openai"],
    },
    {
        "family": "openai",
        "id": "ai.agent",
        "name": "AI Agent",
        "logo": "lucide:bot",
        "settings": {
            "prompt_source": "define_below",
            "prompt": "",
            "credential_id": None,
        },
        "credentials": ["openai"],
    },
    {
        "family": "output",
        "id": "caption.generate",
        "name": "Generate Captions",
        "logo": "lucide:captions",
        "settings": {
            "max_words": 6,
            "style": "karaoke",
        },
    },
    {
        "family": "output",
        "id": "video.render",
        "name": "Render Video",
        "settings": {
            "enabled": False,
            "aspect_ratio": "original",
        },
    },
    {
        "family": "timeline",
        "id": "ai.highlights",
        "name": "Select Highlights",
        "logo": "lucide:sparkles",
        "settings": {
            "mode": "offline",
            "target_duration": 120,
            "strategy": "story_recap",
            "highlights": [],
        },
    },
    {
        "family": "timeline",
        "id": "ai.summary",
        "name": "Recap Script",
        "logo": "lucide:file-text",
        "settings": {
            "mode": "offline",
            "language": "auto",
            "prompt": "",
        },
    },
    {
        "family": "timeline",
        "id": "timeline.cut_plan",
        "name": "Cut Plan",
        "settings": {
            "padding": 0.16,
        },
    },
    {
        "family": "transcription",
        "id": "audio.transcribe",
        "name": "Transcribe Every Word",
        "logo": "lucide:mic",
        "settings": {
            "model": "small",
            "language": None,
            "beam_size": 5,
            "device": "cpu",
            "compute_type": "int8",
            "vad_filter": True,
            "include_confidence": True,
        },
    },
    {
        "family": "triggers",
        "id": "core.manual_trigger",
        "name": "Manual Trigger",
        "logo": "lucide:play",
        "settings": {},
    },
    {
        "family": "triggers",
        "id": "core.schedule_trigger",
        "name": "Schedule Trigger",
        "logo": "lucide:calendar-clock",
        "settings": {
            "timezone": "UTC",
            "enabled": True,
        },
    },
]


def validate_list_nodes() -> None:
    """Validate IDs and metadata before catalog discovery."""
    for family, info in FAMILIES.items():
        if not family or not info.get("category"):
            raise ValueError(f"Invalid family category: {family}")
        if not info.get("logo"):
            raise ValueError(f"Missing family logo: {family}")

    node_ids: set[str] = set()

    for node in LIST_NODES:
        node_id = node.get("id")
        family = node.get("family")

        if family not in FAMILIES:
            raise ValueError(f"Unknown node family: {family}")

        if not isinstance(node_id, str) or not node_id:
            raise ValueError("Node ID is required")

        if node_id in node_ids:
            raise ValueError(f"Duplicate node: {node_id}")

        node_ids.add(node_id)

        if not isinstance(node.get("name"), str) or not node["name"]:
            raise ValueError(f"Node name is required: {node_id}")

        if not isinstance(node.get("settings", {}), dict):
            raise ValueError(f"Invalid settings: {node_id}")

        if "logo" in node and not node["logo"]:
            raise ValueError(f"Invalid logo: {node_id}")

        sub_nodes = node.get("sub_nodes", [])

        if not isinstance(sub_nodes, list):
            raise ValueError(f"Invalid sub_nodes: {node_id}")

        sub_ids: set[str] = set()

        for sub in sub_nodes:
            sub_id = sub.get("id")

            if not isinstance(sub_id, str) or not sub_id:
                raise ValueError(f"Invalid sub-node ID: {node_id}")

            if sub_id in sub_ids:
                raise ValueError(
                    f"Duplicate sub-node: {node_id}.{sub_id}"
                )

            sub_ids.add(sub_id)

            if not isinstance(sub.get("name"), str) or not sub["name"]:
                raise ValueError(
                    f"Invalid sub-node name: {node_id}.{sub_id}"
                )

            if "logo" in sub and not sub["logo"]:
                raise ValueError(
                    f"Invalid sub-node logo: {node_id}.{sub_id}"
                )


def family_group(family: str) -> str:
    return FAMILIES[family]["category"]


def family_logo(family: str) -> str:
    return FAMILIES[family]["logo"]


def operations_for(
    family: str,
) -> dict[str, dict[str, Any]]:
    """Return operation metadata compatible with Node.py."""
    validate_list_nodes()

    if family not in FAMILIES:
        raise ValueError(f"Unknown node family: {family}")

    result: dict[str, dict[str, Any]] = {}

    for node in LIST_NODES:
        if node["family"] != family:
            continue

        logo = node.get("logo") or family_logo(family)

        result[node["id"]] = {
            "label": node["name"],
            "icon": logo,
            "settings": deepcopy(node.get("settings", {})),
            "credentials": list(node.get("credentials", [])),
            "input_types": list(node.get("input_types", [])),
            "output_types": list(
                node.get("output_types", ["json"])
            ),
            "actions": [
                {
                    "id": sub["id"],
                    "label": sub["name"],
                    "icon": sub.get("logo") or logo,
                }
                for sub in node.get("sub_nodes", [])
            ],
        }

    return result


def get_nodes() -> list[dict[str, Any]]:
    """Return all nodes with resolved logos."""
    validate_list_nodes()

    result: list[dict[str, Any]] = []

    for node in LIST_NODES:
        family = node["family"]
        logo = node.get("logo") or family_logo(family)

        result.append({
            "id": node["id"],
            "type": node["id"],
            "name": node["name"],
            "family": family,
            "category": family_group(family),
            "logo": logo,
            "sub_nodes": [
                {
                    "id": sub["id"],
                    "name": sub["name"],
                    "logo": sub.get("logo") or logo,
                }
                for sub in node.get("sub_nodes", [])
            ],
            "credentials": list(
                node.get("credentials", [])
            ),
            "settings": deepcopy(
                node.get("settings", {})
            ),
        })

    return result


def get_node(node_id: str) -> dict[str, Any]:
    for node in get_nodes():
        if node["id"] == node_id:
            return node

    raise KeyError(f"Unknown node: {node_id}")


def get_families() -> list[dict[str, Any]]:
    nodes = get_nodes()

    return [
        {
            "family": family,
            "category": info["category"],
            "logo": info["logo"],
            "nodes": [
                node
                for node in nodes
                if node["family"] == family
            ],
        }
        for family, info in FAMILIES.items()
    ]
