"""Class-based HTTP controller. Router is separate from business logic."""
from __future__ import annotations
from fastapi import APIRouter, Depends
from app.services.workflow_service import *
from app.services.workflow_service import WorkflowService

class WorkflowController:
    def __init__(self):
        self.service = WorkflowService()

    def catalog(self, user: User=Depends(current_user)):
        return self.service.catalog(user=user)

    def openai_status(self, user: User=Depends(current_user)):
        return self.service.openai_status(user=user)

    def gemini_status(self, user: User=Depends(current_user)):
        return self.service.gemini_status(user=user)

    def ollama_status(self, user: User=Depends(current_user)):
        return self.service.ollama_status(user=user)

    def templates(self, user: User=Depends(current_user)):
        return self.service.templates(user=user)

    def definitions(self, project_id: int, db: Session=Depends(wf_db), user: User=Depends(current_user)):
        return self.service.definitions(project_id=project_id, db=db, user=user)

    def create_definition(self, project_id: int, body: DefinitionBody, db: Session=Depends(wf_db), user: User=Depends(current_user)):
        return self.service.create_definition(project_id=project_id, body=body, db=db, user=user)

    def update_definition(self, project_id: int, definition_id: int, body: DefinitionBody, db: Session=Depends(wf_db), user: User=Depends(current_user)):
        return self.service.update_definition(project_id=project_id, definition_id=definition_id, body=body, db=db, user=user)

    def duplicate_definition(self, project_id: int, definition_id: int, db: Session=Depends(wf_db), user: User=Depends(current_user)):
        return self.service.duplicate_definition(project_id=project_id, definition_id=definition_id, db=db, user=user)

    def definition_versions(self, project_id: int, definition_id: int, db: Session=Depends(wf_db), user: User=Depends(current_user)):
        return self.service.definition_versions(project_id=project_id, definition_id=definition_id, db=db, user=user)

    def restore_version(self, project_id: int, definition_id: int, version: int, db: Session=Depends(wf_db), user: User=Depends(current_user)):
        return self.service.restore_version(project_id=project_id, definition_id=definition_id, version=version, db=db, user=user)

    def delete_definition(self, project_id: int, definition_id: int, db: Session=Depends(wf_db), user: User=Depends(current_user)):
        return self.service.delete_definition(project_id=project_id, definition_id=definition_id, db=db, user=user)

    def sources(self, project_id: int, db: Session=Depends(wf_db), user: User=Depends(current_user)):
        return self.service.sources(project_id=project_id, db=db, user=user)

    async def upload_source(self, project_id: int, file: UploadFile=File(...), db: Session=Depends(wf_db), user: User=Depends(current_user)):
        return await self.service.upload_source(project_id=project_id, file=file, db=db, user=user)

    def source_from_media(self, project_id: int, media_id: int, db: Session=Depends(wf_db), user: User=Depends(current_user)):
        return self.service.source_from_media(project_id=project_id, media_id=media_id, db=db, user=user)

    def start_run(self, project_id: int, body: StartRun, background: BackgroundTasks, db: Session=Depends(wf_db), user: User=Depends(current_user)):
        return self.service.start_run(project_id=project_id, body=body, background=background, db=db, user=user)

    def runs(self, project_id: int, db: Session=Depends(wf_db), user: User=Depends(current_user)):
        return self.service.runs(project_id=project_id, db=db, user=user)

    def run_detail(self, project_id: int, run_id: int, db: Session=Depends(wf_db), user: User=Depends(current_user)):
        return self.service.run_detail(project_id=project_id, run_id=run_id, db=db, user=user)

    def cancel_run(self, project_id: int, run_id: int, db: Session=Depends(wf_db), user: User=Depends(current_user)):
        return self.service.cancel_run(project_id=project_id, run_id=run_id, db=db, user=user)

    def retry_run(self, project_id: int, run_id: int, background: BackgroundTasks, db: Session=Depends(wf_db), user: User=Depends(current_user)):
        return self.service.retry_run(project_id=project_id, run_id=run_id, background=background, db=db, user=user)

    def artifact(self, project_id: int, run_id: int, node_id: str, db: Session=Depends(wf_db), user: User=Depends(current_user)):
        return self.service.artifact(project_id=project_id, run_id=run_id, node_id=node_id, db=db, user=user)

    def rendered_video(self, project_id: int, run_id: int, db: Session=Depends(wf_db), user: User=Depends(current_user)):
        return self.service.rendered_video(project_id=project_id, run_id=run_id, db=db, user=user)

controller = WorkflowController()
router = APIRouter(prefix='/workflows', tags=['Dynamic Workflows'])
router.add_api_route('/catalog', controller.catalog, methods=["GET"])
router.add_api_route('/openai/status', controller.openai_status, methods=["GET"])
router.add_api_route('/gemini/status', controller.gemini_status, methods=["GET"])
router.add_api_route('/ollama/status', controller.ollama_status, methods=["GET"])
router.add_api_route('/templates', controller.templates, methods=["GET"])
router.add_api_route('/{project_id}/definitions', controller.definitions, methods=["GET"])
router.add_api_route('/{project_id}/definitions', controller.create_definition, methods=["POST"], status_code=201)
router.add_api_route('/{project_id}/definitions/{definition_id}', controller.update_definition, methods=["PUT"])
router.add_api_route('/{project_id}/definitions/{definition_id}/duplicate', controller.duplicate_definition, methods=["POST"], status_code=201)
router.add_api_route('/{project_id}/definitions/{definition_id}/versions', controller.definition_versions, methods=["GET"])
router.add_api_route('/{project_id}/definitions/{definition_id}/versions/{version}/restore', controller.restore_version, methods=["POST"])
router.add_api_route('/{project_id}/definitions/{definition_id}', controller.delete_definition, methods=["DELETE"], status_code=204)
router.add_api_route('/{project_id}/sources', controller.sources, methods=["GET"])
router.add_api_route('/{project_id}/sources', controller.upload_source, methods=["POST"], status_code=201)
router.add_api_route('/{project_id}/sources/from-media/{media_id}', controller.source_from_media, methods=["POST"], status_code=201)
router.add_api_route('/{project_id}/runs', controller.start_run, methods=["POST"], status_code=202)
router.add_api_route('/{project_id}/runs', controller.runs, methods=["GET"])
router.add_api_route('/{project_id}/runs/{run_id}', controller.run_detail, methods=["GET"])
router.add_api_route('/{project_id}/runs/{run_id}/cancel', controller.cancel_run, methods=["POST"])
router.add_api_route('/{project_id}/runs/{run_id}/retry', controller.retry_run, methods=["POST"], status_code=202)
router.add_api_route('/{project_id}/runs/{run_id}/artifacts/{node_id}', controller.artifact, methods=["GET"])
router.add_api_route('/{project_id}/runs/{run_id}/video', controller.rendered_video, methods=["GET"])
