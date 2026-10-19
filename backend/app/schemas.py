from datetime import datetime
from pydantic import BaseModel, ConfigDict, EmailStr, Field, model_validator

class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int; email: EmailStr; display_name: str; created_at: datetime

class RegisterIn(BaseModel):
    display_name: str = Field(min_length=2, max_length=100)
    email: EmailStr
    password: str = Field(min_length=10, max_length=128)
    password_confirmation: str
    @model_validator(mode="after")
    def passwords_match(self):
        if self.password != self.password_confirmation: raise ValueError("Passwords do not match")
        return self

class LoginIn(BaseModel): email: EmailStr; password: str
class ForgotIn(BaseModel): email: EmailStr
class ResetIn(BaseModel):
    token: str = Field(min_length=20)
    password: str = Field(min_length=10, max_length=128)
    password_confirmation: str
    @model_validator(mode="after")
    def passwords_match(self):
        if self.password != self.password_confirmation: raise ValueError("Passwords do not match")
        return self
class ProfileUpdate(BaseModel): display_name: str = Field(min_length=2, max_length=100)
class ChangePasswordIn(BaseModel): current_password: str; new_password: str = Field(min_length=10, max_length=128)

class ProjectIn(BaseModel):
    name: str = Field(min_length=1, max_length=150)
    width: int = Field(default=1920, ge=240, le=7680)
    height: int = Field(default=1080, ge=240, le=7680)
    aspect_ratio: str = Field(default="16:9", pattern=r"^(16:9|9:16|1:1|4:5)$")
    fps: float = Field(default=30, ge=1, le=120)
class ProjectUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=150)
    width: int | None = Field(default=None, ge=240, le=7680)
    height: int | None = Field(default=None, ge=240, le=7680)
    aspect_ratio: str | None = Field(default=None, pattern=r"^(16:9|9:16|1:1|4:5)$")
    fps: float | None = Field(default=None, ge=1, le=120)
class ProjectOut(ProjectIn):
    model_config = ConfigDict(from_attributes=True)
    id: int; revision: int; created_at: datetime; updated_at: datetime

class TrackIn(BaseModel):
    client_id: str = Field(min_length=1, max_length=64)
    name: str = Field(min_length=1, max_length=80)
    type: str = Field(pattern=r"^(video|audio|text)$")
    position: int = Field(ge=0)
    hidden: bool = False; muted: bool = False; locked: bool = False
class TrackOut(TrackIn):
    model_config = ConfigDict(from_attributes=True)
    id: int
class TimelineIn(BaseModel): revision: int = Field(ge=0); tracks: list[TrackIn] = Field(max_length=100)
class TimelineOut(BaseModel): revision: int; tracks: list[TrackOut]
