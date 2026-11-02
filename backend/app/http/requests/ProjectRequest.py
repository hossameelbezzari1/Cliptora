from __future__ import annotations
from datetime import datetime
from typing import Any, Literal
from pydantic import BaseModel, ConfigDict, Field, model_validator


class ProjectIn(BaseModel):
    name: str = Field(min_length=1,max_length=160)
    width: int = Field(default=1920,ge=144,le=7680)
    height: int = Field(default=1080,ge=144,le=4320)
    fps: int = Field(default=30,ge=1,le=120)
