"""CLIPTORA native workflow execution engine.

Supports dependency ordering, branch conditions, caching,
retries, cancellation, JSON artifacts and live node progress.
"""

from __future__ import annotations

import hashlib
import json
import math
import os
import time
from datetime import datetime, timezone

from pathlib import Path
from typing import Callable


def run_graph(
    nodes: list[dict],
    source: Path | None,
    workspace: Path,
    update: Callable[[int, str, dict], None],
    cancelled: Callable[[], bool] = lambda: False,
) -> dict:

    from app.workflows.Validation import validate_workflow
    from app.helpers.Transcript import get_input
    from app.workflows.Registry import executor as node_executor
    from app.workflows.Credentials import bind_for_node

    ordered = validate_workflow(nodes)

    workspace.mkdir(parents=True, exist_ok=True)

    outputs: dict[str, dict] = {}
    summary: dict[str, dict] = {}

    total_nodes = len(ordered)

    for index, node in enumerate(ordered):

        if cancelled():
            return {
                "status": "cancelled",
                "nodes": summary,
            }

        node_id = node["id"]
        node_type = node["type"]
        node_started_at = datetime.now(timezone.utc).isoformat()
        node_started_clock = time.monotonic()

        deps = {
            key: outputs[key]
            for key in node["depends_on"]
            if key in outputs
        }

        has_video = source is not None

        condition = node.get("when", "always")

        branch_condition = get_input(
            deps,
            "condition",
        )

        switch_route = get_input(
            deps,
            "route",
        )

        satisfied = (
            condition == "always"
            or (
                condition == "has_video"
                and has_video
            )
            or (
                condition == "has_transcript"
                and get_input(deps, "words") is not None
            )
            or (
                condition == "ai_enabled"
                and bool((node.get("settings") or {}).get("credential_id"))
            )
            or (
                condition == "condition_true"
                and branch_condition is True
            )
            or (
                condition == "condition_false"
                and branch_condition is False
            )
            or (
                condition.startswith("route_")
                and condition != "route_fallback"
                and switch_route == int(
                    condition.removeprefix("route_")
                )
            )
            or (
                condition == "route_fallback"
                and switch_route is None
            )
        )

        if (
            not satisfied
            or len(deps) != len(node["depends_on"])
        ):
            summary[node_id] = {
                "state": "skipped",
                "type": node_type,
            }

            update(
                int(100 * (index + 1) / total_nodes),
                node_id,
                summary,
            )

            continue

        artifact = workspace / f"{node_id}.json"

        checkpoint = workspace / f".{node_id}.sha256"

        source_fingerprint = (
            None
            if source is None
            else {
                "path": str(source),
                "size": source.stat().st_size,
                "mtime": source.stat().st_mtime_ns,
            }
        )

        fingerprint = hashlib.sha256(
            json.dumps(
                {
                    "node": node,
                    "deps": deps,
                    "source": source_fingerprint,
                },
                sort_keys=True,
                ensure_ascii=False,
            ).encode()
        ).hexdigest()

        result = None
        cached = False

        if (
            node.get("cache", True)
            and artifact.is_file()
            and checkpoint.is_file()
            and checkpoint.read_text(
                encoding="ascii"
            ) == fingerprint
        ):
            try:
                result = json.loads(
                    artifact.read_text(
                        encoding="utf-8"
                    )
                )

                if not isinstance(result, dict):
                    result = None
                else:
                    cached = True

            except (OSError, ValueError):
                result = None

        # The callback is runtime-only and never enters a cache fingerprint.
        # Each node can publish stages and type-specific numeric metrics.
        node_progress_callback = None

        if result is None:
            last_emit_time = 0.0
            latest_status: dict = {}

            def node_progress_callback(event: dict) -> None:
                nonlocal last_emit_time, latest_status
                if not isinstance(event, dict):
                    return

                previous = latest_status
                stage = str(event.get('stage') or 'processing')[:64]
                message = str(event.get('message') or '')[:200]
                raw_percent = event.get('progress', event.get('percent'))
                percent = previous.get('progress')
                if raw_percent is not None:
                    try:
                        value = float(raw_percent)
                        if math.isfinite(value):
                            percent = round(max(0.0, min(99.0, value)), 2)
                    except (TypeError, ValueError):
                        pass

                status = {
                    **previous,
                    'state': 'running',
                    'type': node_type,
                    'stage': stage,
                    'message': message,
                    'progress': percent,
                    'started_at': node_started_at,
                    'elapsed_seconds': round(time.monotonic() - node_started_clock, 2),
                }

                for field in ('processed', 'total', 'processed_seconds', 'total_seconds',
                              'words_processed', 'segments_processed', 'frames_processed',
                              'requests_processed'):
                    value = event.get(field)
                    if isinstance(value, (int, float)) and not isinstance(value, bool) \
                            and math.isfinite(value) and 0 <= value < 10**12:
                        status[field] = round(float(value), 2)

                if isinstance(event.get('unit'), str):
                    status['unit'] = event['unit'][:24]

                latest_status = status
                now = time.monotonic()
                important = stage != summary.get(node_id, {}).get('stage') or bool(event.get('force'))
                # Prevent a DB commit for every Whisper segment/frame.
                # Keep the freshest percentage + metrics at most once per second.
                if not important and now - last_emit_time < 1.0:
                    return

                last_emit_time = now
                summary[node_id] = status
                fraction = (percent or 0) / 100.0
                overall = int(100 * (index + fraction) / total_nodes)
                update(overall, node_id, summary)

            node_progress_callback({
                'stage': 'starting',
                'message': 'Starting node execution...',
            })

        attempts = 0
        last_error: Exception | None = None

        while (
            result is None
            and attempts <= node.get(
                "retry_limit",
                1,
            )
        ):

            if cancelled():
                summary[node_id] = {
                    **summary.get(node_id, {}),
                    'state': 'cancelled',
                    'stage': 'cancelled',
                    'elapsed_seconds': round(time.monotonic() - node_started_clock, 2),
                    'finished_at': datetime.now(timezone.utc).isoformat(),
                }
                return {'status': 'cancelled', 'nodes': summary}

            attempts += 1
            if attempts > 1 and node_progress_callback:
                node_progress_callback({
                    'stage': 'retrying',
                    'message': f'Retrying node (attempt {attempts})',
                })

            try:

                execution_node = {
                    **node,
                    "_progress_callback": (
                        node_progress_callback
                    ),
                }

                with bind_for_node(execution_node):
                    candidate = node_executor(node_type)(execution_node, deps, source, workspace)

                if not isinstance(candidate, dict):
                    raise ValueError(
                        f"Node {node_id} must "
                        "return a JSON object"
                    )

                json.dumps(
                    candidate,
                    ensure_ascii=False,
                    allow_nan=False,
                )

                result = candidate

            except Exception as exc:
                last_error = exc

        if result is None:
            error = (f'Node {node_id} failed after {attempts} attempt(s): '
                     f'{last_error}')
            summary[node_id] = {
                **summary.get(node_id, {}),
                'state': 'failed',
                'type': node_type,
                'stage': 'failed',
                'message': 'Execution failed',
                'error': error[:500],
                'started_at': node_started_at,
                'finished_at': datetime.now(timezone.utc).isoformat(),
                'elapsed_seconds': round(time.monotonic() - node_started_clock, 2),
            }
            update(int(100 * index / total_nodes), node_id, summary)
            raise RuntimeError(error) from last_error

        target = workspace / f".{node_id}.tmp"

        if not cached:

            target.write_text(
                json.dumps(
                    result,
                    ensure_ascii=False,
                    allow_nan=False,
                ),
                encoding="utf-8",
            )

            target.replace(artifact)

            checkpoint.write_text(
                fingerprint,
                encoding="ascii",
            )

        outputs[node_id] = result

        previous_progress = summary.get(node_id, {})
        public = {
            'state': 'completed',
            'type': node_type,
            'stage': 'completed',
            'message': 'Finished (cached)' if cached else 'Execution completed',
            'progress': 100,
            'started_at': node_started_at,
            'finished_at': datetime.now(timezone.utc).isoformat(),
            'elapsed_seconds': round(time.monotonic() - node_started_clock, 2),
            'artifact': True,
            'cached': cached,
            'attempts': attempts,
        }
        for metric in ('processed', 'total', 'processed_seconds', 'total_seconds',
                       'words_processed', 'segments_processed', 'frames_processed',
                       'requests_processed', 'unit'):
            if metric in previous_progress:
                public[metric] = previous_progress[metric]

        for key in (
            "output_duration",
            "target_duration",
            "language",
            "method",
        ):
            if key in result:
                public[key] = result[key]

        for key in (
            "words",
            "segments",
            "highlights",
            "cut_plan",
            "captions",
            "scenes",
            "keyframes",
        ):
            if isinstance(
                result.get(key),
                list,
            ):
                public[f"{key}_count"] = len(
                    result[key]
                )

        if "render" in result:
            public["render"] = result["render"]

        summary[node_id] = public

        update(
            int(
                100
                * (index + 1)
                / total_nodes
            ),
            node_id,
            summary,
        )

    return {
        "status": "completed",
        "nodes": summary,
    }


class WorkflowEngine:

    def execute(
        self,
        nodes,
        source,
        workspace,
        update,
        cancelled=lambda: False,
    ):
        return run_graph(
            nodes,
            source,
            workspace,
            update,
            cancelled,
        )
