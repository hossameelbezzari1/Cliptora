"""Run with: python -m unittest discover -s backend/tests -v"""
import importlib.util
import tempfile
import unittest
from unittest.mock import patch
from pathlib import Path

TARGET = Path(__file__).resolve().parents[1] / 'app/services/workflow_core.py'
spec = importlib.util.spec_from_file_location('workflow_core', TARGET)
core = importlib.util.module_from_spec(spec)
spec.loader.exec_module(core)

class WorkflowEngineTests(unittest.TestCase):
    def test_templates_and_dag(self):
        for template in core.preset_templates():
            graph = core.validate_workflow(template['nodes'])
            self.assertEqual(len(graph), len(template['nodes']))
        nodes = [
            {'id': 'end', 'type': 'animation.keyframes', 'depends_on': ['begin']},
            {'id': 'begin', 'type': 'animation.storyboard', 'settings': {'script': 'Hello\nWorld'}}
        ]
        self.assertEqual(core.validate_workflow(nodes)[0]['id'], 'begin')

    def test_cycles_rejected(self):
        with self.assertRaisesRegex(ValueError, 'cycle'):
            core.validate_workflow([
                {'id':'a', 'type':'media.probe', 'depends_on':['b']},
                {'id':'b', 'type':'media.probe', 'depends_on':['a']}
            ])
        with self.assertRaisesRegex(ValueError, 'unauthorized'):
            core.validate_workflow([{'id':'evil', 'type':'python.exec'}])

    def test_word_timings_and_ranges(self):
        words = core.as_words([{'text': 'Hello', 'start': 2.3, 'end': 2.7}, {'text':'world!', 'start':2.8, 'end':3.2}])
        segments = core.group_words(words)
        self.assertEqual(len(segments), 1)
        moments = core.normalize_highlights([{'start_word_id':1,'end_word_id':2,'score':99}], words)
        self.assertEqual(moments[0]['start'], 2.3)
        self.assertEqual(moments[0]['end'], 3.2)

    def test_animation_pipeline(self):
        nodes = core.preset_templates()[2]['nodes']
        with tempfile.TemporaryDirectory() as workspace:
            snapshots = []
            result = core.run_graph(nodes, None, Path(workspace), lambda percent, node, data: snapshots.append(percent))
            self.assertEqual(result['status'], 'completed')
            self.assertEqual(snapshots[-1], 100)
            self.assertTrue((Path(workspace)/'keyframes.json').is_file())

    def test_transcript_to_cuts(self):
        words = []
        for i in range(24):
            words.append({'start':i*0.52, 'end':i*0.52+0.43, 'text':['today','we','explore','something','important','here'][i%6]})
        nodes = [
            {'id':'imported', 'type':'transcript.import', 'settings':{'words':words}},
            {'id':'highlights', 'type':'ai.highlights', 'depends_on':['imported'], 'settings':{'mode':'offline','target_duration':10}},
            {'id':'cuts', 'type':'timeline.cut_plan', 'depends_on':['highlights'], 'settings':{'padding':0.1}},
        ]
        with tempfile.TemporaryDirectory() as workspace:
            result = core.run_graph(nodes, None, Path(workspace), lambda *_:None)
            self.assertEqual(result['status'], 'completed')
            import json
            plan=json.loads((Path(workspace)/'cuts.json').read_text())['cut_plan']
            self.assertTrue(len(plan)>0)
            self.assertEqual(plan[0]['timeline_start'],0)

    def test_retry_and_checkpoint_cache(self):
        nodes = core.preset_templates()[2]['nodes']
        original = core.call_node
        calls = {'count': 0}
        def flaky(node, outputs, source, workdir):
            calls['count'] += 1
            if calls['count'] == 1:
                raise RuntimeError('temporary provider failure')
            return original(node, outputs, source, workdir)
        with tempfile.TemporaryDirectory() as workspace:
            with patch.object(core, 'call_node', side_effect=flaky):
                first = core.run_graph(nodes, None, Path(workspace), lambda *_: None)
            self.assertEqual(first['nodes']['storyboard']['attempts'], 2)
            with patch.object(core, 'call_node', side_effect=AssertionError('checkpoint was not reused')):
                second = core.run_graph(nodes, None, Path(workspace), lambda *_: None)
            self.assertTrue(second['nodes']['storyboard']['cached'])
            self.assertTrue(second['nodes']['keyframes']['cached'])

if __name__ == '__main__': unittest.main()
