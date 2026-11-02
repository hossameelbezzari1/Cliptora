from typing import Generic, TypeVar
from sqlalchemy.orm import Session

T = TypeVar("T")

class BaseRepository(Generic[T]):
    def __init__(self, db: Session, model: type[T]):
        self.db, self.model = db, model

    def get(self, identifier: int) -> T | None:
        return self.db.get(self.model, identifier)

    def add(self, instance: T) -> T:
        self.db.add(instance)
        self.db.flush()
        return instance

    def delete(self, instance: T) -> None:
        self.db.delete(instance)
