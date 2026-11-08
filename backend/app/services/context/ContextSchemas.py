
"""Universal data contracts for CLIPTORA Smart Context Manager.

Independent from video processing and AI providers.
Supports text, documents, transcripts, JSON, records and metadata.
"""

from __future__ import annotations

import math
from dataclasses import asdict, dataclass, field
from typing import Any, Literal


InputType = Literal[
    "auto",
    "text",
    "json",
    "transcript",
    "document",
    "records",
    "media_metadata",
]

Strategy = Literal[
    "auto",
    "direct",
    "chunked",
    "hierarchical",
]

Task = Literal[
    "custom",
    "summarize",
    "extract",
    "classify",
    "highlights",
    "question_answer",
]

VALID_INPUT_TYPES = frozenset({
    "auto",
    "text",
    "json",
    "transcript",
    "document",
    "records",
    "media_metadata",
})

VALID_STRATEGIES = frozenset({
    "auto",
    "direct",
    "chunked",
    "hierarchical",
})

VALID_TASKS = frozenset({
    "custom",
    "summarize",
    "extract",
    "classify",
    "highlights",
    "question_answer",
})


def _finite_number(value: Any, name: str) -> float:
    if (
        isinstance(value, bool)
        or not isinstance(value, (int, float))
        or not math.isfinite(value)
    ):
        raise ValueError(
            f"{name} must be a finite number"
        )

    return float(value)


@dataclass(frozen=True, slots=True)
class ContextReference:
    """Reference to the original data source."""

    source_id: str
    kind: str = "item"
    item_id: str | None = None

    start: float | None = None
    end: float | None = None

    page: int | None = None
    row: int | None = None

    metadata: dict[str, Any] = field(
        default_factory=dict
    )

    def __post_init__(self) -> None:
        if (
            not isinstance(self.source_id, str)
            or not self.source_id.strip()
        ):
            raise ValueError(
                "Reference source_id is required"
            )

        if (
            not isinstance(self.kind, str)
            or not self.kind.strip()
        ):
            raise ValueError(
                "Reference kind is required"
            )

        if (
            self.item_id is not None
            and not isinstance(self.item_id, str)
        ):
            raise ValueError(
                "Reference item_id must be a string"
            )

        for name in ("start", "end"):
            value = getattr(self, name)

            if (
                value is not None
                and _finite_number(value, name) < 0
            ):
                raise ValueError(
                    f"Reference {name} must be nonnegative"
                )

        if (
            self.start is not None
            and self.end is not None
            and self.end < self.start
        ):
            raise ValueError(
                "Reference end must not precede start"
            )

        for name in ("page", "row"):
            value = getattr(self, name)

            if (
                value is not None
                and (
                    type(value) is not int
                    or value < 0
                )
            ):
                raise ValueError(
                    f"Reference {name} must be a nonnegative integer"
                )

        if not isinstance(self.metadata, dict):
            raise ValueError(
                "Reference metadata must be an object"
            )

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass(slots=True)
class ContextItem:
    """Normalized content with original source references."""

    id: str
    text: str
    input_type: str = "text"

    references: list[ContextReference] = field(
        default_factory=list
    )

    metadata: dict[str, Any] = field(
        default_factory=dict
    )

    def __post_init__(self) -> None:
        if (
            not isinstance(self.id, str)
            or not self.id.strip()
        ):
            raise ValueError(
                "Context item ID is required"
            )

        if not isinstance(self.text, str):
            raise ValueError(
                "Context item text must be a string"
            )

        if (
            self.input_type
            not in VALID_INPUT_TYPES - {"auto"}
        ):
            raise ValueError(
                f"Unsupported context item type: {self.input_type}"
            )

        if (
            not isinstance(self.references, list)
            or not all(
                isinstance(ref, ContextReference)
                for ref in self.references
            )
        ):
            raise ValueError(
                "Context item references are invalid"
            )

        if not isinstance(self.metadata, dict):
            raise ValueError(
                "Context item metadata must be an object"
            )

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass(slots=True)
class ContextChunk:
    """Context segment preserving original item references."""

    id: str
    text: str
    item_ids: list[str]

    references: list[ContextReference] = field(
        default_factory=list
    )

    estimated_tokens: int = 0
    index: int = 0

    metadata: dict[str, Any] = field(
        default_factory=dict
    )

    def __post_init__(self) -> None:
        if (
            not isinstance(self.id, str)
            or not self.id.strip()
        ):
            raise ValueError(
                "Chunk ID is required"
            )

        if not isinstance(self.text, str):
            raise ValueError(
                "Chunk text must be a string"
            )

        if (
            not isinstance(self.item_ids, list)
            or any(
                not isinstance(item, str) or not item
                for item in self.item_ids
            )
        ):
            raise ValueError(
                "Chunk item_ids must contain valid strings"
            )

        if (
            type(self.estimated_tokens) is not int
            or self.estimated_tokens < 0
        ):
            raise ValueError(
                "estimated_tokens must be nonnegative"
            )

        if (
            type(self.index) is not int
            or self.index < 0
        ):
            raise ValueError(
                "Chunk index must be nonnegative"
            )

        if (
            not isinstance(self.references, list)
            or not all(
                isinstance(ref, ContextReference)
                for ref in self.references
            )
        ):
            raise ValueError(
                "Chunk references are invalid"
            )

        if not isinstance(self.metadata, dict):
            raise ValueError(
                "Chunk metadata must be an object"
            )

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass(slots=True)
class ContextPlan:
    """Processing decision, independent of the AI provider."""

    strategy: Strategy
    input_type: InputType
    task: Task

    estimated_input_tokens: int
    usable_context_tokens: int
    chunk_target_tokens: int
    estimated_chunks: int

    reason: str

    model: str | None = None
    provider: str | None = None

    warnings: list[str] = field(
        default_factory=list
    )

    def __post_init__(self) -> None:
        if (
            self.strategy not in VALID_STRATEGIES
            or self.input_type not in VALID_INPUT_TYPES
            or self.task not in VALID_TASKS
        ):
            raise ValueError(
                "Invalid strategy, input type, or task"
            )

        numeric_fields = (
            "estimated_input_tokens",
            "usable_context_tokens",
            "chunk_target_tokens",
            "estimated_chunks",
        )

        for name in numeric_fields:
            value = getattr(self, name)

            if (
                type(value) is not int
                or value < 0
            ):
                raise ValueError(
                    f"{name} must be a nonnegative integer"
                )

        if not isinstance(self.reason, str):
            raise ValueError(
                "Plan reason must be a string"
            )

        if (
            not isinstance(self.warnings, list)
            or any(
                not isinstance(value, str)
                for value in self.warnings
            )
        ):
            raise ValueError(
                "Plan warnings must be strings"
            )

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)
