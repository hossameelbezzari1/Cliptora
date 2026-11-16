"""Standalone regression tests for the CLIPTORA Live Loop Ghost runtime.

Run in the real backend: python -m unittest tests.test_live_ghost_runtime -v
"""
from __future__ import annotations

import contextlib
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import patch

from app.workflows.ItemExecution import LiveItemTracker, run_item_execution, live_snapshot_from_result
from app.workflows.LoopSubgraph import run_loop_controller


class LiveGhostRuntimeTests(unittest.TestCase):
    def test_tracker_never_emits_input_data(self):
        tracker = LiveItemTracker('for_each', [
            {'id': 'a', 'label': 'A', 'data': {'secret': 'DO_NOT_EMIT'}},
            {'id': 'b', 'label': 'B', 'data': {'secret': 'DO_NOT_EMIT'}},
        ])
        tracker.set(0, 'running')
        tracker.set(0, 'completed')
        snap = tracker.snapshot()
        self.assertEqual((snap['waiting'], snap['running'], snap['completed']), (1, 0, 1))
        self.assertNotIn('DO_NOT_EMIT', str(snap))

    def test_tracker_is_bounded_for_many_tasks(self):
        tracker = LiveItemTracker('batch', [{'id': str(i)} for i in range(2000)])
        for i in range(2000):
            tracker.set(i, 'completed')
        snap = tracker.snapshot()
        self.assertEqual(snap['completed'], 2000)
        self.assertLessEqual(len(snap['items']), 60)
        self.assertTrue(snap['truncated'])

    def test_serial_tasks_have_real_transitions(self):
        seen = []
        node = {'id': 'work', 'type': 'ai.gemini', 'depends_on': ['input'], 'cache': False,
                'settings': {'execution_mode': 'for_each', 'execution_input_path': 'input.items'}}
        with tempfile.TemporaryDirectory() as folder:
            result = run_item_execution(
                node, {'input': {'items': [{'id': 'one', 'text': 'alpha'}, {'id': 'two', 'text': 'beta'}]}},
                None, Path(folder), lambda current, deps: {'text': deps['input']['text']},
                lambda: False, seen.append,
            )
        self.assertEqual(result['status'], 'completed')
        self.assertEqual(len(result['items']), 2)
        self.assertTrue(any(p['item_execution_live']['running'] == 1 for p in seen))
        self.assertEqual(seen[-1]['item_execution_live']['completed'], 2)

    def test_parallel_tasks_are_reported_only_after_actual_start(self):
        seen = []
        node = {'id': 'work', 'type': 'ai.gemini', 'depends_on': ['input'], 'cache': False,
                'settings': {'execution_mode': 'for_each', 'execution_input_path': 'input.items',
                             'execution_parallelism': 2}}
        with tempfile.TemporaryDirectory() as folder:
            def invoke(current, deps):
                time.sleep(0.20)
                return {'result': deps['input']['id']}
            result = run_item_execution(node,
                {'input': {'items': [{'id': str(i)} for i in range(3)]}},
                None, Path(folder), invoke, lambda: False, seen.append)
        self.assertEqual(len(result['items']), 3)
        self.assertTrue(any(p['item_execution_live']['running'] > 0 for p in seen))
        self.assertEqual(seen[-1]['item_execution_live']['completed'], 3)

    def test_continue_policy_preserves_failed_task(self):
        seen = []
        node = {'id': 'work', 'type': 'ai.gemini', 'depends_on': ['input'], 'cache': False,
                'settings': {'execution_mode': 'for_each', 'execution_input_path': 'input.items',
                             'execution_error_policy': 'continue'}}
        def invoke(current, deps):
            if deps['input']['id'] == 'bad':
                raise RuntimeError('test failure')
            return {'ok': True}
        with tempfile.TemporaryDirectory() as folder:
            result = run_item_execution(node,
                {'input': {'items': [{'id': 'good'}, {'id': 'bad'}]}},
                None, Path(folder), invoke, lambda: False, seen.append)
        self.assertEqual(result['status'], 'partial')
        self.assertEqual(seen[-1]['item_execution_live']['failed'], 1)
        self.assertEqual(seen[-1]['item_execution_live']['completed'], 1)
        self.assertEqual(live_snapshot_from_result(result)['failed'], 1)

    def test_subgraph_iteration_statuses(self):
        seen = []
        controller = {'id': 'loop', 'type': 'items.loop', 'depends_on': ['input'], 'cache': False,
                      'settings': {'body_node_ids': ['step'], 'input_path': 'input.items', 'max_iterations': 10}}
        body = {'id': 'step', 'type': 'ai.gemini', 'depends_on': ['loop'], 'cache': False, 'settings': {}}
        with tempfile.TemporaryDirectory() as folder:
            with patch('app.workflows.Registry.executor', return_value=lambda node, deps, source, workdir: {'done': True}), \
                 patch('app.workflows.Credentials.bind_for_node', return_value=contextlib.nullcontext()):
                result, _ = run_loop_controller(controller, [controller, body],
                    {'input': {'items': [{'id': 'a'}, {'id': 'b'}]}}, None,
                    Path(folder), lambda: False, seen.append)
        self.assertEqual(result['status'], 'completed')
        self.assertEqual(seen[-1]['item_execution_live']['completed'], 2)
        self.assertTrue(any(row['item_execution_live']['running'] == 1 for row in seen))


if __name__ == '__main__':
    unittest.main()
