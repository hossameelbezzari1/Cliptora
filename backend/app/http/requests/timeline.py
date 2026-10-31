from __future__ import annotations
from datetime import datetime
from typing import Any, Literal
from pydantic import BaseModel, ConfigDict, Field, model_validator


class ClipProperties(BaseModel):
    x: float = Field(default=0, ge=-500, le=500, allow_inf_nan=False)
    y: float = Field(default=0, ge=-500, le=500, allow_inf_nan=False)
    width: float = Field(default=100, ge=1, le=500, allow_inf_nan=False)
    height: float = Field(default=100, ge=1, le=500, allow_inf_nan=False)
    rotation: float = Field(default=0, ge=-3600, le=3600, allow_inf_nan=False)
    scale: float = Field(default=1, ge=0.1, le=10, allow_inf_nan=False)
    opacity: float = Field(default=1, ge=0, le=1, allow_inf_nan=False)
    flip_x: bool = False
    flip_y: bool = False
    reversed: bool = False
    audio_muted: bool = False
    volume: float = Field(default=1, ge=0, le=1, allow_inf_nan=False)
    attached_to: str | None = Field(default=None, max_length=64)
    crop_left: float = Field(default=0, ge=0, le=95, allow_inf_nan=False)
    crop_right: float = Field(default=0, ge=0, le=95, allow_inf_nan=False)
    crop_top: float = Field(default=0, ge=0, le=95, allow_inf_nan=False)
    crop_bottom: float = Field(default=0, ge=0, le=95, allow_inf_nan=False)
    effect_stack: list[dict[str, Any]] = Field(default_factory=list, max_length=64)
    animation_stack: list[dict[str, Any]] = Field(default_factory=list, max_length=64)
    repeat: dict[str, Any] | None = None
    shape_kind: str | None = Field(default=None, max_length=40)
    follow_target_id: str | None = Field(default=None, max_length=64)
    empty_element: bool = False
    workflow_id: int | None = Field(default=None, ge=1)

    @model_validator(mode='after')
    def crop_bounds(self):
        if self.crop_left + self.crop_right > 95 or self.crop_top + self.crop_bottom > 95:
            raise ValueError('Crop margins must leave at least 5% of the media visible.')
        return self

class ClipIn(BaseModel):
    client_id: str = Field(min_length=1,max_length=64)
    name: str = Field(min_length=1,max_length=160)
    type: Literal['video','image','audio','text']
    start: float = Field(ge=0,le=14400,allow_inf_nan=False)
    duration: float = Field(gt=0,le=14400,allow_inf_nan=False)
    source_offset: float = Field(default=0,ge=0,le=14400,allow_inf_nan=False)
    media_id: int | None = None
    text: str | None = Field(default=None,max_length=2000)
    color: str = Field(default='#5bff93', pattern=r'^#[0-9a-fA-F]{6}$')
    props: ClipProperties = Field(default_factory=ClipProperties)
    locked: bool = False

class TrackIn(BaseModel):
    client_id: str = Field(min_length=1,max_length=64)
    name: str = Field(min_length=1,max_length=100)
    type: Literal['mixed','video','audio','text']
    position: int = Field(ge=0,le=250)
    hidden: bool = False
    muted: bool = False
    locked: bool = False
    background_color: str = Field(default='#101214', pattern=r'^#[0-9a-fA-F]{6}$')
    clips: list[ClipIn] = Field(default_factory=list,max_length=500)

class TimelineIn(BaseModel):
    revision: int = Field(ge=1)
    tracks: list[TrackIn] = Field(default_factory=list,max_length=100)
