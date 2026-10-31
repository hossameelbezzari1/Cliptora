"""Class-based HTTP controller. Router is separate from business logic."""
from __future__ import annotations
from fastapi import APIRouter, Depends
from app.services.projects_service import *
from app.services.projects_service import ProjectsService

class ProjectsController:
    def __init__(self):
        self.service = ProjectsService()

    def listing(self, db: Session=Depends(get_db), user: User=Depends(current_user)):
        return self.service.listing(db=db, user=user)

    def create(self, data: ProjectIn, db: Session=Depends(get_db), user: User=Depends(current_user)):
        return self.service.create(data=data, db=db, user=user)

    def get(self, project: Project=Depends(owned_project)):
        return self.service.get(project=project)

    def update(self, data: ProjectIn, project: Project=Depends(owned_project), db: Session=Depends(get_db)):
        return self.service.update(data=data, project=project, db=db)

    def remove(self, project: Project=Depends(owned_project), db: Session=Depends(get_db)):
        return self.service.remove(project=project, db=db)

    def duplicate(self, project: Project=Depends(owned_project), db: Session=Depends(get_db)):
        return self.service.duplicate(project=project, db=db)

controller = ProjectsController()
router = APIRouter(prefix='/projects', tags=['Projects'])
router.add_api_route('', controller.listing, methods=["GET"], response_model=list[ProjectOut])
router.add_api_route('', controller.create, methods=["POST"], response_model=ProjectOut, status_code=201)
router.add_api_route('/{project_id}', controller.get, methods=["GET"], response_model=ProjectOut)
router.add_api_route('/{project_id}', controller.update, methods=["PATCH"], response_model=ProjectOut)
router.add_api_route('/{project_id}', controller.remove, methods=["DELETE"], status_code=204)
router.add_api_route('/{project_id}/duplicate', controller.duplicate, methods=["POST"], response_model=ProjectOut, status_code=201)
