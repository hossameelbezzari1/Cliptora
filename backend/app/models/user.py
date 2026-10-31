from __future__ import annotations
from datetime import datetime, timezone
from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.core.database import Base
from app.models.timestamps import now

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
