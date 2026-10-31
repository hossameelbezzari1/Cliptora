class RunCommandJob:
    """Executes an authenticated, persisted command in its own database session."""
    def execute(self, run_id: int) -> None:
        from app.services.commands_service import _worker
        _worker(run_id)
