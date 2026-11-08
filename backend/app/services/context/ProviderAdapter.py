
"""Connect Smart Context batches to existing CLIPTORA AI nodes.

Reuses:
- Workflow Registry executors
- Existing Gemini and OpenAI implementations
- Existing per-user credential binding

Does not create new HTTP clients or store API keys.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable

from app.services.context.TokenEstimator import TokenEstimator
from app.workflows.Credentials import bind_for_node
from app.workflows.Registry import executor


@dataclass(frozen=True, slots=True)
class ProviderAdapterOptions:
    provider: str
    model: str
    credential_id: int

    prompt: str
    system_prompt: str = ""
    output_mode: str = "text"

    max_output_tokens: int = 1024
    usable_input_tokens: int = 0

    def __post_init__(self) -> None:
        if self.provider not in ("gemini", "openai"):
            raise ValueError(
                "Supported providers: gemini, openai"
            )

        if not isinstance(self.model, str) or not self.model.strip():
            raise ValueError("model is required")

        if type(self.credential_id) is not int or self.credential_id < 1:
            raise ValueError(
                "A valid credential_id is required"
            )

        if not isinstance(self.prompt, str) or not self.prompt.strip():
            raise ValueError("A nonempty task prompt is required")

        if not isinstance(self.system_prompt, str):
            raise ValueError("system_prompt must be a string")

        if self.output_mode not in ("text", "json"):
            raise ValueError(
                "output_mode must be text or json"
            )

        if (
            type(self.max_output_tokens) is not int
            or not 1 <= self.max_output_tokens <= 16000
        ):
            raise ValueError(
                "max_output_tokens must be between 1 and 16000"
            )

        if (
            type(self.usable_input_tokens) is not int
            or self.usable_input_tokens < 0
        ):
            raise ValueError(
                "usable_input_tokens must be nonnegative"
            )


class ProviderAdapter:
    """Create an AI Batch Processor callback for existing nodes."""

    def __init__(
        self,
        options: ProviderAdapterOptions,
        *,
        source: Path | None = None,
        workdir: Path | None = None,
        estimator: TokenEstimator | None = None,
    ) -> None:
        if not isinstance(options, ProviderAdapterOptions):
            raise TypeError(
                "options must be ProviderAdapterOptions"
            )

        self.options = options
        self.source = source
        self.workdir = workdir or Path(".")
        self.estimator = estimator or TokenEstimator()

    @staticmethod
    def _reference_manifest(
        chunk: dict[str, Any],
    ) -> list[dict[str, Any]]:
        references = chunk.get("references") or []

        if not isinstance(references, list):
            raise ValueError(
                "Chunk references must be an array"
            )

        manifest: list[dict[str, Any]] = []

        for reference in references:
            if not isinstance(reference, dict):
                raise ValueError(
                    "Invalid source reference"
                )

            if not reference.get("source_id"):
                raise ValueError(
                    "Source reference has no source_id"
                )

            manifest.append({
                key: reference[key]
                for key in (
                    "source_id",
                    "kind",
                    "item_id",
                    "start",
                    "end",
                    "page",
                    "row",
                )
                if reference.get(key) is not None
            })

        return manifest

    def _build_prompt(
        self,
        chunk: dict[str, Any],
        memory: dict[str, Any],
    ) -> str:
        if not isinstance(chunk, dict):
            raise TypeError("Chunk must be an object")

        if not isinstance(memory, dict):
            raise TypeError("Memory must be an object")

        chunk_id = chunk.get("id")
        chunk_text = chunk.get("text")

        if not isinstance(chunk_id, str) or not chunk_id:
            raise ValueError("Chunk ID is required")

        if not isinstance(chunk_text, str):
            raise ValueError("Chunk text must be a string")

        previous = memory.get("text") or ""

        if not isinstance(previous, str):
            raise ValueError("Memory text must be a string")

        references = self._reference_manifest(chunk)

        sections = [self.options.prompt.strip()]

        if previous.strip():
            sections.append(
                "PREVIOUS CONTEXT (summaries, not primary evidence):\n"
                + previous
            )

        sections.extend([
            f"CURRENT CHUNK ID: {chunk_id}",
            "CURRENT CHUNK CONTENT:\n" + chunk_text,
        ])

        if references:
            sections.append(
                "Source references are retained separately in "
                "CLIPTORA chunk metadata for later verification. "
                "Select exact text from the current chunk. "
                "Do not generate timestamps or source IDs."
            )

        sections.append(
            "Use the current chunk as primary evidence. "
            "Do not invent timestamps, page numbers, "
            "word IDs, record IDs, or source references. "
            "If exact evidence is unavailable, say so."
        )

        if self.options.output_mode == "json":
            sections.append(
                "Return valid JSON only, without Markdown fences."
            )

        result = "\n\n".join(sections)

        if self.options.usable_input_tokens:
            estimated = (
                self.estimator.estimate_text(result)
                + self.estimator.estimate_text(
                    self.options.system_prompt
                )
            )

            if estimated > self.options.usable_input_tokens:
                raise ValueError(
                    f"Chunk {chunk_id} exceeds the "
                    "configured input token budget "
                    f"({estimated} estimated tokens; "
                    f"limit {self.options.usable_input_tokens}). "
                    "Reduce chunk size, memory, or prompt."
                )

        limit_chars = (
            900000
            if self.options.provider == "gemini"
            else 200000
        )

        if len(result) > limit_chars:
            raise ValueError(
                f"Prompt exceeds the existing "
                f"{self.options.provider} node limit"
            )

        return result

    @staticmethod
    def _parse_json(text: str) -> Any:
        try:
            return json.loads(text)
        except json.JSONDecodeError as exc:
            raise ValueError(
                "AI response is not valid JSON"
            ) from exc

    def _normalize_response(
        self,
        response: dict[str, Any],
    ) -> dict[str, Any]:
        if not isinstance(response, dict):
            raise ValueError(
                "Existing provider node returned an invalid response"
            )

        if self.options.output_mode == "json":
            if "json" in response:
                parsed = response["json"]
            else:
                text = response.get("text")

                if not isinstance(text, str):
                    raise ValueError(
                        "AI response contains no JSON text"
                    )

                parsed = self._parse_json(text)

            if isinstance(parsed, dict):
                return parsed

            if isinstance(parsed, list):
                return {"items": parsed}

            return {"value": parsed}

        text = response.get("text")

        if not isinstance(text, str):
            raise ValueError(
                "AI response contains no text"
            )

        return {
            "text": text,
            "model": response.get("model"),
            "usage": response.get("usage") or {},
            "finish_reason": response.get("finish_reason"),
        }

    def process(
        self,
        chunk: dict[str, Any],
        memory: dict[str, Any],
    ) -> dict[str, Any]:
        """Execute exactly one chunk through a native AI node."""

        prompt = self._build_prompt(chunk, memory)

        node_type = (
            "ai.gemini"
            if self.options.provider == "gemini"
            else "ai.openai"
        )

        node = {
            "id": "batch_" + str(chunk["id"]),
            "type": node_type,
            "settings": {
                "action": "message_model",
                "credential_id": self.options.credential_id,
                "model": self.options.model,
                "prompt": prompt,
                "system_prompt": self.options.system_prompt,
                "max_output_tokens": self.options.max_output_tokens,
                "input_path": "",
                "simplify_output": True,
            },
        }

        if self.options.provider == "gemini":
            node["settings"]["output_mode"] = (
                self.options.output_mode
            )

        # The authenticated execution owner must already be set
        # by the Workflow Engine. No global environment secrets.
        with bind_for_node(node):
            result = executor(node_type)(
                node,
                {},
                self.source,
                self.workdir,
            )

        return self._normalize_response(result)

    def callback(
        self,
    ) -> Callable[
        [dict[str, Any], dict[str, Any]],
        dict[str, Any],
    ]:
        """Callback accepted by AIBatchProcessor.run()."""

        return self.process
