
from __future__ import annotations

import uuid
from pathlib import Path

from fastapi import Depends, File, HTTPException, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy import inspect, select
from sqlalchemy.orm import Session

from app.core.Config import settings
from app.core.Database import get_db
from app.core.Security import current_user
from app.http.Dependencies import owned_project
from app.http.resources.MediaResource import MediaOut
from app.models import (
    Clip,
    MediaAsset,
    Project,
    Track,
    User,
    WorkflowSource,
)
from app.repositories.MediaRepository import MediaRepository
from app.workflows.MediaStorage import project_media_dir


ALLOWED = {
    "video/mp4": ("video", ".mp4"),
    "video/webm": ("video", ".webm"),
    "video/quicktime": ("video", ".mov"),
    "image/jpeg": ("image", ".jpg"),
    "image/png": ("image", ".png"),
    "image/webp": ("image", ".webp"),
    "audio/mpeg": ("audio", ".mp3"),
    "audio/wav": ("audio", ".wav"),
    "audio/x-wav": ("audio", ".wav"),
    "audio/ogg": ("audio", ".ogg"),
    "audio/mp4": ("audio", ".m4a"),
    "audio/webm": ("audio", ".webm"),
}


class MediaService:

    def listing(
        self,
        project: Project = Depends(owned_project),
        db: Session = Depends(get_db),
    ):
        return MediaRepository(db).for_project(project.id)

    async def upload(
        self,
        file: UploadFile = File(...),
        project: Project = Depends(owned_project),
        db: Session = Depends(get_db),
    ):
        mime = (
            (file.content_type or "")
            .split(";")[0]
            .lower()
        )

        if mime not in ALLOWED:
            raise HTTPException(
                415,
                "Supported formats: MP4, WebM, MOV, JPG, PNG, WebP, MP3, WAV, OGG, M4A.",
            )

        kind, extension = ALLOWED[mime]

        folder = project_media_dir(
            project.owner_id,
            project.id,
        )

        folder.mkdir(
            parents=True,
            exist_ok=True,
        )

        path = folder / f"{uuid.uuid4().hex}{extension}"

        max_bytes = settings().max_upload_mb * 1024 * 1024
        size = 0

        try:
            with path.open("wb") as output:
                while chunk := await file.read(1024 * 1024):
                    size += len(chunk)

                    if size > max_bytes:
                        raise HTTPException(
                            413,
                            f"File exceeds {settings().max_upload_mb} MB limit.",
                        )

                    output.write(chunk)

        except Exception:
            path.unlink(missing_ok=True)
            raise

        finally:
            await file.close()

        asset = MediaAsset(
            project_id=project.id,
            name=Path(file.filename or "Untitled").name[:255],
            kind=kind,
            mime=mime,
            disk_path=str(path.resolve()),
            size_bytes=size,
        )

        db.add(asset)
        db.commit()
        db.refresh(asset)

        return asset

    def download(
        self,
        media_id: int,
        db: Session = Depends(get_db),
        user: User = Depends(current_user),
    ):
        item = db.get(MediaAsset, media_id)

        if not item or not db.scalar(
            select(Project.id).where(
                Project.id == item.project_id,
                Project.owner_id == user.id,
            )
        ):
            raise HTTPException(404, "Media not found.")

        path = Path(item.disk_path)

        if not path.is_file():
            raise HTTPException(404, "Media file is missing.")

        return FileResponse(
            path,
            media_type=item.mime,
            filename=item.name,
            content_disposition_type="inline",
        )

    def delete_media(
        self,
        media_id: int,
        db: Session = Depends(get_db),
        user: User = Depends(current_user),
    ):
        item = db.get(MediaAsset, media_id)

        if not item or not db.scalar(
            select(Project.id).where(
                Project.id == item.project_id,
                Project.owner_id == user.id,
            )
        ):
            raise HTTPException(404, "Media not found.")

        linked_timeline = db.scalar(
            select(Project.id)
            .join(Track, Track.project_id == Project.id)
            .join(Clip, Clip.track_id == Track.id)
            .where(Clip.media_id == item.id)
            .limit(1)
        )

        if linked_timeline:
            raise HTTPException(
                409,
                "Remove this media from the timeline before deleting it.",
            )

        # Workflow tables may not exist yet on a fresh installation.
        inspector = inspect(db.get_bind())

        if inspector.has_table(WorkflowSource.__tablename__):
            columns = {
                column["name"]
                for column in inspector.get_columns(
                    WorkflowSource.__tablename__
                )
            }

            if "media_id" in columns:
                linked_workflow = db.scalar(
                    select(WorkflowSource.id)
                    .where(
                        WorkflowSource.media_id == item.id
                    )
                    .limit(1)
                )

                if linked_workflow is not None:
                    raise HTTPException(
                        409,
                        "This media is used as a Workflow source. Remove that source before deleting it.",
                    )

        path = Path(item.disk_path)

        managed_root = project_media_dir(
            user.id,
            item.project_id,
        ).resolve()

        resolved_path = path.resolve()

        if not resolved_path.is_relative_to(managed_root):
            raise HTTPException(
                409,
                "This media file is outside the managed project storage and cannot be deleted automatically.",
            )

        db.delete(item)
        db.commit()

        resolved_path.unlink(missing_ok=True)
