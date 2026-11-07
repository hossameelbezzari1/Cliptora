"""Serialize safe node UI descriptions. Values are metadata, not executable code."""
from __future__ import annotations
from copy import deepcopy
from typing import Any

BLOCKED = {'credential_id', 'credential', 'api_key', 'password', 'secret', 'access_token', 'refresh_token'}


def inferred_parameters_schema(settings: dict[str, Any]) -> dict[str, Any]:
    fields: dict[str, dict[str, Any]] = {}
    for name, value in settings.items():
        if name.startswith('__') or name in BLOCKED:
            continue
        typ = ('boolean' if isinstance(value, bool) else
               'integer' if isinstance(value, int) else
               'number' if isinstance(value, float) else
               'array' if isinstance(value, list) else
               'object' if isinstance(value, dict) else 'string')
        field: dict[str, Any] = {'type': typ, 'title': name.replace('_', ' ').title()}
        if value is not None:
            field['default'] = deepcopy(value)
        if name in ('prompt', 'system_prompt', 'script', 'initial_prompt', 'system_message'):
            field['widget'] = 'textarea'
        if name in ('input_path', 'media_input_path'):
            field['widget'] = 'upstream'
            field['accepts'] = ['media'] if name == 'media_input_path' else ['text', 'json']
        if name == 'model':
            field['widget'] = 'model'
        fields[name] = field
    return {'type': 'object', 'properties': fields}


def node_catalog_entry(node_type: str, metadata: dict[str, Any]) -> dict[str, Any]:
    return {
        'type': node_type, **metadata, 'status': 'implemented', 'priority': 'P0',
        'icon': metadata.get('icon', node_type.split('.', 1)[0]),
        'actions': metadata.get('actions', []),
        'input_types': metadata.get('input_types', []),
        'output_types': metadata.get('output_types', ['json']),
        'parameters_schema': metadata.get('parameters_schema') or inferred_parameters_schema(metadata.get('settings', {})),
        'action_parameters': metadata.get('action_parameters') or {},
        'source_picker': bool(metadata.get('source_picker', False)),
        'credentials': metadata.get('credentials', []),
        'backend_executor': f'workflow.node:{node_type}',
    }
