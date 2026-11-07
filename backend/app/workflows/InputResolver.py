"""Safe, deterministic upstream input resolver for CLIPTORA."""
from __future__ import annotations

import re
from typing import Any

PART = re.compile(r"[A-Za-z0-9_-]{1,80}\Z")
SECRET_FIELDS = {
    "api_key", "apikey", "token", "password", "secret",
    "secret_key", "access_token", "refresh_token",
    "authorization",
}
TEXT_PRIORITY = {
    "text": 100,
    "transcript": 96,
    "transcription": 95,
    "content": 88,
    "message": 85,
    "summary": 82,
    "caption": 80,
    "description": 75,
    "response": 72,
    "result": 60,
    "output": 55,
}


def _validate_part(part: str) -> None:
    if not PART.fullmatch(part) or part.lower() in SECRET_FIELDS:
        raise ValueError("Invalid or sensitive upstream field path")


def resolve_input_path(outputs: dict[str, Any], path: str) -> Any:
    """Resolve a safe dot path, including list indexes."""
    if not isinstance(path, str) or not path.strip():
        raise ValueError("Select an upstream input path")

    parts = path.strip().split(".")

    if len(parts) > 16 or any(not part for part in parts):
        raise ValueError("Upstream input path is too deep or malformed")

    for part in parts:
        _validate_part(part)

    if parts[0] in outputs:
        value: Any = outputs[parts[0]]
        parts = parts[1:]
    else:
        matches = [
            value for value in outputs.values()
            if isinstance(value, dict) and parts[0] in value
        ]

        if len(matches) != 1:
            raise ValueError(
                "Upstream field is missing or ambiguous; "
                "select a connected source"
            )
        value = matches[0]

    for part in parts:
        if isinstance(value, dict) and part in value:
            value = value[part]
        elif isinstance(value, list) and part.isdigit() and int(part) < len(value):
            value = value[int(part)]
        else:
            raise ValueError(f"Upstream input path not found: {path[:160]}")

    return value


def _ranked_text_fields(value: Any, prefix: str, depth: int = 0):
    if not isinstance(value, dict) or depth > 3:
        return

    for key, field in list(value.items())[:150]:
        if (
            not isinstance(key, str)
            or not PART.fullmatch(key)
            or key.lower() in SECRET_FIELDS
        ):
            continue

        path = f"{prefix}.{key}"

        if isinstance(field, str) and field.strip():
            rank = TEXT_PRIORITY.get(key.casefold())

            if rank is not None:
                yield rank, path, field

        elif isinstance(field, dict):
            yield from _ranked_text_fields(field, path, depth + 1)


def infer_text_input(outputs: dict[str, Any]) -> tuple[str, str] | None:
    """Find text from one source; refuse ambiguous multiple sources."""
    candidates: list[tuple[str, str]] = []

    for node_id, output in outputs.items():
        if not isinstance(output, dict):
            continue

        fields = sorted(
            _ranked_text_fields(output, node_id),
            key=lambda row: (-row[0], row[1]),
        )

        if fields:
            candidates.append((fields[0][1], fields[0][2]))

    if len(candidates) > 1:
        sources = ", ".join(
            path.split(".", 1)[0]
            for path, _ in candidates[:6]
        )
        raise ValueError(
            f"Multiple connected nodes produce text ({sources}). "
            "Select one field in the Input picker."
        )

    return candidates[0] if candidates else None
