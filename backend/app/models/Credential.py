from __future__ import annotations
from datetime import datetime
from sqlalchemy import DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column
from app.core.Database import Base
from app.models.Timestamps import now

class Credential(Base):
    __tablename__='credentials'
    id: Mapped[int] = mapped_column(Integer,primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey('users.id',ondelete='CASCADE'),index=True,nullable=False)
    name: Mapped[str] = mapped_column(String(160),nullable=False)
    provider: Mapped[str] = mapped_column(String(40),nullable=False)
    auth_type: Mapped[str] = mapped_column(String(30),nullable=False,default='api_key',server_default='api_key')
    encrypted_data: Mapped[str] = mapped_column(Text,nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime,default=now,nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime,default=now,onupdate=now,nullable=False)
