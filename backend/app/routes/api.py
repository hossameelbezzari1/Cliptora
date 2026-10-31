"""HTTP v1 route group; keeps the existing /api/v1 endpoint contracts."""
from fastapi import APIRouter
from app.http.controllers.auth_controller import router as auth_router
from app.http.controllers.users_controller import router as users_router
from app.http.controllers.projects_controller import router as projects_router
from app.http.controllers.media_controller import router as media_router
from app.http.controllers.timeline_controller import router as timeline_router
from app.http.controllers.library_controller import router as library_router
from app.http.controllers.commands_controller import router as commands_router
from app.http.controllers.workflow_controller import router as workflow_router

router = APIRouter(prefix="/api/v1")
for child in (auth_router, users_router, projects_router, timeline_router,
              media_router, library_router, commands_router, workflow_router):
    router.include_router(child)
