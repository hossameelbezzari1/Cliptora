from datetime import datetime, timezone
from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.core.database import Base

def now():
    return datetime.now(timezone.utc).replace(tzinfo=None)

class User(Base):
    __tablename__ = 'users'
    id: Mapped[int] = mapped_column(primary_key=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    display_name: Mapped[str] = mapped_column(String(120))
    password_hash: Mapped[str] = mapped_column(String(255))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)
    projects: Mapped[list['Project']] = relationship(back_populates='owner', cascade='all, delete-orphan')
    sessions: Mapped[list['Session']] = relationship(cascade='all, delete-orphan')
    reset_tokens: Mapped[list['PasswordReset']] = relationship(cascade='all, delete-orphan')

class Session(Base):
    __tablename__ = 'sessions'
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey('users.id', ondelete='CASCADE'), index=True)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime)

class PasswordReset(Base):
    __tablename__ = 'password_resets'
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey('users.id', ondelete='CASCADE'))
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime)

class Project(Base):
    __tablename__ = 'projects'
    id: Mapped[int] = mapped_column(primary_key=True)
    owner_id: Mapped[int] = mapped_column(ForeignKey('users.id', ondelete='CASCADE'), index=True)
    name: Mapped[str] = mapped_column(String(160))
    width: Mapped[int] = mapped_column(Integer, default=1920)
    height: Mapped[int] = mapped_column(Integer, default=1080)
    fps: Mapped[int] = mapped_column(Integer, default=30)
    revision: Mapped[int] = mapped_column(Integer, default=1)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=now, onupdate=now)
    owner: Mapped[User] = relationship(back_populates='projects')
    tracks: Mapped[list['Track']] = relationship(back_populates='project', cascade='all, delete-orphan', order_by='Track.position')
    media: Mapped[list['MediaAsset']] = relationship(back_populates='project', cascade='all, delete-orphan')
    scripts: Mapped[list['AIScript']] = relationship(back_populates='project', cascade='all, delete-orphan')

class Track(Base):
    __tablename__ = 'tracks'
    id: Mapped[int] = mapped_column(primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey('projects.id', ondelete='CASCADE'), index=True)
    client_id: Mapped[str] = mapped_column(String(64))
    name: Mapped[str] = mapped_column(String(100))
    type: Mapped[str] = mapped_column(String(20))
    position: Mapped[int] = mapped_column(Integer)
    hidden: Mapped[bool] = mapped_column(Boolean, default=False)
    muted: Mapped[bool] = mapped_column(Boolean, default=False)
    locked: Mapped[bool] = mapped_column(Boolean, default=False)
    project: Mapped[Project] = relationship(back_populates='tracks')
    clips: Mapped[list['Clip']] = relationship(back_populates='track', cascade='all, delete-orphan', order_by='Clip.start')
    __table_args__ = (UniqueConstraint('project_id','client_id', name='uq_track_client'),)

class Clip(Base):
    __tablename__ = 'clips'
    id: Mapped[int] = mapped_column(primary_key=True)
    track_id: Mapped[int] = mapped_column(ForeignKey('tracks.id', ondelete='CASCADE'), index=True)
    client_id: Mapped[str] = mapped_column(String(64))
    name: Mapped[str] = mapped_column(String(160))
    type: Mapped[str] = mapped_column(String(20))
    start: Mapped[float] = mapped_column(Float)
    duration: Mapped[float] = mapped_column(Float)
    source_offset: Mapped[float] = mapped_column(Float, default=0)
    media_id: Mapped[int | None] = mapped_column(ForeignKey('media_assets.id', ondelete='SET NULL'), nullable=True)
    text: Mapped[str | None] = mapped_column(Text, nullable=True)
    color: Mapped[str] = mapped_column(String(20), default='#5bff93')
    track: Mapped[Track] = relationship(back_populates='clips')

class MediaAsset(Base):
    __tablename__ = 'media_assets'
    id: Mapped[int] = mapped_column(primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey('projects.id', ondelete='CASCADE'), index=True)
    name: Mapped[str] = mapped_column(String(255))
    kind: Mapped[str] = mapped_column(String(20))
    mime: Mapped[str] = mapped_column(String(100))
    disk_path: Mapped[str] = mapped_column(String(500))
    size_bytes: Mapped[int] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)
    project: Mapped[Project] = relationship(back_populates='media')

class AIScript(Base):
    __tablename__ = 'ai_scripts'
    id: Mapped[int] = mapped_column(primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey('projects.id', ondelete='CASCADE'), index=True)
    name: Mapped[str] = mapped_column(String(120))
    instructions: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)
    project: Mapped[Project] = relationship(back_populates='scripts')
