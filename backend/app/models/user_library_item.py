from __future__ import annotations
from datetime import datetime, timezone
from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.core.database import Base
from app.models.timestamps import now

class UserLibraryItem(Base):
    """User-owned reusable assets: component, folder, group, effect, animation, variable."""
    __tablename__ = 'user_library_items'
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey('users.id', ondelete='CASCADE'), index=True)
    kind: Mapped[str] = mapped_column(String(24), index=True)
    name: Mapped[str] = mapped_column(String(160))
    parent_id: Mapped[int | None] = mapped_column(ForeignKey('user_library_items.id', ondelete='SET NULL'), nullable=True)
    payload_json: Mapped[str] = mapped_column(Text, default='{}')
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=now, onupdate=now)
