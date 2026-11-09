
"""Canonical storage paths for CLIPTORA media and workflow artifacts."""
from __future__ import annotations

import os
from pathlib import Path


def storage_root() -> Path:
    """Return the same storage root used by the Media Library."""
    configured = os.environ.get("CLIPTORA_STORAGE_ROOT")

    if configured:
        return Path(configured).expanduser().resolve()

    try:
        from app.core.Config import settings

        configured_path = settings().storage_path

        if configured_path:
            return Path(configured_path).expanduser().resolve()

    except (ImportError, AttributeError, TypeError):
        pass

    return (
        Path(__file__).resolve().parents[3] / "storage"
    ).resolve()


def media_root() -> Path:
    """Canonical root for every project media asset."""
    configured = os.environ.get("CLIPTORA_MEDIA_ROOT")

    if configured:
        return Path(configured).expanduser().resolve()

    return (storage_root() / "media").resolve()


def project_media_dir(user_id: int, project_id: int) -> Path:
    user = int(user_id)
    project = int(project_id)

    if user <= 0 or project <= 0:
        raise ValueError(
            "User and project IDs must be positive integers"
        )

    return media_root() / str(user) / str(project)


def run_media_dir(workdir: Path) -> Path:
    """Resolve the media folder belonging to a workflow run."""
    path = Path(workdir).expanduser().resolve()

    if (
        path.parent.name != "runs"
        or not path.name.isdecimal()
        or not path.parent.parent.name.isdecimal()
        or not path.parent.parent.parent.name.isdecimal()
    ):
        raise ValueError(
            "Expected a workflow workspace shaped as "
            "<workflow_root>/<user>/<project>/runs/<run_id>"
        )

    user_id = int(path.parent.parent.parent.name)
    project_id = int(path.parent.parent.name)
    run_id = int(path.name)

    if user_id <= 0 or project_id <= 0 or run_id <= 0:
        raise ValueError(
            "Workflow workspace IDs must be positive integers"
        )

    return (
        project_media_dir(user_id, project_id)
        / "workflow-runs"
        / str(run_id)
    )
