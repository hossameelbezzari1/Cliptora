from sqlalchemy import select
from app.models import AutomationCommand
from .BaseRepository import BaseRepository

class CommandRepository(BaseRepository[AutomationCommand]):
    def __init__(self, db):
        super().__init__(db, AutomationCommand)

    def for_user(self, user_id):
        return self.db.scalars(select(AutomationCommand).where(AutomationCommand.user_id == user_id).order_by(AutomationCommand.id.desc())).all()
