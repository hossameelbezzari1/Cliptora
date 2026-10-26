"""Server-side n8n integration and CLIPTORA custom-node tool endpoints.

The browser never receives the n8n API key. CLIPTORA stores only its own link
metadata; n8n remains the source of truth for workflow nodes and credentials.
"""
from __future__ import annotations

import hmac
import hashlib
import base64
import json
import secrets
import subprocess
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from threading import Lock
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import Request, urlopen

from fastapi import APIRouter, BackgroundTasks, Depends, Header, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import DateTime, ForeignKey, Integer, String, Text, UniqueConstraint, inspect, select, text
from sqlalchemy.orm import Mapped, Session, mapped_column

from app.core.config import settings
from app.core.database import Base, SessionLocal, engine, get_db
from app.core.security import current_user
from app.models import Clip, MediaAsset, Project, Track, User

router = APIRouter(prefix="/n8n", tags=["n8n Integration"])
_schema_lock = Lock()
_schema_ready = False


def now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


class N8nWorkflowLink(Base):
    __tablename__ = "n8n_workflow_links"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(Integer, index=True, nullable=False)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True, nullable=False)
    element_client_id: Mapped[str] = mapped_column(String(64), nullable=False)
    n8n_workflow_id: Mapped[str] = mapped_column(String(80), index=True, nullable=False)
    title: Mapped[str] = mapped_column(String(160), nullable=False)
    status: Mapped[str] = mapped_column(String(24), default="inactive", nullable=False)
    last_synced_at: Mapped[datetime] = mapped_column(DateTime, default=now, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=now, onupdate=now, nullable=False)
    __table_args__ = (UniqueConstraint("project_id", "element_client_id", name="uq_n8n_link_element"),)


class N8nToolJob(Base):
    __tablename__ = "n8n_tool_jobs"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True, nullable=False)
    operation: Mapped[str] = mapped_column(String(48), nullable=False)
    state: Mapped[str] = mapped_column(String(24), default="queued", nullable=False)
    input_json: Mapped[str] = mapped_column(Text, default="{}", nullable=False)
    result_json: Mapped[str] = mapped_column(Text, default="{}", nullable=False)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now, nullable=False)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


def ensure_schema() -> None:
    global _schema_ready
    if _schema_ready:
        return
    with _schema_lock:
        if _schema_ready:
            return
        try:
            tables = [N8nWorkflowLink.__table__, N8nToolJob.__table__]
            Base.metadata.create_all(bind=engine, tables=tables, checkfirst=True)
            if not all(inspect(engine).has_table(table.name) for table in tables):
                raise RuntimeError("n8n integration tables were not created")
        except Exception as exc:
            raise HTTPException(503, "n8n integration database is unavailable") from exc
        _schema_ready = True


def n8n_db(db: Session = Depends(get_db)) -> Session:
    ensure_schema()
    return db


def owned_project(db: Session, project_id: int, user_id: int) -> Project:
    project = db.scalar(select(Project).where(Project.id == project_id, Project.owner_id == user_id))
    if project is None:
        raise HTTPException(404, "Project not found")
    return project


def empty_element(db: Session, project_id: int, element_id: str) -> Clip:
    clip = db.scalar(
        select(Clip).join(Track, Clip.track_id == Track.id).where(
            Track.project_id == project_id,
            Clip.client_id == element_id,
        )
    )
    if clip is None:
        raise HTTPException(404, "The Empty Element no longer exists")
    props = json.loads(clip.properties_json or "{}")
    if not (props.get("empty_element") is True or props.get("shape_kind") == "Empty Element"):
        raise HTTPException(422, "Workflow links require an Empty Element")
    return clip


def n8n_request(method: str, path: str, payload: dict[str, Any] | None = None) -> Any:
    config = settings()
    api_key = config.effective_n8n_api_key
    if not api_key:
        raise HTTPException(503, "The Docker n8n API key is not ready; restart the n8n-bootstrap service")
    url = f"{config.n8n_base_url.rstrip('/')}/api/v1{path}"
    body = None if payload is None else json.dumps(payload).encode("utf-8")
    request = Request(url, data=body, method=method, headers={
        "Accept": "application/json",
        "Content-Type": "application/json",
        "X-N8N-API-KEY": api_key,
    })
    try:
        with urlopen(request, timeout=15) as response:
            raw = response.read()
            return json.loads(raw) if raw else None
    except HTTPError as exc:
        detail = exc.read().decode("utf-8", "replace")[:500]
        raise HTTPException(502, f"n8n API rejected the request ({exc.code}): {detail}") from exc
    except (URLError, TimeoutError, OSError) as exc:
        raise HTTPException(503, "n8n is unreachable. Start the n8n service and retry") from exc


def editor_path(n8n_id: str) -> str:
    return f"{settings().n8n_editor_path.rstrip('/')}/workflow/{quote(n8n_id, safe='')}"


def link_view(row: N8nWorkflowLink) -> dict[str, Any]:
    return {
        "id": row.id,
        "project_id": row.project_id,
        "element_client_id": row.element_client_id,
        "n8n_workflow_id": row.n8n_workflow_id,
        "title": row.title,
        "status": row.status,
        "last_synced_at": row.last_synced_at.isoformat(),
        "editor_path": editor_path(row.n8n_workflow_id),
    }


class CreateLink(BaseModel):
    element_client_id: str = Field(min_length=1, max_length=64)
    title: str = Field(default="CLIPTORA Workflow", min_length=2, max_length=160)


class EditorSessionRequest(BaseModel):
    editor_path: str = Field(pattern=r"^/n8n/(?:workflow/[A-Za-z0-9_-]+)?$")


def _base64url(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).decode("ascii").rstrip("=")


def create_editor_session_token(user_id: int, editor_path: str) -> str:
    secret = settings().cliptora_n8n_sso_secret.strip()
    if len(secret) < 32:
        raise HTTPException(503, "CLIPTORA n8n session bridge is not configured")
    payload = {
        "sub": str(user_id),
        "exp": int(time.time()) + 45,
        "jti": secrets.token_urlsafe(18),
        "next": editor_path,
    }
    encoded = _base64url(json.dumps(payload, separators=(",", ":"), sort_keys=True).encode("utf-8"))
    signature = _base64url(hmac.new(secret.encode("utf-8"), encoded.encode("ascii"), hashlib.sha256).digest())
    return f"{encoded}.{signature}"


@router.post("/editor-session")
def editor_session(body: EditorSessionRequest, user: User = Depends(current_user)):
    token = create_editor_session_token(user.id, body.editor_path)
    return {"url": f"/n8n/rest/cliptora-sso?token={quote(token, safe='')}"}


@router.get("/status")
def integration_status(user: User = Depends(current_user)):
    config = settings()
    configured = bool(config.effective_n8n_api_key)
    reachable = False
    try:
        with urlopen(f"{config.n8n_base_url.rstrip('/')}/healthz", timeout=2) as response:
            reachable = response.status < 400
    except (URLError, TimeoutError, OSError):
        pass
    return {
        "configured": configured,
        "reachable": reachable,
        "editor_path": f"{config.n8n_editor_path.rstrip('/')}/",
    }


@router.post("/projects/{project_id}/workflows", status_code=201)
def create_workflow_link(body: CreateLink, project_id: int, db: Session = Depends(n8n_db), user: User = Depends(current_user)):
    project = owned_project(db, project_id, user.id)
    empty_element(db, project_id, body.element_client_id)
    existing = db.scalar(select(N8nWorkflowLink).where(
        N8nWorkflowLink.project_id == project_id,
        N8nWorkflowLink.element_client_id == body.element_client_id,
    ))
    if existing:
        raise HTTPException(409, "This Empty Element already has a workflow")
    title = body.title.strip() or f"{project.name} Workflow"
    workflow = n8n_request("POST", "/workflows", {
        "name": title,
        "nodes": [{
            "parameters": {},
            "id": str(uuid.uuid4()),
            "name": "When clicking ‘Execute workflow’",
            "type": "n8n-nodes-base.manualTrigger",
            "typeVersion": 1,
            "position": [260, 300],
        }],
        "connections": {},
        "settings": {"executionOrder": "v1"},
    })
    n8n_id = str(workflow["id"])
    row = N8nWorkflowLink(
        user_id=user.id, project_id=project_id, element_client_id=body.element_client_id,
        n8n_workflow_id=n8n_id, title=str(workflow.get("name") or title)[:160],
        status="active" if workflow.get("active") else "inactive",
    )
    try:
        db.add(row)
        db.commit()
        db.refresh(row)
    except Exception:
        db.rollback()
        try:
            n8n_request("DELETE", f"/workflows/{quote(n8n_id, safe='')}")
        except HTTPException:
            pass
        raise
    return link_view(row)


def get_link(db: Session, project_id: int, link_id: int, user_id: int) -> N8nWorkflowLink:
    row = db.scalar(select(N8nWorkflowLink).where(
        N8nWorkflowLink.id == link_id,
        N8nWorkflowLink.project_id == project_id,
        N8nWorkflowLink.user_id == user_id,
    ))
    if row is None:
        raise HTTPException(404, "Linked workflow not found")
    return row


@router.get("/projects/{project_id}/workflows/{link_id}")
def workflow_link(project_id: int, link_id: int, db: Session = Depends(n8n_db), user: User = Depends(current_user)):
    owned_project(db, project_id, user.id)
    row = get_link(db, project_id, link_id, user.id)
    workflow = n8n_request("GET", f"/workflows/{quote(row.n8n_workflow_id, safe='')}")
    row.title = str(workflow.get("name") or row.title)[:160]
    row.status = "active" if workflow.get("active") else "inactive"
    row.last_synced_at = now()
    db.commit()
    return link_view(row)


@router.post("/projects/{project_id}/workflows/{link_id}/duplicate", status_code=201)
def duplicate_workflow_link(body: CreateLink, project_id: int, link_id: int, db: Session = Depends(n8n_db), user: User = Depends(current_user)):
    owned_project(db, project_id, user.id)
    empty_element(db, project_id, body.element_client_id)
    source_link = get_link(db, project_id, link_id, user.id)
    source = n8n_request("GET", f"/workflows/{quote(source_link.n8n_workflow_id, safe='')}")
    title = body.title.strip() or f"{source_link.title} (copy)"
    clone = n8n_request("POST", "/workflows", {
        "name": title[:160],
        "nodes": source.get("nodes", []),
        "connections": source.get("connections", {}),
        "settings": source.get("settings", {}),
        "staticData": source.get("staticData"),
    })
    # Keep the stable CLIPTORA link ID stored on the Timeline while replacing
    # its n8n target with the distinct clone. The original workflow remains in
    # n8n unchanged and credential values never pass through CLIPTORA.
    row = source_link
    row.n8n_workflow_id = str(clone["id"])
    row.title = str(clone.get("name") or title)[:160]
    row.status = "inactive"
    row.last_synced_at = now()
    row.updated_at = now()
    db.commit()
    db.refresh(row)
    return link_view(row)


@router.delete("/projects/{project_id}/workflows/{link_id}", status_code=204)
def delete_workflow_link(
    project_id: int,
    link_id: int,
    delete_underlying: bool = Query(default=False),
    db: Session = Depends(n8n_db),
    user: User = Depends(current_user),
):
    owned_project(db, project_id, user.id)
    row = get_link(db, project_id, link_id, user.id)
    if delete_underlying:
        references = db.scalar(select(text("COUNT(*)")).select_from(N8nWorkflowLink).where(
            N8nWorkflowLink.n8n_workflow_id == row.n8n_workflow_id
        )) or 0
        if references > 1:
            raise HTTPException(409, "Other Timeline elements still reference this n8n workflow; unlink this element instead")
        n8n_request("DELETE", f"/workflows/{quote(row.n8n_workflow_id, safe='')}")
    db.delete(row)
    db.commit()


def service_token(authorization: str | None = Header(default=None)) -> None:
    expected = settings().cliptora_n8n_service_token.strip()
    supplied = authorization.removeprefix("Bearer ").strip() if authorization else ""
    if not expected:
        raise HTTPException(503, "CLIPTORA_N8N_SERVICE_TOKEN is not configured")
    if not supplied or not hmac.compare_digest(supplied, expected):
        raise HTTPException(401, "Invalid CLIPTORA service token")


@router.get("/tools/projects/{project_id}", dependencies=[Depends(service_token)])
def tool_get_project(project_id: int, db: Session = Depends(n8n_db)):
    project = db.get(Project, project_id)
    if project is None:
        raise HTTPException(404, "Project not found")
    return {"id": project.id, "name": project.name, "width": project.width, "height": project.height, "fps": project.fps, "revision": project.revision}


@router.get("/tools/projects/{project_id}/timeline", dependencies=[Depends(service_token)])
def tool_get_timeline(project_id: int, db: Session = Depends(n8n_db)):
    if db.get(Project, project_id) is None:
        raise HTTPException(404, "Project not found")
    tracks = db.scalars(select(Track).where(Track.project_id == project_id).order_by(Track.position)).all()
    return {
        "project_id": project_id,
        "tracks": [{
            "client_id": track.client_id,
            "name": track.name,
            "position": track.position,
            "clips": [{
                "client_id": clip.client_id, "name": clip.name, "type": clip.type,
                "start": clip.start, "duration": clip.duration, "media_id": clip.media_id,
            } for clip in db.scalars(select(Clip).where(Clip.track_id == track.id).order_by(Clip.start)).all()],
        } for track in tracks],
    }


class ExtractAudioBody(BaseModel):
    media_asset_id: int = Field(ge=1)


def tool_job_view(row: N8nToolJob) -> dict[str, Any]:
    return {
        "job_id": row.id,
        "project_id": row.project_id,
        "operation": row.operation,
        "state": row.state,
        "result": json.loads(row.result_json or "{}"),
        "error": row.error,
        "created_at": row.created_at.isoformat(),
        "finished_at": row.finished_at.isoformat() if row.finished_at else None,
    }


def extract_audio_job(job_id: int) -> None:
    db = SessionLocal()
    target: Path | None = None
    try:
        row = db.get(N8nToolJob, job_id)
        if row is None or row.state != "queued":
            return
        row.state = "running"
        db.commit()
        payload = json.loads(row.input_json)
        source = db.scalar(select(MediaAsset).where(
            MediaAsset.id == payload["media_asset_id"],
            MediaAsset.project_id == row.project_id,
            MediaAsset.kind == "video",
        ))
        if source is None or not Path(source.disk_path).is_file():
            raise RuntimeError("Source video is missing")
        folder = settings().storage_path / "media" / str(payload["owner_id"]) / str(row.project_id)
        folder.mkdir(parents=True, exist_ok=True)
        target = folder / f"{uuid.uuid4().hex}.wav"
        subprocess.run([
            "ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error", "-y",
            "-i", source.disk_path, "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", str(target),
        ], check=True, timeout=5400, capture_output=True)
        asset = MediaAsset(
            project_id=row.project_id,
            name=f"{Path(source.name).stem} - extracted audio.wav"[:255],
            kind="audio", mime="audio/wav", disk_path=str(target), size_bytes=target.stat().st_size,
        )
        db.add(asset)
        db.flush()
        row.state = "completed"
        row.result_json = json.dumps({"media_asset_id": asset.id, "name": asset.name, "size_bytes": asset.size_bytes})
        row.finished_at = now()
        db.commit()
    except Exception as exc:
        db.rollback()
        row = db.get(N8nToolJob, job_id)
        if row:
            row.state = "failed"
            row.error = str(exc)[:1500]
            row.finished_at = now()
            db.commit()
        if target:
            target.unlink(missing_ok=True)
    finally:
        db.close()


@router.post("/tools/projects/{project_id}/jobs/extract-audio", status_code=202, dependencies=[Depends(service_token)])
def tool_extract_audio(project_id: int, body: ExtractAudioBody, background: BackgroundTasks, db: Session = Depends(n8n_db)):
    project = db.get(Project, project_id)
    if project is None:
        raise HTTPException(404, "Project not found")
    source = db.scalar(select(MediaAsset).where(MediaAsset.id == body.media_asset_id, MediaAsset.project_id == project_id, MediaAsset.kind == "video"))
    if source is None:
        raise HTTPException(404, "Video media asset not found")
    row = N8nToolJob(project_id=project_id, operation="extract_audio", input_json=json.dumps({
        "media_asset_id": source.id,
        "owner_id": project.owner_id,
    }))
    db.add(row)
    db.commit()
    db.refresh(row)
    background.add_task(extract_audio_job, row.id)
    return tool_job_view(row)


@router.get("/tools/jobs/{job_id}", dependencies=[Depends(service_token)])
def tool_job_status(job_id: int, db: Session = Depends(n8n_db)):
    row = db.get(N8nToolJob, job_id)
    if row is None:
        raise HTTPException(404, "Job not found")
    return tool_job_view(row)
