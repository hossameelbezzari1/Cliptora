from fastapi import APIRouter, Depends, HTTPException

from sqlalchemy import select

from sqlalchemy.orm import Session

from app.http.dependencies import owned_project

from app.core.database import get_db

from app.core.security import current_user

from app.models import Project, User, Track, Clip

from uuid import uuid4

from app.http.requests.project import ProjectIn
from app.http.resources.project import ProjectOut

from app.repositories.project import ProjectRepository


class ProjectsService:
    """Business operations previously mixed into API routes."""

    def listing(self, db:Session=Depends(get_db),user:User=Depends(current_user)):
        return ProjectRepository(db).list_for_user(user.id)

    def create(self, data:ProjectIn,db:Session=Depends(get_db),user:User=Depends(current_user)):
        p=Project(owner_id=user.id,**data.model_dump());ProjectRepository(db).add(p)
        for position in range(3):
            db.add(Track(project_id=p.id,client_id=str(uuid4()),name=f'Layer {position+1}',type='mixed',position=position,hidden=False,muted=False,locked=False))
        db.commit();db.refresh(p);return p

    def get(self, project:Project=Depends(owned_project)):
        return project

    def update(self, data:ProjectIn,project:Project=Depends(owned_project),db:Session=Depends(get_db)):
        for key,val in data.model_dump().items(): setattr(project,key,val)
        db.commit();db.refresh(project);return project

    def remove(self, project:Project=Depends(owned_project),db:Session=Depends(get_db)):
        db.delete(project);db.commit()

    def duplicate(self, project:Project=Depends(owned_project),db:Session=Depends(get_db)):
        clone=Project(owner_id=project.owner_id,name=f'{project.name} (copy)'[:160],width=project.width,height=project.height,fps=project.fps)
        db.add(clone);db.flush()
        for position in range(3):
            db.add(Track(project_id=clone.id,client_id=str(uuid4()),name=f'Layer {position+1}',type='mixed',position=position,hidden=False,muted=False,locked=False))
        db.commit();db.refresh(clone);return clone
