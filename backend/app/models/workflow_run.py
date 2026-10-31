from __future__ import annotations
from datetime import datetime, timezone
from sqlalchemy import BigInteger, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.dialects.mysql import LONGTEXT
from sqlalchemy.orm import Mapped, mapped_column
from app.core.database import Base
from app.models.timestamps import now

class WorkflowRun(Base):
    __tablename__ = "workflow_runs"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(Integer, index=True, nullable=False)
    project_id: Mapped[int] = mapped_column(Integer, index=True, nullable=False)
    workflow_id: Mapped[int] = mapped_column(Integer, nullable=False)
    source_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    workflow_json: Mapped[str] = mapped_column(Text().with_variant(LONGTEXT(), "mysql"), nullable=False)
    state: Mapped[str] = mapped_column(String(24), default="queued", nullable=False)
    progress: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    current_node: Mapped[str | None] = mapped_column(String(48), nullable=True)
    results_json: Mapped[str] = mapped_column(Text().with_variant(LONGTEXT(), "mysql"), default="{}")
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
