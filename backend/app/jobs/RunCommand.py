class RunCommandJob:
    """Executes an authenticated, persisted command in its own database session."""
    def execute(self, run_id: int) -> None:
        from app.services.CommandsService import _worker
        _worker(run_id)
