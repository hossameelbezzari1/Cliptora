
"""Universal Smart Context node for CLIPTORA.

Prepares context for downstream AI nodes without calling AI APIs.

Operations:
- context.smart: normalize, plan and chunk arbitrary workflow data

Supports text, JSON, transcripts, documents, records and metadata.
Preserves original references.

Hierarchical mode prepares chunks and a processing plan only.
Actual AI map/reduce execution belongs to the AI Batch Processor.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from app.workflows.Node import Node
from app.workflows.InputResolver import (
    resolve_input_path,
    infer_text_input,
)

from app.services.context.InputNormalizer import InputNormalizer
from app.services.context.TokenEstimator import TokenEstimator
from app.services.context.StrategyPlanner import (
    StrategyOptions,
    StrategyPlanner,
)
from app.services.context.Chunker import (
    AdaptiveChunker,
    ChunkOptions,
)


class SmartContextNode(Node):
    family = "smart_context"
    group = "Data"
    icon = "lucide:brain-circuit"

    operations = {
        "context.smart": {
            "label": "Smart Context Manager",
            "icon": "lucide:brain-circuit",
            "settings": {
                "input_path": "",
                "input_type": "auto",
                "task": "custom",
                "strategy": "auto",
                "model": "unknown-model",
                "provider": "auto",
                "context_window": 8192,
                "reserved_output": 1024,
                "reserved_system": 512,
                "chunk_fraction": 0.65,
                "hierarchical_threshold": 12,
                "preserve_references": True,
                "max_chunks": 200,
            },
            "inputs": [
                {
                    "name": "data",
                    "type": "json",
                    "title": "Input data",
                    "label": "Upstream data",
                    "accepts": [
                        "text",
                        "json",
                        "transcript",
                        "document",
                    ],
                    "required": True,
                    "description": (
                        "Connect any upstream node producing "
                        "text, JSON, transcript or structured data."
                    ),
                }
            ],
            "input_types": [
                "text",
                "json",
            ],
            "output_types": [
                "json",
                "text",
            ],
        }
    }

    parameter_fields = {
        "context.smart": {
            "input_path": {
                "type": "string",
                "widget": "upstream",
                "title": "Input Data",
                "accepts": ["text", "json"],
            },
            "input_type": {
                "type": "string",
                "title": "Input Type",
                "options": [
                    {"value": "auto", "label": "Auto Detect"},
                    {"value": "text", "label": "Text"},
                    {"value": "json", "label": "JSON"},
                    {
                        "value": "transcript",
                        "label": "Transcript",
                    },
                    {
                        "value": "document",
                        "label": "Document",
                    },
                    {
                        "value": "records",
                        "label": "Database Records",
                    },
                    {
                        "value": "media_metadata",
                        "label": "Media Metadata",
                    },
                ],
            },
            "task": {
                "type": "string",
                "title": "Task",
                "options": [
                    {"value": "custom", "label": "Custom"},
                    {
                        "value": "summarize",
                        "label": "Summarization",
                    },
                    {
                        "value": "extract",
                        "label": "Extraction",
                    },
                    {
                        "value": "classify",
                        "label": "Classification",
                    },
                    {
                        "value": "highlights",
                        "label": "Highlights",
                    },
                    {
                        "value": "question_answer",
                        "label": "Question Answering",
                    },
                ],
            },
            "strategy": {
                "type": "string",
                "title": "Processing Strategy",
                "options": [
                    {
                        "value": "auto",
                        "label": "Auto",
                    },
                    {
                        "value": "direct",
                        "label": "Direct",
                    },
                    {
                        "value": "chunked",
                        "label": "Chunked",
                    },
                    {
                        "value": "hierarchical",
                        "label": "Hierarchical",
                    },
                ],
            },
            "provider": {
                "type": "string",
                "title": "AI Provider",
                "options": [
                    {"value": "auto", "label": "Auto"},
                    {"value": "gemini", "label": "Gemini"},
                    {"value": "openai", "label": "OpenAI"},
                    {"value": "ollama", "label": "Ollama"},
                    {"value": "custom", "label": "Custom"},
                ],
            },
            "model": {
                "type": "string",
                "title": "AI Model",
                "description": (
                    "Used for context planning only. "
                    "Does not execute the model."
                ),
            },
            "context_window": {
                "type": "integer",
                "title": "Context Window",
                "minimum": 1024,
                "maximum": 10000000,
                "group": "Advanced",
            },
            "reserved_output": {
                "type": "integer",
                "title": "Reserved Output Tokens",
                "minimum": 0,
                "group": "Advanced",
            },
            "reserved_system": {
                "type": "integer",
                "title": "Reserved System Tokens",
                "minimum": 0,
                "group": "Advanced",
            },
            "chunk_fraction": {
                "type": "number",
                "title": "Chunk Budget Fraction",
                "minimum": 0.1,
                "maximum": 1,
                "group": "Advanced",
            },
            "hierarchical_threshold": {
                "type": "integer",
                "title": "Hierarchical Threshold",
                "minimum": 2,
                "group": "Advanced",
            },
            "preserve_references": {
                "type": "boolean",
                "title": "Preserve References",
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
    def _progress(
        node: dict[str, Any],
        stage: str,
        message: str,
        progress: float,
    ) -> None:
        callback = node.get("_progress_callback")

        if callable(callback):
            callback({
                "stage": stage,
                "message": message,
                "progress": max(
                    0.0,
                    min(99.0, float(progress)),
                ),
            })

    @staticmethod
    def _integer(
        settings: dict[str, Any],
        name: str,
        default: int,
        minimum: int,
        maximum: int,
    ) -> int:
        value = settings.get(name, default)

        if type(value) is not int:
            raise ValueError(
                f"{name} must be an integer"
            )

        if not minimum <= value <= maximum:
            raise ValueError(
                f"{name} must be between "
                f"{minimum} and {maximum}"
            )

        return value

    @staticmethod
    def _float(
        settings: dict[str, Any],
        name: str,
        default: float,
    ) -> float:
        import math

        value = settings.get(name, default)

        if (
            isinstance(value, bool)
            or not isinstance(value, (int, float))
        ):
            raise ValueError(
                f"{name} must be a number"
            )

        value = float(value)

        if (
            not math.isfinite(value)
            or not 0 < value <= 1
        ):
            raise ValueError(
                f"{name} must be greater than 0 "
                "and at most 1"
            )

        return value

    @staticmethod
    def _resolve_input(
        settings: dict[str, Any],
        outputs: dict[str, Any],
    ) -> tuple[str, Any]:
        """Return the selected source ID and original payload."""

        path = str(
            settings.get("input_path") or ""
        ).strip()

        if path:
            value = resolve_input_path(
                outputs,
                path,
            )

            source_id = path.split(".", 1)[0]

            return source_id, value

        if not outputs:
            raise ValueError(
                "Smart Context requires connected input data"
            )

        if len(outputs) == 1:
            source_id, value = next(
                iter(outputs.items())
            )

            return str(source_id), value

        inferred = infer_text_input(outputs)

        if inferred is not None:
            source_path, value = inferred

            return (
                str(source_path).split(".", 1)[0],
                value,
            )

        raise ValueError(
            "Multiple upstream inputs detected. "
            "Select Input Data explicitly."
        )

    def execute_operation(
        self,
        operation: str,
        node: dict[str, Any],
        outputs: dict[str, Any],
        source: Path | None,
        workdir: Path,
    ) -> dict[str, Any]:
        if operation != "context.smart":
            raise ValueError(
                f"Unsupported operation: {operation}"
            )

        settings = node.get("settings") or {}

        if not isinstance(settings, dict):
            raise ValueError(
                "Smart Context settings must be an object"
            )

        self._progress(
            node,
            "reading_input",
            "Reading connected workflow data",
            5,
        )

        source_id, value = self._resolve_input(
            settings,
            outputs,
        )

        input_type = str(
            settings.get("input_type") or "auto"
        )

        task = str(
            settings.get("task") or "custom"
        )

        strategy = str(
            settings.get("strategy") or "auto"
        )

        provider = str(
            settings.get("provider") or "auto"
        ).lower()

        model = str(
            settings.get("model") or "unknown-model"
        )

        context_window = self._integer(
            settings,
            "context_window",
            8192,
            1024,
            10000000,
        )

        reserved_output = self._integer(
            settings,
            "reserved_output",
            1024,
            0,
            10000000,
        )

        reserved_system = self._integer(
            settings,
            "reserved_system",
            512,
            0,
            10000000,
        )

        hierarchical_threshold = self._integer(
            settings,
            "hierarchical_threshold",
            12,
            2,
            100000,
        )

        max_chunks = self._integer(
            settings,
            "max_chunks",
            200,
            1,
            10000,
        )

        chunk_fraction = self._float(
            settings,
            "chunk_fraction",
            0.65,
        )

        preserve_references = settings.get(
            "preserve_references",
            True,
        )

        if type(preserve_references) is not bool:
            raise ValueError(
                "preserve_references must be boolean"
            )

        self._progress(
            node,
            "normalizing",
            "Normalizing input and preserving references",
            20,
        )

        normalizer = InputNormalizer()

        items = normalizer.normalize(
            value,
            source_id=source_id,
            input_type=input_type,
        )

        if not items:
            raise ValueError(
                "Smart Context received no usable items"
            )

        self._progress(
            node,
            "estimating",
            "Estimating context token requirements",
            40,
        )

        estimator = TokenEstimator()

        budget = estimator.calculate_budget(
            model=model,
            provider=provider,
            context_window=context_window,
            reserved_output=reserved_output,
            reserved_system=reserved_system,
        )

        options = StrategyOptions(
            strategy=strategy,
            input_type=input_type,
            task=task,
            chunk_fraction=chunk_fraction,
            hierarchical_threshold=hierarchical_threshold,
            preserve_references=preserve_references,
        )

        planner = StrategyPlanner(estimator)

        plan = planner.plan(
            items,
            budget=budget,
            options=options,
        )

        self._progress(
            node,
            "planning",
            f"Selected {plan.strategy} processing",
            60,
        )

        chunk_target = (
            budget.usable_input
            if plan.strategy == "direct"
            else plan.chunk_target_tokens
        )

        chunker = AdaptiveChunker(estimator)

        chunks = chunker.chunk(
            items,
            options=ChunkOptions(
                target_tokens=chunk_target,
                max_chunks=max_chunks,
                preserve_references=preserve_references,
            ),
            budget=budget,
        )

        if plan.strategy == "direct" and len(chunks) != 1:
            raise ValueError(
                "Direct input could not be serialized into "
                "one chunk within the context budget. "
                "Use Auto or Chunked strategy."
            )

        self._progress(
            node,
            "finalizing",
            f"Prepared {len(chunks)} context chunks",
            95,
        )

        warnings = list(plan.warnings)

        if provider == "auto":
            warnings.append(
                "AI provider is not resolved automatically "
                "yet; configure the verified model budget."
            )

        if plan.strategy == "hierarchical":
            warnings.append(
                "Hierarchical AI aggregation is not executed "
                "by Smart Context. Connect an AI Batch Processor."
            )

        result = {
            "status": "completed",
            "method": "smart_context",
            "source_id": source_id,
            "input_type": plan.input_type,
            "task": plan.task,
            "strategy": plan.strategy,
            "processing_status": "ready",
            "requires_ai_processing": True,
            "plan": plan.to_dict(),
            "budget": budget.to_dict(),
            "total_items": len(items),
            "total_chunks": len(chunks),
            "estimated_input_tokens": (
                plan.estimated_input_tokens
            ),
            "chunks": [
                chunk.to_dict()
                for chunk in chunks
            ],
            "warnings": warnings,
        }

        if plan.strategy == "direct":
            result["text"] = chunks[0].text

        return result
