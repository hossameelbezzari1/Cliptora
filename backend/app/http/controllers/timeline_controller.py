"""Class-based HTTP controller. Router is separate from business logic."""
from __future__ import annotations
from fastapi import APIRouter, Depends
from app.services.timeline_service import *
from app.services.timeline_service import TimelineService

class TimelineController:
    def __init__(self):
        self.service = TimelineService()

    def get(self, project: Project=Depends(owned_project), db: Session=Depends(get_db)):
        return self.service.get(project=project, db=db)

    def put(self, data: TimelineIn, project: Project=Depends(owned_project), db: Session=Depends(get_db)):
        return self.service.put(data=data, project=project, db=db)

controller = TimelineController()
router = APIRouter(prefix='/projects', tags=['Timeline'])
router.add_api_route('/{project_id}/timeline', controller.get, methods=["GET"], response_model=TimelineOut)
router.add_api_route('/{project_id}/timeline', controller.put, methods=["PUT"], response_model=TimelineOut)
