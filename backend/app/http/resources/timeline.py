from __future__ import annotations
from datetime import datetime
from typing import Any, Literal
from pydantic import BaseModel, ConfigDict, Field, model_validator
from app.http.requests.timeline import TimelineIn

class TimelineOut(TimelineIn):
    pass
