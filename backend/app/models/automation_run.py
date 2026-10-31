from __future__ import annotations
from datetime import datetime, timezone
from sqlalchemy import BigInteger, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.dialects.mysql import LONGTEXT
from sqlalchemy.orm import Mapped, mapped_column
from app.core.database import Base
from app.models.timestamps import now as utcnow

class AutomationRun(Base):
    __tablename__ = "automation_runs"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(Integer, index=True, nullable=False)
    binding_id: Mapped[int] = mapped_column(Integer, index=True, nullable=False)
    state: Mapped[str] = mapped_column(String(20), default="queued", nullable=False)
    output_json: Mapped[str] = mapped_column(Text, default="{}", nullable=False)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, nullable=False)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
