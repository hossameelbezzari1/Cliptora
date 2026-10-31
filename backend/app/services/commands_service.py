"""CLIPTORA command library, clip bindings, and auditable asynchronous runs.

Requires the existing auth + CSRF middleware. Import in app.main and include as
normal API v1 router; routes are registered from app.routes.api.
"""

from __future__ import annotations

import json

import logging

import re

from datetime import datetime, timezone

from threading import Lock

from typing import Any, Literal

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException

from pydantic import BaseModel, Field

from sqlalchemy import DateTime, Integer, String, Text, create_engine, inspect, select, text

from sqlalchemy.orm import Mapped, Session, mapped_column

from app.core.database import Base, SessionLocal, engine, get_db

from app.core.security import current_user

from app.models import User

from app.services.command_executor import CommandExecutor

log = logging.getLogger(__name__)

KINDS = ("json_extract", "http_json", "selenium_youtube_comments")

TRIGGERS = ("manual", "on_start", "on_end", "on_repeat")

_schema_lock = Lock()

_schema_ready = False

def utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)

def library_schema() -> None:
    global _schema_ready
    if _schema_ready:
        return
    with _schema_lock:
        if _schema_ready:
            return
        try:
            # Only create the three tables owned by this module; never call drop_all.
            Base.metadata.create_all(engine, tables=[AutomationCommand.__table__, AutomationBinding.__table__, AutomationRun.__table__], checkfirst=True)
            for model in (AutomationCommand, AutomationBinding, AutomationRun):
                if not inspect(engine).has_table(model.__tablename__):
                    raise RuntimeError(f"Table {model.__tablename__} is unavailable")
        except Exception as exc:
            log.exception("CLIPTORA command schema unavailable")
            raise HTTPException(503, "Commands database not ready. Check MySQL and the FastAPI console") from exc
        _schema_ready = True

def command_db(db: Session = Depends(get_db)) -> Session:
    library_schema()
    return db

def json_str(data: dict[str, Any]) -> str:
    encoded = json.dumps(data, ensure_ascii=False, allow_nan=False)
    if len(encoded.encode("utf-8")) > 20_000:
        raise HTTPException(422, "Command input/configuration is too large")
    return encoded

def valid_mapping(mapping: dict[str, str]) -> dict[str, str]:
    if len(mapping) > 20:
        raise HTTPException(422, "Maximum 20 output variable mappings")
    for path, name in mapping.items():
        if not re.fullmatch(r"[\w-]+(?:\.[\w-]+){0,12}", path):
            raise HTTPException(422, "Invalid result path")
        if not re.fullmatch(r"[A-Za-z_][\w.]{0,100}", name):
            raise HTTPException(422, "Invalid destination variable name")
        if name.startswith(("project.", "system.", "media.")):
            raise HTTPException(422, "Built-in variables are read-only")
    return mapping

def project_owned(db: Session, project_id: int, user_id: int) -> None:
    # Project ownership uses projects.owner_id (not user_id).
    row = db.execute(text("SELECT id FROM projects WHERE id=:pid AND owner_id=:uid"), {"pid": project_id, "uid": user_id}).first()
    if row is None:
        raise HTTPException(404, "Project not found")

def owned(db: Session, model: type, item_id: int, user_id: int):
    item = db.get(model, item_id)
    if item is None or item.user_id != user_id:
        raise HTTPException(404, "Item not found")
    return item

def view_command(row):
    return CommandResource.command(row)


def view_binding(row):
    return CommandResource.binding(row)


def view_run(row):
    return CommandResource.run(row)


def _persist_variables(db: Session, user_id: int, output: dict[str, Any], mapping: dict[str, str]) -> None:
    if not mapping:
        return
    from app.models import UserLibraryItem
    for path, name in mapping.items():
        try:
            value = CommandExecutor().resolve(output, path)
        except (IndexError, KeyError, TypeError, ValueError):
            continue
        # Bound individual value size; never turn outputs into executable code.
        if len(json.dumps(value, ensure_ascii=False)) > 8000:
            continue
        row = db.scalars(select(UserLibraryItem).where(UserLibraryItem.user_id == user_id, UserLibraryItem.kind == "variable", UserLibraryItem.name == name)).first()
        payload = {"type": "json" if isinstance(value, (dict, list)) else "boolean" if isinstance(value, bool) else "number" if isinstance(value, (int, float)) else "string", "value": value}
        if row:
            row.payload_json = json.dumps(payload, ensure_ascii=False)
        else:
            db.add(UserLibraryItem(user_id=user_id, kind="variable", name=name, payload_json=json.dumps(payload, ensure_ascii=False)))

def _worker(run_id: int) -> None:
    """Executed by Starlette's post-response background worker, in its own DB session."""
    with SessionLocal() as db:
        run = db.get(AutomationRun, run_id)
        if run is None:
            return
        run.state = "running"
        db.commit()
        try:
            binding = owned(db, AutomationBinding, run.binding_id, run.user_id)
            command = owned(db, AutomationCommand, binding.command_id, run.user_id)
            output = CommandExecutor().execute(command.kind, json.loads(command.config_json or "{}"), json.loads(binding.inputs_json or "{}"))
            encoded = json.dumps(output, ensure_ascii=False, allow_nan=False)
            if len(encoded.encode("utf-8")) > 200_000:
                raise ValueError("Command output exceeded the 200KB limit")
            _persist_variables(db, run.user_id, output, json.loads(binding.mapping_json or "{}"))
            run.output_json = encoded
            run.state = "completed"
        except Exception as exc:
            log.exception("Command run %s failed", run_id)
            db.rollback()
            run = db.get(AutomationRun, run_id)
            # Keep user-facing messages short. Do not leak tokens or server paths.
            run.state = "failed"
            run.error = (str(exc) if isinstance(exc, (ValueError, KeyError)) else "Execution failed; see backend logs")[:300]
        run.finished_at = utcnow()
        db.commit()

def queue_run(db: Session, user_id: int, binding: AutomationBinding, background: BackgroundTasks):
    if not binding.enabled:
        raise HTTPException(409, "Command binding is disabled")
    pending = db.scalars(select(AutomationRun).where(AutomationRun.user_id == user_id, AutomationRun.state.in_(["queued", "running"])).limit(3)).all()
    if len(pending) >= 2:
        raise HTTPException(429, "Maximum two concurrent command runs per user")
    row = AutomationRun(user_id=user_id, binding_id=binding.id, state="queued")
    db.add(row); db.commit(); db.refresh(row)
    from app.jobs.run_command import RunCommandJob
    background.add_task(RunCommandJob().execute, row.id)
    return view_run(row)

from app.models import AutomationCommand, AutomationBinding, AutomationRun
from app.http.requests.command import NewCommand, NewBinding, PatchBinding
from app.repositories.command import CommandRepository


class CommandsService:
    """Business operations previously mixed into API routes."""

    def list_commands(self, db: Session = Depends(command_db), user: User = Depends(current_user)):
        return [view_command(c) for c in CommandRepository(db).for_user(user.id)]

    def create_command(self, body: NewCommand, db: Session = Depends(command_db), user: User = Depends(current_user)):
        row = AutomationCommand(user_id=user.id, name=body.name.strip(), kind=body.kind, config_json=json_str(body.config))
        db.add(row); db.commit(); db.refresh(row)
        return view_command(row)

    def delete_command(self, command_id: int, db: Session = Depends(command_db), user: User = Depends(current_user)):
        row = owned(db, AutomationCommand, command_id, user.id)
        bindings = db.scalars(select(AutomationBinding).where(AutomationBinding.command_id == row.id, AutomationBinding.user_id == user.id)).all()
        if bindings:
            raise HTTPException(409, "Detach this command from clips before deleting it")
        db.delete(row); db.commit()

    def list_bindings(self, project_id: int, clip_id: str | None = None, db: Session = Depends(command_db), user: User = Depends(current_user)):
        project_owned(db, project_id, user.id)
        q = select(AutomationBinding).where(AutomationBinding.project_id == project_id, AutomationBinding.user_id == user.id)
        if clip_id is not None:
            q = q.where(AutomationBinding.clip_id == clip_id)
        return [view_binding(c) for c in db.scalars(q.order_by(AutomationBinding.id)).all()]

    def bind_command(self, body: NewBinding, db: Session = Depends(command_db), user: User = Depends(current_user)):
        project_owned(db, body.project_id, user.id)
        owned(db, AutomationCommand, body.command_id, user.id)
        mapping = valid_mapping(body.output_mapping)
        row = AutomationBinding(user_id=user.id, project_id=body.project_id, clip_id=body.clip_id, command_id=body.command_id,
                                trigger=body.trigger, enabled=body.enabled, inputs_json=json_str(body.inputs), mapping_json=json_str(mapping))
        db.add(row); db.commit(); db.refresh(row)
        return view_binding(row)

    def change_binding(self, binding_id: int, body: PatchBinding, db: Session = Depends(command_db), user: User = Depends(current_user)):
        row = owned(db, AutomationBinding, binding_id, user.id)
        if body.trigger is not None: row.trigger = body.trigger
        if body.enabled is not None: row.enabled = body.enabled
        if body.inputs is not None: row.inputs_json = json_str(body.inputs)
        if body.output_mapping is not None: row.mapping_json = json_str(valid_mapping(body.output_mapping))
        db.commit(); db.refresh(row)
        return view_binding(row)

    def unbind_command(self, binding_id: int, db: Session = Depends(command_db), user: User = Depends(current_user)):
        row = owned(db, AutomationBinding, binding_id, user.id)
        db.delete(row); db.commit()

    def run_binding(self, binding_id: int, background: BackgroundTasks, db: Session = Depends(command_db), user: User = Depends(current_user)):
        binding = owned(db, AutomationBinding, binding_id, user.id)
        return queue_run(db, user.id, binding, background)

    def dispatch_event(self, body: dict[str, Any], background: BackgroundTasks, db: Session = Depends(command_db), user: User = Depends(current_user)):
        """Optional trigger dispatch from a trusted editor UI/server workflow.

        Merely configuring a trigger does NOT silently run browser scrapers during preview.
        """
        project_id = int(body.get("project_id", 0))
        clip_id = str(body.get("clip_id", ""))
        event = str(body.get("event", ""))
        if event not in {"on_start", "on_end", "on_repeat"} or not clip_id:
            raise HTTPException(422, "Invalid event")
        project_owned(db, project_id, user.id)
        bindings = db.scalars(select(AutomationBinding).where(AutomationBinding.user_id == user.id,
            AutomationBinding.project_id == project_id, AutomationBinding.clip_id == clip_id,
            AutomationBinding.trigger == event, AutomationBinding.enabled.is_(True))).all()
        return {"queued": [queue_run(db, user.id, b, background)["id"] for b in bindings[:2]]}

    def list_runs(self, project_id: int, clip_id: str | None = None, db: Session = Depends(command_db), user: User = Depends(current_user)):
        project_owned(db, project_id, user.id)
        q = select(AutomationRun).join(AutomationBinding, AutomationRun.binding_id == AutomationBinding.id).where(
            AutomationRun.user_id == user.id, AutomationBinding.project_id == project_id)
        if clip_id is not None: q = q.where(AutomationBinding.clip_id == clip_id)
        return [view_run(row) for row in db.scalars(q.order_by(AutomationRun.id.desc()).limit(50)).all()]

    def get_run(self, run_id: int, db: Session = Depends(command_db), user: User = Depends(current_user)):
        return view_run(owned(db, AutomationRun, run_id, user.id))

from app.http.resources.command import CommandResource
