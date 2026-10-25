from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from starlette.middleware.cors import CORSMiddleware
from app.core.config import settings
from app.core.security import CSRF_COOKIE, valid_csrf
from app.api.v1 import auth,users,projects,timeline,media,ai_scripts,library
from app.core.app_logging import install_cliptora_logging

app=FastAPI(title='Cliptora API',version='2.0.0')
# During development, Vite proxies same-origin /api/v1. CORS also supports explicit dev origin.
app.add_middleware(CORSMiddleware,allow_origins=[settings().frontend_origin],allow_credentials=True,allow_methods=['GET','POST','PATCH','PUT','DELETE','OPTIONS'],allow_headers=['Content-Type','X-CSRF-Token'])

@app.middleware('http')
async def csrf_guard(request:Request,call_next):
    if request.url.path.startswith('/api/v1/') and request.method in ('POST','PUT','PATCH','DELETE'):
        cookie=request.cookies.get(CSRF_COOKIE)
        header=request.headers.get('X-CSRF-Token')
        if not cookie or not header or cookie!=header or not valid_csrf(cookie):
            return JSONResponse({'detail':'CSRF verification failed. Reload the page.'},status_code=403)
    return await call_next(request)

@app.get('/api/v1/health',tags=['Health'])
def health(): return {'status':'ok','service':'cliptora-api','version':'2.0.0'}

for router in (auth.router,users.router,projects.router,timeline.router,media.router,ai_scripts.router,library.router):
    app.include_router(router,prefix='/api/v1')

# CLIPTORA COMMANDS MODULE V3.1
from app.api.v1.commands import router as cliptora_commands_router
app.include_router(cliptora_commands_router, prefix="/api/v1")

install_cliptora_logging(app)
