
"""Bounded context memory for CLIPTORA Smart Context Manager.

Keeps structured summaries of previously analyzed chunks.

Features:
- Provider-independent memory
- Token-budgeted context retrieval
- Chronological or relevance-based selection
- Source reference preservation
- JSON import/export
- Duplicate entry replacement
- No external API calls or automatic AI summarization

Memory is scoped to one processing session. Persistence must be
implemented separately by the authenticated workflow layer.
"""

from __future__ import annotations

import json
import math
import re
from dataclasses import asdict, dataclass, field
from typing import Any

from app.services.context.ContextSchemas import (
    ContextReference,
)
from app.services.context.TokenEstimator import (
    TokenEstimator,
)


@dataclass(slots=True)
class MemoryEntry:
    id: str
    summary: str
    source_chunk_id: str

    references: list[ContextReference] = field(
        default_factory=list
    )

    keywords: list[str] = field(
        default_factory=list
    )

    metadata: dict[str, Any] = field(
        default_factory=dict
    )

    index: int = 0

    def __post_init__(self) -> None:
        for name in (
            "id",
            "summary",
            "source_chunk_id",
        ):
            value = getattr(self, name)

            if (
                not isinstance(value, str)
                or not value.strip()
            ):
                raise ValueError(
                    f"{name} must be a nonempty string"
                )

        if (
            type(self.index) is not int
            or self.index < 0
        ):
            raise ValueError(
                "Memory index must be nonnegative"
            )

        if (
            not isinstance(self.references, list)
            or not all(
                isinstance(item, ContextReference)
                for item in self.references
            )
        ):
            raise ValueError(
                "Memory references are invalid"
            )

        if (
            not isinstance(self.keywords, list)
            or not all(
                isinstance(item, str)
                for item in self.keywords
            )
        ):
            raise ValueError(
                "Memory keywords must be strings"
            )

        if not isinstance(self.metadata, dict):
            raise ValueError(
                "Memory metadata must be an object"
            )

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


class ContextMemory:
    """In-memory, token-bounded context for one workflow execution."""

    MAX_ENTRIES = 5000
    MAX_SUMMARY_CHARS = 50000
    MAX_KEYWORDS = 50

    _WORDS = re.compile(
        r"[^\W_]+",
        re.UNICODE,
    )

    def __init__(
        self,
        *,
        estimator: TokenEstimator | None = None,
        max_entries: int = 1000,
        default_token_budget: int = 1500,
    ) -> None:
        if (
            type(max_entries) is not int
            or not 1 <= max_entries <= self.MAX_ENTRIES
        ):
            raise ValueError(
                "max_entries must be between 1 and 5000"
            )

        if (
            type(default_token_budget) is not int
            or default_token_budget < 1
        ):
            raise ValueError(
                "default_token_budget must be positive"
            )

        self.estimator = estimator or TokenEstimator()
        self.max_entries = max_entries
        self.default_token_budget = default_token_budget

        self._entries: list[MemoryEntry] = []

    @property
    def entries(self) -> list[MemoryEntry]:
        return list(self._entries)

    def __len__(self) -> int:
        return len(self._entries)

    @classmethod
    def _terms(cls, text: str) -> set[str]:
        return {
            match.group().casefold()
            for match in cls._WORDS.finditer(text)
            if len(match.group()) >= 2
        }

    @classmethod
    def _normalize_keywords(
        cls,
        keywords: list[str] | None,
    ) -> list[str]:
        if keywords is None:
            return []

        if not isinstance(keywords, list):
            raise ValueError(
                "keywords must be a list"
            )

        result: list[str] = []
        seen: set[str] = set()

        for value in keywords:
            if not isinstance(value, str):
                raise ValueError(
                    "keywords must contain strings"
                )

            word = value.strip()

            if not word:
                continue

            key = word.casefold()

            if key not in seen:
                seen.add(key)
                result.append(word[:120])

            if len(result) >= cls.MAX_KEYWORDS:
                break

        return result

    def add(
        self,
        *,
        entry_id: str,
        summary: str,
        source_chunk_id: str,
        references: list[ContextReference] | None = None,
        keywords: list[str] | None = None,
        metadata: dict[str, Any] | None = None,
        index: int | None = None,
    ) -> MemoryEntry:
        """Insert or replace one structured chunk summary."""

        if (
            not isinstance(summary, str)
            or not summary.strip()
            or len(summary) > self.MAX_SUMMARY_CHARS
        ):
            raise ValueError(
                "Summary must contain 1 to 50000 characters"
            )

        existing = next(
            (
                item
                for item in self._entries
                if item.id == entry_id
            ),
            None,
        )

        if index is None:
            index = (
                existing.index
                if existing is not None
                else max(
                    (item.index for item in self._entries),
                    default=-1,
                ) + 1
            )

        entry = MemoryEntry(
            id=entry_id,
            summary=summary.strip(),
            source_chunk_id=source_chunk_id,
            references=list(references or []),
            keywords=self._normalize_keywords(keywords),
            metadata=dict(metadata or {}),
            index=index,
        )

        if existing is not None:
            self._entries = [
                item
                for item in self._entries
                if item.id != entry_id
            ]

        self._entries.append(entry)
        self._entries.sort(
            key=lambda item: (item.index, item.id)
        )

        while len(self._entries) > self.max_entries:
            self._entries.pop(0)

        return entry

    def get(
        self,
        entry_id: str,
    ) -> MemoryEntry | None:
        return next(
            (
                item
                for item in self._entries
                if item.id == entry_id
            ),
            None,
        )

    def remove(self, entry_id: str) -> bool:
        before = len(self._entries)

        self._entries = [
            item
            for item in self._entries
            if item.id != entry_id
        ]

        return len(self._entries) != before

    def clear(self) -> None:
        self._entries.clear()

    def _relevance(
        self,
        entry: MemoryEntry,
        query: str,
    ) -> float:
        query_terms = self._terms(query)

        if not query_terms:
            return 0.0

        entry_terms = self._terms(
            entry.summary + " " + " ".join(entry.keywords)
        )

        if not entry_terms:
            return 0.0

        overlap = len(
            query_terms.intersection(entry_terms)
        )

        return overlap / max(
            1,
            len(query_terms),
        )

    def select(
        self,
        *,
        query: str = "",
        token_budget: int | None = None,
        strategy: str = "recent",
        before_index: int | None = None,
    ) -> list[MemoryEntry]:
        """Retrieve complete summaries that fit the token budget.

        recent: prioritize newest entries.
        relevant: prioritize overlapping query terms.
        chronological: prioritize earliest entries.

        Results are always returned in chronological order.
        """

        if strategy not in {
            "recent",
            "relevant",
            "chronological",
        }:
            raise ValueError(
                "Unsupported memory selection strategy"
            )

        budget = (
            self.default_token_budget
            if token_budget is None
            else token_budget
        )

        if type(budget) is not int or budget < 0:
            raise ValueError(
                "token_budget must be nonnegative"
            )

        if (
            before_index is not None
            and (
                type(before_index) is not int
                or before_index < 0
            )
        ):
            raise ValueError(
                "before_index must be nonnegative"
            )

        candidates = [
            entry
            for entry in self._entries
            if (
                before_index is None
                or entry.index < before_index
            )
        ]

        if strategy == "recent":
            candidates.sort(
                key=lambda entry: entry.index,
                reverse=True,
            )

        elif strategy == "relevant":
            candidates.sort(
                key=lambda entry: (
                    -self._relevance(entry, query),
                    -entry.index,
                )
            )

        else:
            candidates.sort(
                key=lambda entry: entry.index
            )

        chosen: list[MemoryEntry] = []
        used = 0

        for entry in candidates:
            entry_tokens = self.estimator.estimate_text(
                entry.summary
            ) + 24

            if used + entry_tokens > budget:
                continue

            chosen.append(entry)
            used += entry_tokens

        return sorted(
            chosen,
            key=lambda entry: (
                entry.index,
                entry.id,
            ),
        )

    def build_context(
        self,
        *,
        query: str = "",
        token_budget: int | None = None,
        strategy: str = "recent",
        before_index: int | None = None,
    ) -> dict[str, Any]:
        """Build provider-independent context data for a later AI request."""

        selected = self.select(
            query=query,
            token_budget=token_budget,
            strategy=strategy,
            before_index=before_index,
        )

        entries = [
            {
                "id": item.id,
                "chunk_id": item.source_chunk_id,
                "index": item.index,
                "summary": item.summary,
                "keywords": list(item.keywords),
                "references": [
                    ref.to_dict()
                    for ref in item.references
                ],
            }
            for item in selected
        ]

        text = "\n\n".join(
            f"[Chunk {item.source_chunk_id}] "
            f"{item.summary}"
            for item in selected
        )

        return {
            "text": text,
            "entries": entries,
            "selected_count": len(entries),
            "total_available": len(self._entries),
            "estimated_tokens": self.estimator.estimate_text(
                text
            ),
            "strategy": strategy,
        }

    def export_json(self) -> dict[str, Any]:
        """Create a serializable snapshot; does not persist it."""

        return {
            "version": 1,
            "entries": [
                entry.to_dict()
                for entry in self._entries
            ],
        }

    def import_json(
        self,
        payload: dict[str, Any],
        *,
        replace: bool = True,
    ) -> int:
        """Import a previously exported context snapshot."""

        if not isinstance(payload, dict):
            raise ValueError(
                "Memory snapshot must be an object"
            )

        if payload.get("version") != 1:
            raise ValueError(
                "Unsupported memory snapshot version"
            )

        raw_entries = payload.get("entries")

        if not isinstance(raw_entries, list):
            raise ValueError(
                "Memory snapshot entries must be a list"
            )

        if len(raw_entries) > self.MAX_ENTRIES:
            raise ValueError(
                "Memory snapshot contains too many entries"
            )

        restored: list[MemoryEntry] = []

        for raw in raw_entries:
            if not isinstance(raw, dict):
                raise ValueError(
                    "Invalid memory entry"
                )

            refs: list[ContextReference] = []

            for ref in raw.get("references") or []:
                if not isinstance(ref, dict):
                    raise ValueError(
                        "Invalid memory reference"
                    )

                refs.append(
                    ContextReference(**ref)
                )

            restored.append(
                MemoryEntry(
                    id=raw["id"],
                    summary=raw["summary"],
                    source_chunk_id=raw["source_chunk_id"],
                    references=refs,
                    keywords=self._normalize_keywords(
                        raw.get("keywords")
                    ),
                    metadata=raw.get("metadata") or {},
                    index=raw.get("index", 0),
                )
            )

        previous = list(self._entries)

        try:
            if replace:
                self.clear()

            for entry in restored:
                self.add(
                    entry_id=entry.id,
                    summary=entry.summary,
                    source_chunk_id=entry.source_chunk_id,
                    references=entry.references,
                    keywords=entry.keywords,
                    metadata=entry.metadata,
                    index=entry.index,
                )

        except Exception:
            self._entries = previous
            raise

        return len(restored)

    def statistics(self) -> dict[str, Any]:
        total_tokens = sum(
            self.estimator.estimate_text(
                entry.summary
            )
            for entry in self._entries
        )

        return {
            "entries": len(self._entries),
            "estimated_summary_tokens": total_tokens,
            "max_entries": self.max_entries,
            "default_token_budget": self.default_token_budget,
        }
