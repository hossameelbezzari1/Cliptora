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

@router.get("/{project_id}/runs/{run_id}/browser-preview")
def browser_preview(
    project_id: int,
    run_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
):
    """Polling endpoint for preview snapshots; no browser control capabilities."""
    import json
    import time

    item = db.scalar(select(WorkflowRun).where(
        WorkflowRun.id == run_id,
        WorkflowRun.project_id == project_id,
        WorkflowRun.user_id == user.id,
    ))
    if item is None:
        raise HTTPException(404, 'Workflow run not found')

    directory = (project_media_dir(user.id, project_id) / 'workflow-runs' / str(run_id) / 'browser').resolve()
    manifest = directory / '.live-preview.json'
    if not manifest.is_file():
        return {
            'available': False, 'status': item.state,
            'frames': [], 'message': 'No browser preview for this run',
        }

    try:
        if manifest.stat().st_size > 128_000:
            raise ValueError('Manifest exceeds limit')
        snapshot = json.loads(manifest.read_text(encoding='utf-8'))
        if not isinstance(snapshot, dict) or not isinstance(snapshot.get('frames'), list):
            raise ValueError('Invalid preview state')
    except (OSError, ValueError, TypeError) as exc:
        raise HTTPException(503, 'Browser preview temporarily unavailable') from exc

    base = f'/api/v1/workflows/{project_id}/runs/{run_id}/browser-artifacts'
    frames = []
    for frame in snapshot['frames'][-120:]:
        if not isinstance(frame, dict):
            continue
        filename = str(frame.get('file', ''))
        if not re.fullmatch(r'[A-Za-z0-9_-][A-Za-z0-9_.-]{0,119}\.png', filename):
            continue
        if not (directory / filename).is_file():
            continue
        frames.append({
            'url': f'{base}/{filename}',
            'label': str(frame.get('label', ''))[:90],
            'step': frame.get('step', 0),
            'timestamp': frame.get('timestamp', 0),
        })

    return {
        'available': True,
        'node_id': str(snapshot.get('node_id', ''))[:48],
        'provider': str(snapshot.get('provider', ''))[:32],
        'status': (item.state if item.state in ('failed', 'cancelled', 'completed') else snapshot.get('status', item.state)),
        'step': snapshot.get('step', 0),
        'total': snapshot.get('total', 0),
        'message': str(snapshot.get('message', ''))[:300],
        'url': str(snapshot.get('url', ''))[:2000],
        'updated_at': snapshot.get('updated_at', time.time()),
        'frames': frames,
    }
