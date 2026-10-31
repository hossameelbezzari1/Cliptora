from sqlalchemy import select
from app.models import Project
from .base import BaseRepository

class ProjectRepository(BaseRepository[Project]):
    def __init__(self, db):
        super().__init__(db, Project)

    def owned(self, project_id: int, user_id: int):
        return self.db.scalar(select(Project).where(Project.id == project_id, Project.owner_id == user_id))

    def list_for_user(self, user_id: int):
        return self.db.scalars(select(Project).where(Project.owner_id == user_id).order_by(Project.updated_at.desc())).all()
