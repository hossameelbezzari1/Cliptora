"""Discover Node subclasses. Never overwrite class metadata from a parallel list."""
from __future__ import annotations

from functools import lru_cache
from importlib import import_module
from inspect import isabstract, isclass
from pkgutil import iter_modules

from .Node import Node, NodeDefinition, NodeHandler
from . import nodes as node_package


@lru_cache(maxsize=1)
def discovered() -> dict[str, NodeDefinition]:
    found: dict[str, NodeDefinition] = {}
    families_seen: set[str] = set()

    for info in sorted(iter_modules(node_package.__path__), key=lambda item: item.name):
        if info.ispkg or info.name.startswith('_'):
            continue
        module = import_module(f'{node_package.__name__}.{info.name}')
        for obj in vars(module).values():
            if not (isclass(obj) and issubclass(obj, Node) and obj is not Node
                    and obj.__module__ == module.__name__ and not isabstract(obj)):
                continue
            if not isinstance(obj.family, str) or not obj.family:
                raise RuntimeError(f'Invalid node family in {obj.__name__}')
            if obj.family in families_seen:
                raise RuntimeError(f'Duplicate node family: {obj.family}')
            families_seen.add(obj.family)
            for node_type in obj.operations:
                if node_type in found:
                    raise RuntimeError(f'Duplicate node type: {node_type}')
                definition = obj.definition(node_type)
                if not callable(definition.metadata) or not callable(definition.execute):
                    raise RuntimeError(f'Invalid node definition: {node_type}')
                found[node_type] = definition

    if not found:
        raise RuntimeError('No workflow nodes discovered')
    return found


def node_metadata() -> dict[str, dict]:
    result: dict[str, dict] = {}
    for node_type, definition in discovered().items():
        metadata = definition.metadata()
        if not isinstance(metadata.get('settings'), dict) or not metadata.get('label') or not metadata.get('group'):
            raise RuntimeError(f'Invalid metadata: {node_type}')
        result[node_type] = metadata
    return result


def executor(node_type: str) -> NodeHandler:
    try:
        return discovered()[node_type].execute
    except KeyError as exc:
        raise ValueError(f'Unknown node type: {node_type}') from exc


class WorkflowRegistry:
    def discover(self):
        return discovered()

    def metadata(self):
        return node_metadata()

    def executor(self, node_type):
        return executor(node_type)
