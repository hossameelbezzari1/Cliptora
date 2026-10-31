from __future__ import annotations
from datetime import datetime, timezone
from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.core.database import Base
from app.models.timestamps import now

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
    background_color: Mapped[str] = mapped_column(String(20), default='#101214')
    project: Mapped[Project] = relationship(back_populates='tracks')
    clips: Mapped[list['Clip']] = relationship(back_populates='track', cascade='all, delete-orphan', order_by='Clip.start')
    __table_args__ = (UniqueConstraint('project_id','client_id', name='uq_track_client'),)
