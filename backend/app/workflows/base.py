"""Stable plugin interface for CLIPTORA workflow nodes."""
from __future__ import annotations
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, Mapping

NodeHandler = Callable[[dict[str, Any], dict[str, Any], Path | None, Path], dict[str, Any]]

@dataclass(frozen=True)
class NodeDefinition:
    type: str
    metadata: Callable[[], dict[str, Any]]
    execute: NodeHandler
