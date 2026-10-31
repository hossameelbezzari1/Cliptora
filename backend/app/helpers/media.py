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



def tool(*args: str, timeout: int = 120) -> str:
    try:
        process = subprocess.run(list(args), capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=timeout, check=False)
    except FileNotFoundError as exc:
        raise RuntimeError(f"Missing media tool: {args[0]}. Install FFmpeg and add it to PATH") from exc
    except subprocess.TimeoutExpired as exc:
        raise RuntimeError(f"Media process exceeded {timeout}s") from exc
    if process.returncode != 0:
        raise RuntimeError(f"{args[0]} failed: {process.stderr[-1200:]}")
    return process.stdout


def probe(source: Path) -> dict:
    parsed = json.loads(tool("ffprobe", "-v", "error", "-show_entries", "format=duration,size:stream=codec_type,width,height", "-of", "json", str(source)))
    stream = next((s for s in parsed.get("streams", []) if s.get("codec_type") == "video"), {})
    fmt = parsed.get("format", {})
    return {"duration": float(fmt.get("duration") or 0), "width": int(stream.get("width") or 0), "height": int(stream.get("height") or 0), "has_audio": any(s.get("codec_type") == "audio" for s in parsed.get("streams", [])), "bytes": int(fmt.get("size") or 0)}
