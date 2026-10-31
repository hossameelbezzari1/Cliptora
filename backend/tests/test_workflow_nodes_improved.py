"""Regression tests for native workflow plugins after the MVC refactor.

These are offline: no MySQL, remote AI credentials or FFmpeg binary required.
"""
from __future__ import annotations

import json
import math
import sys
import types
from pathlib import Path

import pytest

from app.workflows.base import BaseNode
from app.workflows.registry import discovered, node_metadata
from app.workflows.validation import validate_workflow
from app.workflows.engine import run_graph


def node(type_name, settings=None, **other):
    return {
        "id": other.pop("id", "step"),
        "type": type_name,
        "depends_on": other.pop("depends_on", []),
        "settings": settings if settings is not None else {},
        **other,
    }


def execute(type_name, settings=None, outputs=None, source=None, workdir=None):
    return discovered()[type_name].execute(
        node(type_name, settings), outputs or {}, source, workdir or Path("."),
    )


def test_all_23_nodes_are_class_based_and_catalog_valid():
    definitions = discovered()
    assert len(definitions) == 23
    meta = node_metadata()
    assert set(meta) == set(definitions)
    assert all(data.get("label") and data.get("group") for data in meta.values())
    for entry in definitions.values():
        # 'execute' is a bound class static method in each migrated Node.
        assert callable(entry.execute)
        assert isinstance(entry.metadata(), dict)
    from app.workflows.nodes.ai_agent import AIAgentNode, AiAgentNode
    from app.workflows.nodes.openai import OpenAINode, OpenaiNode
    from app.workflows.nodes.http_request import HTTPRequestNode, HttpRequestNode
    assert issubclass(AIAgentNode, BaseNode) and AiAgentNode is AIAgentNode
    assert issubclass(OpenAINode, BaseNode) and OpenaiNode is OpenAINode
    assert issubclass(HTTPRequestNode, BaseNode) and HttpRequestNode is HTTPRequestNode


def test_old_node_ids_still_validate():
    from app.workflows.catalog import preset_templates
    for template in preset_templates():
        assert validate_workflow(template["nodes"])
    assert execute("core.manual_trigger")["trigger"]["status"] == "received"


def test_validation_fails_cleanly_on_non_finite_settings_and_bool_retry():
    for invalid in (float("nan"), float("inf"), -float("inf")):
        with pytest.raises(ValueError, match="finite"):
            validate_workflow([node("core.manual_trigger", {"value": invalid})])
    with pytest.raises(ValueError, match="Retry limit"):
        validate_workflow([node("core.manual_trigger", retry_limit=True)])
    with pytest.raises(ValueError, match="JSON-compatible"):
        validate_workflow([node("core.manual_trigger", {"bad": object()})])


def test_merge_still_handles_append_and_combine():
    data = {"a": {"items": [1, 2]}, "b": {"items": [3]}}
    assert execute("flow.merge", {"mode": "append"}, data)["items"] == [1, 2, 3]
    result = execute("flow.merge", {"mode": "combine"}, {"a": {"x": 1}, "b": {"y": 2}})
    assert result["items"] == {"x": 1, "y": 2}


def test_storyboard_rejects_nan_and_inf():
    for value in (math.nan, math.inf, -math.inf, -1, 0):
        with pytest.raises(ValueError, match="duration"):
            execute("animation.storyboard", {"script": "Hello", "scene_seconds": value})
    actual = execute("animation.storyboard", {"script": "A\nB", "scene_seconds": 2})
    assert [s["start"] for s in actual["scenes"]] == [0.0, 2.0]


def test_cut_plan_rejects_nan_and_outside_source():
    outputs = {"h": {"highlights": [{"start": 2.0, "end": 4.0, "reason": "yes"}]}, "probe": {"probe": {"duration": 5}}}
    result = execute("timeline.cut_plan", {"padding": 0.2}, outputs)
    assert result["cut_plan"][0]["source_start"] == 1.8
    with pytest.raises(ValueError, match="finite"):
        execute("timeline.cut_plan", {"padding": math.nan}, outputs)
    with pytest.raises(ValueError, match="timing"):
        execute("timeline.cut_plan", {}, {"h": {"highlights": [{"start": math.nan, "end": 1}]}})
    out = execute("timeline.cut_plan", {}, {"h": {"highlights": [{"start": 8, "end": 9}]}, "probe": {"probe": {"duration": 5}}})
    assert out["cut_plan"] == []


def test_highlight_budget_on_manual_and_offline():
    words = [{"id": i, "text": f"word{i}", "start": float(i-1), "end": float(i)} for i in range(1, 121)]
    highlights = [{"start_word_id": 1, "end_word_id": 100, "score": 90, "reason": "long"}]
    for mode in ("manual", "offline"):
        out = execute("ai.highlights", {"mode": mode, "target_duration": 12, "highlights": highlights}, {"words": {"words": words}})
        assert sum(i["end"] - i["start"] for i in out["highlights"]) <= 12.001
    out = execute("ai.highlights", {"mode": "manual", "target_duration": 12, "highlights": highlights}, {"words": {"words": words}})
    assert out["highlights"][0]["end_word_id"] == 12


def test_audio_extract_skips_fresh_cache_and_rebuilds_stale_cache(tmp_path, monkeypatch):
    from app.helpers import media
    calls = []
    def fake_tool(*args, **kwargs):
        calls.append(args)
        Path(args[-1]).write_bytes(b"a" * 1200)
        return ""
    monkeypatch.setattr(media, "tool", fake_tool)
    source = tmp_path / "movie.mp4"
    source.write_bytes(b"data")
    output = execute("audio.extract", source=source, workdir=tmp_path)
    assert Path(output["audio"]).is_file()
    assert len(calls) == 1
    execute("audio.extract", source=source, workdir=tmp_path)
    assert len(calls) == 1
    target = Path(output["audio"])
    # Do not sleep: force source mtime newer than derived WAV.
    import os
    ns = target.stat().st_mtime_ns + 2_000_000_000
    os.utime(source, ns=(ns, ns))
    execute("audio.extract", source=source, workdir=tmp_path)
    assert len(calls) == 2


def test_transcription_corrupt_cache_rebuilds(monkeypatch, tmp_path):
    from app.workflows.nodes.transcribe_every_word import TranscribeEveryWordNode
    audio = tmp_path / "movie.wav"
    audio.write_bytes(b"a" * 1200)
    fake_word = types.SimpleNamespace(start=0.0, end=0.5, word=" Hello")
    fake_seg = types.SimpleNamespace(words=[fake_word])
    called = []
    class FakeWhisper:
        def __init__(self, *args, **kwargs): called.append(1)
        def transcribe(self, *args, **kwargs):
            return [fake_seg], types.SimpleNamespace(language="en")
    monkeypatch.setitem(sys.modules,"faster_whisper", types.SimpleNamespace(WhisperModel=FakeWhisper))
    cfg = {"model": "small", "language": None}
    dependencies = {"audio": {"audio": str(audio)}}
    assert TranscribeEveryWordNode.execute(node("audio.transcribe", cfg), dependencies, None, tmp_path)["words"][0]["text"] == "Hello"
    assert len(called) == 1
    assert TranscribeEveryWordNode.execute(node("audio.transcribe", cfg), dependencies, None, tmp_path)["language"] == "en"
    assert len(called) == 1
    cache = next(tmp_path.glob("transcript_*.json"))
    cache.write_text("{invalid json",encoding="utf8")
    assert TranscribeEveryWordNode.execute(node("audio.transcribe", cfg), dependencies, None, tmp_path)["language"] == "en"
    assert len(called) == 2


def test_render_is_atomic_and_uses_relative_concat_paths(monkeypatch, tmp_path):
    from app.helpers import media
    source = tmp_path / "video.mp4"
    source.write_bytes(b"video")
    calls = []
    def fake_tool(*args, **kwargs):
        calls.append(args)
        Path(args[-1]).write_bytes(b"rendered")
        return ""
    monkeypatch.setattr(media, "tool", fake_tool)
    dependency = {"cuts": {"cut_plan": [{"source_start": 0, "duration": 1.0}]}}
    output = execute("video.render", {"enabled": True}, dependency, source, tmp_path)
    assert output["render"]["filename"] == "final.mp4"
    assert (tmp_path/"final.mp4").read_bytes() == b"rendered"
    assert calls[-1][-1].endswith("rendered.mp4")
    with pytest.raises(ValueError, match="timing"):
        execute("video.render", {"enabled": True}, {"c": {"cut_plan": [{"source_start": math.nan, "duration": 1}]}}, source, tmp_path)
    assert (tmp_path/"final.mp4").read_bytes() == b"rendered"
    def fail_tool(*args, **kwargs):
        raise RuntimeError("Fake FFmpeg failed")
    monkeypatch.setattr(media, "tool", fail_tool)
    with pytest.raises(RuntimeError):
        execute("video.render", {"enabled": True}, dependency, source, tmp_path)
    assert (tmp_path/"final.mp4").read_bytes() == b"rendered"


def test_engine_retries_bad_result_and_caches_good_result(monkeypatch,tmp_path):
    import app.workflows.registry as registry
    calls=[]
    def fake_executor(node, deps, source, workdir):
        calls.append(1)
        return None if len(calls)==1 else {"ok": True}
    monkeypatch.setattr(registry,"executor",lambda kind:fake_executor)
    graph=[node("core.manual_trigger", id="first", retry_limit=1)]
    updates=[]
    result=run_graph(graph, None, tmp_path, lambda *args:updates.append(args))
    assert result["status"] == "completed"
    assert len(calls)==2
    assert json.loads((tmp_path/"first.json").read_text())=={"ok":True}
    second=run_graph(graph, None, tmp_path, lambda *args:None)
    assert second["nodes"]["first"]["cached"] is True
    assert len(calls)==2


def test_engine_cancellation_between_retries(monkeypatch,tmp_path):
    import app.workflows.registry as registry
    attempts=[]
    def bad_node(*args):
        attempts.append(1)
        raise ValueError("temporary")
    monkeypatch.setattr(registry,"executor",lambda kind:bad_node)
    result=run_graph([node("core.manual_trigger",id="first",retry_limit=3)],None,tmp_path,
                     lambda *args:None,lambda:len(attempts)>=1)
    assert result["status"] == "cancelled"
    assert len(attempts)==1


def test_openai_saved_none_effort_is_normalized_for_sol_and_astra(monkeypatch):
    import io
    import urllib.request
    from app.providers.ai.openai import openai_chat
    monkeypatch.setenv("OPENAI_API_KEY", "fake-key-for-local-test")
    payloads = []
    class FakeResponse:
        def __enter__(self): return self
        def __exit__(self,*args): return None
        def read(self, *args): return b'{"choices":[{"message":{"content":"ok"},"finish_reason":"stop"}]}'
    def fake_urlopen(request, timeout=120):
        payloads.append(json.loads(request.data.decode("utf8")))
        return FakeResponse()
    monkeypatch.setattr(urllib.request, "urlopen", fake_urlopen)
    for model in ("gpt-6.1-sol", "gpt-6-astra"):
        assert openai_chat({"model": model, "prompt": "Hi", "reasoning_effort": "none"}, {})["text"] == "ok"
        assert payloads[-1]["reasoning_effort"] == "medium"
    openai_chat({"model": "gpt-6.1-terra", "prompt": "Hi", "reasoning_effort": "none"}, {})
    assert payloads[-1]["reasoning_effort"] == "none"


def test_chat_model_from_saved_settings_normalizes_reasoning():
    result = execute("ai.chat_model", {"model": "gpt-6.1-sol", "reasoning_effort": "none"})
    assert result["chat_model"]["reasoning_effort"] == "medium"
