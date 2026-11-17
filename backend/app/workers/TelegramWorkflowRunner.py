
"""Durable, single-process Telegram long-polling worker for CLIPTORA.

Run separately: python -m app.workers.TelegramWorkflowRunner
Requires CLIPTORA_TELEGRAM_BOT_TOKEN in environment. Telegram webhook must
be disabled for this bot. Bot credentials never go into node settings.
"""
from __future__ import annotations

import json
import logging
import os
import re
import sqlite3
import time
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any

from fastapi import HTTPException
from sqlalchemy import select

from app.core.Database import SessionLocal
from app.models import WorkflowDefinition, WorkflowRun
from app.services.WorkflowService import ensure_schema, process_run, root_dir
from app.services.WorkflowExternalEvents import launch_external_event

log = logging.getLogger("cliptora.telegram")
COMMAND = re.compile(r"^(/[A-Za-z][A-Za-z0-9_]{0,31})(?:@[A-Za-z0-9_]+)?\s+(.+)$", re.DOTALL)


def _api(token: str, method: str, data: dict[str, Any]) -> Any:
    payload = urllib.parse.urlencode(data).encode("utf-8")
    req = urllib.request.Request(
        f"https://api.telegram.org/bot{token}/{method}",
        data=payload, headers={"Content-Type": "application/x-www-form-urlencoded"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=40) as response:
            result = json.load(response)
    except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError) as exc:
        # urllib exceptions can carry the URL, which embeds the bot token.
        # Do not chain or log the original exception.
        raise RuntimeError(f"Telegram {method} request failed ({type(exc).__name__})") from None
    if not isinstance(result, dict) or result.get("ok") is not True:
        raise RuntimeError(f"Telegram {method} returned an invalid response")
    return result.get("result")


def _notify(token: str, chat_id: int, message: str) -> None:
    try:
        _api(token, "sendMessage", {"chat_id": chat_id, "text": message[:3900]})
    except Exception:
        log.exception("Unable to notify Telegram chat %s", chat_id)


def _queue() -> sqlite3.Connection:
    base = root_dir() / "telegram"
    base.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(base / "trigger_queue.sqlite3", timeout=30)
    db.execute("PRAGMA journal_mode=WAL")
    db.execute("""CREATE TABLE IF NOT EXISTS incoming (
        update_id INTEGER PRIMARY KEY,
        workflow_id INTEGER NOT NULL,
        chat_id INTEGER NOT NULL,
        payload_json TEXT NOT NULL,
        state TEXT NOT NULL DEFAULT 'pending',
        run_id INTEGER
    )""")
    db.commit()
    return db


def _candidate(message: dict[str, Any]) -> tuple[int, dict[str, Any]] | None:
    """A Telegram message may trigger exactly one matching saved workflow."""
    chat_id = message.get("chat", {}).get("id")
    text = str(message.get("text") or "").strip()
    if type(chat_id) is not int or not COMMAND.match(text) or len(text) > 1000:
        return None
    matches: list[int] = []
    with SessionLocal() as db:
        for definition in db.scalars(select(WorkflowDefinition)).all():
            try:
                nodes = json.loads(definition.nodes_json)
                telegram = [n for n in nodes if n.get("type") == "core.telegram_trigger"]
                if len(telegram) != 1 or telegram[0].get("depends_on"):
                    continue
                cfg = telegram[0].get("settings") or {}
                command = str(cfg.get("command") or "/recap").strip()
                if (cfg.get("enabled") is not True
                    or chat_id not in cfg.get("allowed_chat_ids", [])
                    or not re.match(rf"^{re.escape(command)}(?:@[A-Za-z0-9_]+)?\s+", text, re.I)):
                    continue
                matches.append(definition.id)
            except (TypeError, ValueError):
                continue
    if len(matches) > 1:
        log.warning("Ambiguous Telegram trigger: chat=%s workflow_ids=%s", chat_id, matches)
        return None
    if not matches:
        return None
    return matches[0], {"chat_id": chat_id, "text": text, "message_id": message.get("message_id")}


def _store_updates(queue: sqlite3.Connection, updates: list[dict[str, Any]]) -> None:
    for update in updates:
        uid = update.get("update_id")
        if type(uid) is not int:
            continue
        message = update.get("message") or update.get("channel_post")
        selection = _candidate(message) if isinstance(message, dict) else None
        if selection:
            workflow_id, event = selection
            event["update_id"] = uid
            chat_id = event["chat_id"]
            status = "pending"
        else:
            workflow_id, chat_id, event, status = 0, 0, {}, "ignored"
        queue.execute(
            "INSERT OR IGNORE INTO incoming(update_id,workflow_id,chat_id,payload_json,state) VALUES (?,?,?,?,?)",
            (uid, workflow_id, chat_id, json.dumps(event, ensure_ascii=False), status),
        )
    queue.commit()


def _dispatch_pending(queue: sqlite3.Connection, workers: ThreadPoolExecutor, token: str) -> None:
    pending = queue.execute(
        "SELECT update_id,workflow_id,chat_id,payload_json FROM incoming WHERE state='pending' ORDER BY update_id LIMIT 30"
    ).fetchall()
    for update_id, workflow_id, chat_id, payload_json in pending:
        try:
            with SessionLocal() as db:
                run = launch_external_event(
                    db, workflow_id=workflow_id, origin="telegram",
                    event=json.loads(payload_json),
                )
            queue.execute(
                "UPDATE incoming SET state='started',run_id=? WHERE update_id=?",
                (run.id, update_id),
            )
            queue.commit()  # Persist run_id BEFORE starting a worker thread.
            if os.environ.get("WORKFLOW_QUEUE", "local").lower() == "celery":
                from app.jobs.WorkflowTask import run_workflow
                run_workflow.delay(run.id)
            else:
                workers.submit(process_run, run.id)
            _notify(token, chat_id, f"CLIPTORA: Workflow #{workflow_id}, Run #{run.id} started.")
        except HTTPException as exc:
            if exc.status_code == 409:
                continue  # FIFO pending until this workflow finishes.
            log.warning("Telegram trigger %s rejected: %s", update_id, exc.detail)
            queue.execute("UPDATE incoming SET state='failed' WHERE update_id=?", (update_id,))
            queue.commit()
            _notify(token, chat_id, f"CLIPTORA trigger rejected: {exc.detail}")
        except Exception:
            log.exception("Dispatch failed for update %s; retrying later", update_id)


def _report_completed(queue: sqlite3.Connection, token: str) -> None:
    started = queue.execute(
        "SELECT update_id,chat_id,run_id FROM incoming WHERE state='started' AND run_id IS NOT NULL LIMIT 100"
    ).fetchall()
    with SessionLocal() as db:
        for update_id, chat_id, run_id in started:
            run = db.get(WorkflowRun, run_id)
            if run is None or run.state not in {"completed", "failed", "cancelled"}:
                continue
            status = "finished" if run.state == "completed" else "failed"
            queue.execute("UPDATE incoming SET state=? WHERE update_id=?", (status, update_id))
            extra = f" ({str(run.error)[:300]})" if run.error else ""
            _notify(token, chat_id, f"CLIPTORA Run #{run_id}: {run.state}{extra}")
    queue.commit()


def main() -> None:
    logging.basicConfig(level=logging.INFO)
    token = os.environ.get("CLIPTORA_TELEGRAM_BOT_TOKEN", "").strip()
    if not re.fullmatch(r"[0-9]{4,15}:[A-Za-z0-9_-]{20,}", token):
        raise RuntimeError("Set CLIPTORA_TELEGRAM_BOT_TOKEN in the worker environment")
    ensure_schema()
    queue = _queue()
    # Ensure no webhook is active: getUpdates and webhooks are mutually exclusive.
    # Never delete webhook automatically; that would disrupt a configured bot.
    info = _api(token, "getWebhookInfo", {})
    if isinstance(info, dict) and info.get("url"):
        raise RuntimeError("This bot has a webhook configured. Disable it before polling.")
    with ThreadPoolExecutor(max_workers=2, thread_name_prefix="telegram-workflow") as workers:
        while True:
            try:
                last = queue.execute("SELECT COALESCE(MAX(update_id),-1) FROM incoming").fetchone()[0]
                updates = _api(token, "getUpdates", {
                    "offset": int(last) + 1,
                    "timeout": 12,
                    "limit": 50,
                    "allowed_updates": json.dumps(["message", "channel_post"]),
                })
                if isinstance(updates, list) and updates:
                    _store_updates(queue, updates)
                _report_completed(queue, token)
                _dispatch_pending(queue, workers, token)
            except (OSError, urllib.error.URLError, ValueError, RuntimeError, sqlite3.Error):
                log.exception("Telegram polling failed")
                time.sleep(5)


if __name__ == "__main__":
    main()
