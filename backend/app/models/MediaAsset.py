
from __future__ import annotations

from datetime import datetime

from sqlalchemy import (
    DateTime,
    ForeignKey,
    Integer,
    String,
)

from sqlalchemy.orm import (
    Mapped,
    mapped_column,
    relationship,
)

from app.core.Database import Base
from app.models.Timestamps import now


class MediaAsset(Base):
    __tablename__ = "media_assets"

    id: Mapped[int] = mapped_column(
        Integer,
        primary_key=True,
        autoincrement=True,
    )

    project_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey(
            "projects.id",
            ondelete="CASCADE",
        ),
        index=True,
        nullable=False,
    )

    name: Mapped[str] = mapped_column(
        String(255),
        nullable=False,
    )

    kind: Mapped[str] = mapped_column(
        String(20),
        nullable=False,
    )

    mime: Mapped[str] = mapped_column(
        String(100),
        nullable=False,
    )

    disk_path: Mapped[str] = mapped_column(
        String(500),
        nullable=False,
    )

    size_bytes: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime,
        default=now,
        nullable=False,
    )

    project: Mapped["Project"] = relationship(
        "Project",
        back_populates="media",
    )
