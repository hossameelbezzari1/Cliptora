
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

from pathlib import Path
from typing import Callable


def run_graph(
    nodes: list[dict],
    source: Path | None,
    workspace: Path,
    update: Callable[[int, str, dict], None],
    cancelled: Callable[[], bool] = lambda: False,
) -> dict:

    from app.workflows.validation import validate_workflow
    from app.helpers.transcript import get_input
    from app.workflows.registry import executor as node_executor

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
                and bool(os.environ.get("OPENAI_API_KEY"))
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

        # Live progress support for all node types.
        # The callback is runtime-only and is never
        # included in workflow JSON or cache fingerprints.

        node_progress_callback = None

        if result is None:

            last_emit_time = 0.0
            last_signature = None

            def node_progress_callback(
                event: dict,
            ) -> None:

                nonlocal last_emit_time
                nonlocal last_signature

                if not isinstance(event, dict):
                    return

                raw_percent = event.get(
                    "progress",
                    event.get("percent"),
                )

                try:
                    parsed = (
                        float(raw_percent)
                        if raw_percent is not None
                        else None
                    )

                    percent = (
                        max(0.0, min(99.0, parsed))
                        if parsed is not None
                        and math.isfinite(parsed)
                        else None
                    )

                except (TypeError, ValueError):
                    percent = None

                stage = str(
                    event.get("stage") or "processing"
                )[:64]

                message = str(
                    event.get("message") or ""
                )[:200]

                status = {
                    "state": "running",
                    "type": node_type,
                    "stage": stage,
                    "message": message,
                    "progress": (
                        round(percent)
                        if percent is not None
                        else None
                    ),
                }

                for field in (
                    "processed",
                    "total",
                    "processed_seconds",
                    "total_seconds",
                ):
                    value = event.get(field)

                    if (
                        isinstance(value, (int, float))
                        and not isinstance(value, bool)
                        and math.isfinite(value)
                        and 0 <= value < 10**12
                    ):
                        status[field] = round(
                            float(value),
                            2,
                        )

                unit = event.get("unit")

                if isinstance(unit, str):
                    status["unit"] = unit[:24]

                words_processed = event.get(
                    "words_processed"
                )

                if (
                    isinstance(words_processed, int)
                    and not isinstance(
                        words_processed,
                        bool,
                    )
                    and words_processed >= 0
                ):
                    status["words_processed"] = (
                        words_processed
                    )

                now = time.monotonic()

                signature = (
                    stage,
                    message,
                )

                # Avoid excessive database writes.
                # At most one progress update per second
                # for the same stage and message.

                if (
                    signature == last_signature
                    and now - last_emit_time < 1.0
                ):
                    return

                last_emit_time = now
                last_signature = signature

                summary[node_id] = status

                node_fraction = (
                    percent / 100.0
                    if percent is not None
                    else 0.0
                )

                overall_progress = int(
                    100
                    * (index + node_fraction)
                    / total_nodes
                )

                update(
                    overall_progress,
                    node_id,
                    summary,
                )

            node_progress_callback({
                "stage": "starting",
                "message": "Starting node execution...",
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
                return {
                    "status": "cancelled",
                    "nodes": summary,
                }

            attempts += 1

            try:

                execution_node = {
                    **node,
                    "_progress_callback": (
                        node_progress_callback
                    ),
                }

                candidate = node_executor(
                    node_type
                )(
                    execution_node,
                    deps,
                    source,
                    workspace,
                )

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
            raise RuntimeError(
                f"Node {node_id} failed "
                f"after {attempts} attempt(s): "
                f"{last_error}"
            ) from last_error

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

        public = {
            "state": "completed",
            "type": node_type,
            "artifact": True,
            "cached": cached,
            "attempts": attempts,
        }

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
