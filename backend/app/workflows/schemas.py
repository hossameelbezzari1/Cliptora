"""Catalog serialization helpers; never serializes executable callables."""
from __future__ import annotations
from typing import Any

def inferred_parameters_schema(settings: dict[str, Any]) -> dict[str, Any]:
    """Default frontend form for nodes without custom parameter schema/UI.

    No credentials, private UI metadata or executable content are exposed.
    """
    fields: dict[str, dict[str, Any]] = {}
    for name, value in settings.items():
        if name.startswith('__') or name in {'credential_id', 'credential'}:
            continue
        kind = ('boolean' if isinstance(value, bool) else
                'integer' if isinstance(value, int) else
                'number' if isinstance(value, float) else
                'array' if isinstance(value, list) else
                'object' if isinstance(value, dict) else 'string')
        fields[name] = {'type': kind, 'title': name.replace('_', ' ').title()}
        if value is not None:
            fields[name]['default'] = value
    return {'type': 'object', 'properties': fields}


def node_catalog_entry(node_type: str, metadata: dict[str, Any]) -> dict[str, Any]:
    return {
        'type': node_type, **metadata, 'status': 'implemented', 'priority': 'P0',
        'icon': metadata.get('icon', node_type.split('.', 1)[0]),
        'actions': metadata.get('actions', []),
        'input_types': metadata.get('input_types', []),
        'output_types': metadata.get('output_types', ['json']),
        'parameters_schema': metadata.get('parameters_schema') or inferred_parameters_schema(metadata.get('settings', {})),
        'credentials': metadata.get('credentials', []),
        'backend_executor': f'workflow.node:{node_type}',
    }
