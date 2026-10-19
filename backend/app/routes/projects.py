from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy import delete, select
from sqlalchemy.orm import Session
from ..database import get_db
from ..models import Project, Track, User
from ..schemas import ProjectIn, ProjectOut, ProjectUpdate, TimelineIn, TimelineOut, TrackOut
from ..security import get_current_user, require_csrf

router=APIRouter(prefix="/projects",tags=["projects"])
def owned(project_id:int,user:User,db:Session)->Project:
    project=db.scalar(select(Project).where(Project.id==project_id,Project.user_id==user.id))
    if not project: raise HTTPException(404,"Project not found")
    return project

@router.get("",response_model=list[ProjectOut])
def list_projects(user:User=Depends(get_current_user),db:Session=Depends(get_db)): return list(db.scalars(select(Project).where(Project.user_id==user.id).order_by(Project.updated_at.desc())))
@router.post("",response_model=ProjectOut,status_code=201,dependencies=[Depends(require_csrf)])
def create_project(data:ProjectIn,user:User=Depends(get_current_user),db:Session=Depends(get_db)):
    project=Project(user_id=user.id,**data.model_dump()); db.add(project); db.commit(); db.refresh(project); return project
@router.get("/{project_id}",response_model=ProjectOut)
def get_project(project_id:int,user:User=Depends(get_current_user),db:Session=Depends(get_db)): return owned(project_id,user,db)
@router.patch("/{project_id}",response_model=ProjectOut,dependencies=[Depends(require_csrf)])
def update_project(project_id:int,data:ProjectUpdate,user:User=Depends(get_current_user),db:Session=Depends(get_db)):
    project=owned(project_id,user,db)
    for key,value in data.model_dump(exclude_unset=True).items(): setattr(project,key,value)
    project.revision+=1; project.updated_at=datetime.now(timezone.utc); db.commit(); db.refresh(project); return project
@router.delete("/{project_id}",status_code=204,dependencies=[Depends(require_csrf)])
def delete_project(project_id:int,user:User=Depends(get_current_user),db:Session=Depends(get_db)): db.delete(owned(project_id,user,db)); db.commit()
@router.post("/{project_id}/duplicate",response_model=ProjectOut,status_code=201,dependencies=[Depends(require_csrf)])
def duplicate_project(project_id:int,user:User=Depends(get_current_user),db:Session=Depends(get_db)):
    source=owned(project_id,user,db); clone=Project(user_id=user.id,name=f"{source.name} copy",width=source.width,height=source.height,aspect_ratio=source.aspect_ratio,fps=source.fps); db.add(clone); db.flush()
    for track in source.tracks: db.add(Track(project_id=clone.id,client_id=f"{track.client_id}-copy",name=track.name,type=track.type,position=track.position,hidden=track.hidden,muted=track.muted,locked=track.locked))
    db.commit(); db.refresh(clone); return clone
@router.get("/{project_id}/timeline",response_model=TimelineOut)
def get_timeline(project_id:int,user:User=Depends(get_current_user),db:Session=Depends(get_db)):
    project=owned(project_id,user,db); return TimelineOut(revision=project.revision,tracks=[TrackOut.model_validate(t) for t in project.tracks])
@router.put("/{project_id}/timeline",response_model=TimelineOut,dependencies=[Depends(require_csrf)])
def save_timeline(project_id:int,data:TimelineIn,user:User=Depends(get_current_user),db:Session=Depends(get_db)):
    project=owned(project_id,user,db)
    if data.revision!=project.revision: raise HTTPException(409,"This project changed in another session. Refresh before saving.")
    db.execute(delete(Track).where(Track.project_id==project.id))
    seen=set()
    for index,item in enumerate(sorted(data.tracks,key=lambda x:x.position)):
        if item.client_id in seen: raise HTTPException(422,"Track identifiers must be unique")
        seen.add(item.client_id); db.add(Track(project_id=project.id,client_id=item.client_id,name=item.name,type=item.type,position=index,hidden=item.hidden,muted=item.muted,locked=item.locked))
    project.revision+=1; project.updated_at=datetime.now(timezone.utc); db.commit(); db.refresh(project); return TimelineOut(revision=project.revision,tracks=[TrackOut.model_validate(t) for t in project.tracks])
