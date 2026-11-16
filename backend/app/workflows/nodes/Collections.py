"""Data-only collection helpers for CLIPTORA workflow item execution.

Media splits create references and time ranges, not physical media files. Apply
an audio/video cutting node separately when actual files are needed.
"""
from __future__ import annotations

import math
import re
from copy import deepcopy
from pathlib import Path
from typing import Any

from app.workflows.InputResolver import resolve_input_path
from app.workflows.ItemExecution import ITEM_MARKER
from app.workflows.Node import Node


def _number(value: Any, name: str, minimum: float = 0, maximum: float = 86400) -> float:
    if isinstance(value, bool):
        raise ValueError(f"{name} must be numeric")
    try:
        parsed = float(value)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"{name} must be numeric") from exc
    if not math.isfinite(parsed) or not minimum <= parsed <= maximum:
        raise ValueError(f"{name} must be between {minimum} and {maximum}")
    return parsed


def _integer(value: Any, name: str, minimum: int = 1, maximum: int = 2000) -> int:
    if type(value) is not int or not minimum <= value <= maximum:
        raise ValueError(f"{name} must be from {minimum} to {maximum}")
    return value


def _alphabet(index: int) -> str:
    """Excel-style A..Z, AA.. labels."""
    result = ""
    value = index + 1
    while value:
        value, remainder = divmod(value - 1, 26)
        result = chr(ord("A") + remainder) + result
    return result


def _data(record: Any) -> Any:
    if isinstance(record, dict) and record.get(ITEM_MARKER) is True:
        return record.get("data")
    return record


def _items(outputs: dict[str, Any], path: str, *, allow_empty: bool = False) -> list[Any]:
    if not path:
        raise ValueError("Select Input Collection")
    value = resolve_input_path(outputs, path)
    if not isinstance(value, list):
        raise ValueError("Input Collection must be an array")
    if len(value) > 2000:
        raise ValueError("Collection exceeds 2000 elements")
    if not value and not allow_empty:
        raise ValueError("Input Collection is empty")
    return value


def _field(record: Any, path: str) -> Any:
    value = _data(record)
    if not path:
        return None
    if not re.fullmatch(r"[a-zA-Z0-9_-]+(?:\.[a-zA-Z0-9_-]+){0,7}", path):
        raise ValueError("Field must be a safe dotted path")
    for token in path.split("."):
        if not isinstance(value, dict):
            return None
        value = value.get(token)
    return value


def _identity(row: Any, index: int, default_parent: str | None = None) -> tuple[str, str, str | None]:
    envelope = row if isinstance(row, dict) and row.get(ITEM_MARKER) is True else {}
    val = _data(row)
    val = val if isinstance(val, dict) else {}
    natural_id = (envelope.get("id") or val.get("id") or val.get("item_id")
                  or val.get("instance_id"))
    label = envelope.get("label") or val.get("label") or val.get("title") or natural_id or _alphabet(index)
    ident = re.sub(r"[^A-Za-z0-9_-]", "_", str(natural_id or f"item_{index + 1}"))[:120]
    parent = val.get("parent_id", envelope.get("parent_id", default_parent))
    return ident, str(label)[:160], str(parent)[:120] if parent is not None else None


def _range(parent: str | None, label: str, index: int, start: float, end: float,
           media_path: str | None) -> dict[str, Any]:
    parent_part = re.sub(r"[^A-Za-z0-9_-]", "_", str(parent or "root"))[:64]
    return {"id": f"{parent_part}_{index+1:04d}", "label": label,
            "parent_id": parent, "start": round(start, 4), "end": round(end, 4),
            "source_start": round(start, 4), "source_end": round(end, 4),
            "duration": round(end - start, 4), "media_path": media_path,
            "children": []}


def _time_splits(start: float, end: float, duration: float, prefix: str,
                 parent: str | None, media_path: str | None, max_segments: int) -> list[dict]:
    segments: list[dict] = []
    now = start
    while now < end - 1e-7:
        finish = min(end, now + duration)
        label = (f"{prefix}{len(segments) + 1}" if prefix else _alphabet(len(segments)))
        segments.append(_range(parent, label, len(segments), now, finish, media_path))
        if len(segments) > max_segments:
            raise ValueError("Split exceeds the configured maximum number of segments")
        now = finish
    return segments


class CollectionNode(Node):
    family = "collections"
    group = "Flow / Collections"
    icon = "lucide:layers"

    operations = {
        "items.loop": {
            "label": "Loop Over Items (Subgraph)", "icon": "lucide:repeat",
            "settings": {"input_path": "", "body_node_ids": [], "max_iterations": 20,
                         "error_policy": "stop", "allow_empty": False},
            "input_types": ["json"], "output_types": ["json"],
        },
        "items.repeat_until": {
            "label": "Repeat Until (Subgraph)", "icon": "lucide:refresh-cw",
            "settings": {"input_path": "", "initial_value": None, "body_node_ids": [],
                         "condition_path": "", "condition_operator": "truthy",
                         "condition_value": True, "max_iterations": 10, "on_limit": "error"},
            "input_types": ["json"], "output_types": ["json"],
        },
        "items.materialize_media": {
            "label": "Export Split Audio / Video Files", "icon": "lucide:film",
            "settings": {"input_path": "", "media_source_path": "", "output_format": "mp3",
                         "max_clips": 100, "overwrite": False},
            "input_types": ["json", "media"], "output_types": ["json", "media"],
        },
        "items.prepare_loop": {
            "label": "Loop Over Items — Prepare", "icon": "lucide:repeat",
            "settings": {"input_path": "", "allow_empty": False},
            "input_types": ["json"], "output_types": ["json"],
        },
        "items.group": {
            "label": "Group Items", "icon": "lucide:folder-tree",
            "settings": {"input_path": "", "group_by_field": "",
                         "group_size": 2, "label_mode": "letters", "allow_empty": False},
            "input_types": ["json"], "output_types": ["json"],
        },
        "items.split": {
            "label": "Split Media / Items", "icon": "lucide:scissors",
            "settings": {"split_mode": "duration", "input_path": "", "duration_path": "",
                         "source_duration_seconds": 60, "segment_seconds": 30,
                         "max_segments": 200, "media_path": "", "allow_empty": False},
            "input_types": ["json", "media"], "output_types": ["json"],
        },
        "items.flatten": {
            "label": "Flatten Nested Items", "icon": "lucide:list-tree",
            "settings": {"input_path": "", "children_field": "children", "allow_empty": False},
            "input_types": ["json"], "output_types": ["json"],
        },
        "items.aggregate": {
            "label": "Aggregate Item Results", "icon": "lucide:combine",
            "settings": {"input_path": "", "group_by_parent": False,
                         "unwrap_data": True, "allow_empty": False},
            "input_types": ["json"], "output_types": ["json"],
        },
    }

    for _kind, _fields in {
        'items.prepare_loop': {'items': 'array', 'item_count': 'integer', 'source_path': 'string'},
        'items.group': {'groups': 'array', 'group_count': 'integer', 'element_count': 'integer'},
        'items.split': {'groups': 'array', 'group_count': 'integer', 'element_count': 'integer'},
        'items.flatten': {'items': 'array', 'item_count': 'integer', 'source_path': 'string'},
        'items.aggregate': {'items': 'array', 'item_count': 'integer', 'source_path': 'string'},
    }.items():
        operations[_kind]['output_contract'] = {
            'type': 'object',
            'properties': {name: {'type': item_type, **({'items': {}} if item_type == 'array' else {})}
                           for name, item_type in _fields.items()},
            'required': list(_fields),
        }

    parameter_fields = {
        "items.loop": {
            "input_path": {"type":"string", "title":"Input Collection", "widget":"upstream", "accepts":["json"]},
            "body_node_ids": {"type":"array", "title":"Body Node IDs (in dependency order)",
                              "widget":"list", "items":{"type":"string"}},
            "max_iterations": {"type":"integer", "title":"Maximum Items", "minimum":1,"maximum":2000},
            "error_policy": {"type":"string", "title":"On Item Error", "enum":["stop","continue"]},
            "allow_empty": {"type":"boolean", "title":"Allow Empty Collection"},
        },
        "items.repeat_until": {
            "input_path": {"type":"string", "title":"Initial Input (optional)","widget":"upstream", "accepts":["json"]},
            "initial_value": {"type":"string", "title":"Initial Value"},
            "body_node_ids": {"type":"array", "title":"Body Node IDs (in dependency order)",
                              "widget":"list", "items":{"type":"string"}},
            "condition_path": {"type":"string", "title":"Body Output Condition Path"},
            "condition_operator": {"type":"string", "title":"Stop When", "enum":["truthy","equals","not_equals","greater_equal","less_equal"]},
            "condition_value": {"type":"string", "title":"Condition Value"},
            "max_iterations": {"type":"integer", "title":"Maximum Repeats", "minimum":1, "maximum":2000},
            "on_limit": {"type":"string", "title":"When Limit Reached", "enum":["error","complete"]},
        },
        "items.materialize_media": {
            "input_path": {"type":"string", "title":"Split Groups", "widget":"upstream", "accepts":["json"]},
            "media_source_path": {"type":"string", "title":"Connected Media Path (optional)", "widget":"upstream", "accepts":["media","json"]},
            "output_format": {"type":"string", "title":"Output Format", "enum":["mp3","wav","mp4"]},
            "max_clips": {"type":"integer", "title":"Maximum Clips", "minimum":1, "maximum":200},
            "overwrite": {"type":"boolean", "title":"Regenerate Files"},
        },
        "items.prepare_loop": {
            "input_path": {"type": "string", "title": "Input Collection", "widget": "upstream", "accepts": ["json"]},
        },
        "items.group": {
            "input_path": {"type": "string", "title": "Input Collection", "widget": "upstream", "accepts": ["json"]},
            "group_by_field": {"type": "string", "title": "Group By Item Field"},
            "group_size": {"type": "integer", "title": "Items per Group", "minimum": 1, "maximum": 2000},
            "label_mode": {"type": "string", "enum": ["letters", "numbers"], "title": "Group Labels"},
        },
        "items.split": {
            "split_mode": {"type": "string", "title": "Split Mode", "enum": ["duration", "subdivide", "manual"]},
            "input_path": {"type": "string", "title": "Existing Groups (for Subdivide)", "widget": "upstream", "accepts": ["json"]},
            "duration_path": {"type": "string", "title": "Media Duration Source", "widget": "upstream", "accepts": ["json"]},
            "source_duration_seconds": {"type": "number", "title": "Source Duration (s)", "minimum": 0.05},
            "segment_seconds": {"type": "number", "title": "Segment Length (s)", "minimum": 0.05},
            "max_segments": {"type": "integer", "title": "Maximum Segments", "minimum": 1, "maximum": 2000},
            "media_path": {"type": "string", "title": "Media Reference Path"},
            "ranges": {"type": "array", "title": "Manual Ranges", "widget": "list",
                       "items": {"type": "object", "properties": {
                           "start": {"type": "number"}, "end": {"type": "number"},
                           "label": {"type": "string"}}}},
        },
        "items.flatten": {
            "input_path": {"type": "string", "title": "Nested Collection", "widget": "upstream", "accepts": ["json"]},
            "children_field": {"type": "string", "title": "Child Collection Field"},
        },
        "items.aggregate": {
            "input_path": {"type": "string", "title": "Item Results", "widget": "upstream", "accepts": ["json"]},
        },
    }

    def execute_operation(self, operation: str, node: dict, outputs: dict,
                          source: Path | None, workdir: Path) -> dict:
        cfg = node.get("settings") or {}
        path = str(cfg.get("input_path") or "").strip()
        allow_empty = cfg.get("allow_empty", False)
        if type(allow_empty) is not bool:
            raise ValueError("Allow Empty must be boolean")
        if operation in ("items.loop", "items.repeat_until"):
            raise ValueError("Subgraph loop controllers must run through WorkflowEngine")
        if operation == "items.materialize_media":
            from app.workflows.MediaSplits import materialize_splits
            return materialize_splits(node, outputs, source, workdir)
        if operation == "items.prepare_loop":
            from app.workflows.ItemExecution import _item_record
            src = path.split(".", 1)[0]
            data = _items(outputs, path, allow_empty=allow_empty)
            return {"items": [_item_record(row, i, src, path) for i, row in enumerate(data)],
                    "item_count": len(data), "source_path": path}

        if operation == "items.group":
            values = _items(outputs, path, allow_empty=allow_empty)
            field = str(cfg.get("group_by_field") or "").strip()
            size = _integer(cfg.get("group_size", 2), "Group Size")
            label_mode = cfg.get("label_mode", "letters")
            if label_mode not in {"letters", "numbers"}:
                raise ValueError("Invalid group label mode")
            buckets: dict[str, list[Any]] = {}
            if field:
                for row in values:
                    bucket = _field(row, field)
                    if isinstance(bucket, (list, dict)):
                        raise ValueError("Group By field must contain scalar values")
                    buckets.setdefault(str(bucket) if bucket is not None else "unknown", []).append(_data(row))
            else:
                for i in range(0, len(values), size):
                    buckets[str(i // size)] = [_data(row) for row in values[i:i + size]]
            grouped = []
            for i, (bucket, elements) in enumerate(buckets.items()):
                label = bucket if field else (_alphabet(i) if label_mode == "letters" else str(i + 1))
                grouped.append({"id": f"group_{i+1:04d}", "label": label,
                                "parent_id": None, "items": elements,
                                "count": len(elements), "group_key": bucket})
            return {"groups": grouped, "group_count": len(grouped),
                    "element_count": len(values)}

        if operation == "items.split":
            mode = cfg.get("split_mode", "duration")
            duration = _number(cfg.get("segment_seconds", 30), "Segment Length", 0.05)
            limit = _integer(cfg.get("max_segments", 200), "Maximum Segments")
            media_path = str(cfg.get("media_path") or "").strip() or None
            if mode == "duration":
                source_duration = cfg.get("source_duration_seconds", 60)
                duration_path = str(cfg.get("duration_path") or "").strip()
                if duration_path:
                    source_duration = resolve_input_path(outputs, duration_path)
                total = _number(source_duration, "Source Duration", 0.05)
                groups = _time_splits(0, total, duration, "", None, media_path, limit)
            elif mode == "subdivide":
                parents = _items(outputs, path, allow_empty=allow_empty)
                groups = []
                total_children = 0
                for i, parent in enumerate(parents):
                    item = _data(parent)
                    if not isinstance(item, dict):
                        raise ValueError("Subdivide requires source group objects")
                    start = _number(item.get("source_start", item.get("start")), "Group start")
                    end = _number(item.get("source_end", item.get("end")), "Group end")
                    if end <= start:
                        raise ValueError("Group end must follow start")
                    gid = str(item.get("id") or f"group_{i+1}")
                    label = str(item.get("label") or _alphabet(i))
                    children = _time_splits(start, end, duration, label, gid,
                                            item.get("media_path", media_path), limit)
                    total_children += len(children)
                    if total_children > limit:
                        raise ValueError("Subdivide exceeds maximum segments")
                    groups.append({**deepcopy(item), "children": children})
            elif mode == "manual":
                ranges = cfg.get("ranges")
                if not isinstance(ranges, list) or not ranges:
                    raise ValueError("Provide manual ranges [{start,end,label}]")
                if len(ranges) > limit:
                    raise ValueError("Manual ranges exceed maximum segments")
                groups = []
                for i, item in enumerate(ranges):
                    if not isinstance(item, dict):
                        raise ValueError("Invalid manual range")
                    start = _number(item.get("start"), "Range start")
                    end = _number(item.get("end"), "Range end")
                    if end <= start:
                        raise ValueError("Range end must follow start")
                    groups.append(_range(None, str(item.get("label") or _alphabet(i)),
                                         i, start, end, media_path))
            else:
                raise ValueError("Unknown Split Mode")
            return {"groups": groups, "group_count": len(groups),
                    "element_count": sum(len(g.get("children", [])) for g in groups)
                    if mode == "subdivide" else len(groups),
                    "note": "Media references and timing only; physical files are not cut."}

        if operation == "items.flatten":
            values = _items(outputs, path, allow_empty=allow_empty)
            field = str(cfg.get("children_field") or "children").strip()
            if not re.fullmatch(r"[A-Za-z0-9_-]{1,80}", field):
                raise ValueError("Invalid Children Field")
            result: list[dict] = []
            def flatten(rows: list[Any], parent_id: str | None, depth: int) -> None:
                if depth > 12:
                    raise ValueError("Nested Groups exceed 12 levels")
                for index, raw in enumerate(rows):
                    row = _data(raw)
                    if not isinstance(row, dict):
                        row = {"value": row}
                    identifier, label, original_parent = _identity(raw, index, parent_id)
                    children = row.get(field)
                    if isinstance(children, list) and children:
                        flatten(children, identifier, depth + 1)
                    else:
                        result.append({**deepcopy(row), "id": identifier,
                                       "label": label, "parent_id": original_parent})
                        if len(result) > 2000:
                            raise ValueError("Flatten output exceeds 2000 elements")
            flatten(values, None, 0)
            return {"items": result, "item_count": len(result), "source_path": path}

        if operation == "items.aggregate":
            values = _items(outputs, path, allow_empty=allow_empty)
            unwrap = cfg.get("unwrap_data", True)
            by_parent = cfg.get("group_by_parent", False)
            if type(unwrap) is not bool or type(by_parent) is not bool:
                raise ValueError("Aggregate options must be booleans")
            completed = [row for row in values if not isinstance(row, dict) or row.get("status") != "failed"]
            collected = [_data(row) if unwrap else deepcopy(row) for row in completed]
            grouped: list[dict[str, Any]] = []
            if by_parent:
                buckets: dict[str, list[Any]] = {}
                for original, data in zip(completed, collected):
                    parent = original.get("parent_id") if isinstance(original, dict) else None
                    buckets.setdefault(str(parent or "root"), []).append(data)
                grouped = [{"parent_id": parent, "items": items, "count": len(items)}
                           for parent, items in buckets.items()]
            return {"items": collected, "groups": grouped, "item_count": len(collected),
                    "group_count": len(grouped), "source_path": path}

        raise ValueError(f"Unsupported collection operation: {operation}")
