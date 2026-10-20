from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session
from app.api.v1.deps import owned_project
from app.core.database import get_db
from app.core.security import current_user
from app.models import Project, User, Track, Clip
from uuid import uuid4
from app.schemas.objects import ProjectIn, ProjectOut

router=APIRouter(prefix='/projects',tags=['Projects'])

@router.get('',response_model=list[ProjectOut])
def listing(db:Session=Depends(get_db),user:User=Depends(current_user)):
    return db.scalars(select(Project).where(Project.owner_id==user.id).order_by(Project.updated_at.desc())).all()

@router.post('',response_model=ProjectOut,status_code=201)
def create(data:ProjectIn,db:Session=Depends(get_db),user:User=Depends(current_user)):
    p=Project(owner_id=user.id,**data.model_dump());db.add(p);db.flush()
    for position in range(3):
        db.add(Track(project_id=p.id,client_id=str(uuid4()),name=f'Layer {position+1}',type='mixed',position=position,hidden=False,muted=False,locked=False))
    db.commit();db.refresh(p);return p

@router.get('/{project_id}',response_model=ProjectOut)
def get(project:Project=Depends(owned_project)):
    return project

@router.patch('/{project_id}',response_model=ProjectOut)
def update(data:ProjectIn,project:Project=Depends(owned_project),db:Session=Depends(get_db)):
    for key,val in data.model_dump().items(): setattr(project,key,val)
    db.commit();db.refresh(project);return project

@router.delete('/{project_id}',status_code=204)
def remove(project:Project=Depends(owned_project),db:Session=Depends(get_db)):
    db.delete(project);db.commit()

@router.post('/{project_id}/duplicate',response_model=ProjectOut,status_code=201)
def duplicate(project:Project=Depends(owned_project),db:Session=Depends(get_db)):
    clone=Project(owner_id=project.owner_id,name=f'{project.name} (copy)'[:160],width=project.width,height=project.height,fps=project.fps)
    db.add(clone);db.flush()
    for position in range(3):
        db.add(Track(project_id=clone.id,client_id=str(uuid4()),name=f'Layer {position+1}',type='mixed',position=position,hidden=False,muted=False,locked=False))
    db.commit();db.refresh(clone);return clone
