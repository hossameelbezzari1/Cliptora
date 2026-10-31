"""Class-based HTTP controller. Router is separate from business logic."""
from __future__ import annotations
from fastapi import APIRouter, Depends
from app.services.library_service import *
from app.services.library_service import LibraryService

class LibraryController:
    def __init__(self):
        self.service = LibraryService()

    def listing(self, kind: Kind | None=None, user: User=Depends(current_user), db: Session=Depends(get_library_db)):
        return self.service.listing(kind=kind, user=user, db=db)

    def create(self, data: ItemIn, user: User=Depends(current_user), db: Session=Depends(get_library_db)):
        return self.service.create(data=data, user=user, db=db)

    def update(self, item_id: int, data: ItemPatch, user: User=Depends(current_user), db: Session=Depends(get_library_db)):
        return self.service.update(item_id=item_id, data=data, user=user, db=db)

    def delete(self, item_id: int, user: User=Depends(current_user), db: Session=Depends(get_library_db)):
        return self.service.delete(item_id=item_id, user=user, db=db)

controller = LibraryController()
router = APIRouter(prefix='/library', tags=['Personal library'])
router.add_api_route('', controller.listing, methods=["GET"])
router.add_api_route('', controller.create, methods=["POST"], status_code=201)
router.add_api_route('/{item_id}', controller.update, methods=["PATCH"])
router.add_api_route('/{item_id}', controller.delete, methods=["DELETE"], status_code=204)
