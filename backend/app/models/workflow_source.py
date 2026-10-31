from __future__ import annotations
from datetime import datetime, timezone
from sqlalchemy import BigInteger, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.dialects.mysql import LONGTEXT
from sqlalchemy.orm import Mapped, mapped_column
from app.core.database import Base
from app.models.timestamps import now

class WorkflowSource(Base):
    __tablename__ = "workflow_sources"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(Integer, index=True, nullable=False)
    project_id: Mapped[int] = mapped_column(Integer, index=True, nullable=False)
    filename: Mapped[str] = mapped_column(String(200), nullable=False)
    stored_name: Mapped[str] = mapped_column(String(80), nullable=False)
    media_id: Mapped[int | None] = mapped_column(ForeignKey("media_assets.id", ondelete="SET NULL"), nullable=True)
    size_bytes: Mapped[int] = mapped_column(BigInteger, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)
