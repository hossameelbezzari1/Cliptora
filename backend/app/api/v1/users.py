from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from app.core.database import get_db
from app.core.security import current_user
from app.models import User
from app.schemas.objects import ProfileIn, UserOut

router=APIRouter(tags=['Profile'])
@router.patch('/profile',response_model=UserOut)
def update_profile(data:ProfileIn,db:Session=Depends(get_db),user:User=Depends(current_user)):
    user.display_name=data.display_name.strip()
    db.commit();db.refresh(user)
    return user
