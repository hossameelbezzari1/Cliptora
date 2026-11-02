"""CLIPTORA scheduled workflow runner. Start as a SINGLE dedicated process.

Example: python -m app.workers.schedule_runner

All schedules are opt-in (settings.enabled=true). One run per workflow per UTC
second is enforced by a MySQL unique index even across restarts. In local
queue mode, execution uses a bounded thread pool, not the polling thread.
"""
from __future__ import annotations

from app.workflows.source_selection import select_workflow_source_id

import json
import logging
import os
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone

from sqlalchemy import DateTime, Integer, UniqueConstraint, select, BigInteger
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base, SessionLocal, engine
from app.models import WorkflowDefinition, WorkflowRun
from app.services.workflow_service import process_run, ensure_schema
from app.workers.schedule_rules import due

logging.basicConfig(level=logging.INFO, format='%(asctime)s %(levelname)s %(message)s')
log = logging.getLogger('cliptora.schedule')


class ScheduleFire(Base):
    __tablename__ = 'workflow_schedule_fires'
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    workflow_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    utc_second: Mapped[int] = mapped_column(BigInteger, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc).replace(tzinfo=None))
    __table_args__ = (UniqueConstraint('workflow_id', 'utc_second', name='uq_workflow_schedule_second'),)


def tick(utc: datetime, workers: ThreadPoolExecutor) -> None:
    second = int(utc.timestamp())
    with SessionLocal() as db:
        definitions = db.scalars(select(WorkflowDefinition)).all()
        for definition in definitions:
            try:
                nodes = json.loads(definition.nodes_json)
                schedule_nodes = [node for node in nodes
                    if node.get('type') == 'core.schedule_trigger' and not node.get('depends_on')
                    and due(node.get('settings', {}), utc)]
                if not schedule_nodes:
                    continue

                # Never start concurrent runs of the same workflow.
                active = db.scalar(select(WorkflowRun.id).where(
                    WorkflowRun.workflow_id == definition.id,
                    WorkflowRun.state.in_(['queued', 'running', 'cancelling'])).limit(1))
                if active is not None:
                    continue

                source_id = select_workflow_source_id(nodes)
                fire = ScheduleFire(workflow_id=definition.id, utc_second=second)
                try:
                    with db.begin_nested():
                        db.add(fire)
                        db.flush()
                except IntegrityError:
                    continue
                run = WorkflowRun(user_id=definition.user_id, project_id=definition.project_id,
                    workflow_id=definition.id, source_id=source_id, workflow_json=definition.nodes_json,
                    results_json='{}', state='queued')
                db.add(run)
                db.commit()
                run_id = run.id
                if os.environ.get('WORKFLOW_QUEUE', 'local').lower() == 'celery':
                    try:
                        from app.jobs.workflow_task import run_workflow
                        run_workflow.delay(run_id)
                    except Exception:
                        log.exception('Unable to enqueue scheduled run %s', run_id)
                        run.state = 'failed'
                        run.error = 'Schedule queue unavailable'
                        db.commit()
                else:
                    workers.submit(process_run, run_id)
                log.info('Scheduled workflow %s run %s', definition.id, run_id)
            except Exception:
                db.rollback()
                log.exception('Invalid schedule or error on workflow %s', definition.id)


def main() -> None:
    ensure_schema()
    Base.metadata.create_all(bind=engine, tables=[ScheduleFire.__table__], checkfirst=True)
    log.info('CLIPTORA scheduler running (UTC ticks, one worker process recommended)')
    last_second = -1
    with ThreadPoolExecutor(max_workers=2, thread_name_prefix='cliptora-schedule') as workers:
        while True:
            now = datetime.now(timezone.utc).replace(microsecond=0)
            current_second = int(now.timestamp())
            if current_second != last_second:
                last_second = current_second
                try:
                    tick(now, workers)
                except Exception:
                    log.exception('Scheduler tick failed')
            time.sleep(0.2)


if __name__ == '__main__':
    main()
