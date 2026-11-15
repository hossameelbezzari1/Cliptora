"""CLIPTORA native workflow execution engine.

Supports dependency ordering, branch conditions, caching,
retries, cancellation, JSON artifacts and live node progress.

Workflow execution errors are logged with their full tracebacks
to the centralized CLIPTORA application log.
"""

from __future__ import annotations

import hashlib
import json
import logging
import math
import os
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable

from app.core.AppLogging import configure_logging


logger = logging.getLogger("cliptora.workflows.engine")


def run_graph(
    nodes: list[dict],
    source: Path | None,
    workspace: Path,
    update: Callable[[int, str, dict], None],
    cancelled: Callable[[], bool] = lambda: False,
    reused: dict[str, dict] | None = None,
) -> dict:

    # Ensure that scheduled and independent workers also
    # write to the central application log.
    configure_logging()

    from app.workflows.Validation import validate_workflow
    from app.helpers.Transcript import get_input
    from app.workflows.Registry import executor as node_executor
    from app.workflows.Credentials import bind_for_node
    from app.workflows.Reuse import STEP_TARGET_KEY
    from app.workflows.ItemExecution import (
        execution_settings, run_item_execution, describe_collections,
    )

    ordered = validate_workflow(nodes)
    from app.workflows.LoopSubgraph import (
        CONTROLLERS, body_members, run_loop_controller,
    )
    loop_membership = body_members(ordered)
    prepared_body_outputs: dict[str, dict] = {}

    workspace.mkdir(parents=True, exist_ok=True)

    outputs: dict[str, dict] = {}
    summary: dict[str, dict] = {}

    total_nodes = len(ordered)
    by_node_id = {item["id"]: item for item in ordered}
    step_targets = [
        item["id"] for item in ordered
        if (item.get("settings") or {}).get(STEP_TARGET_KEY) is True
    ]
    if len(step_targets) > 1:
        raise ValueError("Execute Step must have exactly one target")
    step_target = step_targets[0] if step_targets else None
    if step_target is not None:
        # Fail before executing any expensive or side-effectful upstream node.
        required = {
            item["id"] for item in ordered
            if item["id"] != step_target
        }
        missing = required - set(reused or {})
        # Declarative Browser Tool nodes do not have saved run artifacts.
        declarative = {
            source_id
            for item in ordered if item["type"] == "ai.agent"
            for source_id, port in (item.get("settings", {}).get("__cliptora_ui_target_handles") or {}).items()
            if port == "tool" and source_id in by_node_id
            and by_node_id[source_id]["type"] == "browser.playwright"
        }
        main_dependents = {
            dep for item in ordered for dep in item["depends_on"]
            if (item.get("settings", {}).get("__cliptora_ui_target_handles") or {}).get(dep) != "tool"
        }
        missing -= (declarative - main_dependents)
        if missing:
            raise ValueError(
                "Execute Step stopped: compatible upstream results missing: "
                + ", ".join(sorted(missing))
                + ". Execute the missing nodes separately or run the workflow once."
            )
    agent_tool_ids = {
        source_id
        for item in ordered if item["type"] == "ai.agent"
        for source_id, port in (item.get("settings", {}).get("__cliptora_ui_target_handles") or {}).items()
        if port == "tool" and source_id in by_node_id
        and by_node_id[source_id]["type"] == "browser.playwright"
    }
    main_consumers = {
        dep for item in ordered for dep in item["depends_on"]
        if (item.get("settings", {}).get("__cliptora_ui_target_handles") or {}).get(dep) != "tool"
    }

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

        # The controller has executed this body node once per item. Publish
        # the aggregated result here without running it a second time.
        if node_id in loop_membership:
            result = prepared_body_outputs.get(node_id)
            if result is None:
                raise RuntimeError(
                    f"Loop body {node_id} was not produced by its controller "
                    f"{loop_membership[node_id]}"
                )
            outputs[node_id] = result
            artifact = workspace / f"{node_id}.json"
            temporary = workspace / f".{node_id}.loop.tmp"
            temporary.write_text(json.dumps(result, ensure_ascii=False, allow_nan=False), encoding="utf-8")
            temporary.replace(artifact)
            summary[node_id] = {
                "state": "completed", "type": node_type, "stage": "completed",
                "message": f"Executed in loop {loop_membership[node_id]}",
                "cached": False, "progress": 100, "artifact": True,
                "item_execution": result.get("item_execution", {}),
                "collections": describe_collections(result),
            }
            update(int(100 * (index + 1) / total_nodes), node_id, summary)
            continue

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

        # A Browser attached solely to an Agent Tool port is a declarative
        # capability, not an independent browser run. The Agent owns one live
        # session across all of its iterations. Other main-flow Browser nodes
        # retain their existing standalone behavior.
        if node_id in agent_tool_ids and node_id not in main_consumers:
            outputs[node_id] = {"agent_tool": "browser.playwright", "configured": True}
            summary[node_id] = {"state": "completed", "type": node_type, "tool_ready": True,
                                "result": outputs[node_id]}
            update(int(100 * (index + 1) / total_nodes), node_id, summary)
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

        # Explicit Execute Step means "reuse saved results" even if an upstream
        # node has caching disabled for normal full-workflow runs. It does NOT
        # override the selected target: the target is always executed fresh.
        upstream_step = step_target is not None and node_id != step_target
        allow_cache = (upstream_step or node.get("cache", True)) and (
            node_type != "ai.agent" or upstream_step
        )
        reused_node = (
            (reused or {}).get(node_id)
            if allow_cache
            else None
        )

        if reused_node is not None:
            result = reused_node["result"]
            cached = True

            artifact.write_text(
                json.dumps(
                    result,
                    ensure_ascii=False,
                    allow_nan=False,
                ),
                encoding="utf-8",
            )

            checkpoint.write_text(
                fingerprint,
                encoding="ascii",
            )

            logger.info(
                "Reused completed upstream output | "
                "node_id=%s | previous_run_id=%s",
                node_id,
                reused_node["run_id"],
            )

        if (
            result is None and
            allow_cache
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

        node_progress_callback = None

        if result is None:
            last_emit_time = 0.0
            latest_status: dict = {}

            def node_progress_callback(event: dict) -> None:
                nonlocal last_emit_time, latest_status

                if not isinstance(event, dict):
                    return

                previous = latest_status

                stage = str(
                    event.get("stage") or "processing"
                )[:64]

                message = str(
                    event.get("message") or ""
                )[:200]

                raw_percent = event.get(
                    "progress",
                    event.get("percent"),
                )

                percent = previous.get("progress")

                if raw_percent is not None:
                    try:
                        value = float(raw_percent)

                        if math.isfinite(value):
                            percent = round(
                                max(0.0, min(99.0, value)),
                                2,
                            )
                    except (TypeError, ValueError):
                        pass

                status = {
                    **previous,
                    "state": "running",
                    "type": node_type,
                    "stage": stage,
                    "message": message,
                    "progress": percent,
                    "started_at": node_started_at,
                    "elapsed_seconds": round(
                        time.monotonic() - node_started_clock,
                        2,
                    ),
                }

                for field in (
                    "processed",
                    "total",
                    "processed_seconds",
                    "total_seconds",
                    "words_processed",
                    "segments_processed",
                    "frames_processed",
                    "requests_processed",
                    "eta_seconds",
                    "speed",
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

                if isinstance(event.get("unit"), str):
                    status["unit"] = event["unit"][:24]

                latest_status = status

                now = time.monotonic()

                important = (
                    stage != summary.get(node_id, {}).get("stage")
                    or bool(event.get("force"))
                )

                if (
                    not important
                    and now - last_emit_time < 1.0
                ):
                    return

                last_emit_time = now

                summary[node_id] = status

                fraction = (percent or 0) / 100.0

                overall = int(
                    100 * (index + fraction) / total_nodes
                )

                update(
                    overall,
                    node_id,
                    summary,
                )

            node_progress_callback({
                "stage": "starting",
                "message": "Starting node execution...",
            })

        # Replaying an agent browser session can repeat external actions.
        effective_retry_limit = 0 if node_type == "ai.agent" or node_type in CONTROLLERS else node.get("retry_limit", 1)
        attempts = 0
        last_error: Exception | None = None

        while (
            result is None
            and attempts <= effective_retry_limit
        ):

            if cancelled():
                summary[node_id] = {
                    **summary.get(node_id, {}),
                    "state": "cancelled",
                    "stage": "cancelled",
                    "elapsed_seconds": round(
                        time.monotonic() - node_started_clock,
                        2,
                    ),
                    "finished_at": datetime.now(
                        timezone.utc
                    ).isoformat(),
                }

                return {
                    "status": "cancelled",
                    "nodes": summary,
                }

            attempts += 1

            if attempts > 1 and node_progress_callback:
                node_progress_callback({
                    "stage": "retrying",
                    "message": (
                        f"Retrying node (attempt {attempts})"
                    ),
                })

            try:
                execution_node = {
                    **node,
                    "_progress_callback": node_progress_callback,
                    "_cancelled_callback": cancelled,
                }
                if node_type == "ai.agent":
                    typed = node.get("settings", {}).get("__cliptora_ui_target_handles") or {}
                    execution_node["_agent_tool_specs"] = {
                        source_id: by_node_id[source_id]
                        for source_id, port in typed.items()
                        if port == "tool" and source_id in by_node_id
                    }

                mode = execution_settings(
                    node.get("settings") or {}, node_type, node["depends_on"]
                )["mode"]
                with bind_for_node(execution_node):
                    if node_type in CONTROLLERS:
                        candidate, body_outputs = run_loop_controller(
                            execution_node, ordered, outputs, source, workspace,
                            cancelled, node_progress_callback,
                        )
                        prepared_body_outputs.update(body_outputs)
                    elif mode == "once":
                        candidate = node_executor(node_type)(
                            execution_node, deps, source, workspace,
                        )
                    else:
                        def invoke_item(item_node: dict, item_deps: dict) -> dict:
                            return node_executor(node_type)(
                                item_node, item_deps, source, workspace,
                            )

                        candidate = run_item_execution(
                            execution_node, deps, source, workspace,
                            invoke_item, cancelled, node_progress_callback,
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

                # Log each failed attempt immediately.
                # Includes the original Python traceback.
                # Never log the full node configuration,
                # dependency outputs or credentials.
                logger.exception(
                    "Workflow node attempt failed | "
                    "node_id=%s | "
                    "node_type=%s | "
                    "attempt=%s | "
                    "retry_limit=%s | "
                    "error_type=%s | "
                    "error=%s",
                    node_id,
                    node_type,
                    attempts,
                    node.get("retry_limit", 1),
                    type(exc).__name__,
                    str(exc),
                )

        if result is None:
            error = (
                f"Node {node_id} failed after "
                f"{attempts} attempt(s): {last_error}"
            )

            # Final failure summary. The full traceback
            # has already been logged for every attempt.
            logger.error(
                "Workflow node permanently failed | "
                "node_id=%s | "
                "node_type=%s | "
                "attempts=%s | "
                "elapsed_seconds=%.2f | "
                "error=%s",
                node_id,
                node_type,
                attempts,
                time.monotonic() - node_started_clock,
                error,
            )

            summary[node_id] = {
                **summary.get(node_id, {}),
                "state": "failed",
                "type": node_type,
                "stage": "failed",
                "message": "Execution failed",
                "error": error[:500],
                "started_at": node_started_at,
                "finished_at": datetime.now(
                    timezone.utc
                ).isoformat(),
                "elapsed_seconds": round(
                    time.monotonic() - node_started_clock,
                    2,
                ),
            }

            update(
                int(100 * index / total_nodes),
                node_id,
                summary,
            )

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
        if node_type in CONTROLLERS:
            stored = result.get("body_outputs")
            if not isinstance(stored, dict):
                raise ValueError(f"Loop {node_id} must expose aggregated body_outputs")
            prepared_body_outputs.update(stored)

        previous_progress = summary.get(
            node_id,
            {},
        )

        public = {
            "state": "completed",
            "type": node_type,
            "stage": "completed",
            "message": (
                "Finished (cached)"
                if cached
                else "Execution completed"
            ),
            "progress": 100,
            "started_at": node_started_at,
            "finished_at": datetime.now(
                timezone.utc
            ).isoformat(),
            "elapsed_seconds": round(
                time.monotonic() - node_started_clock,
                2,
            ),
            "artifact": True,
            "cached": cached,
            "attempts": attempts,
        }

        if reused_node is not None:
            public["reused_from_run_id"] = reused_node["run_id"]

        for metric in (
            "processed",
            "total",
            "processed_seconds",
            "total_seconds",
            "words_processed",
            "segments_processed",
            "frames_processed",
            "requests_processed",
            "eta_seconds",
            "speed",
            "unit",
        ):
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

        # Arrays in a node output are Elements, not execution iterations.
        # Report both separately for Workflow Runs and the UI data picker.
        public["collections"] = describe_collections(result)
        if isinstance(result.get("item_execution"), dict):
            public["item_execution"] = result["item_execution"]
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
        
def _safe_type_discovery(value: dict) -> dict:
    """Discover run-output structure without changing node execution semantics."""
    try:
        from app.workflows.TypeEngine import describe

        info = describe(value)

        if len(json.dumps(info, ensure_ascii=False)) <= 64_000:
            return info

        return {
            "version": 1,
            "schema_id": info["schema_id"],
            "collections": info["collections"],
            "schema_truncated": True,
        }

    except (TypeError, ValueError, RecursionError):
        return {
            "version": 1,
            "schema_skipped": True,
        }