"""HTTP v1 route group; keeps the existing /api/v1 endpoint contracts."""
from fastapi import APIRouter
from app.http.controllers.AuthController import router as auth_router
from app.http.controllers.UsersController import router as users_router
from app.http.controllers.ProjectsController import router as projects_router
from app.http.controllers.MediaController import router as media_router
from app.http.controllers.TimelineController import router as timeline_router
from app.http.controllers.LibraryController import router as library_router
from app.http.controllers.CommandsController import router as commands_router
from app.http.controllers.WorkflowController import router as workflow_router

from app.http.controllers.CredentialsController import router as credentials_router

router = APIRouter(prefix="/api/v1")
for child in (auth_router, users_router, projects_router, timeline_router,
              media_router, library_router, commands_router, workflow_router, credentials_router):
    router.include_router(child)
