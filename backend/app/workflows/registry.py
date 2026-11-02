"""Discover only trusted CLIPTORA Node subclasses, preserving persisted type IDs."""
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
    for info in sorted(iter_modules(node_package.__path__), key=lambda item:item.name):
        if info.ispkg or info.name.startswith('_'):
            continue
        module = import_module(f'{node_package.__name__}.{info.name}')
        for obj in vars(module).values():
            if not (isclass(obj) and issubclass(obj, Node) and obj is not Node
                    and obj.__module__ == module.__name__ and not isabstract(obj)):
                continue
            for key in obj.operations:
                if not isinstance(key, str) or not key.strip() or key in found:
                    raise RuntimeError(f'Duplicate/invalid node type: {key!r}')
                definition = obj.definition(key)
                if not callable(definition.metadata) or not callable(definition.execute):
                    raise RuntimeError(f'Invalid executor: {key}')
                found[key] = definition
    return found

def node_metadata():
    result = {}
    for key, definition in discovered().items():
        data = definition.metadata()
        if not isinstance(data.get('settings'), dict) or not data.get('label') or not data.get('group'):
            raise RuntimeError(f'Invalid node metadata: {key}')
        result[key] = data
    return result

def executor(node_type: str) -> NodeHandler:
    try:
        return discovered()[node_type].execute
    except KeyError as exc:
        raise ValueError(f'Unknown node type: {node_type}') from exc

class WorkflowRegistry:
    def discover(self): return discovered()
    def metadata(self): return node_metadata()
    def executor(self, node_type): return executor(node_type)
