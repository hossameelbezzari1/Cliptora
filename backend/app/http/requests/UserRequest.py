from __future__ import annotations
from datetime import datetime
from typing import Any, Literal
from pydantic import BaseModel, ConfigDict, Field, model_validator


class ProfileIn(BaseModel):
    display_name: str = Field(min_length=2,max_length=120)
