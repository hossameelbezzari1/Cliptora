from fastapi import Depends, HTTPException
from sqlalchemy.orm import Session
from app.core.database import get_db
from app.core.security import current_user
from app.models import Project, User

def owned_project(project_id: int, db: Session = Depends(get_db), user: User = Depends(current_user)) -> Project:
    project = db.get(Project,project_id)
    if not project or project.owner_id != user.id:
        raise HTTPException(404, 'Project not found.')
    return project
