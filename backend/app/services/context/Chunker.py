
"""Adaptive, reference-preserving chunking for CLIPTORA.

Supports text, documents, transcripts, JSON and database records.

Responsibilities:
- Respect the estimated token budget.
- Prefer natural text boundaries.
- Preserve source references and item IDs.
- Keep structured records intact by default.
- Produce JSON-serializable ContextChunk objects.

No provider calls, file I/O or AI execution.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from typing import Any

from app.services.context.ContextSchemas import (
    ContextChunk,
    ContextItem,
    ContextReference,
)
from app.services.context.TokenEstimator import (
    TokenBudget,
    TokenEstimator,
)


@dataclass(frozen=True, slots=True)
class ChunkOptions:
    target_tokens: int = 3000
    max_chunks: int = 10000
    separator: str = "\n"
    preserve_references: bool = True
    split_oversized_records: bool = False

    def __post_init__(self) -> None:
        if (
            type(self.target_tokens) is not int
            or self.target_tokens < 1
        ):
            raise ValueError(
                "target_tokens must be a positive integer"
            )

        if (
            type(self.max_chunks) is not int
            or self.max_chunks < 1
        ):
            raise ValueError(
                "max_chunks must be a positive integer"
            )

        if not isinstance(self.separator, str):
            raise ValueError(
                "separator must be a string"
            )

        if type(self.preserve_references) is not bool:
            raise ValueError(
                "preserve_references must be boolean"
            )

        if type(self.split_oversized_records) is not bool:
            raise ValueError(
                "split_oversized_records must be boolean"
            )


@dataclass(slots=True)
class _Piece:
    item_id: str
    text: str
    references: list[ContextReference]
    input_type: str
    part_index: int = 0


class AdaptiveChunker:
    """Split normalized context into bounded, referenced chunks."""

    _SENTENCE_END = re.compile(
        r"(?<=[.!?؟。！？])\s+"
    )

    def __init__(
        self,
        estimator: TokenEstimator | None = None,
    ) -> None:
        self.estimator = estimator or TokenEstimator()

    @staticmethod
    def _separator_for(
        previous: _Piece,
        current: _Piece,
        configured: str,
    ) -> str:
        if (
            previous.input_type == "transcript"
            and current.input_type == "transcript"
        ):
            return " "

        if (
            previous.item_id == current.item_id
            and previous.part_index != current.part_index
        ):
            return ""

        return configured

    def _join(
        self,
        pieces: list[_Piece],
        separator: str,
    ) -> str:
        if not pieces:
            return ""

        parts = [pieces[0].text]

        for previous, current in zip(
            pieces,
            pieces[1:],
        ):
            parts.append(
                self._separator_for(
                    previous,
                    current,
                    separator,
                )
            )
            parts.append(current.text)

        return "".join(parts)

    @staticmethod
    def _unique_references(
        pieces: list[_Piece],
    ) -> list[ContextReference]:
        result: list[ContextReference] = []
        seen: set[str] = set()

        for piece in pieces:
            for ref in piece.references:
                key = json.dumps(
                    ref.to_dict(),
                    sort_keys=True,
                    ensure_ascii=False,
                    default=str,
                )

                if key not in seen:
                    seen.add(key)
                    result.append(ref)

        return result

    @staticmethod
    def _item_ids(
        pieces: list[_Piece],
    ) -> list[str]:
        result: list[str] = []
        seen: set[str] = set()

        for piece in pieces:
            if piece.item_id not in seen:
                seen.add(piece.item_id)
                result.append(piece.item_id)

        return result

    def _fits(
        self,
        text: str,
        limit: int,
    ) -> bool:
        return (
            self.estimator.estimate_text(text)
            <= limit
        )

    def _max_fitting_prefix(
        self,
        text: str,
        limit: int,
    ) -> int:
        """Find the longest character prefix fitting the budget."""

        low = 1
        high = len(text)
        best = 0

        while low <= high:
            middle = (low + high) // 2

            if self._fits(text[:middle], limit):
                best = middle
                low = middle + 1
            else:
                high = middle - 1

        return best

    @classmethod
    def _natural_boundary(
        cls,
        text: str,
        position: int,
    ) -> int:
        """Prefer paragraphs, sentences, then whitespace."""

        if position >= len(text):
            return len(text)

        if position < 1:
            return 0

        minimum = max(
            1,
            int(position * 0.5),
        )

        prefix = text[:position]

        paragraph = prefix.rfind("\n\n")

        if paragraph >= minimum:
            return paragraph + 2

        sentence_candidates = list(
            cls._SENTENCE_END.finditer(prefix)
        )

        if sentence_candidates:
            boundary = sentence_candidates[-1].end()

            if boundary >= minimum:
                return boundary

        for marker in ("\n", " ", "\t"):
            boundary = prefix.rfind(marker)

            if boundary >= minimum:
                return boundary + 1

        return position

    def _split_text(
        self,
        text: str,
        limit: int,
    ) -> list[str]:
        """Split text without removing or changing characters."""

        if not text:
            return []

        result: list[str] = []
        remaining = text

        while remaining:
            if self._fits(remaining, limit):
                result.append(remaining)
                break

            fitting = self._max_fitting_prefix(
                remaining,
                limit,
            )

            if fitting < 1:
                raise ValueError(
                    "Token budget is too small to fit "
                    "even one character"
                )

            boundary = self._natural_boundary(
                remaining,
                fitting,
            )

            if boundary < 1:
                boundary = fitting

            piece = remaining[:boundary]

            if not self._fits(piece, limit):
                piece = remaining[:fitting]
                boundary = fitting

            result.append(piece)
            remaining = remaining[boundary:]

        return result

    def _make_pieces(
        self,
        item: ContextItem,
        options: ChunkOptions,
    ) -> list[_Piece]:
        if not item.text:
            return []

        if self._fits(
            item.text,
            options.target_tokens,
        ):
            return [
                _Piece(
                    item_id=item.id,
                    text=item.text,
                    references=(
                        list(item.references)
                        if options.preserve_references
                        else []
                    ),
                    input_type=item.input_type,
                )
            ]

        if (
            item.input_type == "records"
            and not options.split_oversized_records
        ):
            raise ValueError(
                f"Record {item.id!r} exceeds the chunk "
                "token budget. Increase target_tokens or "
                "enable split_oversized_records."
            )

        sections = self._split_text(
            item.text,
            options.target_tokens,
        )

        return [
            _Piece(
                item_id=item.id,
                text=section,
                references=(
                    list(item.references)
                    if options.preserve_references
                    else []
                ),
                input_type=item.input_type,
                part_index=index,
            )
            for index, section in enumerate(sections)
        ]

    def chunk(
        self,
        items: list[ContextItem],
        *,
        options: ChunkOptions | None = None,
        budget: TokenBudget | None = None,
    ) -> list[ContextChunk]:
        """Produce bounded chunks in original item order."""

        if not isinstance(items, list) or not all(
            isinstance(item, ContextItem)
            for item in items
        ):
            raise TypeError(
                "items must be a list of ContextItem"
            )

        options = options or ChunkOptions()

        if not isinstance(options, ChunkOptions):
            raise TypeError(
                "options must be ChunkOptions"
            )

        if budget is not None:
            if not isinstance(budget, TokenBudget):
                raise TypeError(
                    "budget must be TokenBudget"
                )

            if (
                options.target_tokens
                > budget.usable_input
            ):
                raise ValueError(
                    "Chunk target exceeds usable model "
                    "context budget"
                )

        result: list[ContextChunk] = []
        current: list[_Piece] = []

        def flush() -> None:
            if not current:
                return

            if len(result) >= options.max_chunks:
                raise ValueError(
                    "Maximum chunk count exceeded"
                )

            text = self._join(
                current,
                options.separator,
            )

            estimated = (
                self.estimator.estimate_text(text)
            )

            if estimated > options.target_tokens:
                raise RuntimeError(
                    "Internal chunk budget violation"
                )

            index = len(result)

            result.append(
                ContextChunk(
                    id=f"chunk_{index + 1:06d}",
                    index=index,
                    text=text,
                    item_ids=self._item_ids(current),
                    references=self._unique_references(
                        current
                    ),
                    estimated_tokens=estimated,
                    metadata={
                        "item_count": len(
                            self._item_ids(current)
                        ),
                        "piece_count": len(current),
                        "input_types": sorted({
                            piece.input_type
                            for piece in current
                        }),
                    },
                )
            )

            current.clear()

        for item in items:
            pieces = self._make_pieces(
                item,
                options,
            )

            for piece in pieces:
                if current:
                    candidate = self._join(
                        [*current, piece],
                        options.separator,
                    )

                    if not self._fits(
                        candidate,
                        options.target_tokens,
                    ):
                        flush()

                current.append(piece)

                if not self._fits(
                    self._join(
                        current,
                        options.separator,
                    ),
                    options.target_tokens,
                ):
                    raise RuntimeError(
                        "Piece exceeds the chunk budget"
                    )

        flush()

        return result

    def chunk_json(
        self,
        items: list[ContextItem],
        *,
        options: ChunkOptions | None = None,
        budget: TokenBudget | None = None,
    ) -> list[dict[str, Any]]:
        return [
            chunk.to_dict()
            for chunk in self.chunk(
                items,
                options=options,
                budget=budget,
            )
        ]

    def chunk_input(
        self,
        value: Any,
        *,
        source_id: str = "upstream",
        input_type: str = "auto",
        options: ChunkOptions | None = None,
        budget: TokenBudget | None = None,
    ) -> list[ContextChunk]:
        """Normalize raw input and split it in one operation."""

        from app.services.context.InputNormalizer import (
            InputNormalizer,
        )

        items = InputNormalizer().normalize(
            value,
            source_id=source_id,
            input_type=input_type,
        )

        return self.chunk(
            items,
            options=options,
            budget=budget,
        )
