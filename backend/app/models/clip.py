from __future__ import annotations
from datetime import datetime, timezone
from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.core.database import Base
from app.models.timestamps import now

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
    properties_json: Mapped[str] = mapped_column(Text, default='{}')
    locked: Mapped[bool] = mapped_column(Boolean, default=False)
    track: Mapped[Track] = relationship(back_populates='clips')
