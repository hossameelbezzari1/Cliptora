
"""CLIPTORA schedule worker with restart-safe missed execution recovery.

Run as one dedicated process:
    python -m app.workers.ScheduleRunner

ScheduleFire ensures at most one scheduled run per workflow
per UTC second.
"""
from __future__ import annotations

import json
import logging
import os
import time

from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone

from sqlalchemy import (
    BigInteger,
    DateTime,
    Integer,
    UniqueConstraint,
    select,
)
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Mapped, mapped_column

from app.core.Database import Base, SessionLocal, engine
from app.models import WorkflowDefinition, WorkflowRun
from app.services.WorkflowService import ensure_schema, process_run
from app.workflows.SourceSelection import select_workflow_source_id
from app.workers.ScheduleRules import matches_rule

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
)

log = logging.getLogger("cliptora.schedule")

MAX_GRACE_SECONDS = 86400


class ScheduleFire(Base):
    __tablename__ = "workflow_schedule_fires"

    id: Mapped[int] = mapped_column(
        Integer,
        primary_key=True,
        autoincrement=True,
    )

    workflow_id: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        index=True,
    )

    utc_second: Mapped[int] = mapped_column(
        BigInteger,
        nullable=False,
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime,
        default=lambda: datetime.now(
            timezone.utc,
        ).replace(tzinfo=None),
    )

    __table_args__ = (
        UniqueConstraint(
            "workflow_id",
            "utc_second",
            name="uq_workflow_schedule_second",
        ),
    )


class ScheduleCursor(Base):
    __tablename__ = "workflow_schedule_cursors"

    workflow_id: Mapped[int] = mapped_column(
        Integer,
        primary_key=True,
    )

    last_checked_second: Mapped[int] = mapped_column(
        BigInteger,
        nullable=False,
    )


def _config(
    node: dict,
) -> tuple[list[dict], str, str, int] | None:
    if (
        node.get("type") != "core.schedule_trigger"
        or node.get("depends_on")
    ):
        return None

    settings = node.get("settings") or {}

    if settings.get("enabled") is not True:
        return None

    root = settings.get("rule") or {}

    rules = (
        root.get("interval")
        if isinstance(root, dict)
        else None
    )

    if not isinstance(rules, list) or not 1 <= len(rules) <= 30:
        raise ValueError("Schedule requires 1-30 rules")

    if any(not isinstance(rule, dict) for rule in rules):
        raise ValueError(
            "Every schedule rule must be an object"
        )

    zone = settings.get("timezone") or "UTC"

    if not isinstance(zone, str) or len(zone) > 80:
        raise ValueError("Invalid timezone")

    policy = settings.get(
        "missed_execution_policy",
        "skip",
    )

    if policy == "run_once":
        policy = "most_recent"

    if policy not in (
        "skip",
        "most_recent",
        "most_recent_per_rule",
    ):
        raise ValueError(
            "Invalid missed execution policy"
        )

    grace = settings.get(
        "missed_execution_grace_period_seconds",
        settings.get(
            "missed_execution_grace_period",
            0,
        ),
    )

    if (
        type(grace) is not int
        or not 0 <= grace <= MAX_GRACE_SECONDS
    ):
        raise ValueError(
            "Missed execution grace period must be 0-86400 seconds"
        )

    return rules, zone, policy, grace


def _second_matches(
    rules: list[dict],
    zone: str,
    second: int,
) -> list[int]:
    instant = datetime.fromtimestamp(
        second,
        timezone.utc,
    )

    return [
        index
        for index, rule in enumerate(rules)
        if matches_rule(rule, instant, zone)
    ]


def _candidates(
    rules: list[dict],
    zone: str,
    policy: str,
    grace: int,
    previous: int,
    now: int,
) -> list[int]:
    matched_now = _second_matches(
        rules,
        zone,
        now,
    )

    if policy == "skip" or grace == 0:
        return [now] if matched_now else []

    start = max(
        previous + 1,
        now - grace,
        now - MAX_GRACE_SECONDS,
    )

    if start > now:
        return []

    latest: dict[int, int] = {}

    for second in range(start, now + 1):
        for rule_index in _second_matches(
            rules,
            zone,
            second,
        ):
            latest[rule_index] = second

    if policy == "most_recent":
        return (
            [max(latest.values())]
            if latest
            else []
        )

    return sorted(set(latest.values()))


def tick(
    utc: datetime,
    workers: ThreadPoolExecutor,
) -> None:
    second = int(utc.timestamp())

    with SessionLocal() as db:
        definitions = db.scalars(
            select(WorkflowDefinition)
        ).all()

        for definition in definitions:
            try:
                nodes = json.loads(
                    definition.nodes_json
                )

                schedules = [
                    config
                    for node in nodes
                    if (config := _config(node))
                ]

                cursor = db.get(
                    ScheduleCursor,
                    definition.id,
                )

                previous = (
                    cursor.last_checked_second
                    if cursor
                    else second - 1
                )

                if not schedules:
                    if cursor is not None:
                        db.delete(cursor)
                        db.commit()
                    continue

                active = db.scalar(
                    select(WorkflowRun.id)
                    .where(
                        WorkflowRun.workflow_id
                        == definition.id,
                        WorkflowRun.state.in_([
                            "queued",
                            "running",
                            "cancelling",
                        ]),
                    )
                    .limit(1)
                )

                if active is not None:
                    continue

                candidates: set[int] = set()

                for (
                    rules,
                    zone,
                    policy,
                    grace,
                ) in schedules:
                    candidates.update(
                        _candidates(
                            rules,
                            zone,
                            policy,
                            grace,
                            previous,
                            second,
                        )
                    )

                if cursor is None:
                    cursor = ScheduleCursor(
                        workflow_id=definition.id,
                        last_checked_second=second,
                    )
                    db.add(cursor)
                else:
                    cursor.last_checked_second = second

                # Coalesce eligible missed executions
                # to one workflow run per scheduler tick.
                if candidates:
                    fire_second = max(candidates)

                    source_id = (
                        select_workflow_source_id(
                            nodes
                        )
                    )

                    try:
                        with db.begin_nested():
                            db.add(
                                ScheduleFire(
                                    workflow_id=definition.id,
                                    utc_second=fire_second,
                                )
                            )
                            db.flush()

                    except IntegrityError:
                        db.commit()
                        continue

                    run = WorkflowRun(
                        user_id=definition.user_id,
                        project_id=definition.project_id,
                        workflow_id=definition.id,
                        source_id=source_id,
                        workflow_json=definition.nodes_json,
                        results_json="{}",
                        state="queued",
                    )

                    db.add(run)
                    db.commit()

                    run_id = run.id

                    if (
                        os.environ.get(
                            "WORKFLOW_QUEUE",
                            "local",
                        ).lower()
                        == "celery"
                    ):
                        try:
                            from app.jobs.WorkflowTask import run_workflow

                            run_workflow.delay(run_id)

                        except Exception:
                            log.exception(
                                "Unable to enqueue scheduled run %s",
                                run_id,
                            )
                            run.state = "failed"
                            run.error = (
                                "Schedule queue unavailable"
                            )
                            db.commit()

                    else:
                        workers.submit(
                            process_run,
                            run_id,
                        )

                    log.info(
                        "Scheduled workflow %s run %s",
                        definition.id,
                        run_id,
                    )

                else:
                    db.commit()

            except Exception:
                db.rollback()
                log.exception(
                    "Invalid schedule or error on workflow %s",
                    definition.id,
                )


def main() -> None:
    ensure_schema()

    Base.metadata.create_all(
        bind=engine,
        tables=[
            ScheduleFire.__table__,
            ScheduleCursor.__table__,
        ],
        checkfirst=True,
    )

    log.info(
        "CLIPTORA scheduler started"
    )

    last_second = -1

    with ThreadPoolExecutor(
        max_workers=2,
        thread_name_prefix="cliptora-schedule",
    ) as workers:
        while True:
            now = datetime.now(
                timezone.utc,
            ).replace(microsecond=0)

            current_second = int(
                now.timestamp()
            )

            if current_second != last_second:
                last_second = current_second

                try:
                    tick(
                        now,
                        workers,
                    )

                except Exception:
                    log.exception(
                        "Scheduler tick failed"
                    )

            time.sleep(0.2)


if __name__ == "__main__":
    main()
