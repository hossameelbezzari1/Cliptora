
"""Universal chunk result merger for CLIPTORA Smart Context.

Supports:
- Collecting independent chunk results
- Removing duplicate extracted items
- Combining structured JSON objects
- Preserving original references and provenance
- Reporting missing or failed chunk results
- Configurable JSON conflict handling

This module never calls AI providers or invents source references.
"""

from __future__ import annotations

import copy
import json
import math
import re
from dataclasses import dataclass
from typing import Any, Literal


MergeMode = Literal[
    "collect",
    "deduplicate",
    "structured",
]

ConflictPolicy = Literal[
    "first",
    "last",
    "error",
]


@dataclass(frozen=True, slots=True)
class MergeOptions:
    mode: MergeMode = "collect"
    field: str = "items"
    conflict_policy: ConflictPolicy = "last"
    allow_partial: bool = False
    max_items: int = 100000

    def __post_init__(self) -> None:
        if self.mode not in {
            "collect",
            "deduplicate",
            "structured",
        }:
            raise ValueError(
                "Invalid result merge mode"
            )

        if (
            not isinstance(self.field, str)
            or not self.field.strip()
        ):
            raise ValueError(
                "Merge field must be a nonempty string"
            )

        if self.conflict_policy not in {
            "first",
            "last",
            "error",
        }:
            raise ValueError(
                "Invalid merge conflict policy"
            )

        if type(self.allow_partial) is not bool:
            raise ValueError(
                "allow_partial must be boolean"
            )

        if (
            type(self.max_items) is not int
            or not 1 <= self.max_items <= 1000000
        ):
            raise ValueError(
                "max_items must be between 1 and 1000000"
            )


class ResultMerger:
    """Combine AI or non-AI results from independent chunks."""

    MAX_CHUNKS = 100000

    @staticmethod
    def _canonical(value: Any) -> str:
        return json.dumps(
            value,
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
            allow_nan=False,
        )

    @staticmethod
    def _validate_json(value: Any) -> None:
        def walk(item: Any) -> None:
            if item is None or isinstance(
                item, (str, bool, int)
            ):
                return

            if isinstance(item, float):
                if not math.isfinite(item):
                    raise ValueError(
                        "Non-finite JSON numbers are not allowed"
                    )
                return

            if isinstance(item, list):
                for child in item:
                    walk(child)
                return

            if isinstance(item, dict):
                for key, child in item.items():
                    if not isinstance(key, str):
                        raise ValueError(
                            "JSON object keys must be strings"
                        )
                    walk(child)
                return

            raise ValueError(
                f"Unsupported JSON value: {type(item).__name__}"
            )

        walk(value)

    @staticmethod
    def _references(value: Any) -> list[dict[str, Any]]:
        if value is None:
            return []

        if not isinstance(value, list):
            raise ValueError(
                "References must be an array"
            )

        result = []

        for ref in value:
            if not isinstance(ref, dict):
                raise ValueError(
                    "Each reference must be an object"
                )

            if not str(ref.get("source_id") or "").strip():
                raise ValueError(
                    "Reference source_id is required"
                )

            result.append(copy.deepcopy(ref))

        return result

    @classmethod
    def _union_refs(
        cls,
        left: list[dict],
        right: list[dict],
    ) -> list[dict]:
        result = []
        seen = set()

        for item in [*left, *right]:
            marker = cls._canonical(item)

            if marker not in seen:
                seen.add(marker)
                result.append(copy.deepcopy(item))

        return result

    @staticmethod
    def _dedup_key(item: Any) -> str:
        """Keep distinct identified records even if values match."""

        if isinstance(item, dict):
            for identifier in (
                "id",
                "record_id",
                "item_id",
            ):
                value = item.get(identifier)

                if value is not None and isinstance(
                    value, (str, int)
                ) and not isinstance(value, bool):
                    return f"{identifier}:{value}"

            content = {
                key: value
                for key, value in item.items()
                if key not in {
                    "references",
                    "source_chunk_id",
                    "source_chunk_ids",
                }
            }

        else:
            content = item

        return ResultMerger._canonical(content)

    @staticmethod
    def _extract_items(
        result: Any,
        field: str,
    ) -> list[Any]:
        if isinstance(result, list):
            return result

        if isinstance(result, dict):
            value = result.get(field)

            if value is None:
                for alternative in (
                    "highlights",
                    "records",
                    "items",
                    "results",
                ):
                    if alternative in result:
                        value = result[alternative]
                        break

            if isinstance(value, list):
                return value

            if value is not None:
                return [value]

            # Preserve provider JSON with custom keys instead
            # of silently discarding valid AI responses.
            if result and not (
                set(result).issubset({
                    "summary", "text", "model",
                    "usage", "finish_reason",
                })
                and any(
                    isinstance(result.get(k), str)
                    and result[k].strip()
                    for k in ("summary", "text")
                )
            ):
                return [result]

            return []

        return [result]

    @staticmethod
    def _extract_summary(
        result: Any,
    ) -> str | None:
        if not isinstance(result, dict):
            return None

        for key in ("summary", "text"):
            value = result.get(key)

            if isinstance(value, str) and value.strip():
                return value.strip()

        return None

    @classmethod
    def _deep_merge(
        cls,
        target: dict[str, Any],
        incoming: dict[str, Any],
        policy: ConflictPolicy,
        path: str = "",
    ) -> None:
        for key, value in incoming.items():
            location = f"{path}.{key}" if path else key

            if key not in target:
                target[key] = copy.deepcopy(value)
                continue

            old = target[key]

            if isinstance(old, dict) and isinstance(
                value, dict
            ):
                cls._deep_merge(
                    old, value, policy, location
                )
                continue

            if old == value:
                continue

            if policy == "first":
                continue

            if policy == "last":
                target[key] = copy.deepcopy(value)
                continue

            raise ValueError(
                f"Conflicting values at {location}"
            )

    @staticmethod
    def _chunk_id(
        entry: dict[str, Any],
        index: int,
    ) -> str:
        value = entry.get("chunk_id")

        if value is None:
            value = entry.get("id")

        return str(value) if value is not None else (
            f"chunk_{index + 1:06d}"
        )

    def merge(
        self,
        chunks: list[dict[str, Any]],
        *,
        options: MergeOptions | None = None,
    ) -> dict[str, Any]:
        """Merge results in their supplied original chunk order.

        Each entry should contain:
            chunk_id
            result
            status (optional: completed, failed, skipped)
            references (optional)

        Does not perform AI summarization or timestamp alignment.
        """

        options = options or MergeOptions()

        if not isinstance(options, MergeOptions):
            raise TypeError(
                "options must be MergeOptions"
            )

        if (
            not isinstance(chunks, list)
            or len(chunks) > self.MAX_CHUNKS
        ):
            raise ValueError(
                "Invalid or oversized chunk result collection"
            )

        items: list[dict[str, Any]] = []
        summaries: list[dict[str, Any]] = []
        merged_object: dict[str, Any] = {}

        provenance: list[dict[str, Any]] = []
        warnings: list[str] = []

        dedup_index: dict[str, int] = {}
        duplicates_removed = 0
        failed = 0
        completed = 0
        seen_chunk_ids: set[str] = set()

        for index, entry in enumerate(chunks):
            if not isinstance(entry, dict):
                raise ValueError(
                    f"Chunk result {index} must be an object"
                )

            chunk_id = self._chunk_id(entry, index)

            if chunk_id in seen_chunk_ids:
                raise ValueError(
                    f"Duplicate chunk ID: {chunk_id}"
                )

            seen_chunk_ids.add(chunk_id)

            status = str(
                entry.get("status") or "completed"
            ).lower()

            if status not in {
                "completed",
                "failed",
                "skipped",
            }:
                raise ValueError(
                    f"Unsupported chunk status: {status}"
                )

            if (
                status != "completed"
                or "result" not in entry
            ):
                failed += 1

                message = (
                    f"Chunk {chunk_id} has no completed result"
                )

                if not options.allow_partial:
                    raise ValueError(message)

                warnings.append(message)
                continue

            result = entry["result"]
            self._validate_json(result)

            references = self._references(
                entry.get("references")
            )

            completed += 1

            provenance.append({
                "chunk_id": chunk_id,
                "references": references,
            })

            summary = self._extract_summary(result)

            if summary is not None:
                summaries.append({
                    "chunk_id": chunk_id,
                    "summary": summary,
                    "references": copy.deepcopy(references),
                })

            if options.mode == "structured":
                if not isinstance(result, dict):
                    raise ValueError(
                        "Structured merging requires JSON objects"
                    )

                payload = result.get(options.field, result)

                if not isinstance(payload, dict):
                    raise ValueError(
                        "Structured merge field must be an object"
                    )

                self._deep_merge(
                    merged_object,
                    payload,
                    options.conflict_policy,
                )

                continue

            extracted = self._extract_items(
                result,
                options.field,
            )

            for item in extracted:
                item_refs = (
                    self._references(item.get("references"))
                    if isinstance(item, dict)
                    else []
                )

                if (
                    isinstance(item, dict)
                    and "alignment_status" in item
                ):
                    all_refs = (
                        item_refs
                        if item.get("alignment_status") == "matched"
                        else []
                    )
                else:
                    all_refs = self._union_refs(
                        references,
                        item_refs,
                    )

                if options.mode == "deduplicate":
                    marker = self._dedup_key(item)

                    if marker in dedup_index:
                        existing = items[
                            dedup_index[marker]
                        ]

                        existing["references"] = (
                            self._union_refs(
                                existing["references"],
                                all_refs,
                            )
                        )

                        if chunk_id not in existing[
                            "source_chunk_ids"
                        ]:
                            existing[
                                "source_chunk_ids"
                            ].append(chunk_id)

                        duplicates_removed += 1
                        continue

                if len(items) >= options.max_items:
                    raise ValueError(
                        "Maximum merged item count exceeded"
                    )

                row = {
                    "value": copy.deepcopy(item),
                    "source_chunk_ids": [chunk_id],
                    "references": all_refs,
                }

                if options.mode == "deduplicate":
                    dedup_index[marker] = len(items)

                items.append(row)

        status = (
            "partial"
            if failed
            else "completed"
        )

        return {
            "status": status,
            "mode": options.mode,
            "items": items,
            "summaries": summaries,
            "merged_object": merged_object,
            "provenance": provenance,
            "chunks_total": len(chunks),
            "chunks_processed": completed,
            "chunks_failed": failed,
            "items_count": len(items),
            "duplicates_removed": duplicates_removed,
            "warnings": warnings,
        }

    def merge_json(
        self,
        chunks: list[dict[str, Any]],
        *,
        options: MergeOptions | None = None,
    ) -> str:
        """Return the merged result as formatted JSON text."""

        return json.dumps(
            self.merge(
                chunks,
                options=options,
            ),
            ensure_ascii=False,
            indent=2,
            allow_nan=False,
        )
