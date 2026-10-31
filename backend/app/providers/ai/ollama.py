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

from app.helpers.transcript import input_path
from app.helpers.http import NoWorkflowRedirect


def ollama_base_url() -> str:
    raw = os.environ.get("OLLAMA_BASE_URL", "http://host.docker.internal:11434").strip().rstrip("/")
    parsed = urllib.parse.urlsplit(raw)
    allowed_hosts = {"localhost", "127.0.0.1", "host.docker.internal"}
    allowed_hosts.update(host.strip().casefold() for host in os.environ.get("CLIPTORA_OLLAMA_ALLOWED_HOSTS", "").split(",") if host.strip())
    if parsed.scheme not in {"http", "https"} or not parsed.hostname or parsed.hostname.casefold() not in allowed_hosts:
        raise ValueError("OLLAMA_BASE_URL must use an explicitly allowed local Ollama host")
    if parsed.username or parsed.password or parsed.query or parsed.fragment or parsed.path not in {"", "/"}:
        raise ValueError("OLLAMA_BASE_URL cannot contain credentials, a path, query or fragment")
    if parsed.port is not None and not 1 <= parsed.port <= 65535:
        raise ValueError("OLLAMA_BASE_URL port is invalid")
    return raw


def ollama_request(path: str, payload: dict[str, Any] | None = None, timeout: int = 180) -> dict[str, Any]:
    if path not in {"api/chat", "api/tags"}:
        raise ValueError("Ollama API path is not allowed")
    request = urllib.request.Request(
        f"{ollama_base_url()}/{path}",
        data=None if payload is None else json.dumps(payload, ensure_ascii=False, allow_nan=False).encode("utf-8"),
        headers={"Content-Type": "application/json", "User-Agent": "CLIPTORA-Workflow/1.0"},
        method="GET" if payload is None else "POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            result = json.load(response)
        if not isinstance(result, dict):
            raise ValueError("Ollama returned a non-object response")
        return result
    except urllib.error.HTTPError as exc:
        try:
            detail = exc.read(4096).decode("utf-8", errors="replace")
        except Exception:
            detail = str(exc)
        raise RuntimeError(f"Ollama request failed ({exc.code}): {detail[:500]}") from exc
    except (urllib.error.URLError, TimeoutError, ValueError) as exc:
        raise RuntimeError(f"Ollama is unavailable at {ollama_base_url()}: {str(exc)[:300]}") from exc


def ollama_status() -> dict[str, Any]:
    try:
        base_url = ollama_base_url()
        result = ollama_request("api/tags", timeout=3)
        models = [str(item.get("name") or item.get("model")) for item in result.get("models", []) if isinstance(item, dict) and (item.get("name") or item.get("model"))]
        return {"configured": True, "reachable": True, "base_url": base_url, "models": models[:200]}
    except (RuntimeError, ValueError):
        return {"configured": False, "reachable": False, "base_url": os.environ.get("OLLAMA_BASE_URL", "http://host.docker.internal:11434").strip(), "models": []}


def fetch_public_ollama_image(raw_url: str) -> str:
    parsed = urllib.parse.urlsplit(raw_url.strip())
    if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password or parsed.fragment or parsed.port not in {None, 443}:
        raise ValueError("Ollama image inputs must be public HTTPS URLs")
    addresses = socket.getaddrinfo(parsed.hostname, 443, type=socket.SOCK_STREAM)
    if not addresses or any(not ipaddress.ip_address(address[4][0]).is_global for address in addresses):
        raise ValueError("Ollama image URL cannot resolve to a private, local or reserved address")
    request = urllib.request.Request(raw_url, headers={"Accept": "image/png,image/jpeg,image/webp", "User-Agent": "CLIPTORA-Workflow/1.0"})
    try:
        response = urllib.request.build_opener(NoWorkflowRedirect()).open(request, timeout=30)
        with response:
            content_type = response.headers.get_content_type()
            if content_type not in {"image/png", "image/jpeg", "image/webp"}:
                raise ValueError("Ollama image URL returned an unsupported content type")
            raw = response.read(10_000_001)
        if not raw or len(raw) > 10_000_000:
            raise ValueError("Ollama image must contain between 1 byte and 10 MB")
        return base64.b64encode(raw).decode("ascii")
    except urllib.error.HTTPError as exc:
        raise RuntimeError(f"Ollama image download failed with status {exc.code}") from exc
    except urllib.error.URLError as exc:
        raise RuntimeError(f"Ollama image download failed: {exc.reason}") from exc


def ollama_action(cfg: dict[str, Any], outputs: dict[str, Any]) -> dict[str, Any]:
    action = str(cfg.get("action") or "message_model")
    if action not in {"message_model", "analyze_image"}:
        raise ValueError(f"Ollama action '{action}' is not supported by this CLIPTORA backend")
    model = str(cfg.get("model") or "gemma3").strip()
    if not re.fullmatch(r"[A-Za-z0-9._:/-]{1,160}", model):
        raise ValueError("Ollama model name is invalid")
    prompt = str(cfg.get("prompt", "")).strip()
    if action == "analyze_image" and not prompt:
        prompt = "What is in this image?"
    input_path_value = str(cfg.get("input_path", "")).strip()
    if input_path_value:
        prompt = f"{prompt}\n\nInput data:\n{json.dumps(input_path(outputs, input_path_value), ensure_ascii=False, separators=(',', ':'))}"
    if not prompt or len(prompt) > 200_000:
        raise ValueError("Ollama text input must contain between 1 and 200,000 characters")
    temperature = float(cfg.get("temperature", 0.2))
    max_tokens = int(cfg.get("max_output_tokens", 1000))
    if not math.isfinite(temperature) or not 0 <= temperature <= 2:
        raise ValueError("Ollama temperature must be between 0 and 2")
    if not 1 <= max_tokens <= 32_768:
        raise ValueError("Ollama maximum output tokens must be between 1 and 32,768")
    user_message: dict[str, Any] = {"role": "user", "content": prompt}
    if action == "analyze_image":
        urls = [line.strip() for line in str(cfg.get("image_urls", "")).splitlines() if line.strip()]
        if not 1 <= len(urls) <= 4:
            raise ValueError("Analyze image requires between 1 and 4 public HTTPS image URLs")
        user_message["images"] = [fetch_public_ollama_image(url) for url in urls]
    messages: list[dict[str, Any]] = []
    system_prompt = str(cfg.get("system_prompt", "")).strip()
    if system_prompt:
        messages.append({"role": "system", "content": system_prompt[:100_000]})
    messages.append(user_message)
    result = ollama_request("api/chat", {"model": model, "messages": messages, "stream": False, "options": {"temperature": temperature, "num_predict": max_tokens}})
    if not bool(cfg.get("simplify_output", True)):
        return result
    message = result.get("message") if isinstance(result.get("message"), dict) else {}
    return {"text": str(message.get("content", "")), "model": str(result.get("model", model)), "done_reason": result.get("done_reason"), "prompt_tokens": result.get("prompt_eval_count"), "output_tokens": result.get("eval_count"), "total_duration": result.get("total_duration")}


class OllamaProvider:
    """AI provider adapter with a stable service interface."""

    def execute(self, settings: dict[str, Any], inputs: dict[str, Any]) -> dict[str, Any]:
        return ollama_action(settings, inputs)
