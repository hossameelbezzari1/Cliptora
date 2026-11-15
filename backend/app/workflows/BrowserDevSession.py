
"""Persistent, authenticated Playwright developer sessions.

One worker thread owns each Playwright browser for its entire lifetime. HTTP
requests enqueue individual commands, so the same page, cookies and tabs stay
alive while the user moves between workflow node editors.
"""
from __future__ import annotations

import ipaddress
import queue
import re
import socket
import threading
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

from app.workflows.nodes.Browser import (
    COMMANDS, _action_timeout, _public_url, _selector, _wait_state,
)


_AUDIO_TARGET_RE = re.compile(r"data-act\s*=\s*['\"](mp3|wav)['\"]", re.IGNORECASE)
_UUID_RE = re.compile(r"[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}", re.IGNORECASE)
_INVALID_FILENAME_RE = re.compile(r'[<>:"/\\|?*\x00-\x1f]')
_WINDOWS_RESERVED = frozenset({"CON", "PRN", "AUX", "NUL"} | {
    f"{prefix}{number}" for prefix in ("COM", "LPT") for number in range(1, 10)
})


def _expected_audio_extension(target: str) -> str:
    match = _AUDIO_TARGET_RE.search(target)
    return "." + match.group(1).lower() if match else ""


def _download_filename(action: dict[str, Any], suggested_filename: str) -> str:
    custom = str(action.get("filename") or action.get("value") or "").strip()
    original = custom or str(suggested_filename or "").strip()
    # A browser-suggested name is untrusted: keep it a single safe filename.
    raw = original.replace("\\", "/").rsplit("/", 1)[-1]
    name = _INVALID_FILENAME_RE.sub("_", raw).strip(" .")[:160]
    expected = _expected_audio_extension(str(action.get("target") or ""))
    stem = Path(name).stem if name else ""
    suffix = Path(name).suffix.lower() if name else ""

    if expected:
        if custom and suffix and suffix != expected:
            raise ValueError(f"Download filename must end with {expected}")
        if not custom and (not stem or _UUID_RE.fullmatch(stem)):
            stem = f"wevolabs-{time.strftime('%Y%m%d-%H%M%S')}"
        name = f"{stem}{expected}"
    elif not name:
        name = f"download-{time.strftime('%Y%m%d-%H%M%S')}.bin"

    name = name.strip(" .")
    if Path(name).stem.upper() in _WINDOWS_RESERVED:
        name = "_" + name
    return name


def _available_download_path(directory: Path, filename: str) -> Path:
    candidate = directory / filename
    if not candidate.exists():
        return candidate
    base = Path(filename).stem
    suffix = Path(filename).suffix
    index = 2
    while True:
        candidate = directory / f"{base} ({index}){suffix}"
        if not candidate.exists():
            return candidate
        index += 1


def _audio_signature(path: Path) -> str:
    with path.open("rb") as stream:
        header = stream.read(12)
    if header.startswith(b"ID3") or (
        len(header) >= 2 and header[0] == 0xFF and header[1] & 0xE0 == 0xE0
    ):
        return "mp3"
    if header.startswith(b"RIFF") and header[8:12] == b"WAVE":
        return "wav"
    return "unknown"


TARGET_COMMANDS = frozenset({
    "click", "double_click", "fill", "type", "press", "hover", "wait",
    "select", "check", "uncheck", "extract_text", "download",
})


@dataclass
class _Job:
    action: dict[str, Any] | None
    command_key: str = ""
    done: threading.Event = field(default_factory=threading.Event)
    result: dict[str, Any] | None = None
    error: BaseException | None = None


class BrowserDevSession:
    def __init__(self, *, session_id: str, url: str, browser_name: str,
                 timeout_ms: int, allowed_hosts: list[str], download_dir: Path):
        self.session_id = session_id
        self.url = url
        self.browser_name = browser_name
        self.timeout_ms = timeout_ms
        self.allowed_hosts = allowed_hosts
        self.download_dir = download_dir
        self.created_at = time.time()
        self.updated_at = self.created_at
        self.status = "starting"
        self.message = "Opening developer browser"
        self.current_url = ""
        self.title = ""
        self.history: dict[str, dict[str, Any]] = {}
        self._jobs: queue.Queue[_Job] = queue.Queue(maxsize=20)
        self._ready = threading.Event()
        self._closed = threading.Event()
        self._lock = threading.RLock()
        self._startup_error: BaseException | None = None
        self._thread = threading.Thread(
            target=self._run, name=f"browser-dev-{session_id}", daemon=True,
        )
        self._thread.start()

    def _safe_state(self) -> dict[str, Any]:
        with self._lock:
            return {
                "session_id": self.session_id,
                "status": self.status,
                "message": self.message[:300],
                "url": self.current_url[:2000],
                "title": self.title[:500],
                "created_at": self.created_at,
                "updated_at": self.updated_at,
                "history": list(self.history.values())[-100:],
            }

    def wait_ready(self, timeout: float) -> dict[str, Any]:
        if not self._ready.wait(timeout):
            raise TimeoutError("Developer browser did not start in time")
        if self._startup_error is not None:
            raise RuntimeError(f"Cannot start developer browser: {self._startup_error}")
        return self._safe_state()

    def state(self) -> dict[str, Any]:
        return self._safe_state()

    def execute(self, action: dict[str, Any], command_key: str) -> dict[str, Any]:
        if self._closed.is_set():
            raise RuntimeError("Developer browser session is closed")
        job = _Job(action=dict(action), command_key=command_key)
        try:
            self._jobs.put(job, timeout=2)
        except queue.Full as exc:
            raise RuntimeError("Developer browser is busy") from exc
        wait_seconds = max(5, self.timeout_ms / 1000 + 10)
        if not job.done.wait(wait_seconds):
            raise TimeoutError("Browser command did not finish in time")
        if job.error is not None:
            raise RuntimeError(str(job.error)) from job.error
        return job.result or {}

    def close(self) -> dict[str, Any]:
        if self._closed.is_set():
            return self._safe_state()
        job = _Job(action=None)
        try:
            self._jobs.put(job, timeout=2)
            job.done.wait(10)
        except queue.Full:
            pass
        self._closed.set()
        return self._safe_state()

    def _publish(self, **values: Any) -> None:
        with self._lock:
            for key, value in values.items():
                setattr(self, key, value)
            self.updated_at = time.time()

    def _run(self) -> None:
        browser = None
        try:
            from playwright.sync_api import sync_playwright
            with sync_playwright() as playwright:
                engine = getattr(playwright, self.browser_name)
                browser = engine.launch(headless=False)
                context = browser.new_context(accept_downloads=True)
                context.route("**/*", self._guard_route)
                page = context.new_page()
                page.set_default_timeout(self.timeout_ms)

                # Playwright normally asks Chromium to store downloads by GUID.
                # Switch this developer browser to Chromium's native naming so
                # Chrome's download bubble/history displays the site's MP3 name.
                # The CDP command must target Playwright's isolated context.
                if self.browser_name == "chromium":
                    self.download_dir.mkdir(parents=True, exist_ok=True)
                    target_info = context.new_cdp_session(page).send(
                        "Target.getTargetInfo"
                    )["targetInfo"]
                    browser_context_id = target_info.get("browserContextId")
                    if not browser_context_id:
                        raise RuntimeError(
                            "Cannot identify Chromium download context for native filenames"
                        )
                    download_cdp = browser.new_browser_cdp_session()
                    download_cdp.send("Browser.setDownloadBehavior", {
                        "behavior": "allow",
                        "browserContextId": browser_context_id,
                        "downloadPath": str(self.download_dir.resolve()),
                    })
                try:
                    page.goto(self.url, wait_until="domcontentloaded", timeout=self.timeout_ms)
                    self._publish(status="ready", message="Developer browser is ready")
                except Exception as exc:
                    # Keep the visible browser alive so the user can inspect or
                    # retry commands even when initial navigation times out.
                    self._publish(status="ready", message=f"Page open warning: {type(exc).__name__}")
                self._update_page_state(page)
                self._ready.set()

                while True:
                    job = self._jobs.get()
                    if job.action is None:
                        job.done.set()
                        break
                    try:
                        job.result = self._execute_action(context, page, job.action, job.command_key)
                        page = context.pages[-1] if context.pages else page
                    except BaseException as exc:
                        job.error = exc
                    finally:
                        job.done.set()
        except BaseException as exc:
            self._startup_error = exc
            self._publish(status="failed", message=f"Developer browser stopped: {type(exc).__name__}")
            self._ready.set()
        finally:
            if browser is not None:
                try:
                    browser.close()
                except Exception:
                    pass
            self._publish(status="closed", message="Developer browser closed")
            self._closed.set()

    def _guard_route(self, route) -> None:
        request = route.request
        try:
            parsed = urlsplit(request.url)
            if parsed.scheme not in {"https", "data", "blob"}:
                route.abort()
                return
            if parsed.scheme == "https":
                host = parsed.hostname or ""
                resolved = socket.getaddrinfo(host, 443, type=socket.SOCK_STREAM)
                if not resolved or any(
                    not ipaddress.ip_address(row[4][0]).is_global for row in resolved
                ):
                    route.abort()
                    return
                if request.is_navigation_request():
                    _public_url(request.url, self.allowed_hosts)
            route.continue_()
        except (ValueError, OSError):
            route.abort()

    def _update_page_state(self, page) -> None:
        title = ""
        try:
            title = page.title()
        except Exception:
            pass
        self._publish(current_url=page.url, title=title)

    def _execute_action(self, context, page, action: dict[str, Any], command_key: str) -> dict[str, Any]:
        command = str(action.get("command", ""))
        if command not in COMMANDS:
            raise ValueError("Unsupported browser command")
        started = time.monotonic()
        action_timeout = _action_timeout(action, self.timeout_ms)
        target = action.get("target")
        result: dict[str, Any] = {
            "key": command_key,
            "command": command,
            "status": "running",
            "target": target if isinstance(target, str) else "",
            "element_status": "searching" if target is not None else "not_required",
        }
        with self._lock:
            self.history[command_key] = dict(result)
        self._publish(status="running", message=f"Executing {command}")
        try:
            locator = _selector(page, target) if target is not None else None
            value = str(action.get("value", ""))
            if command == "navigate":
                destination = _public_url(str(action.get("url") or value), self.allowed_hosts)
                page.goto(destination, wait_until="domcontentloaded", timeout=action_timeout)
            elif command in TARGET_COMMANDS:
                if locator is None:
                    raise ValueError(f"{command} requires a target")
                if command != "wait":
                    locator.wait_for(state="attached", timeout=action_timeout)
                result["element_status"] = "found"
                if command == "click": locator.click(timeout=action_timeout)
                elif command == "double_click": locator.dblclick(timeout=action_timeout)
                elif command == "fill": locator.fill(value, timeout=action_timeout)
                elif command == "type": locator.press_sequentially(value, delay=int(action.get("delay_ms", 0)), timeout=action_timeout)
                elif command == "press": locator.press(value, timeout=action_timeout)
                elif command == "hover": locator.hover(timeout=action_timeout)
                elif command == "wait":
                    locator.wait_for(state=_wait_state(action), timeout=action_timeout)
                    result["element_status"] = "found"
                elif command == "select": locator.select_option(value, timeout=action_timeout)
                elif command == "check": locator.check(timeout=action_timeout)
                elif command == "uncheck": locator.uncheck(timeout=action_timeout)
                elif command == "extract_text": result["value"] = locator.inner_text(timeout=action_timeout)[:10000]
                elif command == "download":
                    self.download_dir.mkdir(parents=True, exist_ok=True)
                    # Track which files existed before this exact command.
                    before = {
                        entry.name for entry in self.download_dir.iterdir()
                        if entry.is_file()
                    }
                    with page.expect_download(timeout=action_timeout) as info:
                        locator.click(timeout=action_timeout)
                    item = info.value
                    failure = item.failure()
                    if failure:
                        raise RuntimeError(f"Browser download failed: {failure}")

                    # Wait until Chrome finishes writing its native file.
                    item.path()
                    suggested = Path(item.suggested_filename.replace("\\", "/")).name
                    suggested_path = Path(suggested)
                    new_files = [
                        entry for entry in self.download_dir.iterdir()
                        if entry.is_file()
                        and entry.name not in before
                        and not entry.name.lower().endswith(".crdownload")
                    ]
                    native_matches = [
                        entry for entry in new_files
                        if entry.name == suggested or (
                            entry.suffix.lower() == suggested_path.suffix.lower()
                            and entry.stem.startswith(suggested_path.stem + " (")
                            and entry.stem.endswith(")")
                        )
                    ]
                    native = max(native_matches, key=lambda p: p.stat().st_mtime_ns) if native_matches else None

                    filename = _download_filename(action, item.suggested_filename)
                    if native is not None and native.name == filename:
                        destination = native
                    else:
                        destination = _available_download_path(self.download_dir, filename)
                        item.save_as(str(destination))

                    size_bytes = destination.stat().st_size
                    if size_bytes == 0:
                        destination.unlink(missing_ok=True)
                        raise RuntimeError("Downloaded file is empty")

                    expected = _expected_audio_extension(str(target or "")).lstrip(".")
                    audio_format = _audio_signature(destination) if expected else "not_checked"
                    result["value"] = destination.name
                    result["size_bytes"] = size_bytes
                    result["audio_format"] = audio_format
                    result["suggested_filename"] = item.suggested_filename
                    result["chrome_native_filename"] = native.name if native else None
                    if expected and audio_format != expected:
                        raise RuntimeError(
                            f"Saved {destination.name}, but its contents do not look like {expected.upper()} "
                            f"(detected: {audio_format}). Check the file before using it."
                        )
            elif command == "scroll":
                page.mouse.wheel(0, int(action.get("pixels", 600)))
            elif command == "mouse_move":
                if locator is not None:
                    locator.hover(timeout=action_timeout)
                    result["element_status"] = "found"
                else:
                    page.mouse.move(float(action["x"]), float(action["y"]))
            elif command == "mouse_drag":
                page.mouse.move(float(action["start_x"]), float(action["start_y"]))
                page.mouse.down()
                try:
                    page.mouse.move(float(action["end_x"]), float(action["end_y"]), steps=12)
                finally:
                    page.mouse.up()
            elif command == "screenshot":
                self.download_dir.mkdir(parents=True, exist_ok=True)
                destination = self.download_dir / f"dev-{int(time.time() * 1000)}.png"
                (locator if locator is not None else page).screenshot(path=str(destination), timeout=action_timeout)
                result["value"] = destination.name
            elif command == "back": page.go_back(wait_until="domcontentloaded", timeout=action_timeout)
            elif command == "forward": page.go_forward(wait_until="domcontentloaded", timeout=action_timeout)
            elif command == "reload": page.reload(wait_until="domcontentloaded", timeout=action_timeout)
            elif command == "new_tab":
                page = context.new_page()
                if action.get("url"):
                    page.goto(_public_url(str(action["url"]), self.allowed_hosts), wait_until="domcontentloaded", timeout=action_timeout)
            elif command == "switch_tab":
                page = context.pages[int(action.get("tab", 0))]

            result["status"] = "completed"
            result["elapsed_seconds"] = round(time.monotonic() - started, 3)
            self._update_page_state(page)
            self._publish(status="ready", message=f"Completed {command}")
            with self._lock:
                self.history[command_key] = dict(result)
            return result
        except BaseException as exc:
            result["status"] = "failed"
            if result["element_status"] == "searching":
                result["element_status"] = "not_found"
            result["error"] = f"{type(exc).__name__}: {exc}"[:500]
            result["elapsed_seconds"] = round(time.monotonic() - started, 3)
            self._update_page_state(page)
            self._publish(status="ready", message=f"Failed {command}")
            with self._lock:
                self.history[command_key] = dict(result)
            raise RuntimeError(result["error"]) from exc


class BrowserDevSessions:
    def __init__(self):
        self._sessions: dict[tuple[int, int, int], BrowserDevSession] = {}
        self._lock = threading.RLock()

    def start(self, key: tuple[int, int, int], **config: Any) -> BrowserDevSession:
        with self._lock:
            previous = self._sessions.pop(key, None)
            if previous is not None:
                previous.close()
            session = BrowserDevSession(**config)
            self._sessions[key] = session
            return session

    def get(self, key: tuple[int, int, int]) -> BrowserDevSession | None:
        with self._lock:
            session = self._sessions.get(key)
            if session is not None and session.state()["status"] == "closed":
                self._sessions.pop(key, None)
                return None
            return session

    def close(self, key: tuple[int, int, int]) -> dict[str, Any] | None:
        with self._lock:
            session = self._sessions.pop(key, None)
        return session.close() if session is not None else None


browser_dev_sessions = BrowserDevSessions()
