"""Class-based HTTP controller. Router is separate from business logic."""
from __future__ import annotations
from fastapi import APIRouter, Depends
from app.services.media_service import *
from app.services.media_service import MediaService

class MediaController:
    def __init__(self):
        self.service = MediaService()

    def listing(self, project: Project=Depends(owned_project), db: Session=Depends(get_db)):
        return self.service.listing(project=project, db=db)

    async def upload(self, file: UploadFile=File(...), project: Project=Depends(owned_project), db: Session=Depends(get_db)):
        return await self.service.upload(file=file, project=project, db=db)

    def download(self, media_id: int, db: Session=Depends(get_db), user: User=Depends(current_user)):
        return self.service.download(media_id=media_id, db=db, user=user)

    def delete_media(self, media_id: int, db: Session=Depends(get_db), user: User=Depends(current_user)):
        return self.service.delete_media(media_id=media_id, db=db, user=user)

controller = MediaController()
router = APIRouter(tags=['Media'])
router.add_api_route('/projects/{project_id}/media', controller.listing, methods=["GET"], response_model=list[MediaOut])
router.add_api_route('/projects/{project_id}/media', controller.upload, methods=["POST"], response_model=MediaOut, status_code=201)
router.add_api_route('/media/{media_id}/file', controller.download, methods=["GET"])
router.add_api_route('/media/{media_id}', controller.delete_media, methods=["DELETE"], status_code=204)
