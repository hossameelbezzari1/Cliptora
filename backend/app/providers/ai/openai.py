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


def openai_json(prompt: str, transcript: str, schema: dict) -> dict:
    key = os.environ.get("OPENAI_API_KEY", "").strip()
    if not key:
        raise RuntimeError("OPENAI_API_KEY is missing. Use mode=offline or configure the API key")
    model = os.environ.get("CLIPTORA_OPENAI_MODEL", "gpt-6.1-sol")
    payload = {"model": model, "messages": [{"role": "system", "content": prompt}, {"role": "user", "content": transcript}],
               "response_format": {"type": "json_schema", "json_schema": {"name": "cliptora_workflow", "strict": True, "schema": schema}}}
    req = urllib.request.Request("https://api.openai.com/v1/chat/completions", data=json.dumps(payload).encode(),
                                 headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"}, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=120) as response:
            result = json.load(response)
        return json.loads(result["choices"][0]["message"]["content"])
    except (urllib.error.HTTPError, urllib.error.URLError, ValueError, KeyError, IndexError) as exc:
        raise RuntimeError(f"AI provider failed: {str(exc)[:200]}") from exc


def openai_chat(cfg: dict[str, Any], outputs: dict[str, Any]) -> dict[str, Any]:
    key = os.environ.get("OPENAI_API_KEY", "").strip()
    if not key:
        raise RuntimeError("OPENAI_API_KEY is missing from the backend environment")
    model = str(cfg.get("model") or os.environ.get("CLIPTORA_OPENAI_MODEL", "gpt-6.1-sol")).strip()
    if not re.fullmatch(r"[A-Za-z0-9._:-]{1,100}", model):
        raise ValueError("OpenAI model name is invalid")
    prompt = str(cfg.get("prompt", "")).strip()
    input_path_value = str(cfg.get("input_path", "")).strip()
    if input_path_value:
        input_value = input_path(outputs, input_path_value)
        prompt = f"{prompt}\n\nInput data:\n{json.dumps(input_value, ensure_ascii=False, separators=(',', ':'))}"
    if not prompt or len(prompt) > 200_000:
        raise ValueError("OpenAI prompt must contain between 1 and 200,000 characters")
    system_prompt = str(cfg.get("system_prompt", "You are a helpful assistant."))[:20_000]
    temperature = float(cfg.get("temperature", 0.2))
    max_tokens = int(cfg.get("max_output_tokens", 1000))
    if not math.isfinite(temperature) or not 0 <= temperature <= 2:
        raise ValueError("OpenAI temperature must be between 0 and 2")
    if not 1 <= max_tokens <= 16_000:
        raise ValueError("OpenAI maximum output tokens must be between 1 and 16,000")
    payload: dict[str, Any] = {"model": model, "messages": [{"role": "system", "content": system_prompt}, {"role": "user", "content": prompt}], "max_completion_tokens": max_tokens}
    if model.startswith(("gpt-5", "gpt-6", "o1", "o3", "o4")):
        effort = str(cfg.get("reasoning_effort", "medium"))
        # Keep older workflow settings working: Sol/Astra do not support 'none'.
        if effort == "none" and model in {"gpt-6.1-sol", "gpt-6-astra"}:
            effort = "medium"
        if effort not in OPENAI_REASONING_EFFORTS:
            raise ValueError("OpenAI reasoning effort is invalid")
        payload["reasoning_effort"] = effort
    else:
        payload["temperature"] = temperature
    request = urllib.request.Request("https://api.openai.com/v1/chat/completions", data=json.dumps(payload).encode("utf-8"), headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json", "User-Agent": "CLIPTORA-Workflow/1.0"}, method="POST")
    try:
        with urllib.request.urlopen(request, timeout=120) as response:
            result = json.load(response)
        choice = result["choices"][0]
        return {"text": str(choice["message"]["content"]), "model": str(result.get("model", model)), "usage": result.get("usage", {}), "finish_reason": choice.get("finish_reason")}
    except (urllib.error.HTTPError, urllib.error.URLError, ValueError, KeyError, IndexError) as exc:
        raise RuntimeError(f"OpenAI request failed: {str(exc)[:200]}") from exc


def _find_named_value(value: Any, name: str, depth: int = 0) -> Any:
    """Find a bounded field in upstream JSON without evaluating expressions."""
    if depth > 8:
        return None
    if isinstance(value, dict):
        if name in value:
            return value[name]
        for nested in value.values():
            found = _find_named_value(nested, name, depth + 1)
            if found is not None:
                return found
    elif isinstance(value, list):
        for nested in value[:100]:
            found = _find_named_value(nested, name, depth + 1)
            if found is not None:
                return found
    return None


def execute_ai_agent(cfg: dict[str, Any], outputs: dict[str, Any]) -> dict[str, Any]:
    raw_handles = cfg.get("__cliptora_ui_target_handles", {})
    handles = raw_handles if isinstance(raw_handles, dict) else {}
    model_ids = [source_id for source_id, handle in handles.items() if handle == "chat_model" and source_id in outputs]
    if not model_ids:
        raise ValueError("AI Agent requires a Chat Model connection")
    model_output = outputs[model_ids[0]]
    model_cfg = model_output.get("chat_model", {}) if isinstance(model_output, dict) else {}
    if not isinstance(model_cfg, dict):
        raise ValueError("The connected Chat Model returned invalid configuration")

    prompt_source = str(cfg.get("prompt_source", "connected_chat_trigger"))
    if prompt_source == "connected_chat_trigger":
        prompt_value = _find_named_value({key: value for key, value in outputs.items() if key not in model_ids}, "chatInput")
        if prompt_value is None:
            raise ValueError("Connected Chat Trigger input is missing chatInput")
        prompt = str(prompt_value).strip()
    elif prompt_source == "define_below":
        prompt = str(cfg.get("prompt", "")).strip()
    else:
        raise ValueError("AI Agent prompt source must be connected_chat_trigger or define_below")
    if not prompt:
        raise ValueError("AI Agent prompt cannot be empty")

    memory = {key: outputs[key] for key, handle in handles.items() if handle == "memory" and key in outputs}
    tools = {key: outputs[key] for key, handle in handles.items() if handle == "tool" and key in outputs}
    if memory:
        prompt += "\n\nConversation memory:\n" + json.dumps(memory, ensure_ascii=False, separators=(",", ":"))
    if tools:
        prompt += "\n\nConnected tool results:\n" + json.dumps(tools, ensure_ascii=False, separators=(",", ":"))

    request_cfg = {
        **model_cfg,
        "prompt": prompt,
        "system_prompt": str(cfg.get("system_message", "You are a helpful AI agent.")),
    }
    try:
        result = openai_chat(request_cfg, {})
    except RuntimeError:
        fallback = str(cfg.get("fallback_model", "")).strip()
        if not cfg.get("enable_fallback_model") or not fallback:
            raise
        result = openai_chat({**request_cfg, "model": fallback}, {})
        result["fallback_used"] = True

    if cfg.get("require_specific_output"):
        try:
            result["structured_output"] = json.loads(str(result.get("text", "")))
        except ValueError as exc:
            raise ValueError("AI Agent required structured JSON output, but the model returned invalid JSON") from exc
    result["agent"] = {"chat_model_node": model_ids[0], "memory_inputs": list(memory), "tool_inputs": list(tools)}
    return result


def openai_request(path: str, payload: dict[str, Any], timeout: int = 120) -> dict[str, Any]:
    """Call a JSON OpenAI endpoint with the server-side credential only."""
    key = os.environ.get("OPENAI_API_KEY", "").strip()
    if not key:
        raise RuntimeError("OPENAI_API_KEY is missing from the backend environment")
    request = urllib.request.Request(
        f"https://api.openai.com/v1/{path.lstrip('/')}",
        data=json.dumps(payload).encode("utf-8"),
        headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json", "User-Agent": "CLIPTORA-Workflow/1.0"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            result = json.load(response)
        if not isinstance(result, dict):
            raise ValueError("OpenAI returned a non-object response")
        return result
    except urllib.error.HTTPError as exc:
        try:
            detail = exc.read(4096).decode("utf-8", errors="replace")
        except Exception:
            detail = str(exc)
        raise RuntimeError(f"OpenAI request failed ({exc.code}): {detail[:500]}") from exc
    except (urllib.error.URLError, ValueError) as exc:
        raise RuntimeError(f"OpenAI request failed: {str(exc)[:300]}") from exc


def fetch_public_image_bytes(raw_url: str, *, max_bytes: int = 10_000_000) -> tuple[bytes, str, str]:
    """Download one bounded public image without redirects or private-network access."""
    parsed = urllib.parse.urlsplit(raw_url.strip())
    if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password or parsed.fragment or parsed.port not in {None, 443}:
        raise ValueError("Image inputs must be public HTTPS URLs")
    addresses = socket.getaddrinfo(parsed.hostname, 443, type=socket.SOCK_STREAM)
    if not addresses or any(not ipaddress.ip_address(address[4][0]).is_global for address in addresses):
        raise ValueError("Image URL cannot resolve to a private, local or reserved address")
    request = urllib.request.Request(raw_url, headers={"Accept": "image/png,image/jpeg,image/webp", "User-Agent": "CLIPTORA-Workflow/1.0"})
    try:
        response = urllib.request.build_opener(NoWorkflowRedirect()).open(request, timeout=30)
        with response:
            content_type = response.headers.get_content_type()
            if content_type not in {"image/png", "image/jpeg", "image/webp"}:
                raise ValueError("Image URL returned an unsupported content type")
            raw = response.read(max_bytes + 1)
        if not raw or len(raw) > max_bytes:
            raise ValueError(f"Image must contain between 1 byte and {max_bytes // 1_000_000} MB")
        extension = {"image/png": "png", "image/jpeg": "jpg", "image/webp": "webp"}[content_type]
        return raw, content_type, f"input.{extension}"
    except urllib.error.HTTPError as exc:
        raise RuntimeError(f"Image download failed with status {exc.code}") from exc
    except urllib.error.URLError as exc:
        raise RuntimeError(f"Image download failed: {exc.reason}") from exc


def openai_multipart_request(path: str, fields: dict[str, str], files: list[tuple[str, str, str, bytes]], timeout: int = 180) -> dict[str, Any]:
    """Call a bounded multipart OpenAI endpoint using only the backend credential."""
    key = os.environ.get("OPENAI_API_KEY", "").strip()
    if not key:
        raise RuntimeError("OPENAI_API_KEY is missing from the backend environment")
    if path != "images/edits" or not files or len(files) > 5:
        raise ValueError("OpenAI multipart request is invalid")
    boundary = "----CLIPTORA" + hashlib.sha256(os.urandom(24)).hexdigest()[:32]
    chunks: list[bytes] = []
    for name, value in fields.items():
        if not re.fullmatch(r"[A-Za-z0-9_\[\]-]{1,80}", name) or "\r" in value or "\n" in name:
            raise ValueError("OpenAI multipart field is invalid")
        chunks.extend([f"--{boundary}\r\nContent-Disposition: form-data; name=\"{name}\"\r\n\r\n".encode(), value.encode("utf-8"), b"\r\n"])
    for name, filename, content_type, raw in files:
        if not re.fullmatch(r"[A-Za-z0-9_\[\]-]{1,80}", name) or not re.fullmatch(r"[A-Za-z0-9_.-]{1,120}", filename) or content_type not in {"image/png", "image/jpeg", "image/webp"}:
            raise ValueError("OpenAI multipart file is invalid")
        chunks.extend([f"--{boundary}\r\nContent-Disposition: form-data; name=\"{name}\"; filename=\"{filename}\"\r\nContent-Type: {content_type}\r\n\r\n".encode(), raw, b"\r\n"])
    chunks.append(f"--{boundary}--\r\n".encode())
    body = b"".join(chunks)
    if len(body) > 50_000_000:
        raise ValueError("OpenAI image edit request exceeds 50 MB")
    request = urllib.request.Request(
        f"https://api.openai.com/v1/{path}", data=body,
        headers={"Authorization": f"Bearer {key}", "Content-Type": f"multipart/form-data; boundary={boundary}", "User-Agent": "CLIPTORA-Workflow/1.0"}, method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            result = json.load(response)
        if not isinstance(result, dict):
            raise ValueError("OpenAI returned a non-object response")
        return result
    except urllib.error.HTTPError as exc:
        try:
            detail = exc.read(4096).decode("utf-8", errors="replace")
        except Exception:
            detail = str(exc)
        raise RuntimeError(f"OpenAI image edit failed ({exc.code}): {detail[:500]}") from exc
    except (urllib.error.URLError, ValueError) as exc:
        raise RuntimeError(f"OpenAI image edit failed: {str(exc)[:300]}") from exc


def openai_action(cfg: dict[str, Any], outputs: dict[str, Any]) -> dict[str, Any]:
    action = str(cfg.get("action") or "message_model")
    if action == "message_model":
        return openai_chat(cfg, outputs)

    prompt = str(cfg.get("prompt", "")).strip()
    input_path_value = str(cfg.get("input_path", "")).strip()
    if input_path_value:
        prompt = f"{prompt}\n\nInput data:\n{json.dumps(input_path(outputs, input_path_value), ensure_ascii=False, separators=(',', ':'))}"

    if action == "classify_violations":
        if not prompt or len(prompt) > 200_000:
            raise ValueError("Text input must contain between 1 and 200,000 characters")
        model = str(cfg.get("model") or "omni-moderation-latest")
        if not model.startswith("omni-moderation"):
            model = "omni-moderation-latest"
        result = openai_request("moderations", {"model": model, "input": prompt})
        moderation = (result.get("results") or [{}])[0]
        if bool(cfg.get("simplify_output", True)):
            return {"flagged": bool(moderation.get("flagged")), "categories": moderation.get("categories", {}), "category_scores": moderation.get("category_scores", {})}
        return result

    if action == "analyze_image":
        urls = [line.strip() for line in str(cfg.get("image_urls", "")).splitlines() if line.strip()]
        if not 1 <= len(urls) <= 10:
            raise ValueError("Analyze image requires between 1 and 10 HTTPS image URLs")
        for url in urls:
            parsed = urllib.parse.urlparse(url)
            if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password:
                raise ValueError("Every image URL must be a public HTTPS URL")
        if not prompt:
            prompt = "What's in this image?"
        if len(prompt) > 100_000:
            raise ValueError("Text input is too long")
        model = str(cfg.get("model") or os.environ.get("CLIPTORA_OPENAI_MODEL", "gpt-6.1-sol"))
        if model.startswith(("gpt-image", "omni-moderation")):
            model = "gpt-6.1-sol"
        content: list[dict[str, Any]] = [{"type": "text", "text": prompt}]
        content.extend({"type": "image_url", "image_url": {"url": url, "detail": "auto"}} for url in urls)
        vision_payload: dict[str, Any] = {"model": model, "messages": [{"role": "user", "content": content}], "max_completion_tokens": int(cfg.get("max_output_tokens", 1000))}
        if model.startswith(("gpt-5", "gpt-6", "o1", "o3", "o4")):
            effort = str(cfg.get("reasoning_effort", "none"))
            if effort not in OPENAI_REASONING_EFFORTS:
                raise ValueError("OpenAI reasoning effort is invalid")
            vision_payload["reasoning_effort"] = effort
        result = openai_request("chat/completions", vision_payload)
        choice = result["choices"][0]
        if bool(cfg.get("simplify_output", True)):
            return {"text": str(choice["message"]["content"]), "model": str(result.get("model", model)), "usage": result.get("usage", {}), "finish_reason": choice.get("finish_reason")}
        return result

    if action == "generate_image":
        if not prompt or len(prompt) > 32_000:
            raise ValueError("Image prompt must contain between 1 and 32,000 characters")
        size = str(cfg.get("image_size") or "1024x1024")
        if size not in {"1024x1024", "1536x1024", "1024x1536", "auto"}:
            raise ValueError("Unsupported image size")
        model = str(cfg.get("model") or "gpt-image-2.5-flare")
        if not model.startswith("gpt-image-"):
            model = "gpt-image-2.5-flare"
        result = openai_request("images/generations", {"model": model, "prompt": prompt, "size": size, "n": 1}, timeout=180)
        images = result.get("data") or []
        if bool(cfg.get("simplify_output", True)):
            return {"images": [{key: item[key] for key in ("url", "b64_json", "revised_prompt") if key in item} for item in images if isinstance(item, dict)]}
        return result

    if action == "edit_image":
        if not prompt or len(prompt) > 32_000:
            raise ValueError("Image edit prompt must contain between 1 and 32,000 characters")
        urls = [line.strip() for line in str(cfg.get("image_urls", "")).splitlines() if line.strip()]
        if not 1 <= len(urls) <= 4:
            raise ValueError("Edit image requires between 1 and 4 public HTTPS image URLs")
        model = str(cfg.get("model") or "gpt-image-2.5-sunburst")
        if model not in OPENAI_IMAGE_MODELS:
            model = "gpt-image-2.5-sunburst"
        size = str(cfg.get("image_size") or "1024x1024")
        if size not in {"1024x1024", "1536x1024", "1024x1536", "auto"}:
            raise ValueError("Unsupported image size")
        fields = {"model": model, "prompt": prompt, "size": size, "n": "1"}
        fidelity = str(cfg.get("image_input_fidelity") or "auto")
        if fidelity not in {"auto", "low", "high"}:
            raise ValueError("Unsupported image input fidelity")
        if fidelity != "auto" and model != "gpt-image-2":
            fields["input_fidelity"] = fidelity
        files: list[tuple[str, str, str, bytes]] = []
        for index, url in enumerate(urls):
            raw, content_type, filename = fetch_public_image_bytes(url)
            files.append(("image[]", f"input-{index + 1}.{filename.rsplit('.', 1)[-1]}", content_type, raw))
        mask_url = str(cfg.get("mask_image_url", "")).strip()
        if mask_url:
            raw, content_type, _ = fetch_public_image_bytes(mask_url)
            if content_type != "image/png":
                raise ValueError("OpenAI image edit mask must be a PNG image")
            files.append(("mask", "mask.png", content_type, raw))
        result = openai_multipart_request("images/edits", fields, files, timeout=180)
        images = result.get("data") or []
        if bool(cfg.get("simplify_output", True)):
            return {"images": [{key: item[key] for key in ("url", "b64_json", "revised_prompt") if key in item} for item in images if isinstance(item, dict)]}
        return result

    raise ValueError(f"OpenAI action '{action}' is not supported by this CLIPTORA backend")


class OpenaiProvider:
    """AI provider adapter with a stable service interface."""

    def execute(self, settings: dict[str, Any], inputs: dict[str, Any]) -> dict[str, Any]:
        return openai_action(settings, inputs)
