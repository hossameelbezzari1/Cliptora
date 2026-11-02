"""Offline regression tests for the reconstructed V3 modular backend."""
import json
from pathlib import Path
import pytest
from app.workflows.Node import Node
from app.workflows.Registry import discovered, node_metadata, executor
from app.workflows.Catalog import preset_templates
from app.workflows.Validation import validate_workflow
from app.workflows.Engine import run_graph
from app.workflows.Credentials import execution_owner, credential_field
from app.core.Encryption import encrypt, decrypt
from app.services.CredentialService import CredentialService


def execute(kind,settings=None,outputs=None,source=None,workdir=None):
    return executor(kind)({'id':'step','type':kind,'settings':settings or {}},outputs or {},source,workdir or Path('.'))


def test_registry_is_abstract_class_based_and_legacy_ids_work():
    from app.workflows.nodes.Gemini import GeminiNode
    assert issubclass(GeminiNode, Node)
    assert len(discovered())>=20
    for kind,meta in node_metadata().items():
        assert meta['label'] and meta['group'] and isinstance(meta['settings'],dict)
        assert callable(discovered()[kind].execute)
    for template in preset_templates():validate_workflow(template['nodes'])
    assert execute('core.manual_trigger')['trigger']['status']=='received'


def test_workflow_runs_and_caches(tmp_path):
    nodes=[{'id':'go','type':'core.manual_trigger','depends_on':[],'settings':{},'cache':True}]
    assert run_graph(nodes,None,tmp_path,lambda *args:None)['status']=='completed'
    assert run_graph(nodes,None,tmp_path,lambda *args:None)['nodes']['go']['cached'] is True
    assert json.loads((tmp_path/'go.json').read_text())['trigger']['status']=='received'


def test_node_rules_and_logic():
    assert execute('flow.if',{'path':'x.value','operator':'truthy'},{'x':{'value':True}})['condition']
    assert execute('flow.merge',{'mode':'append'},{'a':{'items':[1]},'b':{'items':[2]}})['items']==[1,2]
    assert execute('flow.switch',{'path':'x.value','cases':[{'value':7}]},{'x':{'value':7}})['route']==0
    with pytest.raises(ValueError,match='secrets'):
        validate_workflow([{'id':'x','type':'ai.gemini','settings':{'api_key':'DO NOT STORE KEY'}}])
    with pytest.raises(ValueError,match='credential_id'):
        validate_workflow([{'id':'x','type':'ai.gemini','settings':{'credential_id':'abc'}}])


def test_highlights_cut_plan_and_storyboard():
    words=[{'id':i,'text':f'w{i}','start':i-1.,'end':float(i)} for i in range(1,13)]
    clips=execute('ai.highlights',{'mode':'manual','target_duration':5,'highlights':[{'start_word_id':1,'end_word_id':11,'score':99,'reason':'test'}]},{'words':{'words':words}})
    assert clips['selected_duration']<=5
    plan=execute('timeline.cut_plan',{'padding':0.2},{'h':clips,'probe':{'probe':{'duration':11}}})
    assert plan['cut_plan']
    scenes=execute('animation.storyboard',{'script':'A\nB','scene_seconds':2})
    assert [s['start'] for s in scenes['scenes']]==[0,2]


def test_credentials_encrypted_and_provider_owned(monkeypatch):
    import app.core.Config as cfg
    monkeypatch.setenv('SECRET_KEY','a_long_random_test_secret_key_123456789999999')
    cfg.settings.cache_clear()
    blob=encrypt({'api_key':'my-very-secret-key'})
    assert 'my-very-secret-key' not in blob
    assert decrypt(blob)['api_key']=='my-very-secret-key'
    assert CredentialService.sanitize('ollama',{'base_url':'http://host.docker.internal:11434'})
    with pytest.raises(ValueError):CredentialService.sanitize('ollama',{'base_url':'http://169.254.169.254/latest/meta-data'})
    with pytest.raises(ValueError):CredentialService.sanitize('gemini',{'api_key':'test', 'extra':'x'})
    cfg.settings.cache_clear()


def test_ai_nodes_do_not_read_keys_from_env(monkeypatch):
    # The user must select credential_id and the backend must bind it; no implicit env fallback.
    monkeypatch.setenv('GEMINI_API_KEY','test-should-be-ignored')
    with pytest.raises(ValueError,match='credential'):
        execute('ai.gemini',{'action':'message_model','prompt':'Hi'})
