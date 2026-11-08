
"""Native AI Batch Processor node for CLIPTORA.

Consumes prepared chunks from context.smart and executes them
through the existing Gemini/OpenAI workflow providers.

No new HTTP client, API-key storage or global AI state.

Hierarchical final reduction is intentionally not claimed as complete.
"""

from __future__ import annotations

import copy
from pathlib import Path
from typing import Any

from app.workflows.Node import Node
from app.services.context.AIBatchProcessor import (
    AIBatchProcessor,
    BatchOptions,
)
from app.services.context.ProviderAdapter import (
    ProviderAdapter,
    ProviderAdapterOptions,
)
from app.services.context.TokenEstimator import TokenEstimator


class AIBatchNode(Node):
    family = "ai_batch"
    group = "AI"
    icon = "lucide:layers-3"

    operations = {
        "ai.batch": {
            "label": "AI Batch Processor",
            "icon": "lucide:layers-3",
            "settings": {
                "input_path": "",
                "provider": "gemini",
                "credential_id": None,
                "model": "",
                "prompt": "Analyze the provided content.",
                "system_prompt": "",
                "output_mode": "json",
                "max_output_tokens": 1024,
                "usable_input_tokens": 0,
                "merge_mode": "collect",
                "merge_field": "items",
                "conflict_policy": "last",
                "allow_partial": False,
                "max_retries": 0,
                "use_memory": False,
                "memory_token_budget": 500,
                "memory_strategy": "recent",
                "max_chunks": 200,
            },
            "inputs": [
                {
                    "name": "context",
                    "type": "json",
                    "title": "Smart Context",
                    "label": "Prepared context chunks",
                    "accepts": ["json"],
                    "required": True,
                    "description": (
                        "Connect the output of Smart Context Manager."
                    ),
                }
            ],
            "input_types": ["json"],
            "output_types": ["json"],
        }
    }

    parameter_fields = {
        "ai.batch": {
            "input_path": {
                "type": "string",
                "widget": "upstream",
                "title": "Smart Context Input",
                "accepts": ["json"],
            },
            "provider": {
                "type": "string",
                "title": "AI Provider",
                "enum": ["gemini", "openai"],
            },
            "credential_id": {
                "type": "integer",
                "title": "Credential ID",
                "minimum": 1,
            },
            "model": {
                "type": "string",
                "title": "Model",
                "widget": "model",
            },
            "prompt": {
                "type": "string",
                "widget": "textarea",
                "title": "Task Prompt",
            },
            "system_prompt": {
                "type": "string",
                "widget": "textarea",
                "title": "System Prompt",
                "group": "Advanced",
            },
            "output_mode": {
                "type": "string",
                "title": "AI Output Format",
                "enum": ["json", "text"],
            },
            "max_output_tokens": {
                "type": "integer",
                "title": "Maximum Output Tokens",
                "minimum": 1,
                "maximum": 16000,
                "group": "Advanced",
            },
            "usable_input_tokens": {
                "type": "integer",
                "title": "Input Token Budget",
                "minimum": 0,
                "group": "Advanced",
            },
            "merge_mode": {
                "type": "string",
                "title": "Merge Results",
                "enum": [
                    "collect",
                    "deduplicate",
                    "structured",
                ],
            },
            "merge_field": {
                "type": "string",
                "title": "Merge Field",
                "group": "Advanced",
            },
            "conflict_policy": {
                "type": "string",
                "title": "JSON Conflict Policy",
                "enum": ["first", "last", "error"],
                "group": "Advanced",
            },
            "allow_partial": {
                "type": "boolean",
                "title": "Continue on Chunk Failure",
            },
            "max_retries": {
                "type": "integer",
                "title": "Retries per Chunk",
                "minimum": 0,
                "maximum": 5,
                "group": "Advanced",
            },
            "use_memory": {
                "type": "boolean",
                "title": "Use Context Memory",
            },
            "memory_token_budget": {
                "type": "integer",
                "title": "Memory Token Budget",
                "minimum": 0,
                "group": "Advanced",
            },
            "memory_strategy": {
                "type": "string",
                "title": "Memory Selection",
                "enum": [
                    "recent",
                    "relevant",
                    "chronological",
                ],
                "group": "Advanced",
            },
            "max_chunks": {
                "type": "integer",
                "title": "Maximum Chunks",
                "minimum": 1,
                "maximum": 10000,
                "group": "Advanced",
            },
        }
    }

    @staticmethod
    def _integer(
        settings: dict[str, Any],
        key: str,
        default: int,
        minimum: int,
        maximum: int,
    ) -> int:
        value = settings.get(key, default)

        if type(value) is not int:
            raise ValueError(f"{key} must be an integer")

        if not minimum <= value <= maximum:
            raise ValueError(
                f"{key} must be between {minimum} and {maximum}"
            )

        return value

    @staticmethod
    def _boolean(
        settings: dict[str, Any],
        key: str,
        default: bool,
    ) -> bool:
        value = settings.get(key, default)

        if type(value) is not bool:
            raise ValueError(f"{key} must be boolean")

        return value

    @staticmethod
    def _find_context(
        outputs: dict[str, Any],
        input_path: str,
    ) -> dict[str, Any]:
        if not isinstance(outputs, dict):
            raise ValueError("Upstream outputs must be an object")

        if input_path:
            from app.workflows.InputResolver import (
                resolve_input_path,
            )

            selected = resolve_input_path(
                outputs,
                input_path,
            )

            if not isinstance(selected, dict):
                raise ValueError(
                    "Selected Smart Context output must be an object"
                )

            if not isinstance(selected.get("chunks"), list):
                raise ValueError(
                    "Selected output has no chunks array"
                )

            return selected

        matches = [
            value
            for value in outputs.values()
            if isinstance(value, dict)
            and value.get("method") == "smart_context"
            and isinstance(value.get("chunks"), list)
        ]

        if len(matches) == 1:
            return matches[0]

        if not matches and len(outputs) == 1:
            value = next(iter(outputs.values()))

            if (
                isinstance(value, dict)
                and isinstance(value.get("chunks"), list)
            ):
                return value

        if not matches:
            raise ValueError(
                "Connect Smart Context Manager before AI Batch Processor"
            )

        raise ValueError(
            "Multiple Smart Context sources found. "
            "Select Smart Context Input explicitly."
        )

    @staticmethod
    def _retryable(error: Exception) -> bool:
        if isinstance(
            error,
            (TimeoutError, ConnectionError),
        ):
            return True

        # Existing AI providers wrap HTTP errors in RuntimeError.
        # Retry only recognizable transient failures.
        message = str(error).lower()

        return any(
            marker in message
            for marker in (
                "429",
                "500",
                "502",
                "503",
                "504",
                "timeout",
                "timed out",
                "rate limit",
                "temporarily unavailable",
            )
        )

    @staticmethod
    def _progress(
        node: dict[str, Any],
        event: dict[str, Any],
    ) -> None:
        callback = node.get("_progress_callback")

        if not callable(callback):
            return

        if not isinstance(event, dict):
            return

        callback({
            **event,
            "unit": "chunks",
        })

    def execute_operation(
        self,
        operation: str,
        node: dict[str, Any],
        outputs: dict[str, Any],
        source: Path | None,
        workdir: Path,
    ) -> dict[str, Any]:
        if operation != "ai.batch":
            raise ValueError(
                f"Unsupported operation: {operation}"
            )

        settings = node.get("settings") or {}

        if not isinstance(settings, dict):
            raise ValueError(
                "AI Batch settings must be an object"
            )

        self._progress(
            node,
            {
                "stage": "reading",
                "message": "Reading Smart Context chunks",
                "progress": 0,
                "processed": 0,
                "total": 1,
            },
        )

        context = self._find_context(
            outputs,
            str(settings.get("input_path") or "").strip(),
        )

        chunks = context["chunks"]

        if not chunks:
            raise ValueError(
                "Smart Context contains no chunks"
            )

        provider = str(
            settings.get("provider") or "gemini"
        ).strip().lower()

        model = str(
            settings.get("model") or ""
        ).strip()

        credential_id = settings.get("credential_id")

        if (
            type(credential_id) is not int
            or credential_id < 1
        ):
            raise ValueError(
                "Select a valid AI credential before execution"
            )

        if not model:
            raise ValueError(
                "Select the AI model before execution"
            )

        prompt = str(
            settings.get("prompt") or ""
        ).strip()

        system_prompt = str(
            settings.get("system_prompt") or ""
        )

        output_mode = str(
            settings.get("output_mode") or "json"
        ).lower()

        merge_mode = str(
            settings.get("merge_mode") or "collect"
        ).lower()

        max_output_tokens = self._integer(
            settings,
            "max_output_tokens",
            1024,
            1,
            16000,
        )

        max_chunks = self._integer(
            settings,
            "max_chunks",
            200,
            1,
            10000,
        )

        max_retries = self._integer(
            settings,
            "max_retries",
            0,
            0,
            5,
        )

        memory_token_budget = self._integer(
            settings,
            "memory_token_budget",
            500,
            0,
            1000000,
        )

        usable_input_tokens = self._integer(
            settings,
            "usable_input_tokens",
            0,
            0,
            10000000,
        )

        use_memory = self._boolean(
            settings,
            "use_memory",
            False,
        )

        allow_partial = self._boolean(
            settings,
            "allow_partial",
            False,
        )

        if len(chunks) > max_chunks:
            raise ValueError(
                f"Input contains {len(chunks)} chunks, "
                f"but max_chunks is {max_chunks}"
            )

        prepared_budget = (
            context.get("budget")
            if isinstance(context.get("budget"), dict)
            else {}
        )

        # A model change invalidates the original context budget.
        planned_model = str(
            prepared_budget.get("model") or ""
        )

        planned_provider = str(
            prepared_budget.get("provider") or ""
        ).lower()

        if (
            planned_model
            and planned_model != "unknown-model"
            and planned_model != model
        ):
            raise ValueError(
                "AI Batch model differs from Smart Context model. "
                "Use the same model or regenerate Smart Context."
            )

        if (
            planned_provider not in ("", "auto", "unknown")
            and planned_provider != provider
        ):
            raise ValueError(
                "AI Batch provider differs from Smart Context provider"
            )

        if usable_input_tokens == 0:
            usable_input_tokens = int(
                prepared_budget.get("usable_input") or 0
            )

        if usable_input_tokens <= 0:
            raise ValueError(
                "No usable token budget is available. "
                "Configure Smart Context first."
            )

        # Reserve space for the task prompt, system prompt,
        # reference manifest, labels and optional memory.
        estimator = TokenEstimator()

        largest_chunk = max(
            estimator.estimate_text(
                str(chunk.get("text") or "")
            )
            for chunk in chunks
        )

        fixed_tokens = (
            estimator.estimate_text(prompt)
            + estimator.estimate_text(system_prompt)
            + 128
        )

        if use_memory:
            fixed_tokens += memory_token_budget

        if largest_chunk + fixed_tokens > usable_input_tokens:
            raise ValueError(
                "Chunk + prompt + memory may exceed the "
                "configured input budget. Reduce chunk_fraction "
                "in Smart Context or reduce memory_token_budget."
            )

        adapter = ProviderAdapter(
            ProviderAdapterOptions(
                provider=provider,
                model=model,
                credential_id=credential_id,
                prompt=prompt,
                system_prompt=system_prompt,
                output_mode=output_mode,
                max_output_tokens=max_output_tokens,
                usable_input_tokens=usable_input_tokens,
            ),
            source=source,
            workdir=workdir,
        )

        strategy = str(
            context.get("strategy") or "chunked"
        )

        processor = AIBatchProcessor()

        result = processor.run(
            copy.deepcopy(chunks),
            processor=adapter.callback(),
            options=BatchOptions(
                merge_mode=merge_mode,
                merge_field=str(
                    settings.get("merge_field") or "items"
                ),
                conflict_policy=str(
                    settings.get("conflict_policy") or "last"
                ),
                allow_partial=allow_partial,
                max_retries=max_retries,
                max_chunks=max_chunks,
                use_memory=use_memory,
                memory_token_budget=memory_token_budget,
                memory_strategy=str(
                    settings.get("memory_strategy") or "recent"
                ),
            ),
            progress_callback=lambda event: self._progress(
                node,
                event,
            ),
            should_retry=self._retryable,
            query=prompt,
            strategy=strategy,
        )

        return {
            **result,
            "method": "ai_batch",
            "provider": provider,
            "model": model,
            "source_id": context.get("source_id"),
            "context_strategy": strategy,
        }
