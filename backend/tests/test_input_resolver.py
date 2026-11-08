import pytest

from app.workflows.InputResolver import resolve_input_path


def test_resolve_input_path_maps_array_wildcard_values():
    outputs = {
        "ai_batch": {
            "merged": {
                "items": [
                    {"value": {"title": "First", "score": 0.9}},
                    {"value": {"title": "Second", "score": 0.8}},
                ]
            }
        }
    }

    assert resolve_input_path(
        outputs, "ai_batch.merged.items[].value"
    ) == [
        {"title": "First", "score": 0.9},
        {"title": "Second", "score": 0.8},
    ]


def test_resolve_input_path_preserves_existing_index_syntax():
    outputs = {"node": {"items": [{"text": "hello"}]}}

    assert resolve_input_path(outputs, "node.items.0.text") == "hello"
    assert resolve_input_path(outputs, "node.items[0].text") == "hello"


def test_resolve_input_path_rejects_code_and_sensitive_fields():
    with pytest.raises(ValueError):
        resolve_input_path({"node": {}}, "node.__class__()")

    with pytest.raises(ValueError):
        resolve_input_path(
            {"node": {"items": [{"token": "secret"}]}},
            "node.items[].token",
        )
