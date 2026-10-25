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
import uuid
from datetime import datetime, timezone
from pathlib import Path
from threading import Lock
from typing import Any

from fastapi import APIRouter, BackgroundTasks, Depends, File, HTTPException, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from sqlalchemy import BigInteger, DateTime, Integer, String, Text, inspect, select, text
from sqlalchemy.dialects.mysql import LONGTEXT
from sqlalchemy.orm import Mapped, Session, mapped_column

from app.core.database import Base, SessionLocal, engine, get_db
from app.core.security import current_user
from app.models import User
from app.services.workflow_core import NODE_TYPES, preset_templates, run_graph, validate_workflow

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
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=now, onupdate=now)


class WorkflowSource(Base):
    __tablename__ = "workflow_sources"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(Integer, index=True, nullable=False)
    project_id: Mapped[int] = mapped_column(Integer, index=True, nullable=False)
    filename: Mapped[str] = mapped_column(String(200), nullable=False)
    stored_name: Mapped[str] = mapped_column(String(80), nullable=False)
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


def ensure_schema() -> None:
    global _schema_ready
    if _schema_ready:
        return
    with _schema_lock:
        if _schema_ready:
            return
        try:
            tables = [WorkflowDefinition.__table__, WorkflowSource.__table__, WorkflowRun.__table__]
            Base.metadata.create_all(bind=engine, tables=tables, checkfirst=True)
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
    found = db.execute(text("SELECT id FROM projects WHERE id=:p AND user_id=:u"), {"p": project_id, "u": user_id}).first()
    if found is None:
        raise HTTPException(404, "Project not found")


def owner(db: Session, model: Any, identifier: int, user_id: int, project_id: int):
    row = db.scalar(select(model).where(model.id == identifier, model.user_id == user_id, model.project_id == project_id))
    if row is None:
        raise HTTPException(404, "Item not found")
    return row


def view_definition(row: WorkflowDefinition) -> dict:
    return {"id": row.id, "name": row.name, "nodes": json.loads(row.nodes_json), "updated_at": row.updated_at.isoformat() if row.updated_at else None}


def view_source(row: WorkflowSource) -> dict:
    return {"id": row.id, "filename": row.filename, "size_bytes": row.size_bytes, "created_at": row.created_at.isoformat() if row.created_at else None}


def view_run(row: WorkflowRun) -> dict:
    return {"id": row.id, "workflow_id": row.workflow_id, "source_id": row.source_id, "state": row.state, "progress": row.progress, "current_node": row.current_node,
            "results": json.loads(row.results_json or "{}"), "error": row.error, "created_at": row.created_at.isoformat() if row.created_at else None}


class DefinitionBody(BaseModel):
    name: str = Field(min_length=2, max_length=160)
    nodes: list[dict[str, Any]]


class StartRun(BaseModel):
    workflow_id: int = Field(ge=1)
    source_id: int | None = Field(default=None, ge=1)


@router.get("/catalog")
def catalog(user: User = Depends(current_user)):
    return [{"type": key, **value} for key, value in NODE_TYPES.items()]


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
    row.name, row.nodes_json, row.updated_at = body.name.strip(), json.dumps(nodes, ensure_ascii=False), now()
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
        from app.services.workflow_core import probe
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
    if body.source_id is not None:
        owner(db, WorkflowSource, body.source_id, user.id, project_id)
    nodes = json.loads(definition.nodes_json)
    if body.source_id is None and any(node["type"] in ("media.probe", "audio.extract", "video.render") and node.get("when") != "has_video" for node in nodes):
        raise HTTPException(422, "This workflow requires a source video. Upload/select one first")
    row = WorkflowRun(user_id=user.id, project_id=project_id, workflow_id=definition.id, source_id=body.source_id, workflow_json=definition.nodes_json, results_json="{}")
    db.add(row)
    db.commit()
    db.refresh(row)
    background.add_task(process_run, row.id)
    return view_run(row)


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
