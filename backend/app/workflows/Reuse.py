"""Reuse completed upstream outputs from older runs of one workflow."""
from __future__ import annotations

import json
import shutil
from pathlib import Path
from typing import Any

REUSABLE_TYPES = frozenset({
    "core.manual_trigger",
    "core.video_source",
    "media.probe",
    "audio.extract",
    "audio.transcribe",
})

MAX_ARTIFACT_BYTES = 64 * 1024 * 1024
MAX_FILE_BYTES = 1024 * 1024 * 1024


def signature(node: dict) -> dict:
    return {
        key: node.get(key)
        for key in (
            "id", "type", "depends_on", "settings", "when"
        )
    }


def read_artifact(path: Path) -> dict | None:
    try:
        if (
            not path.is_file()
            or path.stat().st_size > MAX_ARTIFACT_BYTES
        ):
            return None

        result = json.loads(path.read_text(encoding="utf-8"))
        return result if isinstance(result, dict) else None
    except (OSError, ValueError, UnicodeError):
        return None


def rebase(value: Any, old_dir: Path, new_dir: Path) -> Any:
    if isinstance(value, dict):
        return {
            key: rebase(item, old_dir, new_dir)
            for key, item in value.items()
        }

    if isinstance(value, list):
        return [
            rebase(item, old_dir, new_dir)
            for item in value
        ]

    if not isinstance(value, str):
        return value

    prefix = str(old_dir)

    if not (
        value.startswith(prefix + "\\")
        or value.startswith(prefix + "/")
    ):
        return value

    old_file = Path(value).resolve()
    relative = old_file.relative_to(old_dir)

    if not old_file.is_file():
        raise ValueError("Referenced old artifact is missing")

    if old_file.stat().st_size > MAX_FILE_BYTES:
        raise ValueError("Referenced artifact is too large")

    new_file = (new_dir / relative).resolve()
    new_file.relative_to(new_dir)

    new_file.parent.mkdir(parents=True, exist_ok=True)

    if not new_file.exists():
        shutil.copy2(old_file, new_file)

    return str(new_file)


def collect_reusable_outputs(
    current_nodes: list[dict],
    previous_runs: list[Any],
    workspace: Path,
    source_id: int | None,
) -> dict[str, dict]:
    new_dir = workspace.resolve()
    runs_dir = new_dir.parent

    selected = {}
    best_score = 0

    for run in previous_runs:
        if run.source_id != source_id:
            continue

        try:
            old_nodes = json.loads(run.workflow_json)

            if not isinstance(old_nodes, list):
                continue

            old_by_id = {
                node["id"]: node
                for node in old_nodes
                if (
                    isinstance(node, dict)
                    and isinstance(node.get("id"), str)
                )
            }
        except (TypeError, ValueError, KeyError):
            continue

        old_dir = (runs_dir / str(run.id)).resolve()

        if old_dir == new_dir or not old_dir.is_dir():
            continue

        try:
            old_dir.relative_to(runs_dir)
        except ValueError:
            continue

        available = {}

        for node in current_nodes:
            node_id = node["id"]
            previous = old_by_id.get(node_id)

            if node["type"] not in REUSABLE_TYPES:
                continue

            if node.get("cache", True) is not True:
                continue

            if previous is None:
                continue

            if previous.get("cache", True) is not True:
                continue

            if signature(node) != signature(previous):
                continue

            if not all(
                dep in available
                for dep in node["depends_on"]
            ):
                continue

            artifact = read_artifact(
                old_dir / f"{node_id}.json"
            )

            if artifact is None:
                continue

            available[node_id] = (
                artifact,
                old_dir,
                run.id,
            )

        score = sum(
            100 if next(
                node["type"]
                for node in current_nodes
                if node["id"] == node_id
            ) == "audio.transcribe" else 10
            for node_id in available
        )

        if score > best_score:
            selected = available
            best_score = score

    if not selected:
        return {}

    try:
        return {
            node_id: {
                "result": rebase(
                    artifact, old_dir, new_dir
                ),
                "run_id": run_id,
            }
            for node_id, (
                artifact, old_dir, run_id
            ) in selected.items()
        }
    except (OSError, ValueError):
        return {}
