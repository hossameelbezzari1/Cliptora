from fastapi.responses import JSONResponse
from app.core.security import CSRF_COOKIE, valid_csrf

class CSRFMiddleware:
    """Stateless ASGI middleware for browser mutation protection."""
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope.get("type") != "http":
            return await self.app(scope, receive, send)
        path = scope.get("path", "")
        method = scope.get("method", "GET")
        if path.startswith("/api/v1/") and method in {"POST", "PUT", "PATCH", "DELETE"}:
            from starlette.requests import Request
            request = Request(scope, receive=receive)
            cookie = request.cookies.get(CSRF_COOKIE)
            header = request.headers.get("X-CSRF-Token")
            if not cookie or not header or cookie != header or not valid_csrf(cookie):
                response = JSONResponse({"detail": "CSRF verification failed. Reload the page."}, status_code=403)
                return await response(scope, receive, send)
        await self.app(scope, receive, send)
