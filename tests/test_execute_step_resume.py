"""Standalone verification of CLIPTORA Execute Step reuse behavior."""
from __future__ import annotations
import importlib
import json
import sys
import tempfile
import types
import unittest
from pathlib import Path
from types import SimpleNamespace

BACKEND = Path(__file__).resolve().parents[1] / 'backend'
sys.path.insert(0, str(BACKEND))
# Reuse only needs the run media location; avoids FastAPI/SQLAlchemy dependencies.
media = types.ModuleType('app.workflows.MediaStorage')
media.run_media_dir = lambda folder: Path(folder) / 'media'
sys.modules['app.workflows.MediaStorage'] = media
reuse = importlib.import_module('app.workflows.Reuse')

def node(ident, deps=(), *, cache=True, kind='test.node', settings=None):
    return {'id': ident, 'type': kind, 'depends_on': list(deps),
            'settings': settings or {}, 'when': 'always', 'retry_limit': 1,
            'cache': cache, 'position': {'x': 0, 'y': 0}}

class ExecuteStepTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.runs = Path(self.tmp.name) / 'runs'
        self.old = self.runs / '12'
        self.new = self.runs / '13'
        self.old.mkdir(parents=True)
        self.new.mkdir()

    def make_old_run(self, nodes, artifacts, source_id=None):
        self.prev = SimpleNamespace(id=12, source_id=source_id,
                                    workflow_json=json.dumps(nodes))
        outputs = {}
        for n in nodes:
            ident = n['id']
            if ident not in artifacts:
                continue
            result = artifacts[ident]
            deps = {dep: outputs[dep] for dep in n['depends_on'] if dep in outputs}
            self.old.joinpath(f'{ident}.json').write_text(json.dumps(result))
            self.old.joinpath(f'.{ident}.sha256').write_text(
                reuse._engine_fingerprint(n, deps, None))
            outputs[ident] = result

    def test_strict_resume_reuses_older_outputs_and_does_not_reuse_target(self):
        nodes = [node('video'), node('merge', ['video'], cache=False),
                 node('agent', ['merge'], kind='ai.agent', settings={reuse.STEP_TARGET_KEY: True})]
        self.make_old_run(nodes, {'video': {'duration': 2}, 'merge': {'groups': [1,2]}})
        result = reuse.collect_reusable_outputs(nodes, [self.prev], self.new, None)
        self.assertEqual(set(result), {'video', 'merge'})
        self.assertEqual(result['merge']['result']['groups'], [1, 2])

    def test_strict_missing_upstream_fails_without_running(self):
        nodes = [node('video'), node('merge', ['video']),
                 node('agent', ['merge'], kind='ai.agent', settings={reuse.STEP_TARGET_KEY: True})]
        self.make_old_run(nodes, {'video': {'duration': 2}})
        with self.assertRaisesRegex(ValueError, r'merge: saved JSON artifact missing'):
            reuse.collect_reusable_outputs(nodes, [self.prev], self.new, None)

    def test_changed_input_is_not_reused(self):
        old_nodes = [node('video'), node('merge', ['video'], settings={'cut': 1}),
                     node('agent', ['merge'], kind='ai.agent')]
        self.make_old_run(old_nodes, {'video': {'duration': 2}, 'merge': {'groups': [1]}})
        nodes = [node('video'), node('merge', ['video'], settings={'cut': 2}),
                 node('agent', ['merge'], kind='ai.agent', settings={reuse.STEP_TARGET_KEY: True})]
        with self.assertRaisesRegex(ValueError, r'merge: node configuration changed'):
            reuse.collect_reusable_outputs(nodes, [self.prev], self.new, None)

    def test_changed_agent_chat_model_is_reconstructed_from_current_settings(self):
        old = [node('video'), node('merge',['video']),
               node('model',kind='ai.chat_model',settings={'provider':'openai','model':'gpt-5.5','credential_id':1}),
               node('agent',['merge','model'],kind='ai.agent',settings={
                   '__cliptora_ui_target_handles': {'model':'chat_model'}})]
        self.make_old_run(old, {'video':{'duration':2},'merge':{'groups':[1]},
                                'model':{'chat_model': {'provider':'openai','model':'gpt-5.5','credential_id':1}}})
        new = [node('video'), node('merge',['video']),
               node('model',kind='ai.chat_model',settings={'provider':'gemini','model':'gemini-2.5-flash','credential_id':2}),
               node('agent',['merge','model'],kind='ai.agent',settings={
                   reuse.STEP_TARGET_KEY:True,
                   '__cliptora_ui_target_handles': {'model':'chat_model'}})]
        result = reuse.collect_reusable_outputs(new,[self.prev],self.new,None)
        self.assertEqual(result['model']['result']['chat_model']['provider'],'gemini')
        self.assertEqual(result['model']['result']['chat_model']['credential_id'],2)
        self.assertEqual(result['merge']['result']['groups'],[1])

    def test_main_flow_chat_model_change_is_not_silently_reused(self):
        old = [node('video'), node('model',kind='ai.chat_model',settings={'model':'old'}),
               node('processor',['model']), node('agent',['processor'],kind='ai.agent')]
        self.make_old_run(old,{'video':{'a':1},'model':{'chat_model':{'model':'old'}},'processor':{'v':1}})
        new = [node('video'), node('model',kind='ai.chat_model',settings={'model':'new'}),
               node('processor',['model']),node('agent',['processor'],kind='ai.agent',settings={reuse.STEP_TARGET_KEY:True})]
        with self.assertRaisesRegex(ValueError,'model: node configuration changed'):
            reuse.collect_reusable_outputs(new,[self.prev],self.new,None)

    def test_browser_tool_requires_no_previous_browser_artifact(self):
        nodes = [node('video'), node('browser', kind='browser.playwright'),
                 node('agent', ['video','browser'], kind='ai.agent', settings={
                   reuse.STEP_TARGET_KEY: True,
                   '__cliptora_ui_target_handles': {'browser':'tool'},
                 })]
        self.make_old_run(nodes, {'video': {'duration': 2}})
        result = reuse.collect_reusable_outputs(nodes, [self.prev], self.new, None)
        self.assertEqual(result['browser']['result']['agent_tool'], 'browser.playwright')

    def test_changed_browser_helper_is_rebuilt_from_current_settings(self):
        old = [
            node('commands', kind='browser.commands', settings={
                'actions': [{'command': 'click', 'target': '#old'}],
            }),
            node('browser', ['commands'], kind='browser.playwright'),
        ]
        self.make_old_run(old, {
            'commands': {
                'attachment_type': 'commands',
                'config': old[0]['settings'],
                'status': 'configured',
            },
        })
        current_actions = [{'command': 'fill', 'target': '#studio-script', 'value': 'hello'}]
        current = [
            node('commands', kind='browser.commands', settings={'actions': current_actions}),
            node('browser', ['commands'], kind='browser.playwright', settings={
                reuse.STEP_TARGET_KEY: True,
            }),
        ]

        result = reuse.collect_reusable_outputs(current, [self.prev], self.new, None)

        self.assertEqual(set(result), {'commands'})
        self.assertIsNone(result['commands']['run_id'])
        self.assertEqual(result['commands']['result']['config']['actions'], current_actions)

    def test_browser_helper_with_dependencies_remains_strict(self):
        old = [
            node('input'),
            node('commands', ['input'], kind='browser.commands', settings={'actions': []}),
            node('browser', ['commands'], kind='browser.playwright'),
        ]
        self.make_old_run(old, {
            'input': {'value': 1},
            'commands': {'attachment_type': 'commands', 'config': {'actions': []}},
        })
        current = [
            node('input'),
            node('commands', ['input'], kind='browser.commands', settings={'actions': [{'command': 'click', 'target': '#new'}]}),
            node('browser', ['commands'], kind='browser.playwright', settings={reuse.STEP_TARGET_KEY: True}),
        ]

        with self.assertRaisesRegex(ValueError, r'commands: node configuration changed'):
            reuse.collect_reusable_outputs(current, [self.prev], self.new, None)

if __name__ == '__main__': unittest.main()

class EngineStrictTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.workdir = Path(self.tmp.name) / 'runs' / '22'
        self.calls = []
        import contextlib
        app_log = types.ModuleType('app.core.AppLogging')
        app_log.configure_logging = lambda: None
        val = types.ModuleType('app.workflows.Validation')
        val.validate_workflow = lambda ns: ns
        transcript = types.ModuleType('app.helpers.Transcript')
        transcript.get_input = lambda ds, field: None
        registry = types.ModuleType('app.workflows.Registry')
        def executor(kind):
            def call(item, deps, src, ws):
                self.calls.append(item['id'])
                return {'executed': item['id']}
            return call
        registry.executor = executor
        cred = types.ModuleType('app.workflows.Credentials')
        @contextlib.contextmanager
        def bound(n):
            yield
        cred.bind_for_node = bound
        self.previous = {}
        for name, mod in {
            'app.core.AppLogging':app_log, 'app.workflows.Validation':val,
            'app.helpers.Transcript':transcript, 'app.workflows.Registry':registry,
            'app.workflows.Credentials':cred,
        }.items():
            self.previous[name] = sys.modules.get(name)
            sys.modules[name] = mod
        self.addCleanup(self.cleanup_modules)
        sys.modules.pop('app.workflows.Engine', None)
        self.engine = importlib.import_module('app.workflows.Engine')

    def cleanup_modules(self):
        sys.modules.pop('app.workflows.Engine', None)
        for name, mod in self.previous.items():
            if mod is None: sys.modules.pop(name, None)
            else: sys.modules[name] = mod

    def test_target_runs_without_upstream_executor(self):
        nodes = [node('video'),node('merge',['video']),
                 node('agent',['merge'],kind='ai.agent',settings={reuse.STEP_TARGET_KEY: True})]
        reused = {'video': {'result': {'a': 1},'run_id': 12},
                  'merge': {'result': {'b': 2},'run_id': 12}}
        outcome = self.engine.run_graph(nodes,None,self.workdir,lambda *args:None,reused=reused)
        self.assertEqual(self.calls,['agent'])
        self.assertEqual(outcome['status'],'completed')

    def test_missing_upstream_is_blocked_before_first_node(self):
        nodes = [node('video'),node('merge',['video']),
                 node('agent',['merge'],kind='ai.agent',settings={reuse.STEP_TARGET_KEY: True})]
        with self.assertRaisesRegex(ValueError, 'compatible upstream results missing'):
            self.engine.run_graph(nodes,None,self.workdir,lambda *args:None,reused={})
        self.assertEqual(self.calls,[])
