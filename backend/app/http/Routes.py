"""HTTP v1 route group; keeps existing /api/v1 contracts."""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.http.controllers.AuthController import router as auth_router
from app.http.controllers.UsersController import router as users_router
from app.http.controllers.ProjectsController import router as projects_router
from app.http.controllers.MediaController import router as media_router
from app.http.controllers.TimelineController import router as timeline_router
from app.http.controllers.LibraryController import router as library_router
from app.http.controllers.CommandsController import router as commands_router
from app.http.controllers.WorkflowController import router as workflow_router
from app.http.controllers.CredentialsController import router as credentials_router

from app.workflows.ListNodes import get_nodes, get_families


router = APIRouter(prefix="/api/v1")


for child in (
    auth_router,
    users_router,
    projects_router,
    timeline_router,
    media_router,
    library_router,
    commands_router,
    workflow_router,
    credentials_router,
):
    router.include_router(child)


@router.get("/workflow-node-list", tags=["Workflows"])
def workflow_node_list():
    """Return all registered node metadata and sub-nodes."""
    return {
        "nodes": get_nodes(),
    }


@router.get("/workflow-node-families", tags=["Workflows"])
def workflow_node_families():
    """Return the same catalog grouped by family."""
    return {
        "families": get_families(),
    }


# DTE V3 — Backend remains the authoritative source of node contracts.
# This is additive: existing workflow-node-list and workflow-node-families
# endpoints retain their exact response shapes.
class WorkflowTypeCompatibilityRequest(BaseModel):
    source_type: str = Field(min_length=1, max_length=128)
    target_type: str = Field(min_length=1, max_length=128)
    source_path: str = Field(default="", max_length=240)
    target_path: str = Field(default="", max_length=240)


@router.get("/workflow-type-catalog", tags=["Workflows"])
def workflow_type_catalog():
    """Live structural contracts for the Workflow Canvas/Inspector.

    Nodes without contracts are included as 'undeclared', not mislabelled as
    compatible. A server reload is needed after changing Python node code.
    """
    from app.workflows.Registry import node_metadata
    from app.workflows.TypeRegistry import node_type_catalog

    metadata = node_metadata()
    entries = node_type_catalog(metadata, include_unknown=True)
    return {
        "version": 3,
        "nodes": entries,
        "total_nodes": len(entries),
        "declared_contract_nodes": sum(
            row["contract_status"] == "declared" for row in entries
        ),
    }


@router.post("/workflow-type-compatibility", tags=["Workflows"])
def workflow_type_compatibility(body: WorkflowTypeCompatibilityRequest):
    """Conservative static check of a proposed link between two node types.

    No workflow execution, external requests, stored secrets or arbitrary
    Python expressions. An unknown result never authorizes unsafe adaptation.
    """
    from app.workflows.TypeEngine import TypeContractError
    from app.workflows.TypeRegistry import registered_connection_report

    try:
        return registered_connection_report(
            body.source_type,
            body.target_type,
            source_path=body.source_path,
            target_path=body.target_path,
        )
    except (TypeContractError, ValueError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

