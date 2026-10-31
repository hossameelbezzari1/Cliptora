import os

import uuid

from pathlib import Path

from fastapi import APIRouter,Depends,HTTPException,UploadFile,File

from fastapi.responses import FileResponse

from sqlalchemy import select

from sqlalchemy.orm import Session

from app.http.dependencies import owned_project

from app.core.database import get_db

from app.core.security import current_user

from app.core.config import settings

from app.models import Project,MediaAsset,User,Track,Clip

from app.http.resources.media import MediaOut

ALLOWED={'video/mp4':('video','.mp4'),'video/webm':('video','.webm'),'video/quicktime':('video','.mov'),'image/jpeg':('image','.jpg'),'image/png':('image','.png'),'image/webp':('image','.webp'),'audio/mpeg':('audio','.mp3'),'audio/wav':('audio','.wav'),'audio/x-wav':('audio','.wav'),'audio/ogg':('audio','.ogg'),'audio/mp4':('audio','.m4a'),'audio/webm':('audio','.webm')}

from app.repositories.media import MediaRepository


class MediaService:
    """Business operations previously mixed into API routes."""

    def listing(self, project:Project=Depends(owned_project),db:Session=Depends(get_db)):
        return MediaRepository(db).for_project(project.id)

    async def upload(self, file:UploadFile=File(...),project:Project=Depends(owned_project),db:Session=Depends(get_db)):
        mime=(file.content_type or '').split(';')[0].lower()
        if mime not in ALLOWED: raise HTTPException(415,'Supported formats: MP4, WebM, MOV, JPG, PNG, WebP, MP3, WAV, OGG, M4A.')
        kind,ext=ALLOWED[mime]
        folder=settings().storage_path/'media'/str(project.owner_id)/str(project.id)
        folder.mkdir(parents=True,exist_ok=True)
        path=folder/(uuid.uuid4().hex+ext)
        max_bytes=settings().max_upload_mb*1024*1024
        size=0
        try:
            with path.open('wb') as output:
                while chunk:=await file.read(1024*1024):
                    size+=len(chunk)
                    if size>max_bytes: raise HTTPException(413,f'File exceeds {settings().max_upload_mb} MB limit.')
                    output.write(chunk)
        except Exception:
            path.unlink(missing_ok=True)
            raise
        finally:
            await file.close()
        asset=MediaAsset(project_id=project.id,name=Path(file.filename or 'Untitled').name[:255],kind=kind,mime=mime,disk_path=str(path),size_bytes=size)
        db.add(asset);db.commit();db.refresh(asset)
        return asset

    def download(self, media_id:int,db:Session=Depends(get_db),user:User=Depends(current_user)):
        item=db.get(MediaAsset,media_id)
        if not item or not db.scalar(select(Project.id).where(Project.id==item.project_id,Project.owner_id==user.id)):
            raise HTTPException(404,'Media not found.')
        path=Path(item.disk_path)
        if not path.is_file(): raise HTTPException(404,'Media file is missing.')
        return FileResponse(path,media_type=item.mime,filename=item.name,content_disposition_type='inline')

    def delete_media(self, media_id:int,db:Session=Depends(get_db),user:User=Depends(current_user)):
        item=db.get(MediaAsset,media_id)
        if not item or not db.scalar(select(Project.id).where(Project.id==item.project_id,Project.owner_id==user.id)):
            raise HTTPException(404,'Media not found.')
        linked=db.scalar(select(Project.id).join(Track,Track.project_id==Project.id).join(Clip,Clip.track_id==Track.id).where(Clip.media_id==item.id).limit(1))
        if linked: raise HTTPException(409,'Remove this media from the timeline before deleting it.')
        path=Path(item.disk_path)
        db.delete(item);db.commit()
        path.unlink(missing_ok=True)
