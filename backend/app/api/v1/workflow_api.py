"""Authenticated, project-owned workflow definitions, media sources and runs.

Connect to app.main using:
 from app.api.v1.workflow_api import router as workflow_router
 app.include_router(workflow_router, prefix="/api/v1")

Tables are created explicitly *only for this module*, like CLIPTORA Commands.
For deployment, also see the SQL migration in backend/migrations.
"""
from __future__ import annotations

import json
import os
import re
import shutil
import uuid
from datetime import datetime, timezone
from pathlib import Path
from threading import Lock
from typing import Any

from fastapi import APIRouter, BackgroundTasks, Depends, File, HTTPException, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from sqlalchemy import BigInteger, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint, inspect, select, text
from sqlalchemy.dialects.mysql import LONGTEXT
from sqlalchemy.orm import Mapped, Session, mapped_column

from app.core.database import Base, SessionLocal, engine, get_db
from app.core.security import current_user
from app.models import MediaAsset, User
from app.services.workflow_core import execution_nodes, ollama_status as read_ollama_status, preset_templates, probe, run_graph, tool_catalog, validate_workflow

router = APIRouter(prefix="/workflows", tags=["Dynamic Workflows"])
_schema_lock = Lock()
_schema_ready = False


def now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def root_dir() -> Path:
    base = Path(os.environ.get("CLIPTORA_WORKFLOW_ROOT", str(Path(__file__).resolve().parents[3] / "storage" / "workflows")))
    return base.expanduser().resolve()


def project_dir(user_id: int, project_id: int) -> Path:
    folder = root_dir() / str(user_id) / str(project_id)
    folder.mkdir(parents=True, exist_ok=True)
    return folder


class WorkflowDefinition(Base):
    __tablename__ = "workflow_definitions"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(Integer, index=True, nullable=False)
    project_id: Mapped[int] = mapped_column(Integer, index=True, nullable=False)
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    nodes_json: Mapped[str] = mapped_column(Text().with_variant(LONGTEXT(), "mysql"), nullable=False)
    current_version: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=now, onupdate=now)


class WorkflowSource(Base):
    __tablename__ = "workflow_sources"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(Integer, index=True, nullable=False)
    project_id: Mapped[int] = mapped_column(Integer, index=True, nullable=False)
    filename: Mapped[str] = mapped_column(String(200), nullable=False)
    stored_name: Mapped[str] = mapped_column(String(80), nullable=False)
    media_id: Mapped[int | None] = mapped_column(ForeignKey("media_assets.id", ondelete="SET NULL"), nullable=True)
    size_bytes: Mapped[int] = mapped_column(BigInteger, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)


class WorkflowRun(Base):
    __tablename__ = "workflow_runs"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(Integer, index=True, nullable=False)
    project_id: Mapped[int] = mapped_column(Integer, index=True, nullable=False)
    workflow_id: Mapped[int] = mapped_column(Integer, nullable=False)
    source_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    workflow_json: Mapped[str] = mapped_column(Text().with_variant(LONGTEXT(), "mysql"), nullable=False)
    state: Mapped[str] = mapped_column(String(24), default="queued", nullable=False)
    progress: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    current_node: Mapped[str | None] = mapped_column(String(48), nullable=True)
    results_json: Mapped[str] = mapped_column(Text().with_variant(LONGTEXT(), "mysql"), default="{}")
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class WorkflowVersion(Base):
    __tablename__ = "workflow_versions"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    workflow_id: Mapped[int] = mapped_column(ForeignKey("workflow_definitions.id", ondelete="CASCADE"), index=True, nullable=False)
    user_id: Mapped[int] = mapped_column(Integer, index=True, nullable=False)
    project_id: Mapped[int] = mapped_column(Integer, index=True, nullable=False)
    version: Mapped[int] = mapped_column(Integer, nullable=False)
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    nodes_json: Mapped[str] = mapped_column(Text().with_variant(LONGTEXT(), "mysql"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)
    __table_args__ = (UniqueConstraint("workflow_id", "version", name="uq_workflow_version"),)


def ensure_schema() -> None:
    global _schema_ready
    if _schema_ready:
        return
    with _schema_lock:
        if _schema_ready:
            return
        try:
            tables = [WorkflowDefinition.__table__, WorkflowSource.__table__, WorkflowRun.__table__, WorkflowVersion.__table__]
            Base.metadata.create_all(bind=engine, tables=tables, checkfirst=True)
            columns = {column["name"] for column in inspect(engine).get_columns("workflow_definitions")}
            if "current_version" not in columns:
                with engine.begin() as connection:
                    connection.execute(text("ALTER TABLE workflow_definitions ADD COLUMN current_version INT NOT NULL DEFAULT 1"))
            source_columns = {column["name"] for column in inspect(engine).get_columns("workflow_sources")}
            if "media_id" not in source_columns:
                with engine.begin() as connection:
                    connection.execute(text("ALTER TABLE workflow_sources ADD COLUMN media_id INT NULL"))
            for table in tables:
                if not inspect(engine).has_table(table.name):
                    raise RuntimeError(f"Missing table {table.name}")
        except Exception as exc:
            raise HTTPException(status_code=503, detail="Workflow DB unavailable. Start MySQL and check DATABASE_URL / cliptora_v2") from exc
        _schema_ready = True


def wf_db(db: Session = Depends(get_db)) -> Session:
    ensure_schema()
    return db


def authorize(db: Session, project_id: int, user_id: int) -> None:
    found = db.execute(text("SELECT id FROM projects WHERE id=:p AND owner_id=:u"), {"p": project_id, "u": user_id}).first()
    if found is None:
        raise HTTPException(404, "Project not found")


def owner(db: Session, model: Any, identifier: int, user_id: int, project_id: int):
    row = db.scalar(select(model).where(model.id == identifier, model.user_id == user_id, model.project_id == project_id))
    if row is None:
        raise HTTPException(404, "Item not found")
    return row


def view_definition(row: WorkflowDefinition) -> dict:
    return {"id": row.id, "name": row.name, "nodes": json.loads(row.nodes_json), "version": row.current_version, "updated_at": row.updated_at.isoformat() if row.updated_at else None}


def snapshot(db: Session, row: WorkflowDefinition) -> None:
    db.add(WorkflowVersion(workflow_id=row.id, user_id=row.user_id, project_id=row.project_id,
                           version=row.current_version, name=row.name, nodes_json=row.nodes_json))


def view_source(row: WorkflowSource) -> dict:
    return {"id": row.id, "media_id": row.media_id, "filename": row.filename, "size_bytes": row.size_bytes, "created_at": row.created_at.isoformat() if row.created_at else None}


def view_run(row: WorkflowRun) -> dict:
    return {"id": row.id, "workflow_id": row.workflow_id, "source_id": row.source_id, "state": row.state, "progress": row.progress, "current_node": row.current_node,
            "results": json.loads(row.results_json or "{}"), "error": row.error, "created_at": row.created_at.isoformat() if row.created_at else None}


class DefinitionBody(BaseModel):
    name: str = Field(min_length=2, max_length=160)
    nodes: list[dict[str, Any]]


class StartRun(BaseModel):
    workflow_id: int = Field(ge=1)
    source_id: int | None = Field(default=None, ge=1)
    target_node_id: str | None = Field(default=None, pattern=r"^[A-Za-z][A-Za-z0-9_-]{0,47}$")


@router.get("/catalog")
def catalog(user: User = Depends(current_user)):
    return tool_catalog()


@router.get("/openai/status")
def openai_status(user: User = Depends(current_user)):
    """Expose credential readiness without ever returning the server-side secret."""
    return {"configured": bool(os.environ.get("OPENAI_API_KEY", "").strip()), "credential_source": "backend_environment"}


@router.get("/gemini/status")
def gemini_status(user: User = Depends(current_user)):
    """Expose Gemini credential readiness without ever returning the server-side secret."""
    return {"configured": bool(os.environ.get("GEMINI_API_KEY", "").strip()), "credential_source": "backend_environment"}


@router.get("/ollama/status")
def ollama_status(user: User = Depends(current_user)):
    """Report local Ollama reachability and installed model names without exposing secrets."""
    return read_ollama_status()


@router.get("/templates")
def templates(user: User = Depends(current_user)):
    return preset_templates()


@router.get("/{project_id}/definitions")
def definitions(project_id: int, db: Session = Depends(wf_db), user: User = Depends(current_user)):
    authorize(db, project_id, user.id)
    rows = db.scalars(select(WorkflowDefinition).where(WorkflowDefinition.user_id == user.id, WorkflowDefinition.project_id == project_id).order_by(WorkflowDefinition.id.desc())).all()
    return [view_definition(row) for row in rows]


@router.post("/{project_id}/definitions", status_code=201)
def create_definition(project_id: int, body: DefinitionBody, db: Session = Depends(wf_db), user: User = Depends(current_user)):
    authorize(db, project_id, user.id)
    try:
        nodes = validate_workflow(body.nodes)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    row = WorkflowDefinition(user_id=user.id, project_id=project_id, name=body.name.strip(), nodes_json=json.dumps(nodes, ensure_ascii=False))
    db.add(row)
    db.flush()
    snapshot(db, row)
    db.commit()
    db.refresh(row)
    return view_definition(row)


@router.put("/{project_id}/definitions/{definition_id}")
def update_definition(project_id: int, definition_id: int, body: DefinitionBody, db: Session = Depends(wf_db), user: User = Depends(current_user)):
    authorize(db, project_id, user.id)
    row = owner(db, WorkflowDefinition, definition_id, user.id, project_id)
    try:
        nodes = validate_workflow(body.nodes)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    next_json = json.dumps(nodes, ensure_ascii=False)
    if row.name == body.name.strip() and row.nodes_json == next_json:
        return view_definition(row)
    row.current_version += 1
    row.name, row.nodes_json, row.updated_at = body.name.strip(), next_json, now()
    snapshot(db, row)
    db.commit()
    return view_definition(row)


@router.post("/{project_id}/definitions/{definition_id}/duplicate", status_code=201)
def duplicate_definition(project_id: int, definition_id: int, db: Session = Depends(wf_db), user: User = Depends(current_user)):
    authorize(db, project_id, user.id)
    source = owner(db, WorkflowDefinition, definition_id, user.id, project_id)
    row = WorkflowDefinition(user_id=user.id, project_id=project_id,
                             name=f"{source.name} (copy)"[:160], nodes_json=source.nodes_json)
    db.add(row)
    db.flush()
    snapshot(db, row)
    db.commit()
    db.refresh(row)
    return view_definition(row)


@router.get("/{project_id}/definitions/{definition_id}/versions")
def definition_versions(project_id: int, definition_id: int, db: Session = Depends(wf_db), user: User = Depends(current_user)):
    authorize(db, project_id, user.id)
    owner(db, WorkflowDefinition, definition_id, user.id, project_id)
    rows = db.scalars(select(WorkflowVersion).where(
        WorkflowVersion.workflow_id == definition_id,
        WorkflowVersion.user_id == user.id,
        WorkflowVersion.project_id == project_id,
    ).order_by(WorkflowVersion.version.desc())).all()
    return [{"id": item.id, "version": item.version, "name": item.name,
             "nodes": json.loads(item.nodes_json), "created_at": item.created_at.isoformat()} for item in rows]


@router.post("/{project_id}/definitions/{definition_id}/versions/{version}/restore")
def restore_version(project_id: int, definition_id: int, version: int, db: Session = Depends(wf_db), user: User = Depends(current_user)):
    authorize(db, project_id, user.id)
    row = owner(db, WorkflowDefinition, definition_id, user.id, project_id)
    old = db.scalar(select(WorkflowVersion).where(
        WorkflowVersion.workflow_id == definition_id,
        WorkflowVersion.version == version,
        WorkflowVersion.user_id == user.id,
        WorkflowVersion.project_id == project_id,
    ))
    if old is None:
        raise HTTPException(404, "Workflow version not found")
    row.current_version += 1
    row.name, row.nodes_json, row.updated_at = old.name, old.nodes_json, now()
    snapshot(db, row)
    db.commit()
    return view_definition(row)


@router.delete("/{project_id}/definitions/{definition_id}", status_code=204)
def delete_definition(project_id: int, definition_id: int, db: Session = Depends(wf_db), user: User = Depends(current_user)):
    authorize(db, project_id, user.id)
    row = owner(db, WorkflowDefinition, definition_id, user.id, project_id)
    db.delete(row)
    db.commit()


@router.get("/{project_id}/sources")
def sources(project_id: int, db: Session = Depends(wf_db), user: User = Depends(current_user)):
    authorize(db, project_id, user.id)
    rows = db.scalars(select(WorkflowSource).where(WorkflowSource.user_id == user.id, WorkflowSource.project_id == project_id).order_by(WorkflowSource.id.desc())).all()
    return [view_source(row) for row in rows]


@router.post("/{project_id}/sources", status_code=201)
async def upload_source(project_id: int, file: UploadFile = File(...), db: Session = Depends(wf_db), user: User = Depends(current_user)):
    authorize(db, project_id, user.id)
    name = (file.filename or "video").replace("\\", "/").split("/")[-1][:190]
    ext = Path(name).suffix.lower()
    if ext not in (".mp4", ".mov", ".mkv", ".webm", ".m4v"):
        raise HTTPException(422, "Upload a video: MP4/MOV/MKV/WEBM/M4V")
    stored = f"{uuid.uuid4().hex}{ext}"
    location = project_dir(user.id, project_id) / "sources"
    location.mkdir(parents=True, exist_ok=True)
    path = location / stored
    limit = int(os.environ.get("CLIPTORA_WORKFLOW_MAX_UPLOAD_MB", "4096")) * 1024 * 1024
    amount = 0
    try:
        with path.open("wb") as handle:
            while chunk := await file.read(1024 * 1024):
                amount += len(chunk)
                if amount > limit:
                    raise HTTPException(413, "Video exceeds upload limit")
                handle.write(chunk)
        if amount < 1000:
            raise HTTPException(422, "Video file is empty or too small")
        # A mislabeled file cannot pass ffprobe. It is not interpreted as code.
        try:
            info = probe(path)
        except RuntimeError as exc:
            raise HTTPException(422, str(exc)[:250]) from exc
        if not info["width"] or not info["duration"]:
            raise HTTPException(422, "Could not detect a video stream")
        row = WorkflowSource(user_id=user.id, project_id=project_id, filename=name, stored_name=stored, size_bytes=amount)
        db.add(row)
        db.commit()
        db.refresh(row)
        return view_source(row)
    except Exception:
        path.unlink(missing_ok=True)
        raise
    finally:
        await file.close()


@router.post("/{project_id}/sources/from-media/{media_id}", status_code=201)
def source_from_media(project_id: int, media_id: int, db: Session = Depends(wf_db), user: User = Depends(current_user)):
    """Create a workflow source from the owned Media Library without another upload."""
    authorize(db, project_id, user.id)
    media = db.scalar(select(MediaAsset).where(MediaAsset.id == media_id, MediaAsset.project_id == project_id))
    if media is None or media.kind != "video":
        raise HTTPException(404, "Video media asset not found")
    origin = Path(media.disk_path).resolve()
    if not origin.is_file():
        raise HTTPException(404, "Media file is missing from storage")
    ext = origin.suffix.lower()
    stored = f"{uuid.uuid4().hex}{ext}"
    destination_dir = project_dir(user.id, project_id) / "sources"
    destination_dir.mkdir(parents=True, exist_ok=True)
    destination = destination_dir / stored
    try:
        try:
            os.link(origin, destination)
        except OSError:
            shutil.copy2(origin, destination)
        info = probe(destination)
        if not info["width"] or not info["duration"]:
            raise HTTPException(422, "Could not detect a video stream")
        row = WorkflowSource(user_id=user.id, project_id=project_id, media_id=media.id, filename=media.name[:200],
                             stored_name=stored, size_bytes=destination.stat().st_size)
        db.add(row)
        db.commit()
        db.refresh(row)
        return view_source(row)
    except Exception:
        destination.unlink(missing_ok=True)
        raise


def process_run(run_id: int) -> None:
    session = SessionLocal()
    try:
        row = session.get(WorkflowRun, run_id)
        if not row or row.state != "queued":
            return
        row.state = "running"
        session.commit()
        source = None
        if row.source_id is not None:
            item = owner(session, WorkflowSource, row.source_id, row.user_id, row.project_id)
            source = project_dir(row.user_id, row.project_id) / "sources" / item.stored_name
            if not source.is_file():
                raise RuntimeError("Source video disappeared from storage")
        workspace = project_dir(row.user_id, row.project_id) / "runs" / str(run_id)

        def update(progress: int, current: str, results: dict) -> None:
            session.refresh(row)
            if row.state == "cancelling":
                return
            row.progress = progress
            row.current_node = current
            row.results_json = json.dumps(results, ensure_ascii=False)
            session.commit()

        def cancelled() -> bool:
            session.refresh(row)
            return row.state == "cancelling"

        output = run_graph(json.loads(row.workflow_json), source, workspace, update, cancelled)
        session.refresh(row)
        row.state = output["status"]
        row.progress = 100 if row.state == "completed" else row.progress
        row.results_json = json.dumps(output["nodes"], ensure_ascii=False)
        row.finished_at = now()
        session.commit()
    except Exception as exc:
        session.rollback()
        row = session.get(WorkflowRun, run_id)
        if row:
            row.state = "failed"
            row.error = str(exc)[:1500]
            row.finished_at = now()
            session.commit()
    finally:
        session.close()


@router.post("/{project_id}/runs", status_code=202)
def start_run(project_id: int, body: StartRun, background: BackgroundTasks, db: Session = Depends(wf_db), user: User = Depends(current_user)):
    authorize(db, project_id, user.id)
    definition = owner(db, WorkflowDefinition, body.workflow_id, user.id, project_id)
    try:
        nodes = execution_nodes(json.loads(definition.nodes_json), body.target_node_id)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    node_source_ids = {
        node.get("settings", {}).get("source_id") for node in nodes
        if node.get("type") == "core.video_source" and node.get("settings", {}).get("source_id") is not None
    }
    if len(node_source_ids) > 1:
        raise HTTPException(422, "A workflow can use only one Source Video")
    node_source_id = next(iter(node_source_ids), None)
    if node_source_id is not None and (not isinstance(node_source_id, int) or node_source_id < 1):
        raise HTTPException(422, "Source Video has an invalid source")
    if body.source_id is not None and node_source_id is not None and body.source_id != node_source_id:
        raise HTTPException(422, "Run source does not match the Source Video node")
    source_id = node_source_id if node_source_id is not None else body.source_id
    if source_id is not None:
        owner(db, WorkflowSource, source_id, user.id, project_id)
    if source_id is None and any(node["type"] in ("core.video_source", "media.probe", "audio.extract", "video.render") and node.get("when") != "has_video" for node in nodes):
        raise HTTPException(422, "This workflow requires a source video. Upload/select one first")
    row = WorkflowRun(user_id=user.id, project_id=project_id, workflow_id=definition.id, source_id=source_id,
                      workflow_json=json.dumps(nodes, ensure_ascii=False), results_json="{}")
    db.add(row)
    db.commit()
    db.refresh(row)
    enqueue_run(row, background, db)
    return view_run(row)


def enqueue_run(row: WorkflowRun, background: BackgroundTasks, db: Session) -> None:
    if os.environ.get("WORKFLOW_QUEUE", "local").lower() == "celery":
        try:
            from app.workers.workflow_tasks import run_workflow
            run_workflow.delay(row.id)
        except Exception as exc:
            row.state = "failed"
            row.error = "Workflow queue is unavailable. Check Redis and the Celery worker."
            row.finished_at = now()
            db.commit()
            raise HTTPException(503, row.error) from exc
    else:
        background.add_task(process_run, row.id)


@router.get("/{project_id}/runs")
def runs(project_id: int, db: Session = Depends(wf_db), user: User = Depends(current_user)):
    authorize(db, project_id, user.id)
    items = db.scalars(select(WorkflowRun).where(WorkflowRun.project_id == project_id, WorkflowRun.user_id == user.id).order_by(WorkflowRun.id.desc()).limit(30)).all()
    return [view_run(row) for row in items]


@router.get("/{project_id}/runs/{run_id}")
def run_detail(project_id: int, run_id: int, db: Session = Depends(wf_db), user: User = Depends(current_user)):
    authorize(db, project_id, user.id)
    return view_run(owner(db, WorkflowRun, run_id, user.id, project_id))


@router.post("/{project_id}/runs/{run_id}/cancel")
def cancel_run(project_id: int, run_id: int, db: Session = Depends(wf_db), user: User = Depends(current_user)):
    authorize(db, project_id, user.id)
    row = owner(db, WorkflowRun, run_id, user.id, project_id)
    if row.state == "queued":
        row.state = "cancelled"
        row.finished_at = now()
        db.commit()
    elif row.state == "running":
        row.state = "cancelling"
        db.commit()
    return view_run(row)


@router.post("/{project_id}/runs/{run_id}/retry", status_code=202)
def retry_run(project_id: int, run_id: int, background: BackgroundTasks, db: Session = Depends(wf_db), user: User = Depends(current_user)):
    authorize(db, project_id, user.id)
    row = owner(db, WorkflowRun, run_id, user.id, project_id)
    if row.state not in ("failed", "cancelled"):
        raise HTTPException(409, "Only failed or cancelled runs can be retried")
    row.state = "queued"
    row.error = None
    row.finished_at = None
    row.current_node = None
    db.commit()
    enqueue_run(row, background, db)
    return view_run(row)


@router.get("/{project_id}/runs/{run_id}/artifacts/{node_id}")
def artifact(project_id: int, run_id: int, node_id: str, db: Session = Depends(wf_db), user: User = Depends(current_user)):
    authorize(db, project_id, user.id)
    owner(db, WorkflowRun, run_id, user.id, project_id)
    if not re.fullmatch(r"[A-Za-z][A-Za-z0-9_-]{0,47}", node_id):
        raise HTTPException(422, "Invalid node name")
    path = project_dir(user.id, project_id) / "runs" / str(run_id) / f"{node_id}.json"
    if not path.is_file():
        raise HTTPException(404, "Artifact is not available")
    return FileResponse(path, media_type="application/json", filename=f"{node_id}.json")


@router.get("/{project_id}/runs/{run_id}/video")
def rendered_video(project_id: int, run_id: int, db: Session = Depends(wf_db), user: User = Depends(current_user)):
    authorize(db, project_id, user.id)
    owner(db, WorkflowRun, run_id, user.id, project_id)
    path = project_dir(user.id, project_id) / "runs" / str(run_id) / "final.mp4"
    if not path.is_file():
        raise HTTPException(404, "Rendered video not available. Enable video.render in workflow")
    return FileResponse(path, media_type="video/mp4", filename=f"cliptora_run_{run_id}.mp4")
