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


def gemini_request(method: str, path: str, payload: dict[str, Any] | None = None, timeout: int = 120) -> dict[str, Any]:
    """Call a Gemini JSON endpoint using the backend-only API key."""
    key = os.environ.get("GEMINI_API_KEY", "").strip()
    if not key:
        raise RuntimeError("GEMINI_API_KEY is missing from the backend environment")
    if method not in {"GET", "POST", "DELETE"} or not re.fullmatch(r"[A-Za-z0-9._~:/?=&%-]{1,500}", path):
        raise ValueError("Gemini API request is invalid")
    data = None if payload is None else json.dumps(payload, ensure_ascii=False, allow_nan=False).encode("utf-8")
    request = urllib.request.Request(
        f"https://generativelanguage.googleapis.com/v1beta/{path.lstrip('/')}",
        data=data,
        headers={"x-goog-api-key": key, "Content-Type": "application/json", "User-Agent": "CLIPTORA-Workflow/1.0"},
        method=method,
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            raw = response.read()
        result = json.loads(raw) if raw else {}
        if not isinstance(result, dict):
            raise ValueError("Gemini returned a non-object response")
        return result
    except urllib.error.HTTPError as exc:
        try:
            detail = exc.read(4096).decode("utf-8", errors="replace")
        except Exception:
            detail = str(exc)
        raise RuntimeError(f"Gemini request failed ({exc.code}): {detail[:500]}") from exc
    except (urllib.error.URLError, ValueError) as exc:
        raise RuntimeError(f"Gemini request failed: {str(exc)[:300]}") from exc


def gemini_prompt(cfg: dict[str, Any], outputs: dict[str, Any]) -> str:
    prompt = str(cfg.get("prompt", "")).strip()
    input_path_value = str(cfg.get("input_path", "")).strip()
    if input_path_value:
        prompt = f"{prompt}\n\nInput data:\n{json.dumps(input_path(outputs, input_path_value), ensure_ascii=False, separators=(',', ':'))}"
    if not prompt or len(prompt) > 200_000:
        raise ValueError("Text input must contain between 1 and 200,000 characters")
    return prompt


def gemini_action(cfg: dict[str, Any], outputs: dict[str, Any]) -> dict[str, Any]:
    action = str(cfg.get("action") or "message_model")
    if action == "message_model":
        prompt = gemini_prompt(cfg, outputs)
        model = str(cfg.get("model") or "gemini-3.8-flash").strip()
        if model not in GEMINI_TEXT_MODELS:
            model = "gemini-3.8-flash"
        max_tokens = int(cfg.get("max_output_tokens", 1000))
        if not 1 <= max_tokens <= 65_536:
            raise ValueError("Gemini maximum output tokens must be between 1 and 65,536")
        payload: dict[str, Any] = {
            "contents": [{"role": "user", "parts": [{"text": prompt}]}],
            "generationConfig": {"maxOutputTokens": max_tokens},
        }
        system_prompt = str(cfg.get("system_prompt", "")).strip()
        if system_prompt:
            payload["systemInstruction"] = {"parts": [{"text": system_prompt[:100_000]}]}
        result = gemini_request("POST", f"models/{model}:generateContent", payload)
        if not bool(cfg.get("simplify_output", True)):
            return result
        candidates = result.get("candidates") or []
        parts = candidates[0].get("content", {}).get("parts", []) if candidates and isinstance(candidates[0], dict) else []
        text = "".join(str(part.get("text", "")) for part in parts if isinstance(part, dict))
        finish_reason = candidates[0].get("finishReason") if candidates and isinstance(candidates[0], dict) else None
        return {"text": text, "model": model, "usage": result.get("usageMetadata", {}), "finish_reason": finish_reason}

    if action == "generate_image":
        prompt = gemini_prompt(cfg, outputs)
        model = str(cfg.get("model") or "gemini-3.1-flash-image").strip()
        if model not in GEMINI_IMAGE_MODELS:
            model = "gemini-3.1-flash-image"
        aspect_ratio = str(cfg.get("image_aspect_ratio") or "1:1")
        if aspect_ratio not in {"1:1", "3:2", "2:3", "4:3", "3:4", "16:9", "9:16"}:
            raise ValueError("Unsupported Gemini image aspect ratio")
        result = gemini_request("POST", f"models/{model}:generateContent", {
            "contents": [{"role": "user", "parts": [{"text": prompt}]}],
            "generationConfig": {"responseModalities": ["TEXT", "IMAGE"], "imageConfig": {"aspectRatio": aspect_ratio}},
        }, timeout=180)
        if not bool(cfg.get("simplify_output", True)):
            return result
        candidates = result.get("candidates") or []
        parts = candidates[0].get("content", {}).get("parts", []) if candidates and isinstance(candidates[0], dict) else []
        images = []
        text_parts = []
        for part in parts:
            if not isinstance(part, dict):
                continue
            if part.get("text"):
                text_parts.append(str(part["text"]))
            inline = part.get("inlineData") or part.get("inline_data")
            if isinstance(inline, dict) and inline.get("data"):
                images.append({"mime_type": inline.get("mimeType") or inline.get("mime_type") or "image/png", "b64_json": inline["data"]})
        return {"images": images, "text": "".join(text_parts), "model": model, "usage": result.get("usageMetadata", {})}

    if action == "create_file_search_store":
        display_name = str(cfg.get("display_name", "")).strip()
        if not 1 <= len(display_name) <= 128:
            raise ValueError("File Search store display name must contain between 1 and 128 characters")
        return gemini_request("POST", "fileSearchStores", {"displayName": display_name, "embeddingModel": "models/gemini-embedding-2"})

    if action == "list_file_search_stores":
        return gemini_request("GET", "fileSearchStores?pageSize=100")

    if action == "delete_file_search_store":
        store_name = str(cfg.get("store_name", "")).strip()
        if not re.fullmatch(r"fileSearchStores/[A-Za-z0-9_-]{1,128}", store_name):
            raise ValueError("File Search store name must look like fileSearchStores/store-id")
        return gemini_request("DELETE", f"{store_name}?force=true")

    raise ValueError(f"Gemini action '{action}' is not supported by this CLIPTORA backend")


class GeminiProvider:
    """AI provider adapter with a stable service interface."""

    def execute(self, settings: dict[str, Any], inputs: dict[str, Any]) -> dict[str, Any]:
        return gemini_action(settings, inputs)
