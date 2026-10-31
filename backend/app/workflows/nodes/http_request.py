"""Native workflow node: HttpRequestNode."""

from __future__ import annotations

from pathlib import Path

from typing import Any

from app.workflows.base import BaseNode

class HTTPRequestNode(BaseNode):
    type = 'core.http_request'

    @staticmethod
    def metadata() -> dict[str, Any]:
        return {
            "label": "HTTP Request", "group": "Action in an app",
            "settings": {"method": "GET", "url": "", "query": {}, "headers": {}, "body": {}, "timeout_seconds": 30, "response_format": "auto"},
            "parameters_schema": {"type": "object", "properties": {
                "method": {"type": "string", "title": "Method", "enum": ["GET", "POST", "PUT", "PATCH", "DELETE"]},
                "url": {"type": "string", "title": "HTTPS URL", "description": "The hostname must be listed in CLIPTORA_WORKFLOW_HTTP_ALLOWED_HOSTS."},
                "query": {"type": "object", "title": "Query parameters"},
                "headers": {"type": "object", "title": "Headers", "description": "Secret-bearing headers are blocked; use the credential vault when available."},
                "body": {"type": "object", "title": "JSON body"},
                "timeout_seconds": {"type": "integer", "title": "Timeout (seconds)", "minimum": 1, "maximum": 120},
                "response_format": {"type": "string", "title": "Response format", "enum": ["auto", "json", "text"]},
            }},
        }

    @staticmethod
    def execute(node: dict[str, Any], outputs: dict[str, Any], source: Path | None, workdir: Path) -> dict[str, Any]:
        from app.helpers.http import execute_http_request
        cfg = node.get('settings', {})
        return execute_http_request(cfg)

# Compatibility exports for older callers and imported test utilities.
metadata = HTTPRequestNode.metadata
execute = HTTPRequestNode.execute
NODE = HTTPRequestNode.definition()

HttpRequestNode = HTTPRequestNode  # Legacy Python import compatibility
