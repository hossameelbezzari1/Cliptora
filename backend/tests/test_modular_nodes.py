"""Offline regression tests for modular CLIPTORA nodes (no database required)."""
import json
import tempfile
import unittest
from pathlib import Path

from app.services.workflow_core import (
    NODE_TYPES, call_node, execution_nodes, preset_templates, run_graph,
    tool_catalog, validate_workflow,
)
from app.workflows.registry import discovered, executor


class ModularNodesTests(unittest.TestCase):
    def test_registry_metadata_and_executors(self):
        self.assertEqual(len(discovered()), 23)
        self.assertEqual(set(NODE_TYPES), set(discovered()))
        self.assertEqual(len(tool_catalog()), len(discovered()))
        self.assertTrue(all(row['status'] == 'implemented' for row in tool_catalog()))
        self.assertTrue(all(row['backend_executor'] for row in tool_catalog()))
        self.assertFalse(any(row['type'].startswith('planned.') for row in tool_catalog()))
        with self.assertRaises(ValueError):
            executor('planned.invalid')

    def test_manual_trigger_and_source(self):
        with tempfile.TemporaryDirectory() as folder:
            wd=Path(folder)
            self.assertEqual(call_node({'type':'core.manual_trigger','settings':{}}, {}, None, wd),
                             {'trigger': {'type':'manual','status':'received'}})
            video=wd/'test.mp4'; video.write_bytes(b'test')
            self.assertEqual(call_node({'type':'core.video_source','settings':{}}, {},video,wd)['source']['size_bytes'],4)

    def test_flow_branches_filter_merge(self):
        with tempfile.TemporaryDirectory() as folder:
            wd=Path(folder)
            upstream={'start':{'data':{'x':10},'items':[{'ok':True},{'ok':False}]}}
            if_out=call_node({'type':'flow.if','settings':{'path':'start.data.x','operator':'greater_than','value':5}},upstream,None,wd)
            self.assertTrue(if_out['condition'])
            sw=call_node({'type':'flow.switch','settings':{'path':'start.data.x','rules':[{'value':'10','route':3}]}},upstream,None,wd)
            self.assertEqual(sw['route'],3)
            combined=call_node({'type':'flow.merge','settings':{'mode':'combine'}},{'a':{'x':1},'b':{'y':2}},None,wd)
            self.assertEqual(combined['items'],{'x':1,'y':2})
            kept=call_node({'type':'data.filter','settings':{'path':'start.items','field':'ok','operator':'truthy'}},upstream,None,wd)
            self.assertEqual(kept['matched_count'],1)

    def test_text_video_pipeline(self):
        with tempfile.TemporaryDirectory() as folder:
            wd=Path(folder)
            words=call_node({'type':'transcript.import','settings':{'words':[
                {'start':0,'end':1,'text':'Hello'},
                {'start':1.1,'end':2,'text':'world.'},
                {'start':3,'end':4,'text':'Another'},
                {'start':4.1,'end':5,'text':'scene.'},
            ]}}, {},None,wd)
            moments=call_node({'type':'ai.highlights','settings':{'mode':'offline','target_duration':10,'strategy':'story_recap'}},{'words':words},None,wd)
            self.assertTrue(moments['highlights'])
            cuts=call_node({'type':'timeline.cut_plan','settings':{'padding':0.1}},{'moments':moments},None,wd)
            self.assertTrue(cuts['cut_plan'])
            captions=call_node({'type':'caption.generate','settings':{'max_words':3}},{'words':words,'moments':moments},None,wd)
            self.assertTrue(captions['captions'])
            summary=call_node({'type':'ai.summary','settings':{'mode':'offline'}},{'moments':moments,'words':words},None,wd)
            self.assertEqual(summary['method'],'extractive_fallback')
            disabled=call_node({'type':'video.render','settings':{'enabled':False}},{'cuts':cuts},None,wd)
            self.assertEqual(disabled['render']['state'],'disabled')

    def test_run_artifact_caching_and_cancel(self):
        nodes=[
            {'id':'trigger','type':'core.manual_trigger','depends_on':[],'settings':{}},
            {'id':'branch','type':'flow.if','depends_on':['trigger'],
             'settings':{'path':'trigger.trigger.status','operator':'equals','value':'received'}},
        ]
        with tempfile.TemporaryDirectory() as folder:
            wd=Path(folder)
            first=run_graph(nodes,None,wd,lambda *_:None)
            second=run_graph(nodes,None,wd,lambda *_:None)
            self.assertEqual(first['status'],'completed')
            self.assertTrue(second['nodes']['branch']['cached'])
            self.assertTrue((wd/'branch.json').is_file())
            self.assertEqual(run_graph(nodes,None,wd,lambda *_:None,lambda:True)['status'],'cancelled')

    def test_catalog_direct_add_and_default_form(self):
        from app.workflows.schemas import inferred_parameters_schema
        by_type = {item['type']: item for item in tool_catalog()}
        self.assertEqual(by_type['core.manual_trigger']['actions'], [])
        self.assertEqual(by_type['media.probe']['actions'], [])
        self.assertEqual(by_type['ai.gemini']['actions'][0], 'analyze_audio')
        self.assertEqual(inferred_parameters_schema({'count': 3, 'active': True})['properties']['count']['type'], 'integer')
        self.assertEqual(inferred_parameters_schema({'count': 3, 'active': True})['properties']['active']['type'], 'boolean')
        self.assertNotIn('credential_id', inferred_parameters_schema({'credential_id': 'x'})['properties'])

    def test_registry_standalone_without_legacy_import(self):
        import subprocess
        import sys
        script = ('import sys; from app.workflows.registry import node_metadata; '
                  'assert len(node_metadata()) >= 23; '
                  'assert "app.services.workflow_core" not in sys.modules')
        proc = subprocess.run([sys.executable, '-c', script], capture_output=True, text=True)
        self.assertEqual(proc.returncode, 0, proc.stderr)

    def test_templates_stable_and_unknown_nodes_blocked(self):
        self.assertEqual(len(preset_templates()),4)
        for template in preset_templates():
            self.assertTrue(validate_workflow(template['nodes']))
        with self.assertRaises(ValueError):
            validate_workflow([{'id':'node','type':'planned.fake','depends_on':[]}])
        with self.assertRaises(ValueError):
            call_node({'type':'planned.fake'}, {}, None, Path('.'))
        nodes=[{'id':'trigger','type':'core.manual_trigger','depends_on':[]},
               {'id':'pass','type':'flow.if','depends_on':['trigger']}]
        self.assertEqual([node['id'] for node in execution_nodes(nodes,'pass')],['trigger','pass'])


if __name__=='__main__':
    unittest.main()
