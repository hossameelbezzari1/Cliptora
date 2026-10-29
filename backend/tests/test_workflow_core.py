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
        self.assertEqual(openai['action_capabilities']['edit_image']['status'], 'implemented')
        self.assertEqual(openai['settings']['model'], 'gpt-6.1-sol')

    def test_gemini_catalog_matches_the_fifteen_action_picker(self):
        gemini = next(item for item in core.tool_catalog() if item['type'] == 'ai.gemini')
        self.assertEqual(len(gemini['actions']), 15)
        self.assertEqual(gemini['actions'][:3], ['analyze_audio', 'transcribe_recording', 'analyze_document'])
        self.assertEqual(gemini['actions'][-3:], ['analyze_video', 'generate_video', 'download_video'])
        self.assertEqual(gemini['action_capabilities']['create_file_search_store']['group'], 'File Search actions')
        self.assertEqual(gemini['action_capabilities']['message_model']['status'], 'implemented')
        self.assertEqual(gemini['action_capabilities']['upload_media_file']['status'], 'unavailable')
        self.assertEqual(gemini['settings']['model'], 'gemini-3.8-flash')

    def test_ollama_catalog_matches_the_two_action_picker(self):
        ollama = next(item for item in core.tool_catalog() if item['type'] == 'ai.ollama')
        self.assertEqual(ollama['actions'], ['analyze_image', 'message_model'])
        self.assertEqual(ollama['action_capabilities']['analyze_image']['group'], 'Image actions')
        self.assertEqual(ollama['action_capabilities']['message_model']['group'], 'Text actions')
        self.assertTrue(all(ollama['action_capabilities'][action]['status'] == 'implemented' for action in ollama['actions']))
        self.assertEqual(ollama['settings']['model'], 'gemma3')

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
        payload = json.loads(request.data)
        self.assertEqual(payload['max_completion_tokens'], 1000)
        self.assertNotIn('max_tokens', payload)
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
        self.assertEqual(payload['max_completion_tokens'], 1000)

    def test_current_reasoning_model_uses_supported_chat_parameters(self):
        class Response:
            def __enter__(self): return self
            def __exit__(self, *_): return False
            def read(self): return json.dumps({'model': 'gpt-6.1-sol', 'choices': [{'message': {'content': 'ok'}, 'finish_reason': 'stop'}]}).encode()
        with patch.dict(os.environ, {'OPENAI_API_KEY': 'server-only-key'}), patch.object(core.urllib.request, 'urlopen', return_value=Response()) as request_mock:
            core.openai_chat({'model': 'gpt-6.1-sol', 'prompt': 'Hello', 'reasoning_effort': 'medium', 'temperature': 1.5, 'max_output_tokens': 500}, {})
        payload = json.loads(request_mock.call_args.args[0].data)
        self.assertEqual(payload['reasoning_effort'], 'medium')
        self.assertEqual(payload['max_completion_tokens'], 500)
        self.assertNotIn('temperature', payload)

    def test_generate_image_migrates_incompatible_text_model(self):
        with patch.object(core, 'openai_request', return_value={'data': [{'b64_json': 'encoded'}]}) as request_mock:
            result = core.call_node({'type': 'ai.openai', 'settings': {'action': 'generate_image', 'model': 'gpt-4o-mini', 'prompt': 'A blue sphere'}}, {}, None, Path('.'))
        self.assertEqual(result['images'][0]['b64_json'], 'encoded')
        self.assertEqual(request_mock.call_args.args[1]['model'], 'gpt-image-2.5-flare')

    def test_openai_edit_image_fetches_public_inputs_and_sends_multipart(self):
        downloaded = [
            (b'primary-image', 'image/webp', 'input.webp'),
            (b'png-mask', 'image/png', 'input.png'),
        ]
        provider = {'data': [{'b64_json': 'edited-image'}]}
        settings = {
            'action': 'edit_image', 'model': 'gpt-image-2.5-sunburst', 'prompt': 'Replace the sky',
            'image_urls': 'https://images.example.com/source.webp',
            'mask_image_url': 'https://images.example.com/mask.png', 'image_size': '1024x1024',
            'image_input_fidelity': 'high', 'simplify_output': True,
        }
        with patch.object(core, 'fetch_public_image_bytes', side_effect=downloaded) as fetch_mock, patch.object(core, 'openai_multipart_request', return_value=provider) as request_mock:
            result = core.call_node({'type': 'ai.openai', 'settings': settings}, {}, None, Path('.'))
        self.assertEqual(result['images'][0]['b64_json'], 'edited-image')
        self.assertEqual(fetch_mock.call_count, 2)
        path, fields, files = request_mock.call_args.args
        self.assertEqual(path, 'images/edits')
        self.assertEqual(fields['model'], 'gpt-image-2.5-sunburst')
        self.assertEqual(fields['input_fidelity'], 'high')
        self.assertEqual(files[0], ('image[]', 'input-1.webp', 'image/webp', b'primary-image'))
        self.assertEqual(files[1], ('mask', 'mask.png', 'image/png', b'png-mask'))

    def test_openai_unavailable_action_is_rejected(self):
        with self.assertRaisesRegex(ValueError, 'not supported'):
            core.call_node({'type': 'ai.openai', 'settings': {'action': 'generate_audio'}}, {}, None, Path('.'))

    def test_gemini_message_uses_backend_secret_and_current_model(self):
        class Response:
            def __enter__(self): return self
            def __exit__(self, *_): return False
            def read(self): return json.dumps({'candidates': [{'content': {'parts': [{'text': 'Gemini reply'}]}, 'finishReason': 'STOP'}], 'usageMetadata': {'totalTokenCount': 9}}).encode()
        with patch.dict(os.environ, {'GEMINI_API_KEY': 'server-only-gemini-key'}), patch.object(core.urllib.request, 'urlopen', return_value=Response()) as request_mock:
            result = core.call_node({'type': 'ai.gemini', 'settings': {'action': 'message_model', 'model': 'gemini-3.8-flash', 'prompt': 'Summarize', 'input_path': 'source.value', 'max_output_tokens': 600}}, {'source': {'value': {'answer': 42}}}, None, Path('.'))
        self.assertEqual(result['text'], 'Gemini reply')
        self.assertEqual(result['usage']['totalTokenCount'], 9)
        request = request_mock.call_args.args[0]
        payload = json.loads(request.data)
        self.assertIn('/models/gemini-3.8-flash:generateContent', request.full_url)
        self.assertEqual(request.get_header('X-goog-api-key'), 'server-only-gemini-key')
        self.assertEqual(payload['generationConfig']['maxOutputTokens'], 600)
        self.assertIn('"answer":42', payload['contents'][0]['parts'][0]['text'])
        self.assertNotIn('server-only-gemini-key', json.dumps(result))

    def test_gemini_image_generation_returns_real_inline_artifact(self):
        provider = {'candidates': [{'content': {'parts': [{'text': 'Created'}, {'inlineData': {'mimeType': 'image/png', 'data': 'encoded-image'}}]}}]}
        with patch.object(core, 'gemini_request', return_value=provider) as request_mock:
            result = core.call_node({'type': 'ai.gemini', 'settings': {'action': 'generate_image', 'model': 'gemini-3.1-flash-image', 'prompt': 'A blue sphere', 'image_aspect_ratio': '16:9'}}, {}, None, Path('.'))
        self.assertEqual(result['images'][0], {'mime_type': 'image/png', 'b64_json': 'encoded-image'})
        self.assertEqual(request_mock.call_args.args[0:2], ('POST', 'models/gemini-3.1-flash-image:generateContent'))
        self.assertEqual(request_mock.call_args.args[2]['generationConfig']['imageConfig']['aspectRatio'], '16:9')

    def test_gemini_file_search_store_management_uses_real_endpoints(self):
        with patch.object(core, 'gemini_request', return_value={'name': 'fileSearchStores/store-1'}) as request_mock:
            created = core.call_node({'type': 'ai.gemini', 'settings': {'action': 'create_file_search_store', 'display_name': 'Knowledge'}}, {}, None, Path('.'))
            self.assertEqual(created['name'], 'fileSearchStores/store-1')
            self.assertEqual(request_mock.call_args.args[0:2], ('POST', 'fileSearchStores'))
            self.assertEqual(request_mock.call_args.args[2]['embeddingModel'], 'models/gemini-embedding-2')
        with patch.object(core, 'gemini_request', return_value={'fileSearchStores': []}) as request_mock:
            core.call_node({'type': 'ai.gemini', 'settings': {'action': 'list_file_search_stores'}}, {}, None, Path('.'))
            self.assertEqual(request_mock.call_args.args, ('GET', 'fileSearchStores?pageSize=100'))
        with patch.object(core, 'gemini_request', return_value={}) as request_mock:
            core.call_node({'type': 'ai.gemini', 'settings': {'action': 'delete_file_search_store', 'store_name': 'fileSearchStores/store-1'}}, {}, None, Path('.'))
            self.assertEqual(request_mock.call_args.args, ('DELETE', 'fileSearchStores/store-1?force=true'))

    def test_gemini_unavailable_action_is_rejected(self):
        with self.assertRaisesRegex(ValueError, 'not supported'):
            core.call_node({'type': 'ai.gemini', 'settings': {'action': 'analyze_audio'}}, {}, None, Path('.'))

    def test_ollama_message_uses_local_chat_api_and_simplifies_output(self):
        provider = {'model': 'gemma4', 'message': {'role': 'assistant', 'content': 'Local reply'}, 'done_reason': 'stop', 'prompt_eval_count': 12, 'eval_count': 4, 'total_duration': 99}
        with patch.object(core, 'ollama_request', return_value=provider) as request_mock:
            result = core.call_node({'type': 'ai.ollama', 'settings': {'action': 'message_model', 'model': 'gemma4', 'system_prompt': 'Be concise', 'prompt': 'Summarize', 'input_path': 'source.value', 'temperature': 0.3, 'max_output_tokens': 512}}, {'source': {'value': {'answer': 42}}}, None, Path('.'))
        self.assertEqual(result['text'], 'Local reply')
        self.assertEqual(result['model'], 'gemma4')
        self.assertEqual(request_mock.call_args.args[0], 'api/chat')
        payload = request_mock.call_args.args[1]
        self.assertFalse(payload['stream'])
        self.assertEqual(payload['options'], {'temperature': 0.3, 'num_predict': 512})
        self.assertEqual(payload['messages'][0], {'role': 'system', 'content': 'Be concise'})
        self.assertIn('"answer":42', payload['messages'][1]['content'])

    def test_ollama_analyze_image_sends_real_base64_vision_payload(self):
        provider = {'model': 'gemma4', 'message': {'role': 'assistant', 'content': 'A cat.'}, 'done_reason': 'stop'}
        with patch.object(core, 'fetch_public_ollama_image', return_value='base64-image') as image_fetch, patch.object(core, 'ollama_request', return_value=provider) as request_mock:
            result = core.call_node({'type': 'ai.ollama', 'settings': {'action': 'analyze_image', 'model': 'gemma4', 'prompt': 'What is shown?', 'image_urls': 'https://images.example.com/cat.jpg'}}, {}, None, Path('.'))
        self.assertEqual(result['text'], 'A cat.')
        image_fetch.assert_called_once_with('https://images.example.com/cat.jpg')
        self.assertEqual(request_mock.call_args.args[1]['messages'][-1]['images'], ['base64-image'])

    def test_ollama_base_url_is_restricted_to_local_or_allowed_hosts(self):
        with patch.dict(os.environ, {'OLLAMA_BASE_URL': 'http://host.docker.internal:11434'}):
            self.assertEqual(core.ollama_base_url(), 'http://host.docker.internal:11434')
        with patch.dict(os.environ, {'OLLAMA_BASE_URL': 'https://remote.example.com'}, clear=False):
            with self.assertRaisesRegex(ValueError, 'allowed local'):
                core.ollama_base_url()

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
