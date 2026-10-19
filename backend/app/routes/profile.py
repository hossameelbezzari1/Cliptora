from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import update
from sqlalchemy.orm import Session
from ..database import get_db
from ..models import AuthSession, User
from ..schemas import ChangePasswordIn, ProfileUpdate, UserOut
from ..security import get_current_user, hash_password, require_csrf, verify_password
router=APIRouter(prefix="/profile",tags=["profile"])
@router.get("",response_model=UserOut)
def get_profile(user:User=Depends(get_current_user)): return user
@router.patch("",response_model=UserOut,dependencies=[Depends(require_csrf)])
def update_profile(data:ProfileUpdate,user:User=Depends(get_current_user),db:Session=Depends(get_db)):
    user.display_name=data.display_name.strip(); db.commit(); db.refresh(user); return user
@router.post("/change-password",dependencies=[Depends(require_csrf)])
def change_password(data:ChangePasswordIn,user:User=Depends(get_current_user),db:Session=Depends(get_db)):
    if not verify_password(user.password_hash,data.current_password): raise HTTPException(400,"Current password is incorrect.")
    user.password_hash=hash_password(data.new_password); now=datetime.now(timezone.utc); db.execute(update(AuthSession).where(AuthSession.user_id==user.id).values(revoked_at=now)); db.commit(); return {"message":"Password changed. Please sign in again."}
