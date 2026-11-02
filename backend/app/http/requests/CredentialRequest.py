from __future__ import annotations
from typing import Any, Literal
from pydantic import BaseModel, Field

class CredentialCreate(BaseModel):
    name: str = Field(min_length=2,max_length=160)
    provider: Literal['gemini','openai','ollama']
    data: dict[str,Any]

class CredentialUpdate(BaseModel):
    name: str | None = Field(default=None,min_length=2,max_length=160)
    data: dict[str,Any] | None = None
