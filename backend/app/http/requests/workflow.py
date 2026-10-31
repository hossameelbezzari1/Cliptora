from __future__ import annotations
from datetime import datetime
from typing import Any, Literal
from pydantic import BaseModel, ConfigDict, Field, model_validator

from typing import Optional

class DefinitionBody(BaseModel):
    name: str = Field(min_length=2, max_length=160)
    nodes: list[dict[str, Any]]

class StartRun(BaseModel):
    workflow_id: int = Field(ge=1)
    source_id: int | None = Field(default=None, ge=1)
    target_node_id: str | None = Field(default=None, pattern=r"^[A-Za-z][A-Za-z0-9_-]{0,47}$")
