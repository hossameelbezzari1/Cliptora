class RunWorkflowJob:
    """Runs one persisted native workflow without depending on the HTTP controller."""
    def execute(self, run_id: int) -> None:
        from app.services.workflow_service import process_run
        process_run(run_id)
