"""Typed execution inputs shared by future modular nodes."""
from __future__ import annotations
from dataclasses import dataclass
from pathlib import Path
from typing import Any

@dataclass(frozen=True)
class NodeExecutionContext:
    node: dict[str, Any]
    dependencies: dict[str, Any]
    source: Path | None
    workspace: Path
