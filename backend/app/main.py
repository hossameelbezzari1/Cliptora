from fastapi import FastAPI
from starlette.middleware.cors import CORSMiddleware
from app.core.config import settings
from app.core.app_logging import install_cliptora_logging
from app.http.middleware.csrf import CSRFMiddleware
from app.routes.api import router as api_router

app = FastAPI(title="Cliptora API", version="2.0.0")
app.add_middleware(CORSMiddleware, allow_origins=[settings().frontend_origin],
                   allow_credentials=True, allow_methods=["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
                   allow_headers=["Content-Type", "X-CSRF-Token"])
app.add_middleware(CSRFMiddleware)

@app.get("/api/v1/health", tags=["Health"])
def health():
    return {"status": "ok", "service": "cliptora-api", "version": "2.0.0"}

app.include_router(api_router)
install_cliptora_logging(app)
