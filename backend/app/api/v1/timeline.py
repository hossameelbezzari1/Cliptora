from fastapi import APIRouter,Depends,HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session,selectinload
from app.api.v1.deps import owned_project
from app.core.database import get_db
from app.models import Project,Track,Clip,MediaAsset
from app.schemas.objects import TimelineIn,TimelineOut,TrackIn,ClipIn
from app.models.entities import now

router=APIRouter(prefix='/projects',tags=['Timeline'])

def serialize(db:Session,project:Project)->dict:
    tracks=db.scalars(select(Track).where(Track.project_id==project.id).options(selectinload(Track.clips)).order_by(Track.position)).all()
    return {'revision':project.revision,'tracks':[{'client_id':t.client_id,'name':t.name,'type':t.type,'position':t.position,'hidden':t.hidden,'muted':t.muted,'locked':t.locked,'clips':[{'client_id':c.client_id,'name':c.name,'type':c.type,'start':c.start,'duration':c.duration,'source_offset':c.source_offset,'media_id':c.media_id,'text':c.text,'color':c.color} for c in t.clips]} for t in tracks]}

@router.get('/{project_id}/timeline',response_model=TimelineOut)
def get(project:Project=Depends(owned_project),db:Session=Depends(get_db)):
    return serialize(db,project)

@router.put('/{project_id}/timeline',response_model=TimelineOut)
def put(data:TimelineIn,project:Project=Depends(owned_project),db:Session=Depends(get_db)):
    locked=db.scalar(select(Project).where(Project.id==project.id).with_for_update())
    if locked.revision!=data.revision:
        raise HTTPException(409,'Timeline was edited elsewhere. Refresh to reload.')
    if len({t.client_id for t in data.tracks})!=len(data.tracks):
        raise HTTPException(422,'Duplicate track IDs.')
    all_clips=[clip for track in data.tracks for clip in track.clips]
    if len(all_clips)>500 or len({c.client_id for c in all_clips})!=len(all_clips):
        raise HTTPException(422,'Too many or duplicate clips.')
    media_ids={c.media_id for c in all_clips if c.media_id is not None}
    allowed=set(db.scalars(select(MediaAsset.id).where(MediaAsset.project_id==project.id,MediaAsset.id.in_(media_ids))).all()) if media_ids else set()
    if media_ids!=allowed:
        raise HTTPException(422,'A clip references media outside this project.')
    for track in data.tracks:
        for clip in track.clips:
            if clip.start+clip.duration>14400 or (clip.type=='text' and track.type!='text') or (clip.type=='audio' and track.type!='audio') or (clip.type in ('image','video') and track.type!='video'):
                raise HTTPException(422,'Invalid clip duration or track type.')
    for t in db.scalars(select(Track).where(Track.project_id==project.id)).all(): db.delete(t)
    db.flush()
    for t in data.tracks:
        tr=Track(project_id=project.id,**t.model_dump(exclude={'clips'}));db.add(tr);db.flush()
        for c in t.clips: db.add(Clip(track_id=tr.id,**c.model_dump()))
    project.revision+=1;project.updated_at=now()
    db.commit()
    return serialize(db,project)
