from __future__ import annotations
import json

class WorkflowResource:
    @staticmethod
    def definition(row):
        return {"id": row.id, "name": row.name, "nodes": json.loads(row.nodes_json),
                "version": row.current_version,
                "updated_at": row.updated_at.isoformat() if row.updated_at else None}

    @staticmethod
    def source(row):
        return {"id": row.id, "media_id": row.media_id, "filename": row.filename,
                "size_bytes": row.size_bytes,
                "created_at": row.created_at.isoformat() if row.created_at else None}

    @staticmethod
    def run(row):
        return {"id": row.id, "workflow_id": row.workflow_id, "source_id": row.source_id,
                "state": row.state, "progress": row.progress, "current_node": row.current_node,
                "results": json.loads(row.results_json or "{}"), "error": row.error,
                "created_at": row.created_at.isoformat() if row.created_at else None}
