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
