"""Class-based HTTP controller. Router is separate from business logic."""
from __future__ import annotations
from fastapi import APIRouter, Depends
from app.services.commands_service import *
from app.services.commands_service import CommandsService

class CommandsController:
    def __init__(self):
        self.service = CommandsService()

    def list_commands(self, db: Session=Depends(command_db), user: User=Depends(current_user)):
        return self.service.list_commands(db=db, user=user)

    def create_command(self, body: NewCommand, db: Session=Depends(command_db), user: User=Depends(current_user)):
        return self.service.create_command(body=body, db=db, user=user)

    def delete_command(self, command_id: int, db: Session=Depends(command_db), user: User=Depends(current_user)):
        return self.service.delete_command(command_id=command_id, db=db, user=user)

    def list_bindings(self, project_id: int, clip_id: str | None=None, db: Session=Depends(command_db), user: User=Depends(current_user)):
        return self.service.list_bindings(project_id=project_id, clip_id=clip_id, db=db, user=user)

    def bind_command(self, body: NewBinding, db: Session=Depends(command_db), user: User=Depends(current_user)):
        return self.service.bind_command(body=body, db=db, user=user)

    def change_binding(self, binding_id: int, body: PatchBinding, db: Session=Depends(command_db), user: User=Depends(current_user)):
        return self.service.change_binding(binding_id=binding_id, body=body, db=db, user=user)

    def unbind_command(self, binding_id: int, db: Session=Depends(command_db), user: User=Depends(current_user)):
        return self.service.unbind_command(binding_id=binding_id, db=db, user=user)

    def run_binding(self, binding_id: int, background: BackgroundTasks, db: Session=Depends(command_db), user: User=Depends(current_user)):
        return self.service.run_binding(binding_id=binding_id, background=background, db=db, user=user)

    def dispatch_event(self, body: dict[str, Any], background: BackgroundTasks, db: Session=Depends(command_db), user: User=Depends(current_user)):
        return self.service.dispatch_event(body=body, background=background, db=db, user=user)

    def list_runs(self, project_id: int, clip_id: str | None=None, db: Session=Depends(command_db), user: User=Depends(current_user)):
        return self.service.list_runs(project_id=project_id, clip_id=clip_id, db=db, user=user)

    def get_run(self, run_id: int, db: Session=Depends(command_db), user: User=Depends(current_user)):
        return self.service.get_run(run_id=run_id, db=db, user=user)

controller = CommandsController()
router = APIRouter(prefix='/commands', tags=['Clip Commands'])
router.add_api_route('/library', controller.list_commands, methods=["GET"])
router.add_api_route('/library', controller.create_command, methods=["POST"], status_code=201)
router.add_api_route('/library/{command_id}', controller.delete_command, methods=["DELETE"], status_code=204)
router.add_api_route('/bindings', controller.list_bindings, methods=["GET"])
router.add_api_route('/bindings', controller.bind_command, methods=["POST"], status_code=201)
router.add_api_route('/bindings/{binding_id}', controller.change_binding, methods=["PATCH"])
router.add_api_route('/bindings/{binding_id}', controller.unbind_command, methods=["DELETE"], status_code=204)
router.add_api_route('/bindings/{binding_id}/run', controller.run_binding, methods=["POST"], status_code=202)
router.add_api_route('/events', controller.dispatch_event, methods=["POST"], status_code=202)
router.add_api_route('/runs', controller.list_runs, methods=["GET"])
router.add_api_route('/runs/{run_id}', controller.get_run, methods=["GET"])
