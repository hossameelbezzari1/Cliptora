from __future__ import annotations
from datetime import datetime
from typing import Any, Literal
from pydantic import BaseModel, ConfigDict, Field, model_validator

class ProjectOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str
    width: int
    height: int
    fps: int
    revision: int
    created_at: datetime
    updated_at: datetime
