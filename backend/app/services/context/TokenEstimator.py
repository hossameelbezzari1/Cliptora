
"""Provider-independent token estimation for CLIPTORA Smart Context.

Token counts are conservative estimates, not exact model tokenization.

Actual model context limits must come from verified capabilities
or explicit configuration. Unknown models use a safe fallback budget.
"""

from __future__ import annotations

import json
import math
import re
from dataclasses import dataclass
from typing import Any, Iterable

from app.services.context.ContextSchemas import (
    ContextItem,
    ContextChunk,
)


@dataclass(frozen=True, slots=True)
class TokenBudget:
    provider: str
    model: str
    context_window: int
    reserved_output: int
    reserved_system: int
    safety_margin: int
    usable_input: int
    estimated_input: int
    fits: bool

    def to_dict(self) -> dict[str, Any]:
        return {
            "provider": self.provider,
            "model": self.model,
            "context_window": self.context_window,
            "reserved_output": self.reserved_output,
            "reserved_system": self.reserved_system,
            "safety_margin": self.safety_margin,
            "usable_input": self.usable_input,
            "estimated_input": self.estimated_input,
            "fits": self.fits,
        }


class TokenEstimator:
    """Estimate context size without invoking AI providers."""

    DEFAULT_CONTEXT_WINDOW = 8192
    DEFAULT_OUTPUT_RESERVE = 1024
    DEFAULT_SYSTEM_RESERVE = 512
    DEFAULT_SAFETY_RATIO = 0.15

    MIN_CONTEXT_WINDOW = 1024
    MAX_CONTEXT_WINDOW = 10_000_000

    _CJK = re.compile(
        r"[\u3400-\u9fff\u3040-\u30ff\uac00-\ud7af]"
    )

    _ARABIC = re.compile(
        r"[\u0600-\u06ff\u0750-\u077f\u08a0-\u08ff]"
    )

    _WORD = re.compile(
        r"[^\W_]+",
        re.UNICODE,
    )

    def __init__(
        self,
        *,
        context_windows: dict[str, int] | None = None,
        default_context_window: int = DEFAULT_CONTEXT_WINDOW,
    ) -> None:
        self.default_context_window = self._validate_window(
            default_context_window
        )

        self.context_windows: dict[str, int] = {}

        for name, limit in (context_windows or {}).items():
            self.register_model(name, limit)

    @classmethod
    def _validate_window(cls, value: int) -> int:
        if (
            type(value) is not int
            or not cls.MIN_CONTEXT_WINDOW
            <= value
            <= cls.MAX_CONTEXT_WINDOW
        ):
            raise ValueError(
                "Context window must be an integer between "
                "1024 and 10000000"
            )

        return value

    @staticmethod
    def _model_key(
        model: str,
        provider: str = "",
    ) -> str:
        model = str(model or "").strip().lower()
        provider = str(provider or "").strip().lower()

        if not model:
            raise ValueError("Model name is required")

        return f"{provider}:{model}" if provider else model

    def register_model(
        self,
        model: str,
        context_window: int,
        *,
        provider: str = "",
    ) -> None:
        """Register a verified or explicitly configured model limit."""

        key = self._model_key(model, provider)

        self.context_windows[key] = self._validate_window(
            context_window
        )

    def model_context_window(
        self,
        model: str,
        *,
        provider: str = "",
    ) -> int:
        """Find configured context window or use the safe fallback."""

        key = self._model_key(model, provider)

        if key in self.context_windows:
            return self.context_windows[key]

        generic_key = self._model_key(model)

        return self.context_windows.get(
            generic_key,
            self.default_context_window,
        )

    def estimate_text(self, text: str) -> int:
        """Estimate tokens with a multilingual safety margin.

        Handles Latin, Arabic, CJK, symbols and whitespace.
        This method deliberately overestimates in many cases.
        It is not a replacement for a model-specific tokenizer.
        """

        if not isinstance(text, str):
            raise TypeError("Expected a string")

        if not text:
            return 0

        cjk_count = len(self._CJK.findall(text))
        arabic_count = len(self._ARABIC.findall(text))

        other_chars = max(
            0,
            len(text) - cjk_count - arabic_count,
        )

        estimated = (
            math.ceil(other_chars / 3)
            + math.ceil(arabic_count / 1.5)
            + cjk_count * 2
        )

        words = len(self._WORD.findall(text))

        estimated = max(
            estimated,
            math.ceil(words * 1.3),
        )

        return max(1, estimated)

    def estimate_json(self, value: Any) -> int:
        """Estimate tokens from a JSON-serializable value."""

        serialized = json.dumps(
            value,
            ensure_ascii=False,
            separators=(",", ":"),
            allow_nan=False,
        )

        return self.estimate_text(serialized)

    def estimate(
        self,
        value: Any,
    ) -> int:
        """Estimate tokens for strings, context objects or JSON data."""

        if value is None:
            return 0

        if isinstance(value, str):
            return self.estimate_text(value)

        if isinstance(value, ContextItem):
            return self.estimate_text(value.text)

        if isinstance(value, ContextChunk):
            return self.estimate_text(value.text)

        return self.estimate_json(value)

    def estimate_items(
        self,
        items: Iterable[ContextItem],
        *,
        per_item_overhead: int = 8,
    ) -> int:
        """Estimate serialized item content with small separators."""

        if (
            type(per_item_overhead) is not int
            or per_item_overhead < 0
        ):
            raise ValueError(
                "per_item_overhead must be nonnegative"
            )

        total = 0

        for item in items:
            if not isinstance(item, ContextItem):
                raise TypeError(
                    "Expected ContextItem objects"
                )

            total += (
                self.estimate_text(item.text)
                + per_item_overhead
            )

        return total

    def estimate_chunks(
        self,
        chunks: Iterable[ContextChunk],
    ) -> int:
        total = 0

        for chunk in chunks:
            if not isinstance(chunk, ContextChunk):
                raise TypeError(
                    "Expected ContextChunk objects"
                )

            total += self.estimate_text(chunk.text)

        return total

    def calculate_budget(
        self,
        *,
        model: str,
        provider: str = "",
        input_data: Any = None,
        context_window: int | None = None,
        reserved_output: int = DEFAULT_OUTPUT_RESERVE,
        reserved_system: int = DEFAULT_SYSTEM_RESERVE,
        safety_ratio: float = DEFAULT_SAFETY_RATIO,
        prompt_overhead: int = 0,
    ) -> TokenBudget:
        """Calculate available input tokens for one model request.

        Does not assume that a model supports its advertised maximum.
        Custom context_window overrides the registered/fallback value.
        """

        model = str(model or "").strip()
        provider = str(provider or "").strip().lower()

        if not model:
            raise ValueError(
                "Model is required"
            )

        window = (
            self._validate_window(context_window)
            if context_window is not None
            else self.model_context_window(
                model,
                provider=provider,
            )
        )

        for name, value in (
            ("reserved_output", reserved_output),
            ("reserved_system", reserved_system),
            ("prompt_overhead", prompt_overhead),
        ):
            if type(value) is not int or value < 0:
                raise ValueError(
                    f"{name} must be a nonnegative integer"
                )

        if (
            isinstance(safety_ratio, bool)
            or not isinstance(safety_ratio, (int, float))
            or not math.isfinite(safety_ratio)
            or not 0 <= safety_ratio < 0.75
        ):
            raise ValueError(
                "safety_ratio must be between 0 and 0.75"
            )

        margin = math.ceil(
            window * safety_ratio
        )

        usable = (
            window
            - reserved_output
            - reserved_system
            - margin
            - prompt_overhead
        )

        if usable <= 0:
            raise ValueError(
                "No usable context tokens remain. "
                "Reduce reserved tokens or increase the "
                "verified context window."
            )

        if isinstance(input_data, list) and all(
            isinstance(item, ContextItem)
            for item in input_data
        ):
            input_tokens = self.estimate_items(
                input_data
            )
        else:
            input_tokens = self.estimate(
                input_data
            )

        return TokenBudget(
            provider=provider or "unknown",
            model=model,
            context_window=window,
            reserved_output=reserved_output,
            reserved_system=reserved_system,
            safety_margin=margin,
            usable_input=usable,
            estimated_input=input_tokens,
            fits=input_tokens <= usable,
        )

    def recommend_chunk_size(
        self,
        budget: TokenBudget,
        *,
        fraction: float = 0.65,
        minimum: int = 128,
    ) -> int:
        """Recommend chunk token target within available input budget."""

        if not isinstance(budget, TokenBudget):
            raise TypeError(
                "Expected TokenBudget"
            )

        if (
            isinstance(fraction, bool)
            or not isinstance(fraction, (int, float))
            or not math.isfinite(fraction)
            or not 0 < fraction <= 1
        ):
            raise ValueError(
                "fraction must be between 0 and 1"
            )

        if type(minimum) is not int or minimum < 1:
            raise ValueError(
                "minimum must be a positive integer"
            )

        target = math.floor(
            budget.usable_input * fraction
        )

        return min(
            budget.usable_input,
            max(
                min(minimum, budget.usable_input),
                target,
            ),
        )
