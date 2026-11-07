"""CLIPTORA node contract: implementation and UI metadata live in each family class."""
from __future__ import annotations

from abc import ABC, abstractmethod
from copy import deepcopy
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
    operations: ClassVar[dict[str, dict[str, Any]]] = {}
    # UI fields and action-specific fields are declared by each subclass.
    parameter_fields: ClassVar[dict[str, dict[str, dict[str, Any]]]] = {}
    action_fields: ClassVar[dict[str, dict[str, dict[str, dict[str, Any]]]]] = {}

    @abstractmethod
    def execute_operation(self, operation: str, node: dict[str, Any], outputs: dict[str, Any],
                          source: Path | None, workdir: Path) -> dict[str, Any]:
        """Execute the persisted operation; output remains a JSON object."""

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
            raise ValueError(f'Unknown operation: {operation}')

        def metadata() -> dict[str, Any]:
            from .Schemas import inferred_parameters_schema
            meta = deepcopy(cls.operations[operation])
            ui = inferred_parameters_schema(meta.get('settings') or {})
            ui['properties'].update(deepcopy(cls.parameter_fields.get(operation, {})))
            action_fields = deepcopy(cls.action_fields.get(operation, {}))
            return {
                'label': meta['label'], 'group': cls.group,
                'family': cls.family,
                'settings': meta.get('settings', {}),
                'icon': meta.get('icon', cls.icon),
                'family_icon': cls.icon,
                'operation_icon': meta.get('icon', cls.icon),
                'credentials': meta.get('credentials', []),
                'actions': meta.get('actions', []),
                'input_types': meta.get('input_types', []),
                'output_types': meta.get('output_types', ['json']),
                'parameters_schema': ui,
                'action_parameters': action_fields,
                'source_picker': bool(meta.get('source_picker', False)),
            }

        def execute(node: dict[str, Any], outputs: dict[str, Any], source: Path | None, workdir: Path) -> dict[str, Any]:
            return cls().execute(operation, node, outputs, source, workdir)

        return NodeDefinition(type=operation, metadata=metadata, execute=execute)


BaseNode = Node
