from app.jobs.celery_app import celery_app


@celery_app.task(name="cliptora.run_workflow", bind=True, max_retries=2)
def run_workflow(self, run_id: int) -> None:
    """Execute a persisted run. Database state makes duplicate deliveries safe."""
    try:
        from app.jobs.run_workflow import RunWorkflowJob

        RunWorkflowJob().execute(run_id)
    except Exception as exc:
        raise self.retry(exc=exc, countdown=min(60, 5 * (2 ** self.request.retries)))
