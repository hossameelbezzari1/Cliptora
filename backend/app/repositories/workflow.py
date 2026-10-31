from fastapi import HTTPException
from sqlalchemy import select, text
from app.models import WorkflowVersion

class WorkflowRepository:
    def __init__(self, db):
        self.db = db

    def authorize(self, project_id: int, user_id: int):
        found = self.db.execute(text("SELECT id FROM projects WHERE id=:p AND owner_id=:u"), {"p": project_id, "u": user_id}).first()
        if found is None:
            raise HTTPException(404, "Project not found")

    def owned(self, model, identifier: int, user_id: int, project_id: int):
        row = self.db.scalar(select(model).where(model.id == identifier, model.user_id == user_id, model.project_id == project_id))
        if row is None:
            raise HTTPException(404, "Item not found")
        return row

    def snapshot(self, row):
        self.db.add(WorkflowVersion(workflow_id=row.id, user_id=row.user_id, project_id=row.project_id,
                                    version=row.current_version, name=row.name, nodes_json=row.nodes_json))
