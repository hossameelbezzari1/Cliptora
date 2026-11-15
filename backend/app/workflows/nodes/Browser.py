
"""CLIPTORA Browser Automation — explicit, declarative Playwright tools.

All browser.* helpers are CONFIGURATION nodes. Only browser.bot starts a
browser. It consumes helper nodes only through depends_on (saved graph connections).
settings.attachments, when supplied, is an additional strict port cross-check.
"""
from __future__ import annotations

import ipaddress
import json
import math
import os
import re
import socket
import time
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

from app.workflows.Node import Node
from app.workflows.MediaStorage import run_media_dir
from app.workflows.BrowserLiveState import BrowserLiveState

PREFIX = "browser."
HELPERS = {
    "commands": "commands", "mouse": "mouse", "keyboard": "keyboard",
    "inspector": "inspector", "screenshot": "screenshot",
    "gemini_vision": "gemini_vision", "verification": "verification",
    "error_handler": "error_handler", "download": "download",
    "live_preview": "live_preview", "close": "close",
}
CAPTCHA_SELECTORS = (
    'iframe[src*="recaptcha"]', 'iframe[src*="hcaptcha"]',
    'iframe[src*="challenges.cloudflare.com"]',
    '.g-recaptcha', '.h-captcha', '.cf-turnstile',
)
COMMANDS = frozenset({
    "navigate", "click", "double_click", "fill", "type", "press", "hover", "scroll",
    "mouse_move", "mouse_drag",
    "wait", "select", "check", "uncheck", "extract_text", "screenshot",
    "back", "forward", "reload", "download", "new_tab", "switch_tab",
})


def _op(name: str, label: str, icon: str, defaults: dict) -> dict:
    return {
        "label": label, "icon": icon,
        "settings": defaults,
        "input_types": ["json"], "output_types": ["json"],
    }


def _positive(value: Any, name: str, low: int, high: int) -> int:
    if isinstance(value, bool):
        raise ValueError(f"{name} must be a number")
    try:
        v = int(value)
    except (ValueError, TypeError) as exc:
        raise ValueError(f"{name} must be a number") from exc
    if v < low or v > high:
        raise ValueError(f"{name} must be between {low} and {high}")
    return v


def _public_url(url: str, allowed_hosts: list[str]) -> str:
    if not isinstance(url, str) or len(url) > 2048:
        raise ValueError("Invalid browser URL")
    p = urlsplit(url.strip())
    if p.scheme != "https" or not p.hostname or p.username is not None or p.password is not None:
        raise ValueError("Browser requires an HTTPS URL without embedded credentials")
    host = p.hostname.casefold().rstrip('.')
    if not any(host == item or host.endswith('.' + item) for item in allowed_hosts):
        raise ValueError(f"Browser host not allowlisted: {host}")
    if p.port not in (None, 443):
        raise ValueError("Browser only permits port 443")
    addresses = []
    last_dns_error: socket.gaierror | None = None
    for attempt in range(3):
        try:
            addresses = socket.getaddrinfo(host, 443, type=socket.SOCK_STREAM)
            last_dns_error = None
            break
        except socket.gaierror as exc:
            last_dns_error = exc
            if attempt < 2:
                time.sleep(0.25 * (attempt + 1))
    if last_dns_error is not None:
        raise ValueError("Could not resolve browser destination after 3 attempts") from last_dns_error
    if not addresses or any(not ipaddress.ip_address(item[4][0]).is_global for item in addresses):
        raise ValueError("Browser blocks local and private network destinations")
    return url.strip()


EXPRESSION = re.compile(r"\{\{\s*([A-Za-z][A-Za-z0-9_-]{0,47}(?:\.[A-Za-z0-9_-]{1,80}){1,10})\s*\}\}")


def _interpolate(value: str, outputs: dict) -> str:
    """Bounded upstream references; deliberately no eval or Python execution."""
    if not isinstance(value, str) or len(value) > 20000:
        raise ValueError("Browser expression input must be a short string")

    def replace(match):
        parts = match.group(1).split(".")
        data: Any = outputs.get(parts[0])
        for key in parts[1:]:
            if isinstance(data, dict):
                data = data.get(key)
            elif isinstance(data, list) and key.isdigit() and int(key) < len(data):
                data = data[int(key)]
            else:
                data = None
            if data is None: break
        if data is None:
            raise ValueError(f"Missing workflow expression: {match.group(1)}")
        if isinstance(data, (dict, list)):
            return json.dumps(data, ensure_ascii=False)
        return str(data)

    result = EXPRESSION.sub(replace, value)
    if "{{" in result:
        raise ValueError("Unsupported browser expression syntax")
    return result


def _selector(page: Any, target: Any) -> Any:
    if isinstance(target, str):
        text = target.strip()
        if not text or len(text) > 500:
            raise ValueError("Invalid CSS selector")
        return page.locator(text)
    if not isinstance(target, dict):
        raise ValueError("Element target requires a CSS string or a selector object")
    strategy = target.get("strategy", "css")
    value = str(target.get("value", ""))[:500]
    if strategy == "css":
        return page.locator(value)
    if strategy == "text":
        return page.get_by_text(value, exact=bool(target.get("exact", True)))
    if strategy == "label":
        return page.get_by_label(value, exact=bool(target.get("exact", True)))
    if strategy == "placeholder":
        return page.get_by_placeholder(value, exact=bool(target.get("exact", True)))
    if strategy == "role":
        role = str(target.get("role", ""))[:60]
        return page.get_by_role(role, name=value or None, exact=bool(target.get("exact", True)))
    raise ValueError("Unsupported selector strategy")


def _captcha_element(page: Any) -> Any | None:
    for selector in CAPTCHA_SELECTORS:
        loc = page.locator(selector).first
        try:
            if loc.count() and loc.is_visible(timeout=400):
                return loc
        except Exception:
            continue
    return None


def _safe_filename(name: str, suffix: str) -> str:
    safe = re.sub(r"[^A-Za-z0-9_.-]", "_", name)[:80].strip("._") or "artifact"
    if suffix == ".bin" and re.search(r"\.[A-Za-z0-9]{1,8}$", safe):
        return safe
    return safe if safe.lower().endswith(suffix) else safe + suffix


class BrowserAutomationNode(Node):
    family = "browser_automation"
    group = "Browser Automation"
    icon = "lucide:globe"

    operations = {
        PREFIX + "bot": _op("bot", "Browser Bot", "lucide:globe", {
            "url": "https://example.com", "browser": "chromium", "headless": True,
            "dev_mode": False,
            "timeout_ms": 15000, "max_actions": 60,
            "allowed_hosts": ["example.com"], "actions": [],
            "attachments": {},
        }),
        PREFIX + "commands": _op("commands", "Browser Commands", "lucide:list-checks", {"actions": []}),
        PREFIX + "mouse": _op("mouse", "Mouse Controller", "lucide:mouse-pointer-2", {"movement": "smooth", "steps": 18}),
        PREFIX + "keyboard": _op("keyboard", "Keyboard Controller", "lucide:keyboard", {"typing_delay_ms": 0}),
        PREFIX + "inspector": _op("inspector", "Page Inspector", "lucide:scan-eye", {"enabled": True, "max_text_chars": 3000}),
        PREFIX + "screenshot": _op("screenshot", "Screenshot Capture", "lucide:camera", {"at_end": True, "on_error": True}),
        PREFIX + "gemini_vision": _op("gemini_vision", "Gemini Vision Attachment", "lucide:brain-circuit", {"enabled": True}),
        PREFIX + "verification": _op("verification", "CAPTCHA Verification Handler", "lucide:shield-check", {"mode": "human", "wait_seconds": 120}),
        PREFIX + "error_handler": _op("error_handler", "Browser Error Handler", "lucide:refresh-cw", {"retries": 1, "retry_delay_ms": 500}),
        PREFIX + "download": _op("download", "Browser Download", "lucide:download", {"enabled": True}),
        PREFIX + "live_preview": _op("live_preview", "Browser Preview Snapshots", "lucide:monitor-play", {"enabled": True, "each_step": True}),
        PREFIX + "close": _op("close", "Close Browser Session", "lucide:power", {"enabled": True}),
    }

    parameter_fields = {
        PREFIX + "bot": {
            "url": {"type": "string", "title": "Start URL", "expression": True},
            "browser": {"type": "string", "title": "Browser Engine", "enum": ["chromium", "firefox", "webkit"]},
            "headless": {"type": "boolean", "title": "Headless"},
            "dev_mode": {"type": "boolean", "title": "Dev Mode", "description": "Live screenshots and per-command selector diagnostics."},
            "timeout_ms": {"type": "integer", "title": "Action Timeout (ms)", "minimum": 1000, "maximum": 60000},
            "max_actions": {"type": "integer", "title": "Maximum Actions", "minimum": 1, "maximum": 100},
            "allowed_hosts": {"type": "array", "title": "Allowed HTTPS Hosts", "items": {"type": "string"}},
            "actions": {"type": "array", "title": "Built-in Commands", "widget": "list", "items": {"type": "object", "properties": {
                "command": {"type": "string", "title": "Operation", "default": "click", "enum": [
                    "navigate", "click", "double_click", "fill", "type", "press", "hover", "scroll",
                    "mouse_move", "mouse_drag", "wait", "select", "check", "uncheck", "extract_text",
                    "screenshot", "back", "forward", "reload", "download", "new_tab", "switch_tab"
                ]},
                "target": {"type": "string", "title": "CSS Selector / Target", "default": ""},
                "value": {"type": "string", "title": "Value / URL / Expression", "default": ""},
                "timeout_ms": {"type": "integer", "title": "Action Timeout (ms)", "default": 15000, "minimum": 1000, "maximum": 60000}
            }}},
            "attachments": {"type": "object", "title": "Attached Node IDs by Port"},
        },
        PREFIX + "commands": {"actions": {"type": "array", "title": "Actions", "widget": "list", "items": {"type": "object", "properties": {
                "command": {"type": "string", "title": "Operation", "default": "click", "enum": [
                    "navigate", "click", "double_click", "fill", "type", "press", "hover", "scroll",
                    "mouse_move", "mouse_drag", "wait", "select", "check", "uncheck", "extract_text",
                    "screenshot", "back", "forward", "reload", "download", "new_tab", "switch_tab"
                ]},
                "target": {"type": "string", "title": "CSS Selector / Target", "default": ""},
                "value": {"type": "string", "title": "Value / URL / Expression", "default": ""},
                "timeout_ms": {"type": "integer", "title": "Action Timeout (ms)", "default": 15000, "minimum": 1000, "maximum": 60000}
            }}}},
    }

    def execute_operation(self, operation, node, outputs, source, workdir):
        cfg = node.get("settings") or {}
        kind = operation.removeprefix(PREFIX)
        if kind != "bot":
            if kind not in HELPERS:
                raise ValueError("Unknown browser tool")
            # Config node: does NOT start a browser and has no side effects.
            return {"attachment_type": kind, "config": dict(cfg), "status": "configured"}
        return self._run(node, outputs, workdir)

    @staticmethod
    def _run(node: dict, outputs: dict, workdir: Path) -> dict:
        cfg = node.get("settings") or {}
        browser_name = str(cfg.get("browser", "chromium"))
        if browser_name not in {"chromium", "firefox", "webkit"}:
            raise ValueError("Unsupported browser engine")
        headless = bool(cfg.get("headless", True))
        dev_mode = bool(cfg.get("dev_mode", False))
        timeout = _positive(cfg.get("timeout_ms", 15000), "timeout_ms", 1000, 60000)
        max_actions = _positive(cfg.get("max_actions", 60), "max_actions", 1, 100)
        allowed = cfg.get("allowed_hosts", [])
        if not isinstance(allowed, list) or not 1 <= len(allowed) <= 30:
            raise ValueError("Configure 1-30 allowed_hosts")
        hosts = []
        for item in allowed:
            if not isinstance(item, str) or not re.fullmatch(r"[a-zA-Z0-9.-]{1,253}", item):
                raise ValueError("Invalid allowed host")
            hosts.append(item.casefold().rstrip('.'))
        url = _public_url(_interpolate(str(cfg.get("url", "")), outputs), hosts)

        attached_ids = cfg.get("attachments") or {}
        if not isinstance(attached_ids, dict):
            raise ValueError("attachments must be a port-to-node mapping")
        deps = node.get("depends_on", [])
        attached: dict[str, dict] = {}
        # Every real canvas dependency is an explicit connection. Discover
        # linked tool nodes by their output contract, not by their existence
        # elsewhere in the saved workflow graph.
        for node_id in deps:
            result = outputs.get(node_id)
            if not isinstance(result, dict):
                continue
            port = result.get("attachment_type")
            if port not in HELPERS:
                continue
            if port in attached:
                raise ValueError(f"Only one {port} tool can be connected")
            attached[port] = result.get("config") or {}
        # Optional explicit port map acts as a strict cross-check.
        for port, node_id in attached_ids.items():
            if port not in HELPERS or not isinstance(node_id, str):
                raise ValueError(f"Invalid attached browser tool: {port}")
            if node_id not in deps or outputs.get(node_id, {}).get("attachment_type") != port:
                raise ValueError(f"Tool {node_id} must be connected to the {port} port")

        actions = cfg.get("actions") or []
        if not isinstance(actions, list):
            raise ValueError("Browser actions must be a list")
        actions = list(actions)
        if "commands" in attached:
            additional = attached["commands"].get("actions", [])
            if not isinstance(additional, list):
                raise ValueError("Connected Browser Commands is invalid")
            actions.extend(additional)
        if len(actions) > max_actions:
            raise ValueError("Browser actions exceed max_actions")
        for action in actions:
            if not isinstance(action, dict) or action.get("command") not in COMMANDS:
                raise ValueError("Invalid browser action in commands list")

        if cfg.get("batch_voiceovers_per_clip") is True:
            from app.workflows.ClipVoiceoverBatch import run_clip_voiceover_batch
            return run_clip_voiceover_batch(
                node=node, outputs=outputs, workdir=Path(workdir), actions=actions,
                attached=attached, browser_name=browser_name, headless=headless,
                timeout=timeout, hosts=hosts, url=url,
            )

        try:
            from playwright.sync_api import sync_playwright
        except ImportError as exc:
            raise RuntimeError("Install Playwright: pip install playwright && python -m playwright install chromium") from exc

        callback = node.get("_progress_callback")
        def progress(index: int, message: str):
            if callable(callback):
                callback({"stage": "browser", "message": message,
                          "progress": round(100 * index / max(1, len(actions)), 2),
                          "processed": index, "total": len(actions), "unit": "actions"})

        artifacts = run_media_dir(workdir) / "browser"
        artifacts.mkdir(parents=True, exist_ok=True)
        log: list[dict] = []
        screenshots: list[str] = []
        extracted: dict[str, str] = {}
        downloads: list[dict] = []
        retries = _positive(attached.get("error_handler", {}).get("retries", 0), "retries", 0, 3)
        retry_delay = _positive(attached.get("error_handler", {}).get("retry_delay_ms", 500), "retry_delay_ms", 0, 10000)
        verification_wait = _positive(attached.get("verification", {}).get("wait_seconds", 120), "verification wait", 5, 300) if "verification" in attached else 0
        selected_tab = 0
        live = BrowserLiveState(workdir, node['id'], 'playwright', len(actions)) if dev_mode or 'live_preview' in attached else None

        with sync_playwright() as playwright:
            engine = getattr(playwright, browser_name)
            browser = engine.launch(headless=headless)
            try:
                context = browser.new_context(accept_downloads="download" in attached)
                # Cross-origin requests to public CDNs are permitted; private/LAN
                # destinations and unapproved page navigations are rejected.
                def guard(route):
                    request = route.request
                    try:
                        req_url = request.url
                        parsed = urlsplit(req_url)
                        if parsed.scheme not in {"https", "data", "blob"}:
                            route.abort()
                            return
                        if parsed.scheme == "https":
                            dest = parsed.hostname or ""
                            # Deny private, loopback and local DNS targets,
                            # including subresources loaded by a public page.
                            resolved = socket.getaddrinfo(dest, 443, type=socket.SOCK_STREAM)
                            if not resolved or any(
                                not ipaddress.ip_address(row[4][0]).is_global
                                for row in resolved
                            ):
                                route.abort()
                                return
                            if request.is_navigation_request():
                                _public_url(req_url, hosts)
                        route.continue_()
                    except (ValueError, OSError):
                        route.abort()
                context.route("**/*", guard)
                page = context.new_page()
                page.set_default_timeout(timeout)
                navigation_started = time.monotonic()
                if live:
                    live.command_started(0, 'open_page')
                try:
                    page.goto(url, wait_until="domcontentloaded", timeout=timeout)
                except Exception as exc:
                    if live:
                        live.command_failed(0, exc, time.monotonic() - navigation_started)
                    raise
                if live:
                    live.command_finished(0, time.monotonic() - navigation_started)
                if live:
                    live.update(status='running', message='Page loaded', url=page.url)

                def capture(label: str, element=None) -> str:
                    filename = _safe_filename(f"{node['id']}_{label}_{len(screenshots)+1}", ".png")
                    dest = artifacts / filename
                    if element is not None:
                        element.screenshot(path=str(dest), timeout=timeout)
                    else:
                        page.screenshot(path=str(dest), full_page=False, timeout=timeout)
                    screenshots.append(filename)
                    if live:
                        live.frame(filename, step=len(log), label=label, url=page.url)
                    return filename

                def smooth_move(x: float, y: float):
                    conf = attached.get("mouse", {})
                    steps = _positive(conf.get("steps", 18), "mouse steps", 1, 120)
                    duration_ms = _positive(conf.get("duration_ms", 300), "mouse duration", 0, 5000)
                    # Smoothstep easing for ordinary UI actions, not a
                    # fingerprint-evasion or CAPTCHA-bypass mechanism.
                    old_x, old_y = pointer[0], pointer[1]
                    for step in range(1, steps + 1):
                        t = step / steps
                        u = t * t * (3 - 2 * t)
                        px = old_x + (x - old_x) * u
                        py = old_y + (y - old_y) * u
                        page.mouse.move(px, py)
                        if duration_ms:
                            page.wait_for_timeout(duration_ms / steps)
                    pointer[0], pointer[1] = x, y

                pointer = [0.0, 0.0]

                def check_verification():
                    challenge = _captcha_element(page)
                    if challenge is None:
                        return
                    capture("verification", challenge)
                    if "verification" not in attached:
                        raise RuntimeError("CAPTCHA detected; no verification handler is attached")
                    if headless:
                        raise RuntimeError("CAPTCHA requires human verification: select headed mode")
                    # A person must interact with the visible browser. We do not
                    # synthesize mouse events to solve or bypass CAPTCHA.
                    deadline = time.monotonic() + verification_wait
                    if live:
                        live.update(status='waiting', step=len(log), message='Human verification required', url=page.url)
                    progress(len(log), "Waiting for human verification")
                    while time.monotonic() < deadline:
                        page.wait_for_timeout(750)
                        if _captcha_element(page) is None:
                            if live:
                                live.update(status='running', message='Verification finished', url=page.url)
                            return
                    raise TimeoutError("Human verification timed out")

                if live:
                    capture('initial')
                progress(0, "Browser ready")
                for index, action in enumerate(actions):
                    check_verification()
                    command = action["command"]
                    target = action.get("target")
                    if live:
                        live.update(status='running', step=index, message=f'Executing {command}', url=page.url)
                        live.command_started(index + 1, command, target)
                    detail = {"index": index + 1, "command": command, "status": "completed"}
                    started = time.monotonic()
                    last_error: Exception | None = None
                    for attempt in range(retries + 1):
                        try:
                            loc = _selector(page, target) if target is not None else None
                            text = _interpolate(str(action.get("value", "")), outputs)
                            if command == "navigate":
                                page.goto(_public_url(_interpolate(str(action.get("url", "")), outputs), hosts), wait_until="domcontentloaded", timeout=timeout)
                            elif command in {"click", "double_click", "hover", "fill", "type", "press", "select", "check", "uncheck", "wait", "extract_text"}:
                                if loc is None:
                                    raise ValueError(f"{command} requires target")
                                if command == "click": loc.click(timeout=timeout)
                                elif command == "double_click": loc.dblclick(timeout=timeout)
                                elif command == "hover": loc.hover(timeout=timeout)
                                elif command == "fill": loc.fill(text, timeout=timeout)
                                elif command == "type":
                                    if "keyboard" not in attached:
                                        raise ValueError("Connect Keyboard Controller to use type")
                                    delay = _positive(attached["keyboard"].get("typing_delay_ms", 0), "typing_delay_ms", 0, 250)
                                    loc.press_sequentially(text, delay=delay, timeout=timeout)
                                elif command == "press": loc.press(text, timeout=timeout)
                                elif command == "select": loc.select_option(text, timeout=timeout)
                                elif command == "check": loc.check(timeout=timeout)
                                elif command == "uncheck": loc.uncheck(timeout=timeout)
                                elif command == "wait": loc.wait_for(state=str(action.get("state", "visible")), timeout=timeout)
                                elif command == "extract_text":
                                    extracted[str(action.get("key", f"text_{index+1}"))[:80]] = loc.inner_text(timeout=timeout)[:10000]
                            elif command == "mouse_move":
                                if "mouse" not in attached:
                                    raise ValueError("Connect Mouse Controller to use mouse_move")
                                if loc is not None:
                                    bounds = loc.bounding_box(timeout=timeout)
                                    if bounds is None: raise ValueError("Target is not visible")
                                    smooth_move(bounds["x"]+bounds["width"]/2, bounds["y"]+bounds["height"]/2)
                                else:
                                    smooth_move(float(action["x"]), float(action["y"]))
                            elif command == "mouse_drag":
                                if "mouse" not in attached:
                                    raise ValueError("Connect Mouse Controller to use mouse_drag")
                                smooth_move(float(action["start_x"]), float(action["start_y"]))
                                page.mouse.down()
                                try: smooth_move(float(action["end_x"]), float(action["end_y"]))
                                finally: page.mouse.up()
                            elif command == "scroll":
                                page.mouse.wheel(0, _positive(action.get("pixels", 600), "pixels", -5000, 5000))
                            elif command == "screenshot":
                                capture(f"step_{index+1}", loc)
                            elif command == "back": page.go_back(wait_until="domcontentloaded", timeout=timeout)
                            elif command == "forward": page.go_forward(wait_until="domcontentloaded", timeout=timeout)
                            elif command == "reload": page.reload(wait_until="domcontentloaded", timeout=timeout)
                            elif command == "new_tab":
                                page = context.new_page()
                                selected_tab = len(context.pages) - 1
                                if action.get("url"):
                                    page.goto(_public_url(_interpolate(str(action["url"]), outputs), hosts), wait_until="domcontentloaded", timeout=timeout)
                            elif command == "switch_tab":
                                selected_tab = _positive(action.get("tab", 0), "tab", 0, len(context.pages)-1)
                                page = context.pages[selected_tab]
                            elif command == "download":
                                if "download" not in attached:
                                    raise ValueError("Connect Browser Download to use download command")
                                if loc is None: raise ValueError("Download requires button target")
                                with page.expect_download(timeout=timeout) as info:
                                    loc.click(timeout=timeout)
                                item = info.value
                                filename = _safe_filename(f"{index+1}_{item.suggested_filename}", ".bin")
                                destination = artifacts / filename
                                item.save_as(str(destination))
                                size = destination.stat().st_size
                                if size > 250 * 1024 * 1024:
                                    destination.unlink(missing_ok=True)
                                    raise ValueError("Browser download exceeds 250 MB")
                                downloads.append({"file": filename, "bytes": size})
                            last_error = None
                            if live and target is not None:
                                live.element_found(index + 1)
                            break
                        except Exception as exc:
                            last_error = exc
                            if attempt >= retries:
                                break
                            page.wait_for_timeout(retry_delay)
                    if last_error is not None:
                        if live:
                            live.command_failed(index + 1, last_error, time.monotonic() - started)
                        if dev_mode or ("screenshot" in attached and attached["screenshot"].get("on_error", True)):
                            try: capture(f"error_{index+1}")
                            except Exception: pass
                        raise RuntimeError(f"Browser command {index+1} ({command}) failed: {type(last_error).__name__}") from last_error
                    detail["elapsed_seconds"] = round(time.monotonic()-started, 3)
                    log.append(detail)
                    if live:
                        live.command_finished(index + 1, detail["elapsed_seconds"])
                    if dev_mode or attached.get("live_preview", {}).get("each_step"):
                        capture(f"preview_{index+1}")
                    check_verification()
                    if live:
                        live.update(status='running', step=index+1, message=f'Completed {command}', url=page.url)
                    progress(index+1, f"Completed {command} ({index+1}/{len(actions)})")

                if attached.get("screenshot", {}).get("at_end"):
                    capture("final")
                inspection = {}
                if attached.get("inspector", {}).get("enabled"):
                    limit = _positive(attached["inspector"].get("max_text_chars", 3000), "max_text_chars", 100, 10000)
                    inspection = {"title": page.title()[:500], "text": page.locator("body").inner_text()[:limit]}
                parent = Path(workdir).resolve()
                project_id = parent.parent.parent.name
                run_id = parent.name
                artifact_base = f"/api/v1/workflows/{project_id}/runs/{run_id}/browser-artifacts"
                if live:
                    live.finish('completed', 'Browser execution completed')
                return {"status": "completed", "url": page.url, "title": page.title()[:500],
                        "actions_completed": len(log), "log": log, "extracted": extracted,
                        "screenshots": screenshots,
                        "screenshot_urls": [f"{artifact_base}/{name}" for name in screenshots],
                        "downloads": [{**entry, "url": f"{artifact_base}/{entry['file']}"} for entry in downloads],
                        "inspection": inspection, "attached_ports": sorted(attached),
                        "artifacts_dir": "browser"}
            except BaseException as exc:
                if live:
                    live.finish('failed', f'Browser stopped: {type(exc).__name__}')
                raise
            finally:
                browser.close()
