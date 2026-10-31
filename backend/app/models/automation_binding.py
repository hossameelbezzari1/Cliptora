from __future__ import annotations
from datetime import datetime, timezone
from sqlalchemy import BigInteger, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.dialects.mysql import LONGTEXT
from sqlalchemy.orm import Mapped, mapped_column
from app.core.database import Base
from app.models.timestamps import now as utcnow

class AutomationBinding(Base):
    __tablename__ = "automation_bindings"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(Integer, index=True, nullable=False)
    project_id: Mapped[int] = mapped_column(Integer, index=True, nullable=False)
    clip_id: Mapped[str] = mapped_column(String(64), index=True, nullable=False)
    command_id: Mapped[int] = mapped_column(Integer, nullable=False)
    trigger: Mapped[str] = mapped_column(String(20), default="manual", nullable=False)
    enabled: Mapped[bool] = mapped_column(default=True, nullable=False)
    inputs_json: Mapped[str] = mapped_column(Text, default="{}", nullable=False)
    mapping_json: Mapped[str] = mapped_column(Text, default="{}", nullable=False)
