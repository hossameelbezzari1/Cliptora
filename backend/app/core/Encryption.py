
"""Credential encryption; backwards-compatible with existing Fernet rows."""
from __future__ import annotations

import base64
import hashlib
import json
import zlib

from cryptography.fernet import Fernet, InvalidToken
from app.core.Config import settings

MAX_JSON_BYTES = 1_500_000


def _cipher() -> Fernet:
    secret = settings().secret_key
    if (
        not isinstance(secret, str)
        or len(secret) < 32
        or secret.startswith(
            ("replace-", "local-development", "SET-AT-LEAST")
        )
    ):
        raise RuntimeError(
            "Set a strong random SECRET_KEY before storing credentials"
        )

    key = base64.urlsafe_b64encode(
        hashlib.sha256(
            ("CLIPTORA-CREDENTIALS-V1:" + secret).encode()
        ).digest()
    )
    return Fernet(key)


def encrypt(value: dict) -> str:
    if not isinstance(value, dict):
        raise ValueError("Credential data must be an object")

    raw = json.dumps(
        value,
        ensure_ascii=False,
        allow_nan=False,
        separators=(",", ":"),
    ).encode("utf-8")

    if len(raw) > MAX_JSON_BYTES:
        raise ValueError("Credential snapshot is too large")

    payload = (
        b"CLZ1:" + zlib.compress(raw, level=6)
        if len(raw) >= 4096
        else raw
    )

    return _cipher().encrypt(payload).decode("ascii")


def decrypt(ciphertext: str) -> dict:
    try:
        payload = _cipher().decrypt(ciphertext.encode("ascii"))

        if payload.startswith(b"CLZ1:"):
            decoder = zlib.decompressobj()
            raw = decoder.decompress(
                payload[5:],
                MAX_JSON_BYTES + 1,
            )
            if decoder.unconsumed_tail or not decoder.eof:
                raise ValueError(
                    "Credential compressed payload exceeds limit"
                )
            raw += decoder.flush()
        else:
            raw = payload

        if len(raw) > MAX_JSON_BYTES:
            raise ValueError(
                "Credential payload exceeds limit"
            )

        result = json.loads(raw)

    except (
        InvalidToken,
        ValueError,
        UnicodeError,
        zlib.error,
    ) as exc:
        raise RuntimeError(
            "Credential cannot be decrypted. "
            "Verify the server key or payload."
        ) from exc

    if not isinstance(result, dict):
        raise ValueError("Credential payload is invalid")

    return result
