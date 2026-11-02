from pathlib import Path

import pytest
from app.workflows.nodes.if_branch import IfBranchNode


def run(settings, outputs=None):
    return IfBranchNode.execute({"type": "flow.if", "settings": settings}, outputs or {}, None, Path("."))


def rule(type_, operator, left, right="", left_mode="expression", right_mode="fixed"):
    return {"type": type_, "operator": operator,
            "left": {"mode": left_mode, "value": left},
            "right": {"mode": right_mode, "value": right}}


def test_legacy_truthy():
    assert run({"path": "step.value", "operator": "truthy", "value": ""}, {"step": {"value": True}})["condition"] is True


def test_multiple_and_number():
    settings = {"conditions": [
        rule("number", "greater_than", "{{ $json.probe.duration }}", "30"),
        rule("string", "equals", "{{ step.language }}", "FR"),
    ], "combine": "all", "convert_types": False, "ignore_case": True}
    result = run(settings, {"step": {"probe": {"duration": 125.4}, "language": "fr"}})
    assert result["condition"] is True
    assert result["matched_count"] == 2


def test_multiple_or_and_unary():
    settings = {"conditions": [
        rule("number", "less_than", "{{ step.probe.duration }}", "5"),
        rule("array", "is_not_empty", "{{ step.clips }}"),
    ], "combine": "any"}
    assert run(settings, {"step": {"probe": {"duration": 10}, "clips": [1]}})["condition"] is True


def test_iso_dates_and_boolean():
    settings = {"conditions": [
        rule("datetime", "after", "{{ step.when }}", "2026-10-31T10:00:00Z"),
        rule("boolean", "is_true", "{{ step.approved }}"),
    ], "combine": "all"}
    assert run(settings, {"step": {"when": "2026-10-31T11:00:00+00:00", "approved": True}})["condition"] is True


def test_string_convert_types():
    settings = {"conditions": [rule("number", "greater_than", "{{ step.value }}", "2")], "convert_types": True}
    assert run(settings, {"step": {"value": "3"}})["condition"] is True
    settings["convert_types"] = False
    with pytest.raises(ValueError, match="Convert types"):
        run(settings, {"step": {"value": "3"}})


def test_array_object():
    settings = {"conditions": [
        rule("array", "contains", "{{ step.words }}", "hi"),
        rule("object", "contains_key", "{{ step.metadata }}", "duration"),
    ]}
    assert run(settings, {"step": {"words": ["hi"], "metadata": {"duration": 10}}})["condition"] is True


def test_reject_arbitrary_expression():
    settings = {"conditions": [rule("string", "equals", "{{ eval('42') }}", "x") ]}
    with pytest.raises(ValueError, match="dot path"):
        run(settings, {"step": {"x": 42}})


def test_reject_invalid_operator():
    settings = {"conditions": [rule("number", "contains", "{{ step.x }}", "x") ]}
    with pytest.raises(ValueError, match="Invalid IF"):
        run(settings, {"step": {"x": 42}})


def test_reject_unbounded_rules():
    with pytest.raises(ValueError, match="1 and 25"):
        run({"conditions": []})
    with pytest.raises(ValueError, match="1 and 25"):
        run({"conditions": [rule("string", "equals", "{{ step.x }}", "x")] * 26})


def test_no_eval_or_raw_python():
    settings = {"conditions": [rule("string", "equals", "__import__('os').system('echo hi')", "") ]}
    with pytest.raises(ValueError, match="expression like"):
        run(settings)


def test_fixed_numeric_operand_without_convert_option():
    settings = {"conditions": [rule("number", "greater_than", "7", "3", left_mode="fixed")], "convert_types": False}
    assert run(settings)["condition"] is True
