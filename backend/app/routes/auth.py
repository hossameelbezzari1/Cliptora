import secrets
from datetime import datetime, timedelta, timezone
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from sqlalchemy import func, select, update
from sqlalchemy.orm import Session
from ..config import get_settings
from ..database import get_db
from ..models import AuthSession, PasswordResetToken, User
from ..schemas import ForgotIn, LoginIn, RegisterIn, ResetIn, UserOut
from ..security import create_session, digest, get_current_session, get_current_user, hash_password, rate_limit, require_csrf, verify_password

router=APIRouter(prefix="/auth",tags=["auth"]); settings=get_settings()

@router.get("/csrf")
def csrf(request: Request, response: Response, db: Session = Depends(get_db)):
    token=secrets.token_urlsafe(32)
    session_secret=request.cookies.get(settings.session_cookie)
    if session_secret:
        session=db.scalar(select(AuthSession).where(AuthSession.secret_hash==digest(session_secret),AuthSession.revoked_at.is_(None)))
        if session:
            session.csrf_hash=digest(token); db.commit()
    response.set_cookie("cliptora_csrf",token,httponly=False,secure=settings.cookie_secure,samesite="lax",path="/")
    return {"csrf_token":token}

@router.post("/register",response_model=UserOut,dependencies=[Depends(require_csrf)])
def register(data:RegisterIn,request:Request,response:Response,db:Session=Depends(get_db)):
    rate_limit(request,"register",5,300); email=str(data.email).strip().lower()
    if db.scalar(select(User).where(func.lower(User.email)==email)): raise HTTPException(409,"An account with this email already exists.")
    user=User(email=email,display_name=data.display_name.strip(),password_hash=hash_password(data.password)); db.add(user); db.commit(); db.refresh(user); create_session(db,user,response); return user

@router.post("/login",response_model=UserOut,dependencies=[Depends(require_csrf)])
def login(data:LoginIn,request:Request,response:Response,db:Session=Depends(get_db)):
    rate_limit(request,"login",10,60); user=db.scalar(select(User).where(func.lower(User.email)==str(data.email).lower()))
    if not user or not verify_password(user.password_hash,data.password): raise HTTPException(401,"Invalid email or password.")
    create_session(db,user,response); return user

@router.get("/me",response_model=UserOut)
def me(user:User=Depends(get_current_user)): return user

@router.post("/logout",status_code=204,dependencies=[Depends(require_csrf)])
def logout(response:Response,session:AuthSession=Depends(get_current_session),db:Session=Depends(get_db)):
    session.revoked_at=datetime.now(timezone.utc); db.commit(); response.delete_cookie(settings.session_cookie,path="/"); response.delete_cookie("cliptora_csrf",path="/")

@router.post("/forgot-password",dependencies=[Depends(require_csrf)])
def forgot(data:ForgotIn,request:Request,db:Session=Depends(get_db)):
    rate_limit(request,"forgot",5,300); user=db.scalar(select(User).where(func.lower(User.email)==str(data.email).lower())); result={"message":"If the address exists, a reset link has been sent."}
    if user:
        raw=secrets.token_urlsafe(40); db.add(PasswordResetToken(user_id=user.id,token_hash=digest(raw),expires_at=datetime.now(timezone.utc)+timedelta(minutes=settings.reset_token_minutes))); db.commit()
        if settings.dev_expose_reset_link: result["dev_reset_url"]=f"{settings.frontend_url}/reset-password?token={raw}"
    return result

@router.post("/reset-password",dependencies=[Depends(require_csrf)])
def reset(data:ResetIn,db:Session=Depends(get_db)):
    token=db.scalar(select(PasswordResetToken).where(PasswordResetToken.token_hash==digest(data.token))); now=datetime.now(timezone.utc)
    if not token or token.used_at or token.expires_at.replace(tzinfo=timezone.utc)<=now: raise HTTPException(400,"This reset link is invalid or expired.")
    user=db.get(User,token.user_id); user.password_hash=hash_password(data.password); token.used_at=now; db.execute(update(AuthSession).where(AuthSession.user_id==user.id,AuthSession.revoked_at.is_(None)).values(revoked_at=now)); db.commit(); return {"message":"Password reset successfully."}
