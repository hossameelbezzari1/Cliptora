"""Native workflow node: ManualTriggerNode."""

from __future__ import annotations

from pathlib import Path

from typing import Any

from app.workflows.base import BaseNode

class ManualTriggerNode(BaseNode):
    type = 'core.manual_trigger'

    @staticmethod
    def metadata() -> dict[str, Any]:
        return {"label": "Manual Trigger", "group": "Triggers", "settings": {}}

    @staticmethod
    def execute(node: dict[str, Any], outputs: dict[str, Any], source: Path | None, workdir: Path) -> dict[str, Any]:

        cfg = node.get('settings', {})
        return {"trigger": {"type": "manual", "status": "received"}}

# Compatibility exports for older callers and imported test utilities.
metadata = ManualTriggerNode.metadata
execute = ManualTriggerNode.execute
NODE = ManualTriggerNode.definition()
