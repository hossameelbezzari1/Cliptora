
"""Reuse completed upstream outputs in CLIPTORA workflows.

Supports:
- Legacy workflow cache reuse
- Strict Execute Step
- Verified SHA256 checkpoints
- Media storage and legacy workflow paths
- Audio/video artifact references
- Prevention of silent upstream re-execution
"""

from __future__ import annotations

import hashlib
import json
import re
import shutil
from pathlib import Path
from typing import Any

from app.workflows.MediaStorage import run_media_dir


STEP_TARGET_KEY = "__cliptora_execute_step_target"

MAX_ARTIFACT_BYTES = 64 * 1024 * 1024
MAX_FILE_BYTES = 1024 * 1024 * 1024

REUSABLE_TYPES = frozenset({
    "core.manual_trigger",
    "core.video_source",
    "media.probe",
    "audio.extract",
    "audio.transcribe",
})


def signature(node: dict) -> dict:
    """Compare executable configuration, ignoring step-only metadata.

    The Execute Step target flag is a temporary execution instruction,
    not a user setting. It must not invalidate a completed node's
    reusable output when the next downstream node is executed.
    """
    settings = node.get("settings")

    if isinstance(settings, dict):
        settings = {
            key: value
            for key, value in settings.items()
            if key != STEP_TARGET_KEY
        }

    return {
        key: settings if key == "settings" else node.get(key)
        for key in (
            "id",
            "type",
            "depends_on",
            "settings",
            "when",
            "cache",
        )
    }


def read_artifact(path: Path) -> dict | None:
    try:
        if not path.is_file():
            return None

        size = path.stat().st_size

        if not 0 < size <= MAX_ARTIFACT_BYTES:
            return None

        value = json.loads(
            path.read_text(encoding="utf-8")
        )

        return value if isinstance(value, dict) else None

    except (
        OSError,
        ValueError,
        UnicodeError,
    ):
        return None


def _source_fingerprint(
    source: Path | None,
) -> dict | None:
    if source is None:
        return None

    resolved = Path(source).resolve()

    stat = resolved.stat()

    return {
        "path": str(source),
        "size": stat.st_size,
        "mtime": stat.st_mtime_ns,
    }


def _engine_fingerprint(
    node: dict,
    deps: dict,
    source_info: dict | None,
) -> str:
    """Use exactly the fingerprint format produced by Engine.py."""

    payload = {
        "node": node,
        "deps": deps,
        "source": source_info,
    }

    return hashlib.sha256(
        json.dumps(
            payload,
            sort_keys=True,
            ensure_ascii=False,
        ).encode()
    ).hexdigest()


def _old_workspace(
    new_workspace: Path,
    run_id: int,
) -> Path:
    runs_dir = new_workspace.resolve().parent

    old_dir = (
        runs_dir / str(int(run_id))
    ).resolve()

    if (
        old_dir == new_workspace.resolve()
        or not old_dir.is_relative_to(runs_dir)
    ):
        raise ValueError(
            "Invalid previous workflow run"
        )

    return old_dir


def _copy_run_file(
    source: Path,
    origin: Path,
    destination: Path,
) -> str:
    if source.is_symlink() or not source.is_file():
        raise ValueError(
            "Referenced previous run file is missing"
        )

    size = source.stat().st_size

    if not 0 < size <= MAX_FILE_BYTES:
        raise ValueError(
            "Referenced previous run file exceeds limits"
        )

    relative = source.relative_to(origin)

    target = (
        destination / relative
    ).resolve()

    if not target.is_relative_to(destination):
        raise ValueError(
            "Unsafe destination for reused artifact"
        )

    target.parent.mkdir(
        parents=True,
        exist_ok=True,
    )

    if target.exists():
        if (
            target.is_symlink()
            or not target.is_file()
            or target.stat().st_size != size
        ):
            raise ValueError(
                "Reused file destination is invalid"
            )
    else:
        shutil.copy2(source, target)

    return str(target)


def _rewrite_media(
    value: Any,
    old_dir: Path,
    new_dir: Path,
    old_run_id: int,
    new_run_id: int,
) -> Any:
    if isinstance(value, dict):
        return {
            key: _rewrite_media(
                item,
                old_dir,
                new_dir,
                old_run_id,
                new_run_id,
            )
            for key, item in value.items()
        }

    if isinstance(value, list):
        return [
            _rewrite_media(
                item,
                old_dir,
                new_dir,
                old_run_id,
                new_run_id,
            )
            for item in value
        ]

    if not isinstance(value, str):
        return value

    if value.startswith("/api/v1/workflows/"):
        old_token = f"/runs/{old_run_id}/audio/"

        if old_token in value:
            return value.replace(
                old_token,
                f"/runs/{new_run_id}/audio/",
                1,
            )

        return value

    candidate = Path(value)

    if not candidate.is_absolute():
        return value

    resolved = candidate.resolve()

    old_media = run_media_dir(
        old_dir
    ).resolve()

    new_media = run_media_dir(
        new_dir
    ).resolve()

    roots = (
        (old_media, new_media),
        (old_dir.resolve(), new_dir.resolve()),
    )

    for origin, destination in roots:
        if not resolved.is_relative_to(origin):
            continue

        return _copy_run_file(
            resolved,
            origin,
            destination,
        )

    return value


def rebase(
    value: Any,
    old_dir: Path,
    new_dir: Path,
) -> Any:
    """Compatibility wrapper for previously used Reuse.rebase."""

    old_dir = Path(old_dir).resolve()
    new_dir = Path(new_dir).resolve()

    return _rewrite_media(
        value,
        old_dir,
        new_dir,
        int(old_dir.name),
        int(new_dir.name),
    )


def _candidate(
    current_nodes: list[dict],
    previous: Any,
    workspace: Path,
    source_id: int | None,
    source_info: dict | None,
    target_id: str | None,
) -> tuple[dict, dict]:
    available: dict[str, tuple] = {}
    reasons: dict[str, str] = {}
    raw_outputs: dict[str, dict] = {}

    if previous.source_id != source_id:
        return available, reasons

    try:
        old_nodes = json.loads(
            previous.workflow_json
        )

        if not isinstance(old_nodes, list):
            return available, reasons

        old_by_id = {
            node["id"]: node
            for node in old_nodes
            if (
                isinstance(node, dict)
                and isinstance(node.get("id"), str)
            )
        }

        old_dir = _old_workspace(
            workspace,
            previous.id,
        )

        if not old_dir.is_dir():
            return available, reasons

    except (
        TypeError,
        ValueError,
        KeyError,
        OSError,
    ):
        return available, reasons

    for node in current_nodes:
        node_id = node["id"]

        if node_id == target_id:
            continue

        # Keep original full-workflow caching policy.
        # Targeted execution can reuse any compatible node.
        if (
            target_id is None
            and node["type"] not in REUSABLE_TYPES
        ):
            continue

        old_node = old_by_id.get(node_id)

        if old_node is None:
            reasons[node_id] = (
                "node not found in previous run"
            )
            continue

        if (
            node.get("cache", True) is False
            or old_node.get("cache", True) is False
        ):
            reasons[node_id] = "cache disabled"
            continue

        if signature(node) != signature(old_node):
            reasons[node_id] = (
                "node configuration changed"
            )
            continue

        if any(
            dependency not in raw_outputs
            for dependency in node["depends_on"]
        ):
            reasons[node_id] = (
                "dependency output unavailable"
            )
            continue

        artifact = read_artifact(
            old_dir / f"{node_id}.json"
        )

        if artifact is None:
            reasons[node_id] = (
                "saved JSON artifact missing or invalid"
            )
            continue

        checkpoint = (
            old_dir / f".{node_id}.sha256"
        )

        deps = {
            dependency: raw_outputs[dependency]
            for dependency in node["depends_on"]
        }

        try:
            recorded = checkpoint.read_text(
                encoding="ascii"
            ).strip()

            expected = _engine_fingerprint(
                old_node,
                deps,
                source_info,
            )

        except (
            OSError,
            TypeError,
            ValueError,
            UnicodeError,
        ):
            reasons[node_id] = (
                "SHA256 checkpoint missing or invalid"
            )
            continue

        if (
            re.fullmatch(r"[0-9a-f]{64}", recorded)
            is None
            or recorded != expected
        ):
            reasons[node_id] = (
                "SHA256 mismatch: source, settings "
                "or upstream output changed"
            )
            continue

        raw_outputs[node_id] = artifact

        available[node_id] = (
            artifact,
            old_dir,
            int(previous.id),
        )

    return available, reasons


def collect_reusable_outputs(
    current_nodes: list[dict],
    previous_runs: list[Any],
    workspace: Path,
    source_id: int | None,
    source: Path | None = None,
) -> dict[str, dict]:
    """Collect reusable outputs without rerunning upstream nodes."""

    new_dir = Path(workspace).resolve()

    targets = [
        node["id"]
        for node in current_nodes
        if (
            (node.get("settings") or {}).get(
                STEP_TARGET_KEY
            ) is True
        )
    ]

    if len(targets) > 1:
        raise ValueError(
            "Execute Step has more than one target"
        )

    target_id = (
        targets[0] if targets else None
    )

    required = {
        node["id"]
        for node in current_nodes
        if node["id"] != target_id
    }

    source_info = _source_fingerprint(source)

    if source_id is not None and source_info is None:
        raise ValueError(
            "Workflow source is missing"
        )

    selected: dict[str, tuple] = {}
    selected_reasons: dict[str, str] = {}

    best_missing = len(required) + 1
    best_score = -1

    for previous in previous_runs:
        candidate, reasons = _candidate(
            current_nodes,
            previous,
            new_dir,
            source_id,
            source_info,
            target_id,
        )

        missing_count = len(
            required - candidate.keys()
        )

        score = sum(
            100
            if node["type"] == "audio.transcribe"
            else 10
            for node in current_nodes
            if node["id"] in candidate
        )

        if (
            missing_count < best_missing
            or (
                missing_count == best_missing
                and score > best_score
            )
        ):
            selected = candidate
            selected_reasons = reasons

            best_missing = missing_count
            best_score = score

        if (
            target_id is not None
            and missing_count == 0
        ):
            break

    if (
        target_id is not None
        and not required.issubset(selected)
    ):
        missing = sorted(
            required - selected.keys()
        )

        details = "; ".join(
            f"{node_id}: "
            f"{selected_reasons.get(node_id, 'no matching saved run')}"
            for node_id in missing
        )

        raise ValueError(
            "Execute Step cannot reuse all required "
            "upstream outputs. "
            + details
            + ". Execute missing upstream nodes first."
        )

    result: dict[str, dict] = {}

    for node in current_nodes:
        node_id = node["id"]

        entry = selected.get(node_id)

        if entry is None:
            continue

        artifact, old_dir, run_id = entry

        try:
            rebased = rebase(
                artifact,
                old_dir,
                new_dir,
            )

        except (
            OSError,
            ValueError,
        ) as exc:
            if target_id is not None:
                raise ValueError(
                    f"Cannot restore previous output "
                    f"for {node_id}: {exc}"
                ) from exc

            return {}

        result[node_id] = {
            "result": rebased,
            "run_id": run_id,
        }

    return result
