"""CLIPTORA logging, similar to Laravel's storage/logs/laravel.log.

Integration, after `app = FastAPI(...)` in backend/app/main.py:
    from app.core.app_logging import install_cliptora_logging
    install_cliptora_logging(app)

The log file is backend/storage/logs/cliptora.log by default.
Logs intentionally do NOT include request bodies, cookies, authorization headers,
query strings, or client IPs. Treat tracebacks as sensitive in production.
"""

from __future__ import annotations

import logging
import os
import sys
import threading
import time
import uuid
from logging.handlers import RotatingFileHandler
from pathlib import Path
from typing import Any


# app/core/app_logging.py -> backend/
_BACKEND_DIR = Path(__file__).resolve().parents[2]
_LOG_FILE: Path | None = None
_FILE_HANDLER: RotatingFileHandler | None = None
_INSTALLED_ON_APPS: set[int] = set()


class _SafeLogFilter(logging.Filter):
    """Keep CLIPTORA events, Uvicorn errors and major Python failures.

    In particular, exclude third-party INFO logs such as httpx URLs, which
    could otherwise include tokens in query parameters.
    """

    def filter(self, record: logging.LogRecord) -> bool:
        if record.name.startswith("cliptora") or record.name.startswith("uvicorn.error"):
            return True
        return record.levelno >= logging.ERROR


class _CliptoraFormatter(logging.Formatter):
    """Readable local timestamps and traceback, one entry per line or exception."""

    def __init__(self) -> None:
        super().__init__(
            fmt="[%(asctime)s] %(levelname)-8s %(name)s: %(message)s",
            datefmt="%Y-%m-%d %H:%M:%S",
        )


def log_path() -> Path:
    """Absolute path used for persistent logs."""
    override = os.getenv("CLIPTORA_LOG_DIR", "").strip()
    folder = Path(override).expanduser().resolve() if override else _BACKEND_DIR / "storage" / "logs"
    return folder / "cliptora.log"


def configure_logging() -> Path:
    """Configure one rotating file handler without discarding console handlers.

    Repeated calls are safe within the same process. Rotates at 10 MiB; keeps
    five prior files: cliptora.log.1, ..., cliptora.log.5.
    """
    global _LOG_FILE, _FILE_HANDLER

    path = log_path()
    if _FILE_HANDLER is not None and _LOG_FILE == path:
        return path

    path.parent.mkdir(parents=True, exist_ok=True)
    handler = RotatingFileHandler(
        path, maxBytes=10 * 1024 * 1024, backupCount=5,
        encoding="utf-8", delay=True,
    )
    handler.setFormatter(_CliptoraFormatter())
    handler.setLevel(logging.INFO)
    handler.addFilter(_SafeLogFilter())

    root = logging.getLogger()
    root.setLevel(min(root.level, logging.INFO))
    root.addHandler(handler)

    # Uvicorn has its own logging tree and often does not propagate to root.
    # Add only where needed, so normal app logs are not duplicated.
    for name in ("uvicorn.error",):
        logger = logging.getLogger(name)
        # Uvicorn's parent typically blocks propagation to the root logger.
        parent = logger.parent
        reaches_root = logger.propagate
        while reaches_root and parent is not None and parent is not root:
            reaches_root = parent.propagate
            parent = parent.parent
        if not reaches_root:
            logger.addHandler(handler)

    logging.captureWarnings(True)

    original_thread_hook = threading.excepthook
    if not getattr(original_thread_hook, "_cliptora_hook", False):
        def on_thread_exception(args: threading.ExceptHookArgs) -> None:
            if args.exc_type is not KeyboardInterrupt:
                logging.getLogger("cliptora.uncaught").critical(
                    "Unhandled thread exception (%s)",
                    args.thread.name if args.thread else "unknown",
                    exc_info=(args.exc_type, args.exc_value, args.exc_traceback),
                )
            original_thread_hook(args)
        on_thread_exception._cliptora_hook = True  # type: ignore[attr-defined]
        threading.excepthook = on_thread_exception

    original_hook = sys.excepthook
    if not getattr(original_hook, "_cliptora_hook", False):
        def on_uncaught(exc_type: type[BaseException], exc: BaseException, tb: Any) -> None:
            if not issubclass(exc_type, KeyboardInterrupt):
                logging.getLogger("cliptora.uncaught").critical(
                    "Unhandled process exception", exc_info=(exc_type, exc, tb),
                )
            original_hook(exc_type, exc, tb)
        on_uncaught._cliptora_hook = True  # type: ignore[attr-defined]
        sys.excepthook = on_uncaught

    _LOG_FILE, _FILE_HANDLER = path, handler
    logging.getLogger("cliptora").info("Logging enabled: %s", path)
    return path


class _RequestLoggerMiddleware:
    """Pure ASGI middleware to preserve streaming and not consume request bodies."""

    def __init__(self, app: Any) -> None:
        self.app = app
        self.logger = logging.getLogger("cliptora.http")

    async def __call__(self, scope: dict, receive: Any, send: Any) -> None:
        if scope.get("type") != "http":
            await self.app(scope, receive, send)
            return

        request_id = uuid.uuid4().hex[:12]
        method = str(scope.get("method", "?"))[:12]
        # path only, never query_string, auth headers, or request body
        url_path = str(scope.get("path", "/"))[:300]
        start = time.perf_counter()
        status: int | None = None
        failed = False

        async def send_with_id(message: dict) -> None:
            nonlocal status
            if message.get("type") == "http.response.start":
                status = int(message.get("status", 200))
                # Helpful for matching browser 500 errors to an entry in cliptora.log
                message = dict(message)
                message["headers"] = [
                    *message.get("headers", []),
                    (b"x-request-id", request_id.encode("ascii")),
                ]
            await send(message)

        try:
            await self.app(scope, receive, send_with_id)
        except Exception:
            failed = True
            elapsed = (time.perf_counter() - start) * 1000
            self.logger.exception(
                "[request:%s] %s %s -> 500 (%.0f ms): unhandled exception",
                request_id, method, url_path, elapsed,
            )
            raise
        finally:
            if not failed and status is not None and status >= 400:
                elapsed = (time.perf_counter() - start) * 1000
                severity = logging.ERROR if status >= 500 else logging.WARNING
                self.logger.log(
                    severity,
                    "[request:%s] %s %s -> %d (%.0f ms)",
                    request_id, method, url_path, status, elapsed,
                )


def install_cliptora_logging(app: Any) -> Path:
    """Connect CLIPTORA log file and HTTP error tracking to a FastAPI app.

    Call before serving requests, after creating the app. No route, auth,
    existing middleware, or database table is replaced.
    """
    path = configure_logging()
    key = id(app)
    if key not in _INSTALLED_ON_APPS:
        app.add_middleware(_RequestLoggerMiddleware)
        _INSTALLED_ON_APPS.add(key)
    return path


logger = logging.getLogger("cliptora")
