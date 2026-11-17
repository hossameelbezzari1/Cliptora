from __future__ import annotations

import subprocess
import urllib.error

from app.workflows.nodes.Gemini import GeminiNode


def test_curl_fallback_keeps_api_key_out_of_process_arguments(monkeypatch):
    captured: dict[str, object] = {}

    monkeypatch.setattr("app.workflows.nodes.Gemini.os.name", "nt")
    monkeypatch.setattr(
        "app.workflows.nodes.Gemini.shutil.which",
        lambda name: r"C:\Windows\System32\curl.exe",
    )

    def fake_run(args, **kwargs):
        captured["args"] = args
        captured["input"] = kwargs["input"]
        return subprocess.CompletedProcess(args, 0, b'{"ok":true}\n200', b"")

    monkeypatch.setattr("app.workflows.nodes.Gemini.subprocess.run", fake_run)

    status, payload = GeminiNode._curl_json_request(
        "https://generativelanguage.googleapis.com/v1beta/models/test:generateContent",
        "super-secret-key",
        b'{"contents":[]}',
        30,
    )

    assert status == 200
    assert payload == b'{"ok":true}'
    assert "super-secret-key" not in " ".join(captured["args"])
    assert b"super-secret-key" in captured["input"]


def test_request_uses_curl_after_urllib_network_failure(monkeypatch):
    monkeypatch.setattr(
        "app.workflows.nodes.Gemini.resolve_api_key",
        lambda provider: "secret",
    )
    monkeypatch.setattr(
        "app.workflows.nodes.Gemini.urllib.request.urlopen",
        lambda *args, **kwargs: (_ for _ in ()).throw(
            urllib.error.URLError("unreachable")
        ),
    )
    monkeypatch.setattr(
        GeminiNode,
        "_curl_json_request",
        staticmethod(
            lambda *args, **kwargs: (
                200,
                b'{"candidates":[{"content":{"parts":[{"text":"done"}]}}]}',
            )
        ),
    )

    result = GeminiNode._request(
        "gemini-test",
        {"max_output_tokens": 128, "timeout_seconds": 30},
        "hello",
        "",
    )

    assert result["text"] == "done"

