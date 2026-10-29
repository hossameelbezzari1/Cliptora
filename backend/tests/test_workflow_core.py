"""Run with: python -m unittest discover -s backend/tests -v"""
import importlib.util
import json
import os
import tempfile
import unittest
from unittest.mock import patch
from pathlib import Path

TARGET = Path(__file__).resolve().parents[1] / 'app/services/workflow_core.py'
spec = importlib.util.spec_from_file_location('workflow_core', TARGET)
core = importlib.util.module_from_spec(spec)
spec.loader.exec_module(core)

class WorkflowEngineTests(unittest.TestCase):
    def test_tool_registry_separates_runnable_planned_and_unavailable_tools(self):
        catalog = core.tool_catalog()
        self.assertEqual(len({item['type'] for item in catalog}), len(catalog))
        self.assertEqual(sum(item['status'] == 'implemented' for item in catalog), len(core.NODE_TYPES))
        used_labels = {item['label'].casefold() for item in catalog if item['status'] == 'implemented'}
        expected_planned = sum(label.casefold() not in used_labels for labels in core.PROPOSED_TOOL_GROUPS.values() for label in labels)
        self.assertEqual(sum(item['status'] == 'planned' for item in catalog), expected_planned)
        self.assertEqual(sum(item['status'] == 'unavailable' for item in catalog), 445)
        self.assertTrue(all(item['backend_executor'] for item in catalog if item['status'] == 'implemented'))
        self.assertTrue(all(item['backend_executor'] is None for item in catalog if item['status'] != 'implemented'))

    def test_openai_catalog_matches_the_sixteen_action_picker(self):
        openai = next(item for item in core.tool_catalog() if item['type'] == 'ai.openai')
        self.assertEqual(len(openai['actions']), 16)
        self.assertEqual(openai['actions'][-5:], ['create_conversation', 'get_conversation', 'remove_conversation', 'update_conversation', 'generate_video'])
        self.assertEqual(openai['action_capabilities']['create_conversation']['group'], 'Conversation actions')
        self.assertEqual(openai['action_capabilities']['generate_video']['group'], 'Video actions')

    def test_ai_agent_and_chat_model_are_runnable_catalog_nodes(self):
        catalog = {item['type']: item for item in core.tool_catalog()}
        self.assertEqual(catalog['ai.agent']['status'], 'implemented')
        self.assertEqual(catalog['ai.chat_model']['label'], 'OpenAI Chat Model')
        self.assertEqual(catalog['ai.agent']['settings']['prompt_source'], 'connected_chat_trigger')

    def test_n8n_inventory_matches_vendored_manifest(self):
        package_path = Path(__file__).resolve().parents[2] / 'vendor/n8n/packages/nodes-base/package.json'
        inventory = core.n8n_node_catalog()
        self.assertEqual(len(inventory), 445)
        self.assertEqual(len({item['type'] for item in inventory}), len(inventory))
        self.assertTrue(all(item['status'] == 'unavailable' for item in inventory))
        self.assertTrue(all(item['source_package'] and item['source_path'] and item['source_license'] for item in inventory))
        if package_path.is_file():
            package = json.loads(package_path.read_text(encoding='utf-8'))
            self.assertEqual(len(inventory), len(package['n8n']['nodes']))
            self.assertEqual({item['source_path'] for item in inventory}, set(package['n8n']['nodes']))
            self.assertTrue(all(item['source_package'] == package['name'] for item in inventory))
            self.assertTrue(all(item['version'] == package['version'] for item in inventory))
            self.assertTrue(all(item['source_license'] == package['license'] for item in inventory))

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

    def test_manual_trigger_is_real_and_persisted_as_artifact(self):
        nodes = [{'id': 'start', 'type': 'core.manual_trigger'}]
        with tempfile.TemporaryDirectory() as workspace:
            result = core.run_graph(nodes, None, Path(workspace), lambda *_: None)
            self.assertEqual(result['status'], 'completed')
            self.assertEqual(result['nodes']['start']['state'], 'completed')
            import json
            artifact = json.loads((Path(workspace) / 'start.json').read_text())
            self.assertEqual(artifact['trigger']['type'], 'manual')

    def test_video_source_node_uses_the_resolved_workflow_source(self):
        nodes = [{'id': 'source', 'type': 'core.video_source', 'settings': {'source_id': 7}}]
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            video = root / 'selected.mp4'
            video.write_bytes(b'video-bytes')
            result = core.run_graph(nodes, video, root / 'run', lambda *_: None)
            self.assertEqual(result['status'], 'completed')
            artifact = json.loads((root / 'run' / 'source.json').read_text())
            self.assertEqual(artifact['source']['filename'], 'selected.mp4')
            self.assertEqual(artifact['source']['size_bytes'], 11)

    def test_if_node_runs_only_the_matching_branch(self):
        nodes = [
            {'id': 'start', 'type': 'core.manual_trigger'},
            {'id': 'decision', 'type': 'flow.if', 'depends_on': ['start'], 'settings': {'path': 'start.trigger.status', 'operator': 'equals', 'value': 'received'}},
            {'id': 'yes', 'type': 'animation.storyboard', 'depends_on': ['decision'], 'when': 'condition_true', 'settings': {'script': 'True branch'}},
            {'id': 'no', 'type': 'animation.storyboard', 'depends_on': ['decision'], 'when': 'condition_false', 'settings': {'script': 'False branch'}},
        ]
        with tempfile.TemporaryDirectory() as workspace:
            result = core.run_graph(nodes, None, Path(workspace), lambda *_: None)
            self.assertEqual(result['nodes']['decision']['state'], 'completed')
            self.assertEqual(result['nodes']['yes']['state'], 'completed')
            self.assertEqual(result['nodes']['no']['state'], 'skipped')

    def test_if_numeric_and_invalid_path_validation(self):
        self.assertTrue(core.compare_value(12, 'greater_than', '10'))
        self.assertFalse(core.compare_value(12, 'less_than', '10'))
        with self.assertRaisesRegex(ValueError, 'dot path'):
            core.input_path({'node': {}}, '../secret')

    def test_switch_routes_and_fallback(self):
        nodes = [
            {'id': 'start', 'type': 'core.manual_trigger'},
            {'id': 'switch', 'type': 'flow.switch', 'depends_on': ['start'], 'settings': {'path': 'start.trigger.status', 'operator': 'equals', 'rules': [{'value': 'received', 'route': 2}]}},
            {'id': 'route', 'type': 'animation.storyboard', 'depends_on': ['switch'], 'when': 'route_2', 'settings': {'script': 'Matched'}},
            {'id': 'fallback', 'type': 'animation.storyboard', 'depends_on': ['switch'], 'when': 'route_fallback', 'settings': {'script': 'Fallback'}},
        ]
        with tempfile.TemporaryDirectory() as workspace:
            result = core.run_graph(nodes, None, Path(workspace), lambda *_: None)
        self.assertEqual(result['nodes']['route']['state'], 'completed')
        self.assertEqual(result['nodes']['fallback']['state'], 'skipped')

    def test_merge_and_filter_execute_real_data(self):
        merged = core.call_node({'type': 'flow.merge', 'settings': {'mode': 'append'}}, {
            'left': {'items': [{'id': 1}, {'id': 2}]},
            'right': {'items': [{'id': 3}]},
        }, None, Path('.'))
        self.assertEqual([item['id'] for item in merged['items']], [1, 2, 3])
        filtered = core.call_node({'type': 'data.filter', 'settings': {'path': 'merge.items', 'field': 'id', 'operator': 'greater_than', 'value': 1}}, {'merge': merged}, None, Path('.'))
        self.assertEqual([item['id'] for item in filtered['items']], [2, 3])

    def test_http_request_requires_explicit_https_allowlist(self):
        public_address = [(2, 1, 6, '', ('93.184.216.34', 443))]
        with patch.dict(os.environ, {'CLIPTORA_WORKFLOW_HTTP_ALLOWED_HOSTS': 'api.example.com'}), patch.object(core.socket, 'getaddrinfo', return_value=public_address):
            url = core.safe_workflow_http_url('https://api.example.com/items?old=1', {'page': 2})
            self.assertEqual(url, 'https://api.example.com/items?old=1&page=2')
            with self.assertRaisesRegex(ValueError, 'not in'):
                core.safe_workflow_http_url('https://other.example.com/items')
            with self.assertRaisesRegex(ValueError, 'HTTPS'):
                core.safe_workflow_http_url('http://api.example.com/items')

    def test_openai_node_uses_backend_secret_and_returns_provider_output(self):
        class Response:
            def __enter__(self): return self
            def __exit__(self, *_): return False
            def read(self): return json.dumps({'model': 'gpt-test', 'choices': [{'message': {'content': 'real provider text'}, 'finish_reason': 'stop'}], 'usage': {'total_tokens': 7}}).encode()
        with patch.dict(os.environ, {'OPENAI_API_KEY': 'server-only-key'}), patch.object(core.urllib.request, 'urlopen', return_value=Response()) as request_mock:
            result = core.call_node({'type': 'ai.openai', 'settings': {'model': 'gpt-test', 'prompt': 'Summarize', 'input_path': 'source.value'}}, {'source': {'value': {'answer': 42}}}, None, Path('.'))
        self.assertEqual(result['text'], 'real provider text')
        self.assertEqual(result['usage']['total_tokens'], 7)
        request = request_mock.call_args.args[0]
        self.assertEqual(request.get_header('Authorization'), 'Bearer server-only-key')
        self.assertNotIn('server-only-key', json.dumps(result))

    def test_openai_analyze_image_sends_vision_content_and_simplifies_output(self):
        class Response:
            def __enter__(self): return self
            def __exit__(self, *_): return False
            def read(self): return json.dumps({'model': 'gpt-4o-mini', 'choices': [{'message': {'content': 'A sunset over the ocean.'}, 'finish_reason': 'stop'}], 'usage': {'total_tokens': 19}}).encode()
        with patch.dict(os.environ, {'OPENAI_API_KEY': 'server-only-key'}), patch.object(core.urllib.request, 'urlopen', return_value=Response()) as request_mock:
            result = core.call_node({'type': 'ai.openai', 'settings': {'action': 'analyze_image', 'model': 'gpt-4o-mini', 'prompt': "What's in this image?", 'image_urls': 'https://images.example.com/sunset.jpg', 'simplify_output': True}}, {}, None, Path('.'))
        self.assertEqual(result['text'], 'A sunset over the ocean.')
        request = request_mock.call_args.args[0]
        payload = json.loads(request.data)
        self.assertEqual(payload['messages'][0]['content'][1]['type'], 'image_url')
        self.assertEqual(payload['messages'][0]['content'][1]['image_url']['url'], 'https://images.example.com/sunset.jpg')

    def test_openai_unavailable_action_is_rejected(self):
        with self.assertRaisesRegex(ValueError, 'not supported'):
            core.call_node({'type': 'ai.openai', 'settings': {'action': 'edit_image'}}, {}, None, Path('.'))

    def test_ai_agent_requires_chat_model_and_uses_connected_inputs(self):
        with self.assertRaisesRegex(ValueError, 'Chat Model'):
            core.call_node({'type': 'ai.agent', 'settings': {'prompt_source': 'define_below', 'prompt': 'Hello'}}, {}, None, Path('.'))

        settings = {
            'prompt_source': 'define_below', 'prompt': 'Answer the user',
            '__cliptora_ui_target_handles': {'model': 'chat_model', 'memory': 'memory', 'tool': 'tool'},
            'system_message': 'Act as an agent.',
        }
        outputs = {
            'model': {'chat_model': {'model': 'gpt-test', 'temperature': 0.3, 'max_output_tokens': 321}},
            'memory': {'messages': ['Earlier context']},
            'tool': {'items': [{'answer': 42}]},
        }
        with patch.object(core, 'openai_chat', return_value={'text': 'Agent reply', 'model': 'gpt-test'}) as chat:
            result = core.call_node({'type': 'ai.agent', 'settings': settings}, outputs, None, Path('.'))
        self.assertEqual(result['text'], 'Agent reply')
        self.assertEqual(result['agent']['chat_model_node'], 'model')
        request_cfg = chat.call_args.args[0]
        self.assertIn('Conversation memory', request_cfg['prompt'])
        self.assertIn('Connected tool results', request_cfg['prompt'])
        self.assertEqual(request_cfg['max_output_tokens'], 321)

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
            if node['id'] == 'storyboard':
                calls['count'] += 1
            if node['id'] == 'storyboard' and calls['count'] == 1:
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
