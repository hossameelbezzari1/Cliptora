"""Central media storage for CLIPTORA workflows."""
from __future__ import annotations

import os
from pathlib import Path


def media_root() -> Path:
    default = (
        Path(__file__).resolve().parents[3]
        / "storage"
        / "media"
    )
    configured = os.environ.get("CLIPTORA_MEDIA_ROOT")

    return (
        Path(configured).expanduser().resolve()
        if configured
        else default.resolve()
    )


def project_media_dir(user_id: int, project_id: int) -> Path:
    return (
        media_root()
        / str(int(user_id))
        / str(int(project_id))
    )


def run_media_dir(workdir: Path) -> Path:
    path = Path(workdir).resolve()

    if (
        path.parent.name != "runs"
        or not path.name.isdecimal()
        or not path.parent.parent.name.isdecimal()
        or not path.parent.parent.parent.name.isdecimal()
    ):
        raise ValueError(
            "Expected /<user>/<project>/runs/<run_id> workspace"
        )

    user_id = int(path.parent.parent.parent.name)
    project_id = int(path.parent.parent.name)

    return (
        project_media_dir(user_id, project_id)
        / "workflow-runs"
        / path.name
    )
