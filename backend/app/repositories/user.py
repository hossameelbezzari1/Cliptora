from sqlalchemy import select
from app.models import User
from .base import BaseRepository

class UserRepository(BaseRepository[User]):
    def __init__(self, db):
        super().__init__(db, User)

    def by_email(self, email: str):
        return self.db.scalar(select(User).where(User.email == email.strip().lower()))
