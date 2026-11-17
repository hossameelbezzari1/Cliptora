
"""Project Timeline and Telegram entry points for CLIPTORA.

Both are regular Node subclasses; Registry.py discovers them automatically.
The trusted dispatcher injects __cliptora_trigger_event into a RUN snapshot,
never into the saved workflow definition. A trigger does not itself poll APIs.
"""
from __future__ import annotations

import re
from pathlib import Path
from typing import Any

from app.workflows.Node import Node


def _event(node: dict[str, Any], origin: str) -> dict[str, Any]:
    settings = node.get("settings") or {}
    payload = settings.get("__cliptora_trigger_event")
    if not isinstance(payload, dict) or payload.get("origin") != origin:
        raise ValueError(
            f"{origin} trigger requires a real event from the CLIPTORA dispatcher; "
            "running the node manually does not manufacture an event"
        )
    return payload


class TimelineTriggerNode(Node):
    family = "timeline_trigger"
    group = "Triggers"
    icon = "lucide:film"
    operations = {
        "core.timeline_trigger": {
            "label": "Timeline Video Trigger",
            "icon": "lucide:film",
            "settings": {"enabled": True},
            "input_types": [],
            "output_types": ["json", "media"],
        }
    }
    parameter_fields = {
        "core.timeline_trigger": {
            "enabled": {"type": "boolean", "title": "Enabled", "default": True},
        }
    }

    def execute_operation(self, operation, node, outputs, source, workdir):
        payload = _event(node, "timeline")
        if (node.get("settings") or {}).get("enabled") is not True:
            raise ValueError("Timeline trigger is disabled")
        if not isinstance(source, Path) or not source.is_file():
            raise ValueError("Timeline trigger needs a project-owned video media asset")
        media_id = payload.get("media_id")
        if type(media_id) is not int or media_id < 1:
            raise ValueError("Timeline trigger event is missing media_id")
        return {
            "trigger": {"type": "timeline", "status": "received"},
            "media_id": media_id,
            "source_id": payload.get("source_id"),
            "target_clip_client_id": payload.get("target_clip_client_id"),
            "video": str(source),
            "source_path": str(source),
            "filename": source.name,
        }


class TelegramTriggerNode(Node):
    family = "telegram_trigger"
    group = "Triggers"
    icon = "lucide:send"
    operations = {
        "core.telegram_trigger": {
            "label": "Telegram Message Trigger",
            "icon": "lucide:send",
            "settings": {
                "enabled": False,
                "allowed_chat_ids": [],
                "command": "/recap",
            },
            "input_types": [],
            "output_types": ["json", "text"],
        }
    }
    parameter_fields = {
        "core.telegram_trigger": {
            "enabled": {"type": "boolean", "title": "Enabled", "default": False},
            "allowed_chat_ids": {
                "type": "array", "title": "Allowed Telegram Chat IDs",
                "items": {"type": "integer"},
                "description": "Only messages from these chat IDs start this workflow.",
            },
            "command": {
                "type": "string", "title": "Command", "default": "/recap",
                "description": "Example: /recap Film Title",
            },
        }
    }

    def execute_operation(self, operation, node, outputs, source, workdir):
        settings = node.get("settings") or {}
        payload = _event(node, "telegram")
        if settings.get("enabled") is not True:
            raise ValueError("Telegram trigger is disabled")
        allowed = settings.get("allowed_chat_ids")
        if not isinstance(allowed, list) or not allowed or any(type(x) is not int for x in allowed):
            raise ValueError("Telegram trigger needs an explicit chat ID allowlist")
        chat_id = payload.get("chat_id")
        if type(chat_id) is not int or chat_id not in allowed:
            raise ValueError("Telegram chat is not allowed")
        command = str(settings.get("command") or "/recap").strip()
        if not re.fullmatch(r"/[A-Za-z][A-Za-z0-9_]{0,31}", command):
            raise ValueError("Telegram command must look like /recap")
        text = str(payload.get("text") or "").strip()
        match = re.fullmatch(rf"{re.escape(command)}(?:@[A-Za-z0-9_]+)?\s+(.+)", text, flags=re.IGNORECASE | re.DOTALL)
        if not match:
            raise ValueError(f"Send {command} followed by a film title")
        film_name = match.group(1).strip()
        if not film_name or len(film_name) > 250:
            raise ValueError("Film title must contain 1 to 250 characters")
        return {
            "trigger": {"type": "telegram", "status": "received"},
            "chat_id": chat_id,
            "message_id": payload.get("message_id"),
            "update_id": payload.get("update_id"),
            "film_name": film_name,
            "text": film_name,
            "original_message": text,
        }
