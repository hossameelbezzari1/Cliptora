"""Focused tests for single-step graph selection without requiring a database."""
import importlib.util
import unittest
from pathlib import Path

TARGET = Path(__file__).resolve().parents[1] / 'app/services/workflow_core.py'
spec = importlib.util.spec_from_file_location('workflow_core_helpers', TARGET)
core = importlib.util.module_from_spec(spec)
spec.loader.exec_module(core)


class WorkflowExecutionSelectionTests(unittest.TestCase):
    def test_target_includes_only_its_ancestors(self):
        nodes = [
            {'id': 'start', 'type': 'core.manual_trigger'},
            {'id': 'left', 'type': 'animation.storyboard', 'depends_on': ['start'], 'settings': {'script': 'Left'}},
            {'id': 'right', 'type': 'animation.storyboard', 'depends_on': ['start'], 'settings': {'script': 'Right'}},
            {'id': 'end', 'type': 'animation.keyframes', 'depends_on': ['left']},
        ]
        selected = core.execution_nodes(nodes, 'end')
        self.assertEqual([node['id'] for node in selected], ['start', 'left', 'end'])

    def test_unknown_target_is_rejected(self):
        with self.assertRaisesRegex(ValueError, 'does not exist'):
            core.execution_nodes([{'id': 'start', 'type': 'core.manual_trigger'}], 'missing')


if __name__ == '__main__':
    unittest.main()
