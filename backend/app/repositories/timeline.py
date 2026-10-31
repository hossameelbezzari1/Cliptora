from sqlalchemy import select
from app.models import Track
from .base import BaseRepository

class TimelineRepository(BaseRepository[Track]):
    def __init__(self, db):
        super().__init__(db, Track)

    def for_project(self, project_id):
        return self.db.scalars(select(Track).where(Track.project_id == project_id).order_by(Track.position)).all()
