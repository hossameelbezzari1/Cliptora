"""Authenticated, project-owned workflow definitions, media sources and runs.

Connect to app.main using:
 from app.http.controllers.WorkflowController import router as workflow_router
 app.include_router(workflow_router, prefix="/api/v1")

Tables are created explicitly and use shared SQLAlchemy metadata.
For deployment, review database/migrations.
"""

from __future__ import annotations

from app.workflows.SourceSelection import select_workflow_source_id
from app.workflows.MediaStorage import project_media_dir, run_media_dir

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

from app.core.Database import Base, SessionLocal, engine, get_db

from app.core.Security import current_user

from app.models import MediaAsset, User

from app.workflows.Validation import execution_nodes, validate_workflow
from app.workflows.Catalog import preset_templates, tool_catalog
from app.helpers.Media import probe
from app.workflows.Engine import run_graph
from app.workflows.Reuse import collect_reusable_outputs
from app.workflows.Credentials import execution_owner

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
    WorkflowRepository(db).authorize(project_id, user_id)


def owner(db: Session, model: Any, identifier: int, user_id: int, project_id: int):
    return WorkflowRepository(db).owned(model, identifier, user_id, project_id)


def view_definition(row):
    return WorkflowResource.definition(row)


def snapshot(db: Session, row: WorkflowDefinition) -> None:
    WorkflowRepository(db).snapshot(row)


def view_source(row):
    return WorkflowResource.source(row)


def view_run(row):
    return WorkflowResource.run(row)


def source_location(db: Session, row: WorkflowSource) -> Path:
    """Use Media Library first; support legacy workflow sources."""

    if row.media_id is not None:
        media = db.get(MediaAsset, row.media_id)

        if media is not None and media.project_id == row.project_id:
            candidate = Path(media.disk_path).resolve()
            owned = project_media_dir(
                row.user_id, row.project_id
            ).resolve()

            if candidate.is_relative_to(owned) and candidate.is_file():
                return candidate

    name = Path(str(row.stored_name)).name

    if not name or name != row.stored_name:
        raise FileNotFoundError("Invalid source filename")

    candidates = [
        project_media_dir(
            row.user_id, row.project_id
        ) / "workflow-sources" / name,
        root_dir()
        / str(row.user_id)
        / str(row.project_id)
        / "sources"
        / name,
    ]

    for path in candidates:
        if path.is_file():
            return path.resolve()

    raise FileNotFoundError(
        f"Workflow source #{row.id} is missing"
    )


def register_run_media(
    user_id: int,
    project_id: int,
    run_id: int
) -> None:
    """Register generated files in the existing Media Library."""

    import mimetypes

    folder = (
        project_media_dir(user_id, project_id)
        / "workflow-runs"
        / str(run_id)
    )

    if not folder.is_dir():
        return

    kinds = {
        ".mp4": "video",
        ".mov": "video",
        ".mkv": "video",
        ".webm": "video",
        ".m4v": "video",
        ".png": "image",
        ".jpg": "image",
        ".jpeg": "image",
        ".webp": "image",
        ".gif": "image",
        ".svg": "image",
        ".wav": "audio",
        ".mp3": "audio",
        ".m4a": "audio",
        ".flac": "audio",
        ".mka": "audio",
        ".ogg": "audio",
        ".aac": "audio",
    }

    with SessionLocal() as db:
        for path in folder.rglob("*"):
            if not path.is_file() or path.is_symlink():
                continue

            kind = kinds.get(path.suffix.lower())

            if kind is None:
                continue

            size = path.stat().st_size

            if not 0 < size <= 2147483647:
                continue

            absolute = str(path.resolve())

            existing = db.scalar(
                select(MediaAsset.id).where(
                    MediaAsset.project_id == project_id,
                    MediaAsset.disk_path == absolute
                )
            )

            if existing is not None:
                continue

            mime = (
                mimetypes.guess_type(path.name)[0]
                or "application/octet-stream"
            )

            db.add(
                MediaAsset(
                    project_id=project_id,
                    name=f"Workflow {run_id} - {path.name}"[:255],
                    kind=kind,
                    mime=mime,
                    disk_path=absolute,
                    size_bytes=size,
                    created_at=now(),
                )
            )

        db.commit()


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
            source = source_location(session, item)
        workspace = project_dir(row.user_id, row.project_id) / "runs" / str(run_id)

        previous_runs = session.scalars(
            select(WorkflowRun).where(
                WorkflowRun.user_id == row.user_id,
                WorkflowRun.project_id == row.project_id,
                WorkflowRun.workflow_id == row.workflow_id,
                WorkflowRun.source_id == row.source_id,
                WorkflowRun.id < row.id,
                WorkflowRun.state.in_((
                    "completed", "failed", "cancelled"
                )),
            ).order_by(
                WorkflowRun.id.desc()
            ).limit(50)
        ).all()

        reusable = collect_reusable_outputs(
            json.loads(row.workflow_json),
            previous_runs,
            workspace,
            row.source_id,
            source=source,
        )

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

        with execution_owner(row.user_id):
            output = run_graph(json.loads(row.workflow_json), source, workspace, update, cancelled, reusable)
        session.refresh(row)
        row.state = output["status"]
        row.progress = 100 if row.state == "completed" else row.progress
        row.results_json = json.dumps(output["nodes"], ensure_ascii=False)
        row.finished_at = now()
        session.commit()

        try:
            register_run_media(
                row.user_id,
                row.project_id,
                run_id
            )
        except Exception:
            import logging
            logging.getLogger(
                "cliptora.workflows.storage"
            ).exception(
                "Failed to index run %s media",
                run_id
            )
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

def enqueue_run(row: WorkflowRun, background: BackgroundTasks, db: Session) -> None:
    if os.environ.get("WORKFLOW_QUEUE", "local").lower() == "celery":
        try:
            from app.jobs.WorkflowTask import run_workflow
            run_workflow.delay(row.id)
        except Exception as exc:
            row.state = "failed"
            row.error = "Workflow queue is unavailable. Check Redis and the Celery worker."
            row.finished_at = now()
            db.commit()
            raise HTTPException(503, row.error) from exc
    else:
        from app.jobs.RunWorkflow import RunWorkflowJob
        background.add_task(RunWorkflowJob().execute, row.id)

from app.models import WorkflowDefinition, WorkflowSource, WorkflowRun, WorkflowVersion
from app.http.requests.WorkflowRequest import DefinitionBody, StartRun
from app.repositories.WorkflowRepository import WorkflowRepository


class WorkflowService:
    def _credential_status(self, provider: str, user: User):
        from app.models import Credential
        with SessionLocal() as db:
            total = len(db.scalars(select(Credential).where(Credential.user_id == user.id, Credential.provider == provider)).all())
        return {'configured': total > 0, 'credential_count': total, 'credential_source': 'encrypted_database'}

    """Business operations previously mixed into API routes."""

    def catalog(self, user: User = Depends(current_user)):
        return tool_catalog()

    def openai_status(self, user: User = Depends(current_user)):
        """Expose credential readiness without ever returning the server-side secret."""
        return self._credential_status("openai", user)

    def gemini_status(self, user: User = Depends(current_user)):
        """Expose Gemini credential readiness without ever returning the server-side secret."""
        return self._credential_status("gemini", user)

    def ollama_status(self, user: User = Depends(current_user)):
        """Report local Ollama reachability and installed model names without exposing secrets."""
        return self._credential_status("ollama", user)

    def templates(self, user: User = Depends(current_user)):
        return preset_templates()

    def definitions(self, project_id: int, db: Session = Depends(wf_db), user: User = Depends(current_user)):
        authorize(db, project_id, user.id)
        rows = db.scalars(select(WorkflowDefinition).where(WorkflowDefinition.user_id == user.id, WorkflowDefinition.project_id == project_id).order_by(WorkflowDefinition.id.desc())).all()
        return [view_definition(row) for row in rows]

    def create_definition(self, project_id: int, body: DefinitionBody, db: Session = Depends(wf_db), user: User = Depends(current_user)):
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

    def update_definition(self, project_id: int, definition_id: int, body: DefinitionBody, db: Session = Depends(wf_db), user: User = Depends(current_user)):
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

    def duplicate_definition(self, project_id: int, definition_id: int, db: Session = Depends(wf_db), user: User = Depends(current_user)):
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

    def definition_versions(self, project_id: int, definition_id: int, db: Session = Depends(wf_db), user: User = Depends(current_user)):
        authorize(db, project_id, user.id)
        owner(db, WorkflowDefinition, definition_id, user.id, project_id)
        rows = db.scalars(select(WorkflowVersion).where(
            WorkflowVersion.workflow_id == definition_id,
            WorkflowVersion.user_id == user.id,
            WorkflowVersion.project_id == project_id,
        ).order_by(WorkflowVersion.version.desc())).all()
        return [{"id": item.id, "version": item.version, "name": item.name,
                 "nodes": json.loads(item.nodes_json), "created_at": item.created_at.isoformat()} for item in rows]

    def restore_version(self, project_id: int, definition_id: int, version: int, db: Session = Depends(wf_db), user: User = Depends(current_user)):
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

    def delete_definition(self, project_id: int, definition_id: int, db: Session = Depends(wf_db), user: User = Depends(current_user)):
        authorize(db, project_id, user.id)
        row = owner(db, WorkflowDefinition, definition_id, user.id, project_id)
        db.delete(row)
        db.commit()

    def sources(self, project_id: int, db: Session = Depends(wf_db), user: User = Depends(current_user)):
        authorize(db, project_id, user.id)
        rows = db.scalars(select(WorkflowSource).where(WorkflowSource.user_id == user.id, WorkflowSource.project_id == project_id).order_by(WorkflowSource.id.desc())).all()
        return [view_source(row) for row in rows]

    async def upload_source(self, project_id: int, file: UploadFile = File(...), db: Session = Depends(wf_db), user: User = Depends(current_user)):
        authorize(db, project_id, user.id)
        name = (file.filename or "video").replace("\\", "/").split("/")[-1][:190]
        ext = Path(name).suffix.lower()
        if ext not in (".mp4", ".mov", ".mkv", ".webm", ".m4v"):
            raise HTTPException(422, "Upload a video: MP4/MOV/MKV/WEBM/M4V")
        stored = f"{uuid.uuid4().hex}{ext}"
        location = (
            project_media_dir(user.id, project_id)
            / "workflow-sources"
        )
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
            import mimetypes

            media = MediaAsset(
                project_id=project_id,
                name=name,
                kind="video",
                mime=mimetypes.guess_type(name)[0] or "video/mp4",
                disk_path=str(path.resolve()),
                size_bytes=amount,
                created_at=now(),
            )

            db.add(media)
            db.flush()

            row = WorkflowSource(
                user_id=user.id,
                project_id=project_id,
                media_id=media.id,
                filename=name,
                stored_name=stored,
                size_bytes=amount,
            )

            db.add(row)
            db.commit()
            db.refresh(row)
            return view_source(row)
        except Exception:
            path.unlink(missing_ok=True)
            raise
        finally:
            await file.close()

    def source_from_media(self, project_id: int, media_id: int, db: Session = Depends(wf_db), user: User = Depends(current_user)):
        """Create a workflow source from the owned Media Library without another upload."""
        authorize(db, project_id, user.id)
        media = db.scalar(select(MediaAsset).where(MediaAsset.id == media_id, MediaAsset.project_id == project_id))
        if media is None or media.kind != "video":
            raise HTTPException(404, "Video media asset not found")
        origin = Path(media.disk_path).resolve()
        if not origin.is_file():
            raise HTTPException(404, "Media file is missing from storage")
        if not origin.is_relative_to(
            project_media_dir(user.id, project_id).resolve()
        ):
            raise HTTPException(
                422, "Media must belong to this project's media folder"
            )

        info = probe(origin)

        if not info["width"] or not info["duration"]:
            raise HTTPException(
                422, "Could not detect a video stream"
            )

        row = WorkflowSource(
            user_id=user.id,
            project_id=project_id,
            media_id=media.id,
            filename=media.name[:200],
            stored_name=origin.name,
            size_bytes=origin.stat().st_size,
        )

        db.add(row)
        db.commit()
        db.refresh(row)

        return view_source(row)

    def source_video(self, project_id: int, source_id: int,
                     db: Session = Depends(wf_db), user: User = Depends(current_user)):
        """Authorized video streaming for browser-only remix preview."""
        authorize(db, project_id, user.id)
        item = owner(db, WorkflowSource, source_id, user.id, project_id)
        try:
            path = source_location(db, item)
        except FileNotFoundError as exc:
            raise HTTPException(404, "Workflow source video not found") from exc
        mime = {".mp4": "video/mp4", ".webm": "video/webm",
                ".mov": "video/quicktime", ".m4v": "video/mp4",
                ".mkv": "video/x-matroska"}.get(path.suffix.lower())
        if not mime:
            raise HTTPException(415, "Unsupported preview media format")
        return FileResponse(path, media_type=mime, content_disposition_type="inline",
                            headers={"Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff"})
    def start_run(self, project_id: int, body: StartRun, background: BackgroundTasks, db: Session = Depends(wf_db), user: User = Depends(current_user)):
        authorize(db, project_id, user.id)
        definition = owner(db, WorkflowDefinition, body.workflow_id, user.id, project_id)
        
        try:
            nodes = execution_nodes(
                json.loads(definition.nodes_json),
                body.target_node_id,
            )

            if body.target_node_id is not None:
                nodes = [
                    {
                        **node,
                        "settings": {
                            **node["settings"],
                            "__cliptora_execute_step_target": True,
                        },
                    }
                    if node["id"] == body.target_node_id
                    else node
                    for node in nodes
                ]

        except ValueError as exc:
            raise HTTPException(422, str(exc)) from exc

        try:
            source_id = select_workflow_source_id(nodes, body.source_id)
        except ValueError as exc:
            raise HTTPException(422, str(exc)) from exc
        # Check credential ownership before queuing a run, never after starting an API call.
        from app.models import Credential
        for workflow_node in nodes:
            cfg = workflow_node.get('settings') or {}
            credential_id = cfg.get('credential_id')
            if credential_id is None:
                continue
            row_cred = db.scalar(select(Credential).where(Credential.id == credential_id, Credential.user_id == user.id))
            if row_cred is None:
                raise HTTPException(422, f'Credential for node {workflow_node["id"]} is missing or inaccessible')
            kind = workflow_node['type']
            expected = ('gemini' if kind == 'ai.gemini' or (kind in ('ai.highlights','ai.summary') and cfg.get('mode') == 'gemini')
                        else 'ollama' if kind == 'ai.ollama' else
                        str(cfg.get('provider') or 'openai') if kind.startswith('ai.') else None)
            if expected != row_cred.provider:
                raise HTTPException(422, f'Credential provider does not match node {workflow_node["id"]}')
        if source_id is not None:
            source_row = owner(
                db, WorkflowSource, source_id, user.id, project_id
            )

            try:
                source_location(db, source_row)
            except FileNotFoundError as exc:
                raise HTTPException(422, str(exc)) from exc
        if source_id is None and any(node["type"] in ("core.video_source", "media.probe", "audio.extract", "video.render") and node.get("when") != "has_video" for node in nodes):
            raise HTTPException(422, "This workflow requires a source video. Upload/select one first")
        row = WorkflowRun(user_id=user.id, project_id=project_id, workflow_id=definition.id, source_id=source_id,
                          workflow_json=json.dumps(nodes, ensure_ascii=False), results_json="{}")
        db.add(row)
        db.commit()
        db.refresh(row)
        enqueue_run(row, background, db)
        return view_run(row)

    def runs(self, project_id: int, db: Session = Depends(wf_db), user: User = Depends(current_user)):
        authorize(db, project_id, user.id)
        items = db.scalars(select(WorkflowRun).where(WorkflowRun.project_id == project_id, WorkflowRun.user_id == user.id).order_by(WorkflowRun.id.desc()).limit(30)).all()
        return [view_run(row) for row in items]

    def run_detail(self, project_id: int, run_id: int, db: Session = Depends(wf_db), user: User = Depends(current_user)):
        authorize(db, project_id, user.id)
        return view_run(owner(db, WorkflowRun, run_id, user.id, project_id))

    def cancel_run(self, project_id: int, run_id: int, db: Session = Depends(wf_db), user: User = Depends(current_user)):
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

    def retry_run(self, project_id: int, run_id: int, background: BackgroundTasks, db: Session = Depends(wf_db), user: User = Depends(current_user)):
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

    def artifact(self, project_id: int, run_id: int, node_id: str, db: Session = Depends(wf_db), user: User = Depends(current_user)):
        authorize(db, project_id, user.id)
        owner(db, WorkflowRun, run_id, user.id, project_id)
        if not re.fullmatch(r"[A-Za-z][A-Za-z0-9_-]{0,47}", node_id):
            raise HTTPException(422, "Invalid node name")
        path = project_dir(user.id, project_id) / "runs" / str(run_id) / f"{node_id}.json"
        if not path.is_file():
            raise HTTPException(404, "Artifact is not available")
        return FileResponse(path, media_type="application/json", filename=f"{node_id}.json")

    def audio_file(self, project_id: int, run_id: int, node_id: str, track: int,
                   download: bool = False, db: Session = Depends(wf_db), user: User = Depends(current_user)):
        """Stream only an extracted audio artifact belonging to the authenticated user/run.

        The artifact path is never accepted from a URL. It must be recorded in
        the matching workflow node's JSON artifact and confined to this run's
        audio folder. No other file under the server can be fetched.
        """
        authorize(db, project_id, user.id)
        owner(db, WorkflowRun, run_id, user.id, project_id)
        if not re.fullmatch(r"[A-Za-z][A-Za-z0-9_-]{0,47}", node_id) or track < 0 or track > 255:
            raise HTTPException(422, "Invalid audio artifact identifier")
        workspace = project_dir(user.id, project_id) / "runs" / str(run_id)
        artifact = workspace / f"{node_id}.json"
        if not artifact.is_file():
            raise HTTPException(404, "Audio artifact not available")
        try:
            data = json.loads(artifact.read_text(encoding="utf-8"))
        except (OSError, ValueError) as exc:
            raise HTTPException(404, "Audio artifact unavailable") from exc
        if not isinstance(data, dict):
            raise HTTPException(404, "Audio artifact unavailable")
        files = data.get("audio_files")
        if not isinstance(files, list):
            raise HTTPException(404, "This node has no extracted audio")
        entry = next((item for item in files if isinstance(item, dict) and item.get("track") == track), None)
        if not entry or not isinstance(entry.get("path"), str):
            raise HTTPException(404, "Audio track not available")
        target = Path(entry["path"]).resolve()

        allowed = [
            (workspace / "audio").resolve(),
            (run_media_dir(workspace) / "audio").resolve(),
        ]

        if not any(
            target.is_relative_to(folder)
            for folder in allowed
        ):
            raise HTTPException(
                404, "Audio artifact unavailable"
            )
        suffix = target.suffix.lower()
        content_types = {
            ".wav": "audio/wav", ".mp3": "audio/mpeg", ".m4a": "audio/mp4",
            ".flac": "audio/flac", ".mka": "audio/x-matroska",
        }
        if suffix not in content_types or not target.is_file():
            raise HTTPException(404, "Audio file missing")
        return FileResponse(
            target, media_type=content_types[suffix], filename=target.name,
            content_disposition_type="attachment" if download else "inline",
            headers={"Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff"},
        )

    def rendered_video(self, project_id: int, run_id: int, db: Session = Depends(wf_db), user: User = Depends(current_user)):
        authorize(db, project_id, user.id)
        owner(db, WorkflowRun, run_id, user.id, project_id)
        workspace = (
            project_dir(user.id, project_id)
            / "runs"
            / str(run_id)
        )

        path = (
            run_media_dir(workspace)
            / "videos"
            / "final.mp4"
        )

        if not path.is_file():
            path = workspace / "final.mp4"

        if not path.is_file():
            raise HTTPException(404, "Rendered video not available. Enable video.render in workflow")
        return FileResponse(path, media_type="video/mp4", filename=f"cliptora_run_{run_id}.mp4")

from app.http.resources.WorkflowResource import WorkflowResource
