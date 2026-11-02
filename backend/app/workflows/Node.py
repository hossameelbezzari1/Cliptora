"""One abstract contract for all CLIPTORA node families and their operations.

One Python file per node family. Each operation is a method on that family;
its metadata is declared here exactly once, not in a second parallel catalog.
"""
from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, ClassVar

NodeHandler = Callable[[dict[str, Any], dict[str, Any], Path | None, Path], dict[str, Any]]

@dataclass(frozen=True)
class NodeDefinition:
    type: str
    metadata: Callable[[], dict[str, Any]]
    execute: NodeHandler

class Node(ABC):
    family: ClassVar[str]
    group: ClassVar[str]
    icon: ClassVar[str] = 'lucide:workflow'
    # key is the PERSISTED legacy type: 'media.probe', 'audio.extract', etc.
    # Each operation must declare its handler; metadata comes from this map.
    operations: ClassVar[dict[str, dict[str, Any]]] = {}

    @abstractmethod
    def execute_operation(self, operation: str, node: dict[str, Any], outputs: dict[str, Any],
                          source: Path | None, workdir: Path) -> dict[str, Any]:
        """Dispatch a known operation to a method in the same class."""

    def execute(self, operation: str, node: dict[str, Any], outputs: dict[str, Any],
                source: Path | None, workdir: Path) -> dict[str, Any]:
        if operation not in self.operations:
            raise ValueError(f'Unknown {self.family} operation: {operation}')
        result = self.execute_operation(operation, node, outputs, source, workdir)
        if not isinstance(result, dict):
            raise TypeError(f'Node operation {operation} must return a JSON object')
        return result

    @classmethod
    def definition(cls, operation: str) -> NodeDefinition:
        if operation not in cls.operations:
            raise ValueError(f'Unknown operation {operation}')
        meta = cls.operations[operation]
        def metadata():
            operation_icon = meta.get('icon', cls.icon)
            return {'label': meta['label'], 'group': cls.group, 'settings': dict(meta.get('settings', {})),
                    'icon': operation_icon, 'family_icon': cls.icon, 'operation_icon': operation_icon,
                    'credentials': list(meta.get('credentials', [])),
                    'actions': [dict(action) for action in meta.get('actions', [])],
                    'input_types': list(meta.get('input_types', [])),
                    'output_types': list(meta.get('output_types', ['json']))}
        def execute(node, outputs, source, workdir):
            return cls().execute(operation, node, outputs, source, workdir)
        return NodeDefinition(type=operation, metadata=metadata, execute=execute)

# Compatibility for legacy plugins that subclass BaseNode (if copied later).
BaseNode = Node
