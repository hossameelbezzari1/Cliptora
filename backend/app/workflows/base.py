"""Stable plugin interface for native workflow nodes."""
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


from abc import ABC, abstractmethod
from typing import ClassVar

class BaseNode(ABC):
    """Class-based workflow plugin. Subclasses define node metadata and execute logic."""
    type: ClassVar[str]

    @staticmethod
    @abstractmethod
    def metadata() -> dict[str, Any]:
        raise NotImplementedError

    @staticmethod
    @abstractmethod
    def execute(node: dict[str, Any], outputs: dict[str, Any], source: Path | None, workdir: Path) -> dict[str, Any]:
        raise NotImplementedError

    @classmethod
    def definition(cls) -> NodeDefinition:
        return NodeDefinition(type=cls.type, metadata=cls.metadata, execute=cls.execute)
