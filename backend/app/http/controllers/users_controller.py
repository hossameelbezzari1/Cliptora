"""Class-based HTTP controller. Router is separate from business logic."""
from __future__ import annotations
from fastapi import APIRouter, Depends
from app.services.users_service import *
from app.services.users_service import UsersService

class UsersController:
    def __init__(self):
        self.service = UsersService()

    def update_profile(self, data: ProfileIn, db: Session=Depends(get_db), user: User=Depends(current_user)):
        return self.service.update_profile(data=data, db=db, user=user)

controller = UsersController()
router = APIRouter(tags=['Profile'])
router.add_api_route('/profile', controller.update_profile, methods=["PATCH"], response_model=UserOut)
