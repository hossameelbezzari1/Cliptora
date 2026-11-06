
"""
CLIPTORA - Centralized application logging.

One output file:
    storage/logs/cliptora.log

Captures:
- HTTP requests: 200, 201, 400, 401, 404, 500...
- Unhandled FastAPI exceptions and tracebacks
- Application logging messages
- Uvicorn startup errors
- Python warnings and uncaught thread exceptions
- Unhandled asyncio task errors

No cookies, request bodies, headers or query strings
are intentionally included in HTTP request logs.
"""

from __future__ import annotations

import asyncio
import logging
import os
import sys
import threading
import time
import uuid

from pathlib import Path
from typing import Any


LOGGER_NAME = "cliptora"

_handler: logging.FileHandler | None = None
_handler_path: Path | None = None

_lock = threading.RLock()
_installed_apps: set[int] = set()
_hooks_installed = False


def log_path() -> Path:
    """
    Resolve one application log file.

    Locally:
      CLIPTORA/storage/logs/cliptora.log

    Optional:
      CLIPTORA_LOG_FILE=/absolute/path/cliptora.log
    """

    override = os.getenv(
        "CLIPTORA_LOG_FILE",
        "",
    ).strip()

    if override:
        return Path(
            override
        ).expanduser().resolve()

    backend_dir = (
        Path(__file__).resolve().parents[2]
    )

    project_dir = backend_dir.parent

    # In Windows development the repository contains
    # backend/ and frontend/. In a backend-only container,
    # keep logs under the backend's storage directory.
    if (
        (project_dir / "frontend").exists()
        or (project_dir / "backend").exists()
    ):
        storage_dir = project_dir / "storage"
    else:
        storage_dir = backend_dir / "storage"

    return (
        storage_dir / "logs" / "cliptora.log"
    ).resolve()


class _LogFilter(logging.Filter):
    def filter(
        self,
        record: logging.LogRecord,
    ) -> bool:

        # Do not write Uvicorn's raw access log.
        # It can include client IPs and URL queries.
        # Our middleware records safe request paths.
        if record.name.startswith(
            "uvicorn.access"
        ):
            return False

        # Application and server information.
        if record.name.startswith(
            ("cliptora", "uvicorn")
        ):
            return True

        # Other libraries: warnings and errors only.
        return record.levelno >= logging.WARNING


def _formatter() -> logging.Formatter:
    return logging.Formatter(
        fmt=(
            "[%(asctime)s] "
            "%(levelname)-8s "
            "%(name)s: "
            "%(message)s"
        ),
        datefmt="%Y-%m-%d %H:%M:%S",
    )


def _attach_to_blocking_logger(
    logger: logging.Logger,
    handler: logging.FileHandler,
) -> None:
    """
    Uvicorn sometimes disables propagation.
    Attach to the first logger that blocks
    propagation, without duplicate handlers.
    """

    root = logging.getLogger()
    current = logger

    while current is not root:
        if not current.propagate:
            if handler not in current.handlers:
                current.addHandler(handler)
            return

        current = current.parent


def _install_exception_hooks() -> None:
    global _hooks_installed

    if _hooks_installed:
        return

    old_sys_hook = sys.excepthook

    def on_uncaught_exception(
        exc_type: type[BaseException],
        exc: BaseException,
        traceback: Any,
    ) -> None:

        if not issubclass(
            exc_type,
            KeyboardInterrupt,
        ):
            logging.getLogger(
                "cliptora.python"
            ).critical(
                "Unhandled Python exception",
                exc_info=(
                    exc_type,
                    exc,
                    traceback,
                ),
            )

        old_sys_hook(
            exc_type,
            exc,
            traceback,
        )

    sys.excepthook = on_uncaught_exception

    old_thread_hook = threading.excepthook

    def on_thread_exception(
        args: threading.ExceptHookArgs,
    ) -> None:

        if args.exc_type is not KeyboardInterrupt:
            logging.getLogger(
                "cliptora.threads"
            ).critical(
                "Unhandled exception in thread: %s",
                (
                    args.thread.name
                    if args.thread
                    else "unknown"
                ),
                exc_info=(
                    args.exc_type,
                    args.exc_value,
                    args.exc_traceback,
                ),
            )

        old_thread_hook(args)

    threading.excepthook = on_thread_exception

    _hooks_installed = True


def configure_logging() -> Path:
    """
    Initialize exactly one persistent file handler
    in this Python process.

    Logs are appended to one file.
    No log rotation or extra log files are created.
    """

    global _handler
    global _handler_path

    with _lock:
        path = log_path()

        if (
            _handler is not None
            and _handler_path == path
        ):
            return path

        path.parent.mkdir(
            parents=True,
            exist_ok=True,
        )

        handler = logging.FileHandler(
            filename=path,
            mode="a",
            encoding="utf-8",
            delay=False,
        )

        handler.setFormatter(
            _formatter()
        )

        handler.addFilter(
            _LogFilter()
        )

        handler.setLevel(logging.INFO)

        root = logging.getLogger()

        if root.level > logging.INFO:
            root.setLevel(logging.INFO)

        # Remove our previous handler if a new
        # path was configured.
        if _handler is not None:
            for name in (
                "",
                "uvicorn",
                "uvicorn.error",
            ):
                target = logging.getLogger(name)

                if _handler in target.handlers:
                    target.removeHandler(
                        _handler
                    )

            _handler.close()

        root.addHandler(handler)

        # Uvicorn's logger often has propagate=False.
        _attach_to_blocking_logger(
            logging.getLogger(
                "uvicorn.error"
            ),
            handler,
        )

        _attach_to_blocking_logger(
            logging.getLogger(
                "uvicorn"
            ),
            handler,
        )

        logging.captureWarnings(True)

        _handler = handler
        _handler_path = path

        _install_exception_hooks()

        logging.getLogger(
            "cliptora"
        ).info(
            "Centralized logging enabled: %s",
            path,
        )

        return path


class _HTTPLoggingMiddleware:
    """
    Pure ASGI middleware.

    Logs requests without consuming bodies
    or interfering with streaming responses.
    """

    def __init__(self, app: Any) -> None:
        self.app = app

        self.logger = logging.getLogger(
            "cliptora.http"
        )

    async def __call__(
        self,
        scope: dict,
        receive: Any,
        send: Any,
    ) -> None:

        if scope.get("type") != "http":
            await self.app(
                scope,
                receive,
                send,
            )
            return

        request_id = uuid.uuid4().hex[:12]

        method = str(
            scope.get("method", "UNKNOWN")
        )[:12]

        started = time.perf_counter()

        status_code: int | None = None
        exception_logged = False

        async def send_logged(
            message: dict,
        ) -> None:
            nonlocal status_code

            if (
                message.get("type")
                == "http.response.start"
            ):
                status_code = int(
                    message.get("status", 200)
                )

                message = dict(message)

                headers = list(
                    message.get(
                        "headers",
                        [],
                    )
                )

                headers.append(
                    (
                        b"x-request-id",
                        request_id.encode(
                            "ascii"
                        ),
                    )
                )

                message["headers"] = headers

            await send(message)

        try:
            await self.app(
                scope,
                receive,
                send_logged,
            )

        except Exception:
            exception_logged = True

            elapsed = (
                time.perf_counter() - started
            ) * 1000

            route = scope.get("route")

            path = str(
                getattr(
                    route,
                    "path_format",
                    None,
                )
                or getattr(
                    route,
                    "path",
                    None,
                )
                or scope.get(
                    "path",
                    "/",
                )
            )[:300]

            self.logger.exception(
                "[request:%s] "
                "%s %s -> 500 "
                "(%.2f ms) "
                "UNHANDLED EXCEPTION",
                request_id,
                method,
                path,
                elapsed,
            )

            raise

        finally:
            if not exception_logged:
                elapsed = (
                    time.perf_counter() - started
                ) * 1000

                route = scope.get("route")

                path = str(
                    getattr(
                        route,
                        "path_format",
                        None,
                    )
                    or getattr(
                        route,
                        "path",
                        None,
                    )
                    or scope.get(
                        "path",
                        "/",
                    )
                )[:300]

                status = (
                    status_code
                    if status_code is not None
                    else 0
                )

                if status >= 500:
                    level = logging.ERROR

                elif status >= 400:
                    level = logging.WARNING

                else:
                    level = logging.INFO

                self.logger.log(
                    level,
                    "[request:%s] "
                    "%s %s -> %s "
                    "(%.2f ms)",
                    request_id,
                    method,
                    path,
                    status,
                    elapsed,
                )


def _install_asyncio_logger() -> None:
    """
    Catch unhandled background asyncio task errors.
    """

    loop = asyncio.get_running_loop()

    previous_handler = (
        loop.get_exception_handler()
    )

    def handle_async_exception(
        event_loop: asyncio.AbstractEventLoop,
        context: dict,
    ) -> None:

        exception = context.get(
            "exception"
        )

        logger = logging.getLogger(
            "cliptora.asyncio"
        )

        if isinstance(
            exception,
            BaseException,
        ):
            logger.error(
                "Unhandled asyncio exception",
                exc_info=(
                    type(exception),
                    exception,
                    exception.__traceback__,
                ),
            )
        else:
            logger.error(
                "Unhandled asyncio task error "
                "(no exception object)"
            )

        if previous_handler is not None:
            previous_handler(
                event_loop,
                context,
            )
        else:
            event_loop.default_exception_handler(
                context
            )

    loop.set_exception_handler(
        handle_async_exception
    )


def install_cliptora_logging(
    app: Any,
) -> Path:
    """
    Register logging for a FastAPI application.
    Safe to call more than once on the same app.
    """

    path = configure_logging()

    app_id = id(app)

    if app_id in _installed_apps:
        return path

    app.add_middleware(
        _HTTPLoggingMiddleware
    )

    app.router.add_event_handler(
    "startup",
    _install_asyncio_logger,
    )

    _installed_apps.add(app_id)

    logging.getLogger(
        "cliptora"
    ).info(
        "HTTP and exception logging installed"
    )

    return path


logger = logging.getLogger(
    LOGGER_NAME
)
