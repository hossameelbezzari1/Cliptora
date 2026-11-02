"""Authenticated encryption for user credentials, keyed by the server SECRET_KEY.

The master key is application infrastructure, never a provider API key. In
production provision SECRET_KEY through a Docker secret/secret manager.
"""
from __future__ import annotations
import base64
import hashlib
import json
from cryptography.fernet import Fernet, InvalidToken
from app.core.Config import settings

def _cipher() -> Fernet:
    secret = settings().secret_key
    if not isinstance(secret, str) or len(secret) < 32 or secret.startswith(('replace-', 'local-development','SET-AT-LEAST')):
        raise RuntimeError('Set a strong random SECRET_KEY before storing credentials')
    key = base64.urlsafe_b64encode(hashlib.sha256(('CLIPTORA-CREDENTIALS-V1:'+secret).encode()).digest())
    return Fernet(key)

def encrypt(value: dict) -> str:
    return _cipher().encrypt(json.dumps(value,ensure_ascii=False,allow_nan=False).encode()).decode('ascii')

def decrypt(ciphertext: str) -> dict:
    try: result = json.loads(_cipher().decrypt(ciphertext.encode()).decode())
    except (InvalidToken, ValueError, UnicodeError) as exc:
        raise RuntimeError('Credential cannot be decrypted. Verify the server master key.') from exc
    if not isinstance(result,dict):raise ValueError('Credential payload is invalid')
    return result
