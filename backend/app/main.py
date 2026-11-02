from fastapi import FastAPI
from starlette.middleware.cors import CORSMiddleware
from app.core.Config import settings
from app.core.AppLogging import install_cliptora_logging
from app.http.middleware.CSRF import CSRFMiddleware
from app.http.Routes import router as api_router

app = FastAPI(title="Cliptora API", version="2.0.0")
app.add_middleware(CORSMiddleware, allow_origins=[settings().frontend_origin],
                   allow_credentials=True, allow_methods=["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
                   allow_headers=["Content-Type", "X-CSRF-Token"])
app.add_middleware(CSRFMiddleware)

@app.get("/api/v1/health", tags=["Health"])
def health():
    return {"status": "ok", "service": "cliptora-api", "version": "2.0.0"}

# Create only the missing credential table. Existing workflow/project tables remain intact.
from app.core.Database import Base, engine
from app.models import Credential
@app.on_event("startup")
def prepare_credentials():
    Base.metadata.create_all(bind=engine, tables=[Credential.__table__], checkfirst=True)
app.include_router(api_router)
install_cliptora_logging(app)
