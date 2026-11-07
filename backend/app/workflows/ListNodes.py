"""Compatibility view of registered nodes. Node subclasses own the definitions.

New code should import Registry.node_metadata or Catalog.tool_catalog.
"""
from __future__ import annotations
from copy import deepcopy
from typing import Any
from .Registry import node_metadata


def get_nodes() -> list[dict[str, Any]]:
    result = []
    for node_type, meta in node_metadata().items():
        result.append({
            'id': node_type, 'type': node_type, 'name': meta['label'],
            'family': meta['family'], 'category': meta['group'],
            'logo': meta['icon'], 'family_logo': meta.get('family_icon', meta['icon']),
            'settings': deepcopy(meta['settings']),
            'credentials': list(meta.get('credentials', [])),
            'sub_nodes': [
                {'id': action['id'], 'name': action['label'], 'logo': action.get('icon', meta['icon'])}
                for action in meta.get('actions', [])
            ],
        })
    return result


def get_node(node_id: str) -> dict[str, Any]:
    for entry in get_nodes():
        if entry['id'] == node_id:
            return entry
    raise KeyError(f'Unknown node: {node_id}')


def get_families() -> list[dict[str, Any]]:
    families: dict[str, dict[str, Any]] = {}
    for node in get_nodes():
        item = families.setdefault(node['family'], {
            'family': node['family'], 'category': node['category'],
            'logo': node.get('family_logo', node['logo']), 'nodes': [],
        })
        item['nodes'].append(node)
    return list(families.values())


def family_group(family: str) -> str:
    return next(item['category'] for item in get_families() if item['family'] == family)


def family_logo(family: str) -> str:
    return next(item['logo'] for item in get_families() if item['family'] == family)


def operations_for(family: str) -> dict[str, dict[str, Any]]:
    return {
        key: deepcopy(meta)
        for key, meta in node_metadata().items() if meta['family'] == family
    }


def validate_list_nodes() -> None:
    node_metadata()


# Kept for legacy imports, but never used as a source of runtime authority.
LIST_NODES = get_nodes()
FAMILIES = {
    item['family']: {'category': item['category'], 'logo': item['logo']}
    for item in get_families()
}
