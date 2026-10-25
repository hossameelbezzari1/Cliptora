import os

from celery import Celery


def broker_url() -> str:
    return os.environ.get("REDIS_URL", "redis://127.0.0.1:6379/0")


celery_app = Celery(
    "cliptora",
    broker=broker_url(),
    backend=broker_url(),
    include=["app.workers.workflow_tasks"],
)
celery_app.conf.update(
    task_acks_late=True,
    task_reject_on_worker_lost=True,
    worker_prefetch_multiplier=1,
    task_track_started=True,
    result_expires=86400,
    broker_connection_retry_on_startup=True,
)
