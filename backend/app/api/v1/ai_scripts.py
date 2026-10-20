from fastapi import APIRouter,Depends,HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session
from app.api.v1.deps import owned_project
from app.core.database import get_db
from app.models import AIScript,Project
from app.schemas.objects import AIScriptIn,AIScriptOut

router=APIRouter(prefix='/projects',tags=['AI Scripts'])

@router.get('/{project_id}/ai-scripts',response_model=list[AIScriptOut])
def listing(project:Project=Depends(owned_project),db:Session=Depends(get_db)):
    return db.scalars(select(AIScript).where(AIScript.project_id==project.id).order_by(AIScript.id.desc())).all()

@router.post('/{project_id}/ai-scripts',response_model=AIScriptOut,status_code=201)
def add(data:AIScriptIn,project:Project=Depends(owned_project),db:Session=Depends(get_db)):
    script=AIScript(project_id=project.id,**data.model_dump());db.add(script);db.commit();db.refresh(script);return script

@router.delete('/{project_id}/ai-scripts/{script_id}',status_code=204)
def remove(script_id:int,project:Project=Depends(owned_project),db:Session=Depends(get_db)):
    script=db.get(AIScript,script_id)
    if not script or script.project_id!=project.id: raise HTTPException(404,'Script not found.')
    db.delete(script);db.commit()
