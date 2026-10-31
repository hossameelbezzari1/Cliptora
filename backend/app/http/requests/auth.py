from __future__ import annotations
from datetime import datetime
from typing import Any, Literal
from pydantic import BaseModel, ConfigDict, Field, model_validator


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
