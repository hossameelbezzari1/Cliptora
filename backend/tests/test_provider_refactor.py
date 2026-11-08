"""Offline smoke tests: AI provider functionality lives in native CLIPTORA nodes."""
from pathlib import Path
import pytest

from app.workflows.nodes.Gemini import GeminiNode
from app.workflows.nodes.OpenAI import OpenAINode
from app.workflows.nodes.Ollama import OllamaNode
from app.workflows.nodes.Timeline import TimelineNode


def _execute(kind, cls, settings, outputs=None):
    return cls().execute(kind, {'id':'test_node', 'type':kind, 'settings':settings}, outputs or {}, None, Path('.'))


def test_metadata_preserves_family_and_operation_icons():
    for cls, kind, icon in (
        (GeminiNode, 'ai.gemini', 'brand:gemini'),
        (OpenAINode, 'ai.openai', 'brand:openai'),
        (OllamaNode, 'ai.ollama', 'brand:ollama'),
    ):
        meta = cls.definition(kind).metadata()
        assert meta['family_icon'] == icon
        assert meta['actions'] and all(action['icon'] for action in meta['actions'])


def test_gemini_message_dispatch(monkeypatch):
    monkeypatch.setattr(GeminiNode, '_request', staticmethod(lambda *a, **k: {
        'text':'mock text', 'usage':{}, 'finish_reason':'STOP'
    }))
    result = _execute('ai.gemini', GeminiNode, {'action':'message_model', 'prompt':'hello'})
    assert result['text'] == 'mock text'


def test_gemini_expression_message_resolves_ai_batch_items(monkeypatch):
    captured = {}

    def request(model, cfg, prompt, system, **kwargs):
        captured['messages'] = cfg['messages']
        captured['prompt'] = prompt
        return {'text': 'mock text', 'usage': {}, 'finish_reason': 'STOP'}

    monkeypatch.setattr(GeminiNode, '_request', staticmethod(request))
    outputs = {
        'ai_batch': {
            'merged': {
                'items': [
                    {'value': {'title': 'First'}},
                    {'value': {'title': 'Second'}},
                ]
            }
        }
    }
    settings = {
        'action': 'message_model',
        'messages': [{
            'role': 'user',
            'text': '',
            'mode': 'expression',
            'input_path': 'ai_batch.merged.items[].value',
        }],
    }

    result = GeminiNode().execute(
        'ai.gemini',
        {
            'id': 'gemini',
            'type': 'ai.gemini',
            'depends_on': ['ai_batch'],
            'settings': settings,
        },
        outputs,
        None,
        Path('.'),
    )

    assert result['text'] == 'mock text'
    assert captured['prompt'] == ''
    assert captured['messages'][0]['text'] == (
        '[{"title":"First"},{"title":"Second"}]'
    )


def test_gemini_expression_selects_compact_highlights_only(monkeypatch):
    captured = {}

    def request(model, cfg, prompt, system, **kwargs):
        captured['text'] = cfg['messages'][0]['text']
        return {'text': 'ok', 'usage': {}, 'finish_reason': 'STOP'}

    monkeypatch.setattr(GeminiNode, '_request', staticmethod(request))
    compact = [{
        'title': 'First',
        'selected_text': 'Short exact quote',
        'start': 1.0,
        'end': 4.0,
        'duration': 3.0,
        'score': 0.9,
        'reason': 'Strong moment',
    }]
    noisy = {
        'compact_highlights': compact,
        'merged': {
            'items': [{
                'value': {
                    **compact[0],
                    'references': [{'word': index} for index in range(500)],
                },
            }],
        },
        'provenance': [{'duplicate': 'metadata'}],
    }

    GeminiNode().execute(
        'ai.gemini',
        {
            'id': 'gemini',
            'type': 'ai.gemini',
            'depends_on': ['ai_batch'],
            'settings': {
                'messages': [{
                    'role': 'user',
                    'text': '',
                    'mode': 'expression',
                    'input_path': 'ai_batch.compact_highlights',
                }],
            },
        },
        {'ai_batch': noisy},
        None,
        Path('.'),
    )

    assert captured['text'] == (
        '[{"title":"First","selected_text":"Short exact quote",'
        '"start":1.0,"end":4.0,"duration":3.0,"score":0.9,'
        '"reason":"Strong moment"}]'
    )
    assert 'references' not in captured['text']
    assert 'provenance' not in captured['text']


def test_gemini_expression_auto_prefers_compact_highlights(monkeypatch):
    captured = {}

    def request(model, cfg, prompt, system, **kwargs):
        captured['text'] = cfg['messages'][0]['text']
        return {'text': 'ok', 'usage': {}, 'finish_reason': 'STOP'}

    monkeypatch.setattr(GeminiNode, '_request', staticmethod(request))
    compact = [{'title': 'Only compact data'}]

    GeminiNode().execute(
        'ai.gemini',
        {
            'id': 'gemini',
            'type': 'ai.gemini',
            'depends_on': ['ai_batch'],
            'settings': {
                'messages': [{
                    'role': 'user',
                    'text': '',
                    'mode': 'expression',
                    'input_path': '',
                }],
            },
        },
        {
            'ai_batch': {
                'compact_highlights': compact,
                'merged': {'large': 'ignored'},
            },
        },
        None,
        Path('.'),
    )

    assert captured['text'] == '[{"title":"Only compact data"}]'


def test_gemini_expression_projects_compact_from_legacy_batch_cache(
    monkeypatch,
):
    captured = {}

    def request(model, cfg, prompt, system, **kwargs):
        captured['text'] = cfg['messages'][0]['text']
        return {'text': 'ok', 'usage': {}, 'finish_reason': 'STOP'}

    monkeypatch.setattr(GeminiNode, '_request', staticmethod(request))
    legacy = {
        'merged': {
            'items': [{
                'value': {
                    'title': 'Legacy cached highlight',
                    'selected_text': 'Exact words',
                    'start': 2.0,
                    'end': 5.0,
                    'duration': 3.0,
                    'score': 0.8,
                    'reason': 'Relevant',
                    'references': [
                        {'word': index} for index in range(200)
                    ],
                },
                'references': [
                    {'duplicated': index} for index in range(200)
                ],
            }],
            'merged_object': {},
            'provenance': [{'large': 'metadata'}],
        },
    }

    GeminiNode().execute(
        'ai.gemini',
        {
            'id': 'gemini',
            'type': 'ai.gemini',
            'depends_on': ['ai_batch'],
            'settings': {
                'messages': [{
                    'role': 'user',
                    'text': '',
                    'mode': 'expression',
                    'input_path': 'ai_batch.compact_highlights',
                }],
            },
        },
        {'ai_batch': legacy},
        None,
        Path('.'),
    )

    assert 'Legacy cached highlight' in captured['text']
    assert 'references' not in captured['text']
    assert 'provenance' not in captured['text']


def test_gemini_expression_message_auto_uses_only_dependency(monkeypatch):
    captured = {}

    def request(model, cfg, prompt, system, **kwargs):
        captured['text'] = cfg['messages'][0]['text']
        return {'text': 'ok', 'usage': {}, 'finish_reason': 'STOP'}

    monkeypatch.setattr(GeminiNode, '_request', staticmethod(request))
    result = GeminiNode().execute(
        'ai.gemini',
        {
            'id': 'gemini',
            'type': 'ai.gemini',
            'depends_on': ['upstream'],
            'settings': {
                'messages': [{
                    'role': 'user',
                    'text': '',
                    'mode': 'expression',
                    'input_path': '',
                }],
            },
        },
        {'older': {'text': 'ignore'}, 'upstream': {'answer': 42}},
        None,
        Path('.'),
    )

    assert result['text'] == 'ok'
    assert captured['text'] == '{"answer":42}'


def test_gemini_fixed_messages_remain_unchanged(monkeypatch):
    captured = {}

    def request(model, cfg, prompt, system, **kwargs):
        captured['messages'] = cfg['messages']
        return {'text': 'ok', 'usage': {}, 'finish_reason': 'STOP'}

    monkeypatch.setattr(GeminiNode, '_request', staticmethod(request))
    fixed = [{'role': 'user', 'text': 'fixed prompt'}]

    result = _execute(
        'ai.gemini', GeminiNode,
        {'action': 'message_model', 'messages': fixed},
        {'upstream': {'text': 'dynamic'}},
    )

    assert result['text'] == 'ok'
    assert captured['messages'] == fixed


def test_gemini_media_dispatch(monkeypatch):
    monkeypatch.setattr(GeminiNode, '_key', staticmethod(lambda: 'mock'))
    monkeypatch.setattr(GeminiNode, '_uploaded', staticmethod(lambda *a, **k: {
        'file_uri':'https://generativelanguage.googleapis.com/v1beta/files/test',
        'mime_type':'video/mp4'
    }))
    monkeypatch.setattr(GeminiNode, '_json_call', staticmethod(lambda *a, **k: {
        'candidates':[{'content':{'parts':[{'text':'mock video analysis'}]}}]
    }))
    result = _execute('ai.gemini', GeminiNode, {'action':'analyze_video'})
    assert result['text'] == 'mock video analysis'


def test_openai_message_dispatch(monkeypatch):
    monkeypatch.setattr(OpenAINode, 'openai_chat', staticmethod(lambda *a, **k: {'text':'mock openai'}))
    assert _execute('ai.openai', OpenAINode, {'prompt':'hi'})['text']=='mock openai'


def test_openai_classification_dispatch(monkeypatch):
    monkeypatch.setattr(OpenAINode, 'openai_request', staticmethod(lambda *a, **k: {
        'results':[{'flagged':False,'categories':{},'category_scores':{}}]
    }))
    result = _execute('ai.openai', OpenAINode, {'action':'classify_violations', 'prompt':'Hi'})
    assert result['flagged'] is False


def test_ollama_message_dispatch(monkeypatch):
    monkeypatch.setattr(OllamaNode, 'ollama_request', staticmethod(lambda *a, **k: {
        'model':'gemma3','message':{'content':'mock ollama'},'done_reason':'stop'
    }))
    assert _execute('ai.ollama', OllamaNode, {'prompt':'hi'})['text'] == 'mock ollama'


def test_ollama_status_dispatch(monkeypatch):
    monkeypatch.setattr(OllamaNode, 'ollama_request', staticmethod(lambda *a, **k: {
        'models':[{'name':'gemma3:latest'}]
    }))
    assert OllamaNode.ollama_status()['reachable'] is True


def test_timeline_without_provider_imports():
    assert _execute('ai.summary', TimelineNode, {'mode':'offline'}, {'n': {'text':'example'}})['method']=='offline_excerpts'
