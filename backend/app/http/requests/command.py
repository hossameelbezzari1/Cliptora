from __future__ import annotations
from datetime import datetime
from typing import Any, Literal
from pydantic import BaseModel, ConfigDict, Field, model_validator


class NewCommand(BaseModel):
    name: str = Field(min_length=1, max_length=140)
    kind: Literal["json_extract", "http_json", "selenium_youtube_comments"]
    config: dict[str, Any] = Field(default_factory=dict)

class NewBinding(BaseModel):
    project_id: int = Field(ge=1)
    clip_id: str = Field(min_length=1, max_length=64)
    command_id: int = Field(ge=1)
    trigger: Literal["manual", "on_start", "on_end", "on_repeat"] = "manual"
    enabled: bool = True
    inputs: dict[str, Any] = Field(default_factory=dict)
    output_mapping: dict[str, str] = Field(default_factory=dict)

class PatchBinding(BaseModel):
    trigger: Literal["manual", "on_start", "on_end", "on_repeat"] | None = None
    enabled: bool | None = None
    inputs: dict[str, Any] | None = None
    output_mapping: dict[str, str] | None = None
