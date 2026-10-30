from datetime import timedelta
import secrets
from fastapi import APIRouter, Depends, HTTPException, Response, Cookie
from sqlalchemy import select, delete
from sqlalchemy.orm import Session
from app.core.database import get_db
from app.core.config import settings
from app.core.security import (CSRF_COOKIE, SESSION_COOKIE, create_csrf, current_user, digest, new_session, password_hash, set_cookie)
from app.models import User, PasswordReset, Session as LoginSession
from app.models.entities import now
from app.schemas.objects import RegisterIn, LoginIn, ForgotIn, ResetIn, UserOut

router = APIRouter(prefix='/auth',tags=['Auth'])

@router.get('/csrf')
def csrf(response: Response):
    token = create_csrf()
    set_cookie(response, CSRF_COOKIE, token, 60*60*24)
    return {'csrf_token':token}

@router.post('/register',response_model=UserOut,status_code=201)
def register(data: RegisterIn, response: Response, db: Session = Depends(get_db)):
    email = data.email.strip().lower()
    if '@' not in email:
        raise HTTPException(422, 'Invalid email.')
    if db.scalar(select(User).where(User.email==email)):
        raise HTTPException(409, 'This email is already registered.')
    user = User(email=email,display_name=data.display_name.strip(),password_hash=password_hash.hash(data.password))
    db.add(user); db.commit(); db.refresh(user)
    session = new_session(db,user)
    set_cookie(response, SESSION_COOKIE, session, settings().session_days*86400)
    return user

@router.post('/login',response_model=UserOut)
def login(data: LoginIn, response: Response, db: Session=Depends(get_db)):
    user = db.scalar(select(User).where(User.email==data.email.strip().lower()))
    if not user or not password_hash.verify(data.password,user.password_hash):
        raise HTTPException(401,'Incorrect email or password.')
    token = new_session(db,user)
    set_cookie(response,SESSION_COOKIE,token,settings().session_days*86400)
    return user

@router.get('/me',response_model=UserOut)
def me(user: User=Depends(current_user)):
    return user

@router.post('/logout',status_code=204)
def logout(response: Response, session: str|None=Cookie(default=None,alias=SESSION_COOKIE), db:Session=Depends(get_db)):
    if session:
        db.execute(delete(LoginSession).where(LoginSession.token_hash==digest(session)))
        db.commit()
    response.delete_cookie(SESSION_COOKIE,path='/')
    response.status_code=204

@router.post('/forgot-password')
def forgot(data:ForgotIn, db:Session=Depends(get_db)):
    user=db.scalar(select(User).where(User.email==data.email.strip().lower()))
    result={'message':'If this email exists, a recovery link will be sent.'}
    if not user:
        return result
    token=secrets.token_urlsafe(35)
    db.add(PasswordReset(user_id=user.id,token_hash=digest(token),expires_at=now()+timedelta(minutes=30)))
    db.commit()
    if not settings().production:
        result['dev_reset_token']=token
    return result

@router.post('/reset-password')
def reset(data:ResetIn,db:Session=Depends(get_db)):
    record=db.scalar(select(PasswordReset).where(PasswordReset.token_hash==digest(data.token)))
    if not record or record.expires_at<now():
        raise HTTPException(400,'Recovery link is invalid or expired.')
    user=db.get(User,record.user_id)
    if not user:
        raise HTTPException(400,'Recovery link is invalid.')
    user.password_hash=password_hash.hash(data.password)
    db.execute(delete(PasswordReset).where(PasswordReset.user_id==user.id))
    db.execute(delete(LoginSession).where(LoginSession.user_id==user.id))
    db.commit()
    return {'message':'Password changed. Please sign in.'}
