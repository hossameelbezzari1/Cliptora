"""Allowlisted command executors for CLIPTORA.

No arbitrary Python, shell, SQL or local file commands are accepted through HTTP.
User-owned Selenium sessions live exclusively on the server (never sent to JS).
"""
from __future__ import annotations

import ipaddress
import json
import pickle
from pathlib import Path
import os
import re
import socket
import ssl
import urllib.error
import urllib.parse
import urllib.request
from typing import Any


MAX_OUTPUT = 200_000


def _setting(name: str) -> str:
    """Server-only settings; backend/commands.env is deliberately separate from app config."""
    if name in os.environ:
        return os.environ[name]
    file = Path(__file__).resolve().parents[2] / 'commands.env'
    if not file.is_file():
        return ''
    for line in file.read_text(encoding='utf-8').splitlines():
        line = line.strip()
        if not line or line.startswith('#') or '=' not in line:
            continue
        key, value = line.split('=', 1)
        if key.strip() == name:
            return value.strip().strip('\"').strip("'")
    return ''


class _CookieOnlyUnpickler(pickle.Unpickler):
    def find_class(self, module: str, name: str):
        raise pickle.UnpicklingError('Pickle globals/functions are not allowed')


def _local_cookies() -> list[dict[str, str]]:
    """Read only primitive Selenium cookie dictionaries from a server-authorized .pkl.

    No executable pickle globals are supported. Cookies are never sent to the browser UI.
    """
    filename = _setting('CLIPTORA_SELENIUM_COOKIES_PKL')
    if not filename:
        return []
    path = Path(filename)
    if not path.is_file() or path.stat().st_size > 1_000_000:
        raise ValueError('Configured local cookie .pkl file is absent or too large')
    with path.open('rb') as file:
        obj = _CookieOnlyUnpickler(file).load()
    if isinstance(obj, dict):
        obj = obj.get('cookies')
    if not isinstance(obj, list) or len(obj) > 150:
        raise ValueError('Cookie file must be a list of Selenium cookie dictionaries')
    cookies: list[dict[str, str]] = []
    for raw in obj:
        if not isinstance(raw, dict) or not isinstance(raw.get('name'), str) or not isinstance(raw.get('value'), str):
            continue
        domain = str(raw.get('domain', '.youtube.com')).lstrip('.').lower()
        if domain != 'youtube.com' and not domain.endswith('.youtube.com'):
            continue
        cookie = {'name': raw['name'][:150], 'value': raw['value'][:4096], 'domain': domain, 'path': '/'}
        if len(cookie['name']) > 0:
            cookies.append(cookie)
    return cookies


def resolve_path(data: Any, path: str) -> Any:
    """Resolve a simple JSON path e.g. comments.0.text; no eval or code execution."""
    if not isinstance(path, str) or not re.fullmatch(r"[\w-]+(?:\.[\w-]+){0,12}", path):
        raise ValueError("Invalid JSON output path")
    for part in path.split("."):
        if part.startswith("__"):
            raise ValueError("Private Python attributes are not valid JSON paths")
        if isinstance(data, dict):
            data = data[part]
        elif isinstance(data, list) and part.isdecimal():
            data = data[int(part)]
        else:
            raise KeyError("Output path not present")
    return data


def _safe_http_url(url: str) -> str:
    parsed = urllib.parse.urlsplit(url)
    if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password:
        raise ValueError("Only HTTPS URLs without embedded credentials are allowed")
    hosts = {x.strip().lower() for x in _setting("CLIPTORA_COMMAND_ALLOWED_HOSTS").split(",") if x.strip()}
    if not hosts or parsed.hostname.lower() not in hosts:
        raise ValueError("Host is not in CLIPTORA_COMMAND_ALLOWED_HOSTS")
    if parsed.port not in (None, 443):
        raise ValueError("Only HTTPS port 443 is supported")
    # Defense in depth; hostname allowlisting with HTTPS/TLS is the primary control.
    ips = socket.getaddrinfo(parsed.hostname, 443, type=socket.SOCK_STREAM)
    if not ips:
        raise ValueError("Host DNS lookup failed")
    for item in ips:
        ip = ipaddress.ip_address(item[4][0])
        if not ip.is_global:
            raise ValueError("Private, reserved, local and loopback IPs are blocked")
    return url


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise ValueError("HTTP redirects are disabled for automation commands")


def _http_json(config: dict[str, Any], inputs: dict[str, Any]) -> dict[str, Any]:
    url = _safe_http_url(str(inputs.get("url") or config.get("url") or ""))
    method = str(config.get("method", "GET")).upper()
    if method not in {"GET", "POST"}:
        raise ValueError("Only GET and POST are supported")
    body = None
    if method == "POST":
        payload = inputs.get("body", config.get("body", {}))
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        if len(body) > 100_000:
            raise ValueError("Request body is too large")
    headers = {"Accept": "application/json", "User-Agent": "CLIPTORA-Commands/1.0"}
    if body is not None:
        headers["Content-Type"] = "application/json"
    # API tokens are configured in backend/.env, never accepted from clip JSON.
    token = _setting("CLIPTORA_COMMAND_HTTP_TOKEN").strip()
    if token:
        headers["Authorization"] = f"Bearer {token}"
    opener = urllib.request.build_opener(
        urllib.request.ProxyHandler({}), _NoRedirect(), urllib.request.HTTPSHandler(context=ssl.create_default_context())
    )
    request = urllib.request.Request(url, data=body, headers=headers, method=method)
    with opener.open(request, timeout=12) as response:
        if response.status not in range(200, 300):
            raise ValueError("Remote request did not succeed")
        raw = response.read(MAX_OUTPUT + 1)
        if len(raw) > MAX_OUTPUT:
            raise ValueError("Remote JSON response exceeds limit")
        result = json.loads(raw.decode("utf-8"))
    return result if isinstance(result, dict) else {"data": result}


def _youtube_comments(config: dict[str, Any], inputs: dict[str, Any]) -> dict[str, Any]:
    """Read public, visible YouTube comments with an authorized local Chrome profile.

    This does not automate sign-in, bypass CAPTCHA, or deserialize .pkl credentials.
    Selenium is imported only when this specific command is executed.
    """
    url = str(inputs.get("video_url") or config.get("video_url") or "").strip()
    parsed = urllib.parse.urlsplit(url)
    hostname = (parsed.hostname or "").lower()
    if parsed.scheme != "https" or hostname not in {"youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be"}:
        raise ValueError("Enter a valid HTTPS YouTube URL")
    if hostname == "youtu.be":
        video_id = parsed.path.strip("/")
    else:
        video_id = urllib.parse.parse_qs(parsed.query).get("v", [""])[0]
    if not re.fullmatch(r"[A-Za-z0-9_-]{11}", video_id):
        raise ValueError("Could not find a valid YouTube video ID")
    profile = _setting("CLIPTORA_SELENIUM_PROFILE_DIR").strip()
    if profile and not os.path.isdir(profile):
        raise ValueError("Configured local Selenium profile folder does not exist")
    if not profile and not _setting("CLIPTORA_SELENIUM_COOKIES_PKL"):
        raise ValueError("Configure a dedicated Chrome profile or trusted local .pkl cookies file")
    try:
        from selenium import webdriver
        from selenium.webdriver.common.by import By
        from selenium.webdriver.chrome.options import Options
    except ImportError as exc:
        raise ValueError("Install Selenium: pip install selenium>=4.20,<5") from exc
    options = Options()
    if profile:
        options.add_argument(f"--user-data-dir={profile}")
    options.add_argument("--disable-notifications")
    options.add_argument("--window-size=1280,900")
    if _setting("CLIPTORA_SELENIUM_HEADLESS") == "1":
        options.add_argument("--headless=new")
    max_comments = max(1, min(int(config.get("max_comments", 20)), 50))
    from time import monotonic, sleep
    driver = webdriver.Chrome(options=options)
    try:
        driver.set_page_load_timeout(25)
        saved_cookies = _local_cookies()
        if saved_cookies:
            driver.get('https://www.youtube.com/')
            for cookie in saved_cookies:
                try:
                    driver.add_cookie(cookie)
                except Exception:
                    # Expired/incompatible cookies are skipped; never bypass Google login.
                    continue
        driver.get(f"https://www.youtube.com/watch?v={video_id}")
        deadline = monotonic() + 55
        comments: list[dict[str, str]] = []
        seen: set[str] = set()
        while monotonic() < deadline and len(comments) < max_comments:
            driver.execute_script("window.scrollBy(0, 640)")
            sleep(1.1)
            for el in driver.find_elements(By.CSS_SELECTOR, "ytd-comment-thread-renderer"):
                try:
                    text_nodes = el.find_elements(By.CSS_SELECTOR, "#content-text")
                    if not text_nodes:
                        continue
                    txt = text_nodes[0].text.strip()
                    if not txt:
                        continue
                    authors = el.find_elements(By.CSS_SELECTOR, "#author-text")
                    author = authors[0].text.strip() if authors else ""
                    key = f"{author}\n{txt}"
                    if key in seen:
                        continue
                    seen.add(key)
                    comments.append({"author": author[:160], "text": txt[:4000]})
                    if len(comments) >= max_comments:
                        break
                except Exception:
                    continue
        return {"video_id": video_id, "comments": comments, "count": len(comments)}
    finally:
        driver.quit()


def execute(kind: str, config: dict[str, Any], inputs: dict[str, Any]) -> dict[str, Any]:
    if kind == "json_extract":
        data = inputs.get("data", config.get("data", {}))
        path = str(inputs.get("path", config.get("path", "data")))
        return {"value": resolve_path(data, path)}
    if kind == "http_json":
        return _http_json(config, inputs)
    if kind == "selenium_youtube_comments":
        return _youtube_comments(config, inputs)
    raise ValueError("Unsupported or disabled command kind")
