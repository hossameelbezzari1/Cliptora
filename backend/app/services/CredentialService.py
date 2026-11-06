
"""Owner-checked credentials: API keys and encrypted local browser sessions."""
from __future__ import annotations

import json
import urllib.error
import urllib.request
from urllib.parse import urlsplit

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.Encryption import encrypt, decrypt
from app.models import Credential

BROWSER_PROVIDERS = {"tiktok", "instagram", "youtube"}
API_PROVIDERS = {"gemini", "openai", "ollama"}


class CredentialService:
    @staticmethod
    def sanitize(provider: str, data: dict) -> dict:
        if provider not in API_PROVIDERS or not isinstance(data, dict):
            raise ValueError(
                "Unsupported API provider. "
                "Browser accounts must use browser capture."
            )

        if provider in {"gemini", "openai"}:
            if set(data) - {"api_key", "allow_paid_actions"}:
                raise ValueError(
                    "Only api_key and allow_paid_actions are accepted"
                )

            key = data.get("api_key")
            if (
                not isinstance(key, str)
                or not 8 <= len(key.strip()) <= 512
                or "\r" in key
                or "\n" in key
            ):
                raise ValueError("A valid API key is required")

            return {
                "api_key": key.strip(),
                "allow_paid_actions": (
                    data.get("allow_paid_actions") is True
                ),
            }

        if set(data) - {"base_url"}:
            raise ValueError("Only base_url is accepted for Ollama")

        value = str(
            data.get("base_url")
            or "http://host.docker.internal:11434"
        ).rstrip("/")

        url = urlsplit(value)

        if (
            url.scheme not in ("http", "https")
            or url.hostname not in (
                "localhost",
                "127.0.0.1",
                "host.docker.internal",
            )
            or url.username
            or url.password
            or url.path
            or url.query
            or url.fragment
            or url.port not in (None, 11434)
        ):
            raise ValueError(
                "Ollama URL must be a trusted local "
                "Ollama endpoint on port 11434"
            )

        return {"base_url": value}

    @staticmethod
    def view(row: Credential) -> dict:
        return {
            "id": row.id,
            "name": row.name,
            "provider": row.provider,
            "auth_type": row.auth_type,
            "configured": True,
            "created_at": (
                row.created_at.isoformat()
                if row.created_at
                else None
            ),
            "updated_at": (
                row.updated_at.isoformat()
                if row.updated_at
                else None
            ),
        }

    def list(self, db: Session, user_id: int):
        rows = db.scalars(
            select(Credential)
            .where(Credential.user_id == user_id)
            .order_by(Credential.id.desc())
        ).all()

        return [self.view(row) for row in rows]

    def get_owned(
        self,
        db: Session,
        user_id: int,
        ident: int,
    ) -> Credential:
        row = db.scalar(
            select(Credential).where(
                Credential.id == ident,
                Credential.user_id == user_id,
            )
        )

        if row is None:
            raise HTTPException(404, "Credential not found")

        return row

    def create(
        self,
        db: Session,
        user_id: int,
        name: str,
        provider: str,
        data: dict,
    ):
        try:
            safe = self.sanitize(provider, data)
        except ValueError as exc:
            raise HTTPException(422, str(exc)) from exc

        row = Credential(
            user_id=user_id,
            name=name.strip(),
            provider=provider,
            auth_type=(
                "local_service"
                if provider == "ollama"
                else "api_key"
            ),
            encrypted_data=encrypt(safe),
        )

        db.add(row)
        db.commit()
        db.refresh(row)

        return self.view(row)

    def update(
        self,
        db: Session,
        user_id: int,
        ident: int,
        name: str | None,
        data: dict | None,
    ):
        row = self.get_owned(db, user_id, ident)

        if name is not None:
            row.name = name.strip()

        if data is not None:
            if row.auth_type == "browser_session":
                raise HTTPException(
                    422,
                    "Browser snapshots can only be updated "
                    "by local Selenium capture",
                )

            try:
                row.encrypted_data = encrypt(
                    self.sanitize(row.provider, data)
                )
            except ValueError as exc:
                raise HTTPException(422, str(exc)) from exc

        db.commit()
        db.refresh(row)

        return self.view(row)

    def save_browser(
        self,
        db: Session,
        user_id: int,
        name: str,
        provider: str,
        snapshot: dict,
        ident: int | None = None,
    ) -> dict:
        if provider not in BROWSER_PROVIDERS:
            raise HTTPException(
                422,
                "Unsupported browser provider",
            )

        if ident is not None:
            row = self.get_owned(db, user_id, ident)

            if (
                row.provider != provider
                or row.auth_type != "browser_session"
            ):
                raise HTTPException(
                    409,
                    "Credential is not a matching browser account",
                )
        else:
            row = Credential(
                user_id=user_id,
                provider=provider,
                auth_type="browser_session",
            )
            db.add(row)

        row.name = name.strip()
        row.encrypted_data = encrypt({
            "snapshot": snapshot
        })

        db.commit()
        db.refresh(row)

        return self.view(row)

    def load_browser(
        self,
        db: Session,
        user_id: int,
        ident: int,
    ) -> tuple[Credential, dict]:
        row = self.get_owned(db, user_id, ident)

        if (
            row.auth_type != "browser_session"
            or row.provider not in BROWSER_PROVIDERS
        ):
            raise HTTPException(
                422,
                "Credential is not a browser session",
            )

        data = decrypt(row.encrypted_data)
        snapshot = data.get("snapshot")

        if (
            not isinstance(snapshot, dict)
            or snapshot.get("provider") != row.provider
        ):
            raise HTTPException(
                422,
                "Invalid encrypted browser snapshot",
            )

        return row, snapshot

    def delete(
        self,
        db: Session,
        user_id: int,
        ident: int,
    ):
        row = self.get_owned(db, user_id, ident)

        from app.models import WorkflowDefinition

        for workflow in db.scalars(
            select(WorkflowDefinition).where(
                WorkflowDefinition.user_id == user_id
            )
        ).all():
            try:
                nodes = json.loads(workflow.nodes_json)
            except (TypeError, ValueError):
                continue

            if any(
                isinstance(node, dict)
                and (
                    node.get("settings") or {}
                ).get("credential_id") in (
                    ident,
                    str(ident),
                )
                for node in nodes
            ):
                raise HTTPException(
                    409,
                    "Credential is still used by a workflow",
                )

        db.delete(row)
        db.commit()

    def resolve(
        self,
        db: Session,
        user_id: int,
        ident: int,
        provider: str,
    ) -> dict:
        row = self.get_owned(db, user_id, ident)

        if (
            row.provider != provider
            or row.auth_type == "browser_session"
        ):
            raise ValueError(
                "Selected credential has the wrong "
                "provider or authentication type"
            )

        return decrypt(row.encrypted_data)

    def available_models(
        self,
        db: Session,
        user_id: int,
        ident: int,
    ) -> dict:
        row = self.get_owned(db, user_id, ident)

        if (
            row.provider not in API_PROVIDERS
            or row.auth_type == "browser_session"
        ):
            raise HTTPException(
                422,
                "This credential does not provide AI models",
            )

        secrets = decrypt(row.encrypted_data)

        if row.provider == "openai":
            url = "https://api.openai.com/v1/models"
            headers = {
                "Authorization": "Bearer " + secrets["api_key"]
            }

        elif row.provider == "gemini":
            url = (
                "https://generativelanguage.googleapis.com"
                "/v1beta/models?pageSize=100"
            )
            headers = {
                "x-goog-api-key": secrets["api_key"]
            }

        else:
            url = secrets.get(
                "base_url",
                "http://host.docker.internal:11434",
            ) + "/api/tags"
            headers = {}

        request = urllib.request.Request(
            url,
            headers=headers,
            method="GET",
        )

        try:
            with urllib.request.urlopen(
                request,
                timeout=12,
            ) as response:
                blob = response.read(2_000_001)

        except urllib.error.HTTPError as exc:
            raise HTTPException(
                502,
                f"Provider rejected the credential "
                f"(HTTP {exc.code})",
            ) from None

        except (
            urllib.error.URLError,
            OSError,
            TimeoutError,
        ):
            raise HTTPException(
                502,
                "Unable to connect to provider",
            ) from None

        if len(blob) > 2_000_000:
            raise HTTPException(
                502,
                "Provider model list is too large",
            )

        try:
            body = json.loads(blob)
        except ValueError:
            raise HTTPException(
                502,
                "Provider returned invalid JSON",
            ) from None

        values = (
            body.get("data", [])
            if row.provider == "openai"
            else body.get("models", [])
        )

        if not isinstance(values, list):
            raise HTTPException(
                502,
                "Provider model list is malformed",
            )

        names = []

        for item in values[:300]:
            if not isinstance(item, dict):
                continue

            key = str(
                item.get("id")
                or item.get("name")
                or item.get("model")
                or ""
            )

            if row.provider == "gemini":
                key = key.removeprefix("models/")

            if key and len(key) <= 160:
                names.append(key)

        return {
            "provider": row.provider,
            "models": sorted(set(names)),
        }
