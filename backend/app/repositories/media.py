from sqlalchemy import select
from app.models import MediaAsset
from .base import BaseRepository

class MediaRepository(BaseRepository[MediaAsset]):
    def __init__(self, db):
        super().__init__(db, MediaAsset)

    def for_project(self, project_id):
        return self.db.scalars(select(MediaAsset).where(MediaAsset.project_id == project_id).order_by(MediaAsset.id.desc())).all()
