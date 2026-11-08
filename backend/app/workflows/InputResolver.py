"""Safe, deterministic upstream input resolver for CLIPTORA."""
from __future__ import annotations

import re
from typing import Any

PART = re.compile(r"[A-Za-z0-9_-]{1,80}\Z")
PATH_PART = re.compile(
    r"(?P<name>[A-Za-z0-9_-]{1,80})"
    r"(?P<accessors>(?:\[\]|\[\d+\])*)\Z"
)
ACCESSOR = re.compile(r"\[([^\]]*)\]")
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


def _path_tokens(path: str) -> list[str | int | None]:
    """Parse a safe path. ``None`` represents an array wildcard (``[]``)."""
    if not isinstance(path, str) or not path.strip():
        raise ValueError("Select an upstream input path")

    normalized = path.strip()

    expression = re.fullmatch(r"\{\{\s*(.*?)\s*\}\}", normalized)
    if expression:
        normalized = expression.group(1).strip()

    if normalized == "$json":
        return []
    if normalized.startswith("$json."):
        normalized = normalized[6:]

    parts = normalized.split(".")

    if len(parts) > 16 or any(not part for part in parts):
        raise ValueError("Upstream input path is too deep or malformed")

    tokens: list[str | int | None] = []

    for part in parts:
        match = PATH_PART.fullmatch(part)
        if not match:
            raise ValueError("Upstream input path is too deep or malformed")

        name = match.group("name")
        _validate_part(name)
        tokens.append(name)

        for accessor in ACCESSOR.findall(match.group("accessors")):
            tokens.append(None if accessor == "" else int(accessor))

    if len(tokens) > 32:
        raise ValueError("Upstream input path is too deep or malformed")

    return tokens


def resolve_input_path(outputs: dict[str, Any], path: str) -> Any:
    """Resolve a safe upstream path, including indexes and ``[]`` mapping.

    Examples include ``node.items.0.text``, ``node.items[0].text`` and
    ``node.items[].value``. Wildcards are deterministic data traversal; no
    Python or JavaScript expressions are evaluated.
    """
    tokens = _path_tokens(path)

    if not tokens:
        return outputs

    first = tokens[0]
    if not isinstance(first, str):
        raise ValueError("Upstream input path must start with a field")

    if first in outputs:
        value: Any = outputs[first]
        tokens = tokens[1:]
    else:
        matches = [
            value for value in outputs.values()
            if isinstance(value, dict) and first in value
        ]

        if len(matches) != 1:
            raise ValueError(
                "Upstream field is missing or ambiguous; "
                "select a connected source"
            )
        value = matches[0]

    def walk(current: Any, remaining: list[str | int | None]) -> Any:
        if not remaining:
            return current

        token, rest = remaining[0], remaining[1:]

        if token is None:
            if not isinstance(current, list):
                raise ValueError(
                    f"Upstream array path not found: {path[:160]}"
                )
            return [walk(item, rest) for item in current]

        if isinstance(token, int):
            if not isinstance(current, list) or token >= len(current):
                raise ValueError(
                    f"Upstream input path not found: {path[:160]}"
                )
            return walk(current[token], rest)

        if isinstance(current, dict) and token in current:
            return walk(current[token], rest)

        if isinstance(current, list) and token.isdigit():
            index = int(token)
            if index < len(current):
                return walk(current[index], rest)

        raise ValueError(f"Upstream input path not found: {path[:160]}")

    return walk(value, tokens)


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
