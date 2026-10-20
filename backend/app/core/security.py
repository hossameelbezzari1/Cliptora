import hashlib
import hmac
import secrets
from datetime import timedelta
from fastapi import Cookie, Depends, HTTPException
from argon2 import PasswordHasher
from argon2.exceptions import VerificationError, InvalidHashError
from sqlalchemy import select
from sqlalchemy.orm import Session
from app.core.config import settings
from app.core.database import get_db
from app.models import User, Session as LoginSession
from app.models.entities import now

_hasher = PasswordHasher()
class password_hash:
    @staticmethod
    def hash(password: str) -> str:
        return _hasher.hash(password)
    @staticmethod
    def verify(password: str, encoded: str) -> bool:
        try:
            return _hasher.verify(encoded, password)
        except (VerificationError, InvalidHashError):
            return False
SESSION_COOKIE = 'cliptora_session'
CSRF_COOKIE = 'cliptora_csrf'

def digest(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()

def new_session(db: Session, user: User) -> str:
    token = secrets.token_urlsafe(40)
    db.add(LoginSession(user_id=user.id,token_hash=digest(token),expires_at=now()+timedelta(days=settings().session_days)))
    db.commit()
    return token

def user_from_session(db: Session, token: str | None) -> User | None:
    if not token:
        return None
    session = db.scalar(select(LoginSession).where(LoginSession.token_hash == digest(token)))
    if not session or session.expires_at < now():
        return None
    return db.get(User, session.user_id)

def current_user(db: Session = Depends(get_db), token: str | None = Cookie(default=None, alias=SESSION_COOKIE)) -> User:
    user = user_from_session(db, token)
    if not user:
        raise HTTPException(401, 'Please sign in.')
    return user

def create_csrf() -> str:
    nonce = secrets.token_urlsafe(30)
    sig = hmac.new(settings().secret_key.encode(), nonce.encode(), hashlib.sha256).hexdigest()
    return f'{nonce}.{sig}'

def valid_csrf(token: str | None) -> bool:
    if not token or '.' not in token:
        return False
    nonce,sig = token.rsplit('.',1)
    expected = hmac.new(settings().secret_key.encode(), nonce.encode(), hashlib.sha256).hexdigest()
    return hmac.compare_digest(sig,expected)

def set_cookie(response, name: str, token: str, max_age: int) -> None:
    response.set_cookie(name,token,httponly=True,samesite='lax',secure=settings().production,path='/',max_age=max_age)
