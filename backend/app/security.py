import hashlib, secrets, time
from collections import defaultdict, deque
from datetime import datetime, timedelta, timezone
from fastapi import Cookie, Depends, Header, HTTPException, Request, Response, status
from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError
from sqlalchemy import select
from sqlalchemy.orm import Session
from .config import get_settings
from .database import get_db
from .models import AuthSession, User

settings = get_settings(); hasher = PasswordHasher(); attempts: dict[str, deque[float]] = defaultdict(deque)
def digest(value: str) -> str: return hashlib.sha256(value.encode()).hexdigest()
def hash_password(password: str) -> str: return hasher.hash(password)
def verify_password(password_hash: str, password: str) -> bool:
    try: return hasher.verify(password_hash, password)
    except VerifyMismatchError: return False

def rate_limit(request: Request, bucket: str, limit: int = 10, seconds: int = 60):
    key = f"{bucket}:{request.client.host if request.client else 'unknown'}"; now = time.monotonic(); q = attempts[key]
    while q and q[0] < now - seconds: q.popleft()
    if len(q) >= limit: raise HTTPException(429, "Too many attempts. Please wait and try again.")
    q.append(now)

def create_session(db: Session, user: User, response: Response) -> str:
    secret, csrf = secrets.token_urlsafe(40), secrets.token_urlsafe(32)
    session = AuthSession(user_id=user.id, secret_hash=digest(secret), csrf_hash=digest(csrf), expires_at=datetime.now(timezone.utc)+timedelta(days=settings.session_days))
    db.add(session); db.commit()
    response.set_cookie(settings.session_cookie, secret, httponly=True, secure=settings.cookie_secure, samesite="lax", max_age=settings.session_days*86400, path="/")
    response.set_cookie("cliptora_csrf", csrf, httponly=False, secure=settings.cookie_secure, samesite="lax", max_age=settings.session_days*86400, path="/")
    return csrf

def get_current_session(session_secret: str | None = Cookie(default=None, alias=settings.session_cookie), db: Session = Depends(get_db)) -> AuthSession:
    if not session_secret: raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Authentication required")
    session = db.scalar(select(AuthSession).where(AuthSession.secret_hash==digest(session_secret)))
    now = datetime.now(timezone.utc)
    if not session or session.revoked_at or session.expires_at.replace(tzinfo=timezone.utc) <= now: raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Authentication required")
    return session

def get_current_user(session: AuthSession = Depends(get_current_session)) -> User: return session.user

def require_csrf(request: Request, csrf_header: str | None = Header(default=None, alias="X-CSRF-Token"), csrf_cookie: str | None = Cookie(default=None, alias="cliptora_csrf"), db: Session = Depends(get_db)):
    if request.method in {"GET","HEAD","OPTIONS"}: return
    if not csrf_header or not csrf_cookie or not secrets.compare_digest(csrf_header, csrf_cookie): raise HTTPException(403, "Invalid CSRF token")
    session_secret = request.cookies.get(settings.session_cookie)
    if session_secret:
        session = db.scalar(select(AuthSession).where(AuthSession.secret_hash==digest(session_secret)))
        if session and not secrets.compare_digest(session.csrf_hash, digest(csrf_header)): raise HTTPException(403, "Invalid CSRF token")
