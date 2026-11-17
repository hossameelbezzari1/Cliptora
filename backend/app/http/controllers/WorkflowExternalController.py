
"""Authenticated editor -> CLIPTORA Timeline Trigger dispatch.

Mount this router in app/http/Routes.py (see README). No public media URLs,
raw disk paths or Telegram tokens are accepted here.
"""
from __future__ import annotations

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.Security import current_user
from app.models import User, WorkflowRun
from app.services.WorkflowService import wf_db, enqueue_run, authorize
from app.services.WorkflowExternalEvents import (
    launch_external_event,
    timeline_render_result,
    publish_timeline_render,
)

router = APIRouter(prefix="/workflow-events", tags=["Workflow Triggers"])


class TimelineLaunchRequest(BaseModel):
    media_id: int = Field(gt=0)
    target_clip_client_id: str | None = Field(default=None, min_length=1, max_length=120)


@router.post("/projects/{project_id}/timeline/{workflow_id}", status_code=202)
def launch_from_timeline(
    project_id: int,
    workflow_id: int,
    body: TimelineLaunchRequest,
    background: BackgroundTasks,
    db: Session = Depends(wf_db),
    user: User = Depends(current_user),
):
    authorize(db, project_id, user.id)
    event = {"target_clip_client_id": body.target_clip_client_id}
    run = launch_external_event(
        db, workflow_id=workflow_id, origin="timeline",
        event=event, user_id=user.id, project_id=project_id,
        media_id=body.media_id,
    )
    enqueue_run(run, background, db)
    return {
        "run_id": run.id,
        "workflow_id": workflow_id,
        "state": run.state,
        "target_clip_client_id": body.target_clip_client_id,
    }


@router.get("/projects/{project_id}/timeline-runs/{run_id}")
def get_timeline_result(
    project_id: int,
    run_id: int,
    db: Session = Depends(wf_db),
    user: User = Depends(current_user),
):
    authorize(db, project_id, user.id)
    run = db.scalar(select(WorkflowRun).where(
        WorkflowRun.id == run_id,
        WorkflowRun.project_id == project_id,
        WorkflowRun.user_id == user.id,
    ))
    if run is None:
        raise HTTPException(404, "Run not found")
    result = timeline_render_result(db, run)
    if result is None:
        raise HTTPException(404, "This run was not launched by Timeline Trigger")
    return result


@router.post("/projects/{project_id}/timeline-runs/{run_id}/apply")
def apply_timeline_result(
    project_id: int,
    run_id: int,
    db: Session = Depends(wf_db),
    user: User = Depends(current_user),
):
    authorize(db, project_id, user.id)
    run = db.scalar(select(WorkflowRun).where(
        WorkflowRun.id == run_id,
        WorkflowRun.project_id == project_id,
        WorkflowRun.user_id == user.id,
    ))
    if run is None:
        raise HTTPException(404, "Run not found")
    if run.state != "completed":
        raise HTTPException(409, "Render is not complete")
    result = publish_timeline_render(run.id)
    if result is None:
        raise HTTPException(422, "No valid timeline render output")
    return result
