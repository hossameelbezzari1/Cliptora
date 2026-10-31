"""Discover executable node modules and make the backend the source of truth.

Only trusted, installed Python modules under app.workflows.nodes are imported.
The browser never supplies module paths or executable code.
"""
from __future__ import annotations
from functools import lru_cache
from importlib import import_module
from pkgutil import iter_modules
from typing import Any
from .base import NodeDefinition, NodeHandler
from . import nodes as node_package

@lru_cache(maxsize=1)
def discovered() -> dict[str, NodeDefinition]:
    found: dict[str, NodeDefinition] = {}
    for item in sorted(iter_modules(node_package.__path__), key=lambda item: item.name):
        if item.name.startswith('_') or item.ispkg:
            continue
        module = import_module(f'{node_package.__name__}.{item.name}')
        definition = getattr(module, 'NODE', None)
        if not isinstance(definition, NodeDefinition):
            raise RuntimeError(f'Workflow module {item.name} does not export NODE')
        if not isinstance(definition.type, str) or not definition.type.strip() or definition.type in found:
            raise RuntimeError(f'Duplicate/invalid workflow node type: {definition.type}')
        if not callable(definition.execute) or not callable(definition.metadata):
            raise RuntimeError(f'Workflow node {definition.type} missing executor or metadata')
        found[definition.type] = definition
    return found

def node_metadata() -> dict[str, dict[str, Any]]:
    result: dict[str, dict[str, Any]] = {}
    for key, definition in discovered().items():
        value = definition.metadata()
        if not isinstance(value, dict) or not isinstance(value.get('label'), str) or not value['label'].strip() or not isinstance(value.get('group'), str) or not value['group'].strip() or not isinstance(value.get('settings'), dict):
            raise RuntimeError(f'Invalid metadata for registered node {key}')
        result[key] = value
    return result

def executor(node_type: str) -> NodeHandler:
    try:
        return discovered()[node_type].execute
    except KeyError as exc:
        raise ValueError(f'Unknown or unauthorized node: {node_type}') from exc


class WorkflowRegistry:
    def discover(self):
        return discovered()

    def metadata(self):
        return node_metadata()

    def executor(self, node_type: str):
        return executor(node_type)
