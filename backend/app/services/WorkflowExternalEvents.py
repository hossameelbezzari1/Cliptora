
"""Verified external event -> persisted CLIPTORA WorkflowRun.

The saved workflow definition is never mutated. The event is injected into the
per-run JSON snapshot, which is executed by the existing workflow worker.
"""
from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import (
    Clip, MediaAsset, Project, Track, WorkflowDefinition, WorkflowRun,
    WorkflowSource,
)
from app.workflows.MediaStorage import project_media_dir, run_media_dir
from app.workflows.SourceSelection import SOURCE_NODE_TYPES
from app.workflows.Validation import validate_workflow

ACTIVE = ("queued", "running", "cancelling")
TRIGGERS = {
    "timeline": "core.timeline_trigger",
    "telegram": "core.telegram_trigger",
}


def launch_external_event(
    db: Session,
    *,
    workflow_id: int,
    origin: str,
    event: dict[str, Any],
    user_id: int | None = None,
    project_id: int | None = None,
    media_id: int | None = None,
) -> WorkflowRun:
    """Create one queued run, transactionally checking workflow concurrency.

    Caller must enqueue the committed row through WorkflowService.enqueue_run
    (or Celery) after this returns. No arbitrary filesystem path is accepted.
    """
    if origin not in TRIGGERS:
        raise HTTPException(422, "Unsupported external trigger")

    # Serializes concurrent launches made through this dispatcher per workflow.
    definition = db.scalar(
        select(WorkflowDefinition)
        .where(WorkflowDefinition.id == workflow_id)
        .with_for_update()
    )
    if definition is None:
        raise HTTPException(404, "Workflow not found")
    if user_id is not None and definition.user_id != user_id:
        raise HTTPException(404, "Workflow not found")
    if project_id is not None and definition.project_id != project_id:
        raise HTTPException(404, "Workflow does not belong to this project")

    active = db.scalar(
        select(WorkflowRun.id).where(
            WorkflowRun.workflow_id == workflow_id,
            WorkflowRun.state.in_(ACTIVE),
        ).limit(1)
    )
    if active is not None:
        raise HTTPException(409, f"Workflow already has active run #{active}")

    try:
        nodes = validate_workflow(json.loads(definition.nodes_json))
    except (ValueError, TypeError, json.JSONDecodeError) as exc:
        raise HTTPException(422, f"Invalid workflow: {exc}") from exc

    trigger_type = TRIGGERS[origin]
    roots = [node for node in nodes if node["type"] == trigger_type]
    if len(roots) != 1 or roots[0]["depends_on"]:
        raise HTTPException(422, f"Workflow needs exactly one root {trigger_type} node")
    root = roots[0]
    if (root.get("settings") or {}).get("enabled") is not True:
        raise HTTPException(422, f"{origin} trigger is disabled")

    selected_source_id: int | None = None
    if origin == "timeline":
        if type(media_id) is not int or media_id < 1:
            raise HTTPException(422, "Timeline requires a valid source media_id")
        asset = db.scalar(select(MediaAsset).where(
            MediaAsset.id == media_id,
            MediaAsset.project_id == definition.project_id,
        ))
        if asset is None or (asset.kind != "video" and not str(asset.mime).startswith("video/")):
            raise HTTPException(422, "Choose a video in the same CLIPTORA project")
        safe_base = project_media_dir(definition.user_id, definition.project_id).resolve()
        source_path = Path(asset.disk_path).resolve()
        if (not source_path.is_relative_to(safe_base)
                or not source_path.is_file() or source_path.stat().st_size < 1):
            raise HTTPException(422, "Selected project video is not accessible")
        existing = db.scalar(select(WorkflowSource).where(
            WorkflowSource.user_id == definition.user_id,
            WorkflowSource.project_id == definition.project_id,
            WorkflowSource.media_id == media_id,
        ).order_by(WorkflowSource.id.desc()).limit(1))
        if existing is None:
            existing = WorkflowSource(
                user_id=definition.user_id,
                project_id=definition.project_id,
                media_id=media_id,
                filename=asset.name[:200],
                stored_name=source_path.name[:80],
                size_bytes=source_path.stat().st_size,
            )
            db.add(existing)
            db.flush()
        selected_source_id = existing.id

        # Video-consuming nodes read `source` from run.source_id, not a
        # filesystem path in arbitrary JSON settings. Override old picker
        # selections only in this run, never in the saved definition.
        for node in nodes:
            if node["type"] in SOURCE_NODE_TYPES:
                node["settings"] = {**node["settings"], "source_id": selected_source_id}

    # Remove any old event snapshots before adding the new trusted event.
    for node in nodes:
        node["settings"].pop("__cliptora_trigger_event", None)
    event = dict(event)
    event["origin"] = origin
    if origin == "timeline":
        event["media_id"] = media_id
        event["source_id"] = selected_source_id
    root["settings"]["__cliptora_trigger_event"] = event
    root["cache"] = False
    root["retry_limit"] = 0
    # Enforce the normal workflow schema on the generated run snapshot.
    nodes = validate_workflow(nodes)

    run = WorkflowRun(
        user_id=definition.user_id,
        project_id=definition.project_id,
        workflow_id=definition.id,
        source_id=selected_source_id,
        workflow_json=json.dumps(nodes, ensure_ascii=False),
        results_json="{}",
        state="queued",
    )
    db.add(run)
    db.commit()
    db.refresh(run)
    return run


def timeline_render_result(db: Session, run: WorkflowRun) -> dict[str, Any] | None:
    """Return verified rendered video metadata without changing the editor.

    Frontend can use this to refresh a linked Empty Element on completion.
    """
    try:
        nodes = json.loads(run.workflow_json)
    except (ValueError, TypeError):
        return None
    root = next((n for n in nodes if n.get("type") == "core.timeline_trigger"), None)
    event = (root or {}).get("settings", {}).get("__cliptora_trigger_event")
    if not isinstance(event, dict) or event.get("origin") != "timeline":
        return None
    response: dict[str, Any] = {
        "run_id": run.id,
        "workflow_id": run.workflow_id,
        "status": run.state,
        "target_clip_client_id": event.get("target_clip_client_id"),
        "media_id": None,
        "duration": None,
    }
    if run.state != "completed":
        return response

    from app.services.WorkflowService import project_dir
    workspace = project_dir(run.user_id, run.project_id) / "runs" / str(run.id)
    output_base = run_media_dir(workspace).resolve()
    for node in reversed(nodes):
        if node.get("type") not in {"video.remix_render", "video.render"}:
            continue
        artifact = workspace / f"{node['id']}.json"
        if not artifact.is_file():
            continue
        try:
            data = json.loads(artifact.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue
        details = data.get("render") or {}
        path_str = details.get("video_path") or data.get("video_path")
        if not isinstance(path_str, str) or not path_str:
            continue
        path = Path(path_str).resolve()
        if (not path.is_relative_to(output_base) or path.suffix.lower() != ".mp4"
                or not path.is_file() or path.stat().st_size == 0):
            continue
        media = db.scalar(select(MediaAsset).where(
            MediaAsset.project_id == run.project_id,
            MediaAsset.disk_path == str(path),
        ).order_by(MediaAsset.id.desc()).limit(1))
        if media is None:
            # The normal process_run() media indexer may still be running;
            # create a project-owned entry if it hasn't indexed this file yet.
            media = MediaAsset(
                project_id=run.project_id,
                name=path.name,
                kind="video",
                mime="video/mp4",
                disk_path=str(path),
                size_bytes=path.stat().st_size,
            )
            db.add(media)
            db.commit()
            db.refresh(media)
        response.update({
            "media_id": media.id,
            "duration": details.get("duration"),
            "filename": path.name,
        })
        break
    return response


def publish_timeline_render(run_id: int) -> dict[str, Any] | None:
    """Update an existing linked editor clip, if the target exists in DB.

    This is optional: some frontend Empty Elements are not DB Clip rows.
    If not found, timeline_render_result() still exposes the rendered media_id.
    """
    from app.core.Database import SessionLocal
    with SessionLocal() as db:
        run = db.get(WorkflowRun, run_id)
        if run is None or run.state != "completed":
            return None
        result = timeline_render_result(db, run)
        if not result or type(result.get("media_id")) is not int:
            return result
        target_id = result.get("target_clip_client_id")
        if not isinstance(target_id, str) or not re.fullmatch(r"[A-Za-z0-9_-]{1,120}", target_id):
            return result
        clip = db.scalar(
            select(Clip).join(Track, Clip.track_id == Track.id).where(
                Track.project_id == run.project_id,
                Clip.client_id == target_id,
            ).with_for_update()
        )
        if clip is None:
            return result
        # Do not overwrite a different clip if it has since been edited.
        props = json.loads(clip.properties_json or "{}")
        if props.get("workflow_id") not in (None, run.workflow_id):
            return result
        clip.media_id = result["media_id"]
        clip.type = "video"
        clip.name = "Workflow output"
        duration = result.get("duration")
        if isinstance(duration, (int, float)) and 0 < duration <= 14400:
            clip.duration = float(duration)
        props.update({"workflow_id": run.workflow_id, "workflow_run_id": run.id})
        clip.properties_json = json.dumps(props, ensure_ascii=False)
        project = db.get(Project, run.project_id)
        if project is not None:
            project.revision += 1
        db.commit()
        result["updated_clip_client_id"] = target_id
        return result
