from datetime import datetime
from typing import Literal
from pydantic import BaseModel, ConfigDict, Field, model_validator

class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    email: str
    display_name: str
    created_at: datetime

class RegisterIn(BaseModel):
    display_name: str = Field(min_length=2,max_length=120)
    email: str = Field(min_length=3,max_length=255)
    password: str = Field(min_length=10,max_length=128)
    password_confirmation: str
    @model_validator(mode='after')
    def match(self):
        if self.password != self.password_confirmation:
            raise ValueError('Passwords do not match.')
        return self

class LoginIn(BaseModel):
    email: str
    password: str

class ForgotIn(BaseModel):
    email: str

class ResetIn(BaseModel):
    token: str
    password: str = Field(min_length=10,max_length=128)
    password_confirmation: str
    @model_validator(mode='after')
    def match(self):
        if self.password != self.password_confirmation:
            raise ValueError('Passwords do not match.')
        return self

class ProfileIn(BaseModel):
    display_name: str = Field(min_length=2,max_length=120)

class ProjectIn(BaseModel):
    name: str = Field(min_length=1,max_length=160)
    width: int = Field(default=1920,ge=144,le=7680)
    height: int = Field(default=1080,ge=144,le=4320)
    fps: int = Field(default=30,ge=1,le=120)

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

class MediaOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str
    kind: Literal['video','audio','image']
    mime: str
    size_bytes: int
    created_at: datetime

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

class TimelineOut(TimelineIn):
    pass

class AIScriptIn(BaseModel):
    name: str = Field(min_length=1,max_length=120)
    instructions: str = Field(min_length=5,max_length=20000)

class AIScriptOut(AIScriptIn):
    model_config = ConfigDict(from_attributes=True)
    id: int
    project_id: int
    created_at: datetime
