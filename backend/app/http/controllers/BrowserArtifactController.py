"""Authenticated Browser workflow screenshots/downloads, stored under media root."""
from __future__ import annotations

import mimetypes
import re
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.Database import get_db
from app.core.Security import current_user
from app.models import WorkflowRun, User
from app.workflows.MediaStorage import project_media_dir

router = APIRouter(prefix="/workflows", tags=["Browser Artifacts"])


@router.get("/{project_id}/runs/{run_id}/browser-artifacts/{filename}")
def browser_artifact(
    project_id: int,
    run_id: int,
    filename: str,
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
):
    if not re.fullmatch(r"[a-zA-Z0-9_.-]{1,120}", filename) or filename.startswith("."):
        raise HTTPException(404, "Browser artifact not found")
    item = db.scalar(select(WorkflowRun).where(
        WorkflowRun.id == run_id,
        WorkflowRun.project_id == project_id,
        WorkflowRun.user_id == user.id,
    ))
    if item is None:
        raise HTTPException(404, "Workflow run not found")
    folder = (project_media_dir(user.id, project_id) / "workflow-runs" / str(run_id) / "browser").resolve()
    file = (folder / filename).resolve()
    if file.parent != folder or not file.is_file():
        raise HTTPException(404, "Browser artifact not found")
    mime = mimetypes.guess_type(filename)[0] or "application/octet-stream"
    # Never let downloaded HTML/SVG execute as same-origin active content.
    inline = mime == "image/png" and filename.lower().endswith(".png")
    return FileResponse(
        path=file,
        media_type="image/png" if inline else "application/octet-stream",
        filename=None if inline else filename,
        content_disposition_type="inline" if inline else "attachment",
        headers={"X-Content-Type-Options": "nosniff", "Cache-Control": "private, no-store"},
    )
