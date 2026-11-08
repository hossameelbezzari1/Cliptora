
"""Dynamic strategy planning for CLIPTORA Smart Context Manager.

Selects direct, chunked or hierarchical processing using:
- estimated token requirements
- verified/configured model budget
- task semantics
- input characteristics
- user preferences

Planning only: no API calls, file writes or AI execution.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Any

from app.services.context.ContextSchemas import (
    ContextItem,
    ContextPlan,
    VALID_INPUT_TYPES,
    VALID_STRATEGIES,
    VALID_TASKS,
)
from app.services.context.TokenEstimator import (
    TokenBudget,
    TokenEstimator,
)


@dataclass(frozen=True, slots=True)
class StrategyOptions:
    strategy: str = "auto"
    input_type: str = "auto"
    task: str = "custom"

    chunk_fraction: float = 0.65
    hierarchical_threshold: int = 12

    preserve_references: bool = True
    allow_hierarchical: bool = True

    def __post_init__(self) -> None:
        if self.strategy not in VALID_STRATEGIES:
            raise ValueError(
                f"Unsupported strategy: {self.strategy}"
            )

        if self.input_type not in VALID_INPUT_TYPES:
            raise ValueError(
                f"Unsupported input type: {self.input_type}"
            )

        if self.task not in VALID_TASKS:
            raise ValueError(
                f"Unsupported task: {self.task}"
            )

        if (
            isinstance(self.chunk_fraction, bool)
            or not isinstance(self.chunk_fraction, (int, float))
            or not math.isfinite(self.chunk_fraction)
            or not 0 < self.chunk_fraction <= 1
        ):
            raise ValueError(
                "chunk_fraction must be between 0 and 1"
            )

        if (
            type(self.hierarchical_threshold) is not int
            or self.hierarchical_threshold < 2
        ):
            raise ValueError(
                "hierarchical_threshold must be >= 2"
            )

        if type(self.preserve_references) is not bool:
            raise ValueError(
                "preserve_references must be boolean"
            )

        if type(self.allow_hierarchical) is not bool:
            raise ValueError(
                "allow_hierarchical must be boolean"
            )


class StrategyPlanner:
    """Provider-independent automatic context strategy planner."""

    GLOBAL_TASKS = frozenset({
        "summarize",
        "highlights",
        "question_answer",
    })

    LOCAL_TASKS = frozenset({
        "extract",
        "classify",
    })

    def __init__(
        self,
        estimator: TokenEstimator | None = None,
    ) -> None:
        self.estimator = estimator or TokenEstimator()

    @staticmethod
    def _validate_items(
        items: list[ContextItem],
    ) -> None:
        if not isinstance(items, list):
            raise TypeError(
                "items must be a list of ContextItem"
            )

        if not all(
            isinstance(item, ContextItem)
            for item in items
        ):
            raise TypeError(
                "All items must be ContextItem objects"
            )

    @staticmethod
    def _resolve_type(
        items: list[ContextItem],
        requested: str,
    ) -> str:
        if requested != "auto":
            return requested

        if not items:
            return "text"

        types = {
            item.input_type
            for item in items
        }

        if len(types) == 1:
            return next(iter(types))

        return "json"

    def _estimate_input(
        self,
        items: list[ContextItem],
    ) -> int:
        return self.estimator.estimate_items(items)

    @staticmethod
    def _estimated_chunks(
        tokens: int,
        chunk_target: int,
    ) -> int:
        if tokens == 0:
            return 0

        if chunk_target < 1:
            raise ValueError(
                "Chunk target must be positive"
            )

        return math.ceil(
            tokens / chunk_target
        )

    def _automatic_strategy(
        self,
        *,
        input_tokens: int,
        usable_tokens: int,
        estimated_chunks: int,
        options: StrategyOptions,
    ) -> tuple[str, str]:
        if input_tokens <= usable_tokens:
            return (
                "direct",
                "Input fits within the estimated usable context budget.",
            )

        if (
            options.task in self.LOCAL_TASKS
        ):
            return (
                "chunked",
                "The input exceeds the context budget, but "
                "the task can usually be processed per chunk.",
            )

        if (
            options.allow_hierarchical
            and estimated_chunks >= options.hierarchical_threshold
            and options.task in self.GLOBAL_TASKS
        ):
            return (
                "hierarchical",
                "The global task spans many chunks and may "
                "benefit from multi-stage aggregation.",
            )

        if (
            options.allow_hierarchical
            and estimated_chunks >= options.hierarchical_threshold
            and options.task == "custom"
        ):
            return (
                "hierarchical",
                "The custom task exceeds the configured "
                "chunk threshold; multi-stage processing "
                "is recommended, subject to task semantics.",
            )

        return (
            "chunked",
            "Input exceeds the available context budget; "
            "processing in smaller chunks is recommended.",
        )

    def plan(
        self,
        items: list[ContextItem],
        *,
        budget: TokenBudget,
        options: StrategyOptions | None = None,
    ) -> ContextPlan:
        """Return a processing plan without executing it."""

        self._validate_items(items)

        if not isinstance(budget, TokenBudget):
            raise TypeError(
                "budget must be TokenBudget"
            )

        options = options or StrategyOptions()

        if not isinstance(options, StrategyOptions):
            raise TypeError(
                "options must be StrategyOptions"
            )

        if budget.usable_input < 1:
            raise ValueError(
                "No usable input token budget"
            )

        input_type = self._resolve_type(
            items,
            options.input_type,
        )

        estimated_tokens = self._estimate_input(items)

        chunk_target = self.estimator.recommend_chunk_size(
            budget,
            fraction=options.chunk_fraction,
            minimum=128,
        )

        chunk_count = self._estimated_chunks(
            estimated_tokens,
            chunk_target,
        )

        warnings: list[str] = []

        if budget.provider == "unknown":
            warnings.append(
                "Provider is unknown. Context budget may need "
                "verification before AI execution."
            )

        if options.strategy == "auto":
            strategy, reason = self._automatic_strategy(
                input_tokens=estimated_tokens,
                usable_tokens=budget.usable_input,
                estimated_chunks=chunk_count,
                options=options,
            )

        else:
            strategy = options.strategy

            if strategy == "direct":
                if estimated_tokens > budget.usable_input:
                    raise ValueError(
                        "Direct strategy exceeds the usable "
                        "context budget. Use auto, chunked "
                        "or hierarchical processing."
                    )

                reason = (
                    "Direct processing was explicitly selected."
                )

            elif strategy == "hierarchical":
                if not options.allow_hierarchical:
                    raise ValueError(
                        "Hierarchical processing is disabled"
                    )

                reason = (
                    "Hierarchical processing was explicitly selected."
                )

            else:
                reason = (
                    "Chunked processing was explicitly selected."
                )

        if not items:
            warnings.append(
                "Input contains no context items."
            )

        if strategy == "hierarchical":
            warnings.append(
                "Hierarchical processing requires an AI or "
                "custom aggregation executor to combine "
                "results across processing stages."
            )

        if (
            strategy == "chunked"
            and options.task in self.GLOBAL_TASKS
        ):
            warnings.append(
                "A global task may require a final aggregation "
                "step to preserve cross-chunk context."
            )

        if (
            strategy != "direct"
            and not options.preserve_references
        ):
            warnings.append(
                "Reference preservation is disabled. "
                "Original timestamps, page or record "
                "identifiers may be unavailable downstream."
            )

        if (
            input_type in {"transcript", "document", "records"}
            and strategy != "direct"
        ):
            warnings.append(
                "Chunk boundaries must preserve original "
                "source references and must not invent "
                "timestamps or item identifiers."
            )

        if (
            options.task == "question_answer"
            and strategy != "direct"
        ):
            warnings.append(
                "Question answering across large sources may "
                "benefit from retrieval rather than processing "
                "every chunk."
            )

        return ContextPlan(
            strategy=strategy,
            input_type=input_type,
            task=options.task,
            estimated_input_tokens=estimated_tokens,
            usable_context_tokens=budget.usable_input,
            chunk_target_tokens=chunk_target,
            estimated_chunks=(
                1 if strategy == "direct" and items
                else chunk_count
            ),
            reason=reason,
            model=budget.model,
            provider=budget.provider,
            warnings=warnings,
        )

    def plan_input(
        self,
        value: Any,
        *,
        source_id: str = "upstream",
        model: str = "unknown-model",
        provider: str = "",
        context_window: int | None = None,
        reserved_output: int = 1024,
        reserved_system: int = 512,
        options: StrategyOptions | None = None,
    ) -> ContextPlan:
        """Normalize raw data, estimate budget, and select strategy."""

        from app.services.context.InputNormalizer import (
            InputNormalizer,
        )

        options = options or StrategyOptions()

        normalizer = InputNormalizer()

        items = normalizer.normalize(
            value,
            source_id=source_id,
            input_type=options.input_type,
        )

        budget = self.estimator.calculate_budget(
            model=model,
            provider=provider,
            context_window=context_window,
            reserved_output=reserved_output,
            reserved_system=reserved_system,
        )

        return self.plan(
            items,
            budget=budget,
            options=options,
        )

    def plan_json(
        self,
        value: Any,
        *,
        source_id: str = "upstream",
        model: str = "unknown-model",
        provider: str = "",
        context_window: int | None = None,
        reserved_output: int = 1024,
        reserved_system: int = 512,
        options: StrategyOptions | None = None,
    ) -> dict[str, Any]:
        """Return JSON-serializable strategy metadata."""

        result = self.plan_input(
            value,
            source_id=source_id,
            model=model,
            provider=provider,
            context_window=context_window,
            reserved_output=reserved_output,
            reserved_system=reserved_system,
            options=options,
        )

        return result.to_dict()
