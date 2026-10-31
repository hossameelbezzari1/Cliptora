from __future__ import annotations
import json

class CommandResource:
    @staticmethod
    def command(row):
        return {"id": row.id, "name": row.name, "kind": row.kind,
                "config": json.loads(row.config_json or "{}"), "created_at": row.created_at}

    @staticmethod
    def binding(row):
        return {"id": row.id, "project_id": row.project_id, "clip_id": row.clip_id,
                "command_id": row.command_id, "trigger": row.trigger, "enabled": row.enabled,
                "inputs": json.loads(row.inputs_json or "{}"),
                "output_mapping": json.loads(row.mapping_json or "{}")}

    @staticmethod
    def run(row):
        return {"id": row.id, "binding_id": row.binding_id, "state": row.state,
                "output": json.loads(row.output_json or "{}"), "error": row.error,
                "created_at": row.created_at, "finished_at": row.finished_at}
