from __future__ import annotations
from datetime import datetime
from typing import Any, Literal
from pydantic import BaseModel, ConfigDict, Field, model_validator


Kind = Literal["component","group","folder","effect","animation","variable"]

class ItemIn(BaseModel):
    kind: Kind
    name: str = Field(min_length=1, max_length=160)
    parent_id: int | None = None
    payload: dict[str, Any] = Field(default_factory=dict)

class ItemPatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=160)
    parent_id: int | None = None
    payload: dict[str, Any] | None = None
