"""Agent-local window memory for interactive tool calls (scoped to one run)."""
from __future__ import annotations
from app.workflows.Node import Node


class AgentMemoryNode(Node):
    family = 'agent_memory'
    group = 'AI'
    icon = 'lucide:database'
    operations = {
        'ai.window_memory': {
            'label': 'Window Memory',
            'icon': 'lucide:database',
            'settings': {'max_messages': 8},
            'input_types': ['json'],
            'output_types': ['json'],
        },
    }
    parameter_fields = {
        'ai.window_memory': {
            'max_messages': {'type': 'integer', 'title': 'Recent Steps to Remember',
                             'minimum': 1, 'maximum': 30, 'default': 8},
        }
    }

    def execute_operation(self, operation, node, outputs, source, workdir):
        cfg = node.get('settings') or {}
        count = cfg.get('max_messages', 8)
        if type(count) is not int or not 1 <= count <= 30:
            raise ValueError('Window Memory must remember 1 to 30 recent steps')
        return {'agent_memory': {'max_messages': count, 'scope': 'workflow_run'}}
