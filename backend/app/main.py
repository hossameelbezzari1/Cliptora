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
from app.core.Database import SessionLocal
from app.models import Credential, WorkflowRun
from app.models.Timestamps import now
from sqlalchemy import select

@app.on_event("startup")
def prepare_credentials():
    Base.metadata.create_all(bind=engine, tables=[Credential.__table__], checkfirst=True)

    # Background workflow tasks are process-local.  After a service restart,
    # queued/running rows have no worker left and must not block the single-run
    # guard forever.
    session = SessionLocal()
    try:
        interrupted = session.scalars(
            select(WorkflowRun).where(
                WorkflowRun.state.in_(("queued", "running", "cancelling"))
            )
        ).all()
        finished_at = now()
        for run in interrupted:
            if run.state == "cancelling":
                run.state = "cancelled"
            else:
                run.state = "failed"
                run.error = "Execution interrupted by application restart"
            run.finished_at = finished_at
        if interrupted:
            session.commit()
    finally:
        session.close()

app.include_router(api_router)
install_cliptora_logging(app)
