
"""Universal reference resolution for CLIPTORA Smart Context.

Resolve AI-selected references against original normalized source items.

Supported:
- Word and segment identifiers with original timestamps
- PDF pages
- Database record identifiers
- General source items
- Start/end reference ranges

Never generates timestamps, pages or IDs that do not exist
in the original normalized input.

No AI calls, database access or filesystem operations.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from app.services.context.ContextSchemas import (
    ContextItem,
    ContextReference,
)


@dataclass(slots=True)
class ResolutionResult:
    status: str
    references: list[ContextReference] = field(
        default_factory=list
    )
    item_ids: list[str] = field(default_factory=list)
    text: str = ""
    start: float | None = None
    end: float | None = None
    error: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "status": self.status,
            "references": [
                reference.to_dict()
                for reference in self.references
            ],
            "item_ids": list(self.item_ids),
            "text": self.text,
            "start": self.start,
            "end": self.end,
            "error": self.error,
        }


class ReferenceResolver:
    """Resolve only references present in the original input."""

    def __init__(
        self,
        items: list[ContextItem],
    ) -> None:
        if not isinstance(items, list) or not all(
            isinstance(item, ContextItem)
            for item in items
        ):
            raise TypeError(
                "items must contain ContextItem objects"
            )

        self.items = list(items)

        self._by_item_id: dict[str, ContextItem] = {}
        self._by_reference: dict[
            tuple[str, str, str], list[int]
        ] = {}

        for index, item in enumerate(self.items):
            if item.id in self._by_item_id:
                raise ValueError(
                    f"Duplicate context item ID: {item.id}"
                )

            self._by_item_id[item.id] = item

            for reference in item.references:
                if reference.item_id is None:
                    continue

                key = (
                    reference.source_id,
                    reference.kind,
                    reference.item_id,
                )

                self._by_reference.setdefault(
                    key, []
                ).append(index)

    @staticmethod
    def _error(message: str) -> ResolutionResult:
        return ResolutionResult(
            status="unresolved",
            error=message,
        )

    @staticmethod
    def _unique_references(
        items: list[ContextItem],
    ) -> list[ContextReference]:
        result: list[ContextReference] = []

        for item in items:
            for reference in item.references:
                if reference not in result:
                    result.append(reference)

        return result

    @staticmethod
    def _build_result(
        items: list[ContextItem],
    ) -> ResolutionResult:
        if not items:
            return ReferenceResolver._error(
                "No matching source items"
            )

        references = ReferenceResolver._unique_references(
            items
        )

        starts = [
            ref.start
            for ref in references
            if ref.start is not None
        ]

        ends = [
            ref.end
            for ref in references
            if ref.end is not None
        ]

        start = (
            min(starts)
            if len(starts) == len(references)
            else None
        )

        end = (
            max(ends)
            if len(ends) == len(references)
            else None
        )

        if all(
            item.input_type == "transcript"
            for item in items
        ):
            text = " ".join(item.text for item in items)
        else:
            text = "\n".join(item.text for item in items)

        return ResolutionResult(
            status="resolved",
            references=references,
            item_ids=[item.id for item in items],
            text=text,
            start=start,
            end=end,
        )

    def resolve_item(
        self,
        item_id: str,
    ) -> ResolutionResult:
        """Resolve a normalized ContextItem ID."""

        item = self._by_item_id.get(str(item_id))

        if item is None:
            return self._error(
                f"Unknown context item: {item_id}"
            )

        return self._build_result([item])

    def resolve_reference(
        self,
        *,
        source_id: str,
        kind: str,
        item_id: str | int,
    ) -> ResolutionResult:
        """Resolve one original reference without guessing."""

        key = (
            str(source_id),
            str(kind),
            str(item_id),
        )

        matches = self._by_reference.get(key, [])

        if not matches:
            return self._error(
                f"Reference not found: {key}"
            )

        if len(matches) != 1:
            return self._error(
                f"Ambiguous reference: {key}"
            )

        return self._build_result([
            self.items[matches[0]]
        ])

    def resolve_range(
        self,
        *,
        source_id: str,
        kind: str,
        start_id: str | int,
        end_id: str | int,
    ) -> ResolutionResult:
        """Resolve an inclusive range using original item order.

        The complete range must belong to the same source and kind.
        This method does not interpolate missing time information.
        """

        start_key = (
            str(source_id),
            str(kind),
            str(start_id),
        )

        end_key = (
            str(source_id),
            str(kind),
            str(end_id),
        )

        start_matches = self._by_reference.get(
            start_key, []
        )

        end_matches = self._by_reference.get(
            end_key, []
        )

        if (
            len(start_matches) != 1
            or len(end_matches) != 1
        ):
            return self._error(
                "Range boundaries are missing or ambiguous"
            )

        start_index = start_matches[0]
        end_index = end_matches[0]

        if end_index < start_index:
            return self._error(
                "Range end precedes range start"
            )

        selected = self.items[
            start_index:end_index + 1
        ]

        for item in selected:
            matching = [
                ref
                for ref in item.references
                if (
                    ref.source_id == str(source_id)
                    and ref.kind == str(kind)
                )
            ]

            if len(matching) != 1:
                return self._error(
                    "Range crosses an unrelated or ambiguous item"
                )

        return self._build_result(selected)

    def resolve_word_range(
        self,
        *,
        source_id: str,
        start_word_id: str | int,
        end_word_id: str | int,
    ) -> ResolutionResult:
        """Resolve exact Whisper word boundaries."""

        result = self.resolve_range(
            source_id=source_id,
            kind="word",
            start_id=start_word_id,
            end_id=end_word_id,
        )

        if result.status != "resolved":
            return result

        if result.start is None or result.end is None:
            return self._error(
                "Original word timestamps are missing"
            )

        if result.end < result.start:
            return self._error(
                "Invalid source timestamp range"
            )

        return result

    def resolve_selection(
        self,
        selection: dict[str, Any],
        *,
        default_source_id: str | None = None,
    ) -> ResolutionResult:
        """Resolve a structured AI selection.

        Accepted examples:
            {"item_id": "source:record:5"}
            {"source_id": "db", "kind": "record", "ref_id": 5}
            {"source_id": "audio", "start_word_id": 10,
             "end_word_id": 35}
            {"source_id": "pdf", "kind": "page",
             "start_id": 2, "end_id": 4}
        """

        if not isinstance(selection, dict):
            return self._error(
                "Selection must be a JSON object"
            )

        if selection.get("item_id") is not None:
            return self.resolve_item(
                str(selection["item_id"])
            )

        source_id = (
            selection.get("source_id")
            or default_source_id
        )

        if not source_id:
            return self._error(
                "Selection source_id is required"
            )

        if (
            selection.get("start_word_id") is not None
            and selection.get("end_word_id") is not None
        ):
            return self.resolve_word_range(
                source_id=str(source_id),
                start_word_id=selection["start_word_id"],
                end_word_id=selection["end_word_id"],
            )

        kind = str(selection.get("kind") or "item")

        if (
            selection.get("start_id") is not None
            and selection.get("end_id") is not None
        ):
            return self.resolve_range(
                source_id=str(source_id),
                kind=kind,
                start_id=selection["start_id"],
                end_id=selection["end_id"],
            )

        if selection.get("ref_id") is not None:
            return self.resolve_reference(
                source_id=str(source_id),
                kind=kind,
                item_id=selection["ref_id"],
            )

        return self._error(
            "Selection has no supported reference identifier"
        )

    def resolve_many(
        self,
        selections: list[dict[str, Any]],
        *,
        default_source_id: str | None = None,
    ) -> dict[str, Any]:
        """Resolve selections and report failures explicitly."""

        if not isinstance(selections, list):
            raise TypeError(
                "Selections must be an array"
            )

        results = [
            self.resolve_selection(
                selection,
                default_source_id=default_source_id,
            ).to_dict()
            for selection in selections
        ]

        resolved = sum(
            item["status"] == "resolved"
            for item in results
        )

        return {
            "status": (
                "completed"
                if resolved == len(results)
                else "partial"
                if resolved
                else "unresolved"
            ),
            "total": len(results),
            "resolved_count": resolved,
            "unresolved_count": len(results) - resolved,
            "results": results,
        }
