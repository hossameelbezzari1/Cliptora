from __future__ import annotations
from datetime import datetime, timezone
from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.core.database import Base
from app.models.timestamps import now

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
