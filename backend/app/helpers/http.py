from __future__ import annotations
import hashlib
import base64
import ipaddress
import json
import math
import os
import re
import socket
import subprocess
import tempfile
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any, Callable
from app.workflows.model_constants import (OPENAI_TEXT_MODELS, OPENAI_IMAGE_MODELS,
    OPENAI_MODERATION_MODELS, OPENAI_REASONING_EFFORTS, GEMINI_TEXT_MODELS, GEMINI_IMAGE_MODELS)



def value_path(value: Any, path: str) -> Any:
    """Resolve a bounded dot path inside JSON-compatible data without eval."""
    if not path:
        return value
    parts = path.strip().split(".")
    if len(parts) > 16 or any(not re.fullmatch(r"[A-Za-z0-9_-]{1,80}", part) for part in parts):
        raise ValueError("Field must be a safe dot path")
    for part in parts:
        if isinstance(value, dict) and part in value:
            value = value[part]
        elif isinstance(value, list) and part.isdigit() and int(part) < len(value):
            value = value[int(part)]
        else:
            return None
    return value


def safe_workflow_http_url(raw_url: str, query: Any = None) -> str:
    """Validate an outbound integration URL against an explicit HTTPS allowlist."""
    if not isinstance(raw_url, str) or len(raw_url) > 2048:
        raise ValueError("HTTP Request URL is invalid")
    parsed = urllib.parse.urlsplit(raw_url.strip())
    if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password or parsed.fragment:
        raise ValueError("HTTP Request requires an HTTPS URL without credentials or fragments")
    if parsed.port not in (None, 443):
        raise ValueError("HTTP Request only supports HTTPS port 443")
    allowed = {host.strip().casefold() for host in os.environ.get("CLIPTORA_WORKFLOW_HTTP_ALLOWED_HOSTS", "").split(",") if host.strip()}
    if parsed.hostname.casefold() not in allowed:
        raise ValueError("HTTP Request host is not in CLIPTORA_WORKFLOW_HTTP_ALLOWED_HOSTS")
    addresses = socket.getaddrinfo(parsed.hostname, 443, type=socket.SOCK_STREAM)
    if not addresses or any(not ipaddress.ip_address(address[4][0]).is_global for address in addresses):
        raise ValueError("HTTP Request blocks private, local, reserved and loopback addresses")
    pairs = urllib.parse.parse_qsl(parsed.query, keep_blank_values=True)
    if query not in (None, {}):
        if not isinstance(query, dict) or len(query) > 100:
            raise ValueError("HTTP Request query must be an object with at most 100 fields")
        for key, value in query.items():
            if isinstance(value, (dict, list)):
                value = json.dumps(value, ensure_ascii=False, separators=(",", ":"))
            pairs.append((str(key)[:200], str(value)[:4000]))
    return urllib.parse.urlunsplit((parsed.scheme, parsed.netloc, parsed.path or "/", urllib.parse.urlencode(pairs), ""))


class NoWorkflowRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise ValueError("HTTP Request redirects are disabled")


def execute_http_request(cfg: dict[str, Any]) -> dict[str, Any]:
    url = safe_workflow_http_url(str(cfg.get("url", "")), cfg.get("query", {}))
    method = str(cfg.get("method", "GET")).upper()
    if method not in {"GET", "POST", "PUT", "PATCH", "DELETE"}:
        raise ValueError("Unsupported HTTP method")
    timeout = int(cfg.get("timeout_seconds", 30))
    if not 1 <= timeout <= 120:
        raise ValueError("HTTP timeout must be between 1 and 120 seconds")
    raw_headers = cfg.get("headers", {})
    if not isinstance(raw_headers, dict) or len(raw_headers) > 50:
        raise ValueError("HTTP headers must be an object with at most 50 fields")
    blocked = {"authorization", "proxy-authorization", "cookie", "set-cookie", "host", "content-length"}
    headers = {"Accept": "application/json, text/plain;q=0.9", "User-Agent": "CLIPTORA-Workflow/1.0"}
    for key, value in raw_headers.items():
        name = str(key).strip()
        if not re.fullmatch(r"[A-Za-z0-9-]{1,80}", name) or name.casefold() in blocked:
            raise ValueError(f"HTTP header is not allowed: {name}")
        text = str(value)
        if "\r" in text or "\n" in text or len(text) > 4000:
            raise ValueError(f"HTTP header value is invalid: {name}")
        headers[name] = text
    data = None
    if method in {"POST", "PUT", "PATCH"}:
        data = json.dumps(cfg.get("body", {}), ensure_ascii=False, allow_nan=False).encode("utf-8")
        if len(data) > 1_000_000:
            raise ValueError("HTTP request body exceeds 1 MB")
        headers.setdefault("Content-Type", "application/json")
    request = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        response = urllib.request.build_opener(NoWorkflowRedirect()).open(request, timeout=timeout)
        with response:
            raw = response.read(5_000_001)
            if len(raw) > 5_000_000:
                raise ValueError("HTTP response exceeds 5 MB")
            content_type = response.headers.get_content_type()
            charset = response.headers.get_content_charset() or "utf-8"
            response_format = str(cfg.get("response_format", "auto"))
            if response_format not in {"auto", "json", "text"}:
                raise ValueError("HTTP response format must be auto, json or text")
            if response_format == "json" or (response_format == "auto" and content_type == "application/json"):
                body: Any = json.loads(raw.decode(charset)) if raw else None
            else:
                body = raw.decode(charset, errors="replace")
            return {"response": {"status": response.status, "url": url, "content_type": content_type, "body": body}}
    except urllib.error.HTTPError as exc:
        raise RuntimeError(f"HTTP Request failed with status {exc.code}") from exc
    except urllib.error.URLError as exc:
        raise RuntimeError(f"HTTP Request transport failed: {exc.reason}") from exc
