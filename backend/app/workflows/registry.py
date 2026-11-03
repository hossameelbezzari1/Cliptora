
"""CLIPTORA Node Registry.

ListNodes.py is the authoritative metadata catalog.
Node Classes remain responsible for execution.
"""

from __future__ import annotations

from functools import lru_cache
from importlib import import_module
from inspect import isabstract, isclass
from pkgutil import iter_modules

from .Node import Node, NodeDefinition, NodeHandler
from .ListNodes import (
    LIST_NODES,
    FAMILIES,
    family_group,
    family_logo,
    operations_for,
    validate_list_nodes,
)
from . import nodes as node_package


@lru_cache(maxsize=1)
def discovered() -> dict[str, NodeDefinition]:
    validate_list_nodes()

    found: dict[str, NodeDefinition] = {}
    families_seen: set[str] = set()

    for info in sorted(
        iter_modules(node_package.__path__),
        key=lambda item: item.name,
    ):
        if info.ispkg or info.name.startswith("_"):
            continue

        module = import_module(
            f"{node_package.__name__}.{info.name}"
        )

        for obj in vars(module).values():
            if not (
                isclass(obj)
                and issubclass(obj, Node)
                and obj is not Node
                and obj.__module__ == module.__name__
                and not isabstract(obj)
            ):
                continue

            family = obj.family

            if family not in FAMILIES:
                raise RuntimeError(
                    f"Unknown node family: {family}"
                )

            if family in families_seen:
                raise RuntimeError(
                    f"Duplicate node family: {family}"
                )

            families_seen.add(family)

            expected = operations_for(family)
            original_types = set(obj.operations)
            expected_types = set(expected)

            if original_types != expected_types:
                missing = sorted(
                    expected_types - original_types
                )
                extra = sorted(
                    original_types - expected_types
                )

                raise RuntimeError(
                    f"Node catalog mismatch in {obj.__name__}: "
                    f"missing={missing}, extra={extra}"
                )

            # Central catalog replaces runtime metadata,
            # without changing node execution methods.
            obj.group = family_group(family)
            obj.icon = family_logo(family)
            obj.operations = expected

            for node_type in expected:
                if node_type in found:
                    raise RuntimeError(
                        f"Duplicate node type: {node_type}"
                    )

                definition = obj.definition(node_type)

                if not callable(definition.metadata):
                    raise RuntimeError(
                        f"Invalid metadata: {node_type}"
                    )

                if not callable(definition.execute):
                    raise RuntimeError(
                        f"Invalid executor: {node_type}"
                    )

                found[node_type] = definition

    catalog_types = {
        node["id"]
        for node in LIST_NODES
    }

    if set(found) != catalog_types:
        missing = sorted(
            catalog_types - set(found)
        )
        extra = sorted(
            set(found) - catalog_types
        )

        raise RuntimeError(
            f"Registry mismatch: "
            f"missing={missing}, extra={extra}"
        )

    return found


def node_metadata() -> dict[str, dict]:
    result: dict[str, dict] = {}

    for node_type, definition in discovered().items():
        metadata = definition.metadata()

        if not isinstance(
            metadata.get("settings"), dict
        ):
            raise RuntimeError(
                f"Invalid settings: {node_type}"
            )

        if not metadata.get("label"):
            raise RuntimeError(
                f"Missing label: {node_type}"
            )

        if not metadata.get("group"):
            raise RuntimeError(
                f"Missing group: {node_type}"
            )

        result[node_type] = metadata

    return result


def executor(node_type: str) -> NodeHandler:
    try:
        return discovered()[node_type].execute
    except KeyError as exc:
        raise ValueError(
            f"Unknown node type: {node_type}"
        ) from exc


class WorkflowRegistry:
    def discover(self):
        return discovered()

    def metadata(self):
        return node_metadata()

    def executor(self, node_type):
        return executor(node_type)
