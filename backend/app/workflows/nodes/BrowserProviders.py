"""CLIPTORA: Playwright and Selenium browser provider nodes.

Keep the existing Browser.py tool nodes (browser.commands, browser.mouse, etc.).
This module adds two browser entry nodes. Helpers are only consumed if explicitly
listed in depends_on; no automatic discovery of unconnected helpers.
"""
from __future__ import annotations

import re
import time
from pathlib import Path
from typing import Any

from app.workflows.Node import Node
from app.workflows.MediaStorage import run_media_dir
from app.workflows.BrowserLiveState import BrowserLiveState
from app.workflows.nodes.Browser import (
    BrowserAutomationNode, HELPERS, COMMANDS, _public_url,
    _interpolate, _positive, _safe_filename,
)


def _definition(label: str, engine: str) -> dict:
    return {
        "label": label,
        "icon": "lucide:globe",
        "settings": {
            "url": "https://example.com",
            "browser": engine,
            "headless": True,
            "dev_mode": False,
            "timeout_ms": 15000,
            "max_actions": 60,
            "allowed_hosts": ["example.com"],
            "actions": [],
            "attachments": {},
        },
        "input_types": ["json"],
        "output_types": ["json"],
    }


def _fields() -> dict:
    return {
        "url": {"type": "string", "title": "Start URL", "expression": True},
        "headless": {
            "type": "boolean",
            "title": "Run in background (headless)",
            "description": "Turn this off to open a visible browser window, like Selenium.",
        },
        "dev_mode": {
            "type": "boolean",
            "title": "Dev Mode",
            "description": "Show live screenshots and per-command selector diagnostics.",
        },
        "timeout_ms": {"type": "integer", "title": "Action Timeout (ms)", "minimum": 1000, "maximum": 60000},
        "max_actions": {"type": "integer", "title": "Max Commands", "minimum": 1, "maximum": 100},
        "allowed_hosts": {"type": "array", "title": "Allowed HTTPS Hosts", "items": {"type": "string"}},
        "actions": {"type": "array", "title": "Built-in Commands", "items": {"type": "object"}},
        "attachments": {"type": "object", "title": "Attached Node IDs"},
    }


def _inputs(node: dict, outputs: dict) -> tuple[list[dict], dict[str, dict], list[str]]:
    cfg = node.get("settings") or {}
    deps = node.get("depends_on") or []
    attachments = cfg.get("attachments") or {}
    if not isinstance(attachments, dict):
        raise ValueError("attachments must be an object")
    connected = {}
    for ident in deps:
        row = outputs.get(ident)
        if not isinstance(row, dict):
            continue
        port = row.get("attachment_type")
        if port in HELPERS:
            if port in connected:
                raise ValueError(f"Multiple {port} attachments")
            connected[port] = row.get("config") or {}
    for port, ident in attachments.items():
        row = outputs.get(ident)
        if port not in HELPERS or ident not in deps or not isinstance(row, dict) or row.get("attachment_type") != port:
            raise ValueError(f"Attachment {port} must reference a connected {port} node")
    actions = cfg.get("actions") or []
    if not isinstance(actions, list):
        raise ValueError("actions must be an array")
    actions = list(actions)
    if "commands" in connected:
        extra = connected["commands"].get("actions") or []
        if not isinstance(extra, list):
            raise ValueError("commands attachment must have actions array")
        actions += extra
    max_actions = _positive(cfg.get("max_actions", 60), "max_actions", 1, 100)
    if len(actions) > max_actions:
        raise ValueError("Too many browser commands")
    for action in actions:
        if not isinstance(action, dict) or action.get("command") not in COMMANDS:
            raise ValueError("Unsupported browser command")
    hosts = cfg.get("allowed_hosts")
    if not isinstance(hosts, list) or not 1 <= len(hosts) <= 30 or any(
        not isinstance(h, str) or not re.fullmatch(r"[A-Za-z0-9.-]{1,253}", h)
        for h in hosts
    ):
        raise ValueError("Configure between 1 and 30 allowed HTTPS hosts")
    return actions, connected, [h.casefold().rstrip(".") for h in hosts]


class BrowserProvidersNode(Node):
    family = "browser_providers"
    group = "Browser Automation"
    icon = "lucide:globe"
    operations = {
        "browser.playwright": _definition("Playwright Browser", "chromium"),
        "browser.selenium": _definition("Selenium Browser", "chrome"),
    }
    parameter_fields = {
        "browser.playwright": {**_fields(), "browser": {"type": "string", "title": "Engine", "enum": ["chromium", "firefox", "webkit"]}},
        "browser.selenium": {**_fields(), "browser": {"type": "string", "title": "Engine", "enum": ["chrome", "firefox", "edge"]}},
    }

    def execute_operation(self, operation, node, outputs, source, workdir):
        if operation == "browser.playwright":
            _inputs(node, outputs)
            return BrowserAutomationNode._run(node, outputs, workdir)
        if operation == "browser.selenium":
            return self._selenium(node, outputs, Path(workdir))
        raise ValueError(f"Unknown Browser Provider: {operation}")

    @staticmethod
    def _selenium(node: dict, outputs: dict, workdir: Path) -> dict:
        try:
            from selenium import webdriver
            from selenium.webdriver.common.by import By
            from selenium.webdriver.support.ui import WebDriverWait, Select
            from selenium.webdriver.support import expected_conditions as EC
            from selenium.webdriver.common.action_chains import ActionChains
            from selenium.webdriver.common.keys import Keys
        except ImportError as exc:
            raise RuntimeError("Install Selenium: python -m pip install selenium") from exc

        cfg = node.get("settings") or {}
        actions, attached, hosts = _inputs(node, outputs)
        engine = str(cfg.get("browser", "chrome")).lower()
        if engine not in {"chrome", "firefox", "edge"}:
            raise ValueError("Selenium supports chrome, firefox, edge")
        timeout_ms = _positive(cfg.get("timeout_ms", 15000), "timeout_ms", 1000, 60000)
        timeout = timeout_ms / 1000
        url = _public_url(_interpolate(str(cfg.get("url", "")), outputs), hosts)
        headless = bool(cfg.get("headless", True))
        dev_mode = bool(cfg.get("dev_mode", False))

        if engine == "chrome":
            opts = webdriver.ChromeOptions()
            if headless:
                opts.add_argument("--headless=new")
            driver = webdriver.Chrome(options=opts)
        elif engine == "edge":
            opts = webdriver.EdgeOptions()
            if headless:
                opts.add_argument("--headless=new")
            driver = webdriver.Edge(options=opts)
        else:
            opts = webdriver.FirefoxOptions()
            if headless:
                opts.add_argument("-headless")
            driver = webdriver.Firefox(options=opts)

        output_dir = run_media_dir(workdir) / "browser"
        output_dir.mkdir(parents=True, exist_ok=True)
        log: list[dict[str, Any]] = []
        images: list[str] = []
        extracted: dict[str, str] = {}
        callback = node.get("_progress_callback")
        project_id = workdir.parent.parent.name
        run_id = workdir.name
        url_base = f"/api/v1/workflows/{project_id}/runs/{run_id}/browser-artifacts"
        live = BrowserLiveState(workdir, node['id'], 'selenium', len(actions)) if dev_mode or 'live_preview' in attached else None

        def ensure_url() -> None:
            actual = driver.current_url
            if actual and actual != "about:blank":
                _public_url(actual, hosts)

        def capture(label: str, element=None) -> str:
            name = _safe_filename(f"{node['id']}_{label}_{len(images)+1}", ".png")
            path = output_dir / name
            ok = element.screenshot(str(path)) if element is not None else driver.save_screenshot(str(path))
            if not ok:
                raise RuntimeError("Screenshot failed")
            images.append(name)
            if live:
                live.frame(name, step=len(log), label=label, url=driver.current_url)
            return name

        def locate(target: Any):
            if isinstance(target, str):
                by, query = By.CSS_SELECTOR, target
            elif isinstance(target, dict):
                mode = target.get("strategy", "css")
                val = str(target.get("value", ""))
                mapping = {
                    "css": By.CSS_SELECTOR,
                    "text": By.XPATH,
                    "label": By.XPATH,
                    "placeholder": By.CSS_SELECTOR,
                    "role": By.CSS_SELECTOR,
                }
                if mode not in mapping:
                    raise ValueError(f"Unsupported selector strategy: {mode}")
                if mode == "text":
                    by, query = By.XPATH, f"//*[normalize-space(text())={_xpath_literal(val)}]"
                elif mode == "label":
                    by, query = By.XPATH, f"//label[normalize-space(.)={_xpath_literal(val)}]"
                elif mode == "role":
                    role = str(target.get("role", ""))
                    if not re.fullmatch(r"[a-zA-Z-]{1,40}", role):
                        raise ValueError("Invalid role selector")
                    by, query = By.CSS_SELECTOR, f'[role="{role}"]'
                elif mode == "placeholder":
                    from selenium.webdriver.common.by import By as _By
                    by, query = _By.XPATH, f"//*[@placeholder={_xpath_literal(val)}]"
                else:
                    by, query = By.CSS_SELECTOR, val
            else:
                raise ValueError("Target must be CSS string or selector object")
            if not query or len(query) > 1000:
                raise ValueError("Invalid selector")
            return WebDriverWait(driver, timeout).until(EC.presence_of_element_located((by, query)))

        def progress(index: int, command: str) -> None:
            if callable(callback):
                callback({
                    "stage": "browser", "message": f"Selenium: {command}",
                    "progress": round(100 * index / max(1, len(actions)), 2),
                    "processed": index, "total": len(actions), "unit": "actions",
                })

        def check_verification() -> None:
            if "verification" not in attached:
                return
            selectors = (
                'iframe[src*="recaptcha"]', 'iframe[src*="hcaptcha"]',
                'iframe[src*="challenges.cloudflare.com"]', '.g-recaptcha', '.h-captcha', '.cf-turnstile',
            )
            found = next((e for sel in selectors for e in driver.find_elements(By.CSS_SELECTOR, sel) if e.is_displayed()), None)
            if found is None:
                return
            capture("verification", found)
            if live:
                live.update(status='waiting', message='Human verification required', url=driver.current_url)
            if headless:
                raise RuntimeError("Human verification requires headless=false")
            limit = _positive(attached["verification"].get("wait_seconds", 120), "wait_seconds", 5, 300)
            until = time.monotonic() + limit
            while time.monotonic() < until:
                time.sleep(1)
                if not any(e.is_displayed() for sel in selectors for e in driver.find_elements(By.CSS_SELECTOR, sel)):
                    if live:
                        live.update(status='running', message='Verification finished', url=driver.current_url)
                    return
            raise RuntimeError("Human verification timed out")

        try:
            driver.set_page_load_timeout(timeout)
            navigation_started = time.monotonic()
            if live:
                live.command_started(0, 'open_page')
            try:
                driver.get(url)
            except Exception as exc:
                if live:
                    live.command_failed(0, exc, time.monotonic() - navigation_started)
                raise
            if live:
                live.command_finished(0, time.monotonic() - navigation_started)
            ensure_url()
            if live:
                live.update(status='running', url=driver.current_url, message='Page loaded')
                capture('initial')
            for index, action in enumerate(actions, 1):
                ensure_url()
                check_verification()
                cmd = action["command"]
                target = action.get("target")
                if live:
                    live.update(status='running', step=index-1, message=f'Executing {cmd}', url=driver.current_url)
                    live.command_started(index, cmd, target)
                value = _interpolate(str(action.get("value", "")), outputs)
                started = time.monotonic()
                retries = _positive(attached.get("error_handler", {}).get("retries", 0), "retries", 0, 3)
                for attempt in range(retries + 1):
                    try:
                        elem = locate(target) if target is not None else None
                        if cmd == "navigate":
                            driver.get(_public_url(_interpolate(str(action.get("url", "")), outputs), hosts))
                        elif cmd in {"click", "double_click", "hover", "fill", "type", "press", "select", "check", "uncheck", "wait", "extract_text"}:
                            if elem is None:
                                raise ValueError(f"{cmd} requires target")
                            if cmd == "click": elem.click()
                            elif cmd == "double_click": ActionChains(driver).double_click(elem).perform()
                            elif cmd == "hover": ActionChains(driver).move_to_element(elem).perform()
                            elif cmd == "fill": elem.clear(); elem.send_keys(value)
                            elif cmd == "type":
                                if "keyboard" not in attached:
                                    raise ValueError("Connect Keyboard Controller")
                                delay = _positive(attached["keyboard"].get("typing_delay_ms", 0), "typing_delay_ms", 0, 250) / 1000
                                for char in value:
                                    elem.send_keys(char)
                                    if delay: time.sleep(delay)
                            elif cmd == "press":
                                keys = {"ENTER": Keys.ENTER, "TAB": Keys.TAB, "ESCAPE": Keys.ESCAPE, "BACKSPACE": Keys.BACKSPACE}
                                elem.send_keys(keys.get(value.upper(), value))
                            elif cmd == "select": Select(elem).select_by_value(value)
                            elif cmd == "check" and not elem.is_selected(): elem.click()
                            elif cmd == "uncheck" and elem.is_selected(): elem.click()
                            elif cmd == "wait": WebDriverWait(driver, timeout).until(lambda d: elem.is_displayed())
                            elif cmd == "extract_text": extracted[str(action.get("key", f"text_{index}"))[:80]] = elem.text[:10000]
                        elif cmd == "scroll":
                            pixels = int(action.get("pixels", 600))
                            if not -5000 <= pixels <= 5000: raise ValueError("Scroll outside bounds")
                            driver.execute_script("window.scrollBy(0,arguments[0])", pixels)
                        elif cmd == "mouse_move":
                            if "mouse" not in attached: raise ValueError("Connect Mouse Controller")
                            if elem is None: raise ValueError("Selenium mouse_move requires element target")
                            ActionChains(driver).move_to_element(elem).perform()
                        elif cmd == "mouse_drag":
                            if "mouse" not in attached: raise ValueError("Connect Mouse Controller")
                            if elem is None: raise ValueError("Selenium mouse_drag requires source target")
                            dest = locate(action.get("destination"))
                            ActionChains(driver).drag_and_drop(elem, dest).perform()
                        elif cmd == "screenshot": capture(f"step_{index}", elem)
                        elif cmd == "back": driver.back()
                        elif cmd == "forward": driver.forward()
                        elif cmd == "reload": driver.refresh()
                        elif cmd == "new_tab":
                            driver.switch_to.new_window("tab")
                            if action.get("url"):
                                driver.get(_public_url(_interpolate(str(action["url"]), outputs), hosts))
                        elif cmd == "switch_tab":
                            tab = _positive(action.get("tab", 0), "tab", 0, len(driver.window_handles) - 1)
                            driver.switch_to.window(driver.window_handles[tab])
                        elif cmd == "download":
                            raise ValueError("Selenium downloads require a dedicated configured download profile; use Playwright Browser for downloads")
                        else:
                            raise ValueError(f"Unsupported Selenium command: {cmd}")
                        ensure_url()
                        if live and target is not None:
                            live.element_found(index)
                        break
                    except Exception as exc:
                        if attempt == retries:
                            if live:
                                live.command_failed(index, exc, time.monotonic() - started)
                            if dev_mode or attached.get("screenshot", {}).get("on_error"):
                                try: capture(f"error_{index}")
                                except Exception: pass
                            raise RuntimeError(f"Selenium action {index} ({cmd}) failed") from exc
                        time.sleep(_positive(attached.get("error_handler", {}).get("retry_delay_ms", 500), "retry_delay_ms", 0, 10000) / 1000)
                log.append({"index": index, "command": cmd, "status": "completed", "elapsed_seconds": round(time.monotonic()-started, 3)})
                if live:
                    live.command_finished(index, log[-1]["elapsed_seconds"])
                if dev_mode or attached.get("live_preview", {}).get("each_step"):
                    capture(f"preview_{index}")
                check_verification()
                if live:
                    live.update(status='running', step=index, message=f'Completed {cmd}', url=driver.current_url)
                progress(index, cmd)
            if attached.get("screenshot", {}).get("at_end"):
                capture("final")
            inspection = {}
            if attached.get("inspector", {}).get("enabled"):
                chars = _positive(attached["inspector"].get("max_text_chars", 3000), "max_text_chars", 100, 10000)
                inspection = {"title": driver.title[:500], "text": driver.find_element(By.TAG_NAME, "body").text[:chars]}
            if live:
                live.finish('completed', 'Browser execution completed')
            return {
                "status": "completed", "provider": "selenium", "url": driver.current_url,
                "title": driver.title[:500], "actions_completed": len(log), "log": log,
                "extracted": extracted, "inspection": inspection,
                "screenshots": images,
                "screenshot_urls": [f"{url_base}/{name}" for name in images],
                "downloads": [], "attached_ports": sorted(attached),
            }
        except BaseException as exc:
            if live:
                live.finish('failed', f'Browser stopped: {type(exc).__name__}')
            raise
        finally:
            driver.quit()


def _xpath_literal(value: str) -> str:
    if "'" not in value:
        return f"'{value}'"
    if '"' not in value:
        return f'"{value}"'
    return "concat(" + ', "\'", '.join(f"'{part}'" for part in value.split("'")) + ")"
