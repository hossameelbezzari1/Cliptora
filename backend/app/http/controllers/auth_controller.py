"""Class-based HTTP controller. Router is separate from business logic."""
from __future__ import annotations
from fastapi import APIRouter, Depends
from app.services.auth_service import *
from app.services.auth_service import AuthService

class AuthController:
    def __init__(self):
        self.service = AuthService()

    def csrf(self, response: Response):
        return self.service.csrf(response=response)

    def register(self, data: RegisterIn, response: Response, db: Session=Depends(get_db)):
        return self.service.register(data=data, response=response, db=db)

    def login(self, data: LoginIn, response: Response, db: Session=Depends(get_db)):
        return self.service.login(data=data, response=response, db=db)

    def me(self, user: User=Depends(current_user)):
        return self.service.me(user=user)

    def logout(self, response: Response, session: str | None=Cookie(default=None, alias=SESSION_COOKIE), db: Session=Depends(get_db)):
        return self.service.logout(response=response, session=session, db=db)

    def forgot(self, data: ForgotIn, db: Session=Depends(get_db)):
        return self.service.forgot(data=data, db=db)

    def reset(self, data: ResetIn, db: Session=Depends(get_db)):
        return self.service.reset(data=data, db=db)

controller = AuthController()
router = APIRouter(prefix='/auth', tags=['Auth'])
router.add_api_route('/csrf', controller.csrf, methods=["GET"])
router.add_api_route('/register', controller.register, methods=["POST"], response_model=UserOut, status_code=201)
router.add_api_route('/login', controller.login, methods=["POST"], response_model=UserOut)
router.add_api_route('/me', controller.me, methods=["GET"], response_model=UserOut)
router.add_api_route('/logout', controller.logout, methods=["POST"], status_code=204)
router.add_api_route('/forgot-password', controller.forgot, methods=["POST"])
router.add_api_route('/reset-password', controller.reset, methods=["POST"])
