from sqlalchemy import select
from app.models import UserLibraryItem
from .base import BaseRepository

class LibraryRepository(BaseRepository[UserLibraryItem]):
    def __init__(self, db):
        super().__init__(db, UserLibraryItem)

    def for_user(self, user_id, kind=None):
        query = select(UserLibraryItem).where(UserLibraryItem.user_id == user_id)
        if kind:
            query = query.where(UserLibraryItem.kind == kind)
        return self.db.scalars(query.order_by(UserLibraryItem.id.desc())).all()
