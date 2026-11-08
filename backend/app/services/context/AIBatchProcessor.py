
"""Provider-independent batch execution for CLIPTORA Smart Context.

Executes prepared context chunks through an injected processor callback.

Features:
- Sequential, ordered execution
- Progress reporting
- Cancellation checks
- Optional bounded retries
- Token-budgeted memory from previous chunk summaries
- Result merging and provenance
- Explicit partial-failure handling
- No API credentials, network clients or persistent global state

The caller is responsible for connecting an authenticated AI provider.
Hierarchical aggregation is NOT performed by this module.
"""

from __future__ import annotations

import json
import math
from dataclasses import dataclass
from typing import Any, Callable

from app.services.context.ContextMemory import ContextMemory
from app.services.context.ContextSchemas import (
    ContextReference,
)
from app.services.context.ResultMerger import (
    MergeOptions,
    ResultMerger,
)
from app.services.context.TokenEstimator import TokenEstimator


Processor = Callable[
    [dict[str, Any], dict[str, Any]],
    Any,
]

ProgressCallback = Callable[[dict[str, Any]], None]
CancelCallback = Callable[[], bool]
RetryCallback = Callable[[Exception], bool]


@dataclass(frozen=True, slots=True)
class BatchOptions:
    merge_mode: str = "collect"
    merge_field: str = "items"
    conflict_policy: str = "last"

    allow_partial: bool = False
    max_retries: int = 0
    max_chunks: int = 10000
    max_merged_items: int = 100000

    use_memory: bool = False
    memory_token_budget: int = 1000
    memory_strategy: str = "recent"

    def __post_init__(self) -> None:
        if self.merge_mode not in {
            "collect",
            "deduplicate",
            "structured",
        }:
            raise ValueError("Invalid merge_mode")

        if (
            not isinstance(self.merge_field, str)
            or not self.merge_field.strip()
        ):
            raise ValueError("merge_field must be nonempty")

        if self.conflict_policy not in {
            "first",
            "last",
            "error",
        }:
            raise ValueError("Invalid conflict_policy")

        if type(self.allow_partial) is not bool:
            raise ValueError("allow_partial must be boolean")

        if type(self.use_memory) is not bool:
            raise ValueError("use_memory must be boolean")

        if (
            type(self.max_retries) is not int
            or not 0 <= self.max_retries <= 5
        ):
            raise ValueError("max_retries must be between 0 and 5")

        if (
            type(self.max_chunks) is not int
            or not 1 <= self.max_chunks <= 10000
        ):
            raise ValueError("max_chunks must be between 1 and 10000")

        if (
            type(self.max_merged_items) is not int
            or not 1 <= self.max_merged_items <= 1000000
        ):
            raise ValueError(
                "max_merged_items must be between 1 and 1000000"
            )

        if (
            type(self.memory_token_budget) is not int
            or not 0 <= self.memory_token_budget <= 1000000
        ):
            raise ValueError(
                "memory_token_budget must be between 0 and 1000000"
            )

        if self.memory_strategy not in {
            "recent",
            "relevant",
            "chronological",
        }:
            raise ValueError("Invalid memory_strategy")


class BatchCancelled(Exception):
    """Raised when a caller requests batch cancellation."""


class AIBatchProcessor:
    """Execute Smart Context chunks with any compatible provider."""

    COMPACT_HIGHLIGHT_FIELDS = (
        "title",
        "selected_text",
        "start",
        "end",
        "duration",
        "score",
        "reason",
    )

    def __init__(
        self,
        *,
        estimator: TokenEstimator | None = None,
    ) -> None:
        self.estimator = estimator or TokenEstimator()

    @staticmethod
    def _validate_chunks(
        chunks: list[dict[str, Any]],
        max_chunks: int,
    ) -> None:
        if (
            not isinstance(chunks, list)
            or not chunks
            or len(chunks) > max_chunks
        ):
            raise ValueError(
                "Batch needs 1 to max_chunks prepared chunks"
            )

        seen: set[str] = set()

        for position, chunk in enumerate(chunks):
            if not isinstance(chunk, dict):
                raise ValueError(
                    f"Chunk {position} must be an object"
                )

            chunk_id = chunk.get("id")

            if (
                not isinstance(chunk_id, str)
                or not chunk_id.strip()
            ):
                raise ValueError(
                    f"Chunk {position} has no valid ID"
                )

            if chunk_id in seen:
                raise ValueError(
                    f"Duplicate chunk ID: {chunk_id}"
                )

            seen.add(chunk_id)

            if not isinstance(chunk.get("text"), str):
                raise ValueError(
                    f"Chunk {chunk_id} has no text"
                )

            references = chunk.get("references", [])

            if not isinstance(references, list):
                raise ValueError(
                    f"Chunk {chunk_id} references must be an array"
                )

            for reference in references:
                if not isinstance(reference, dict):
                    raise ValueError(
                        f"Invalid reference in {chunk_id}"
                    )

                ContextReference(**reference)

            if "index" in chunk and (
                type(chunk["index"]) is not int
                or chunk["index"] < 0
            ):
                raise ValueError(
                    f"Invalid chunk index in {chunk_id}"
                )

    @staticmethod
    def _emit(
        callback: ProgressCallback | None,
        *,
        stage: str,
        message: str,
        processed: int,
        total: int,
        chunk_id: str | None = None,
        attempt: int | None = None,
    ) -> None:
        if callback is None:
            return

        progress = (
            round(processed / total * 100, 2)
            if total
            else 100.0
        )

        event: dict[str, Any] = {
            "stage": stage,
            "message": message,
            "progress": progress,
            "processed": processed,
            "total": total,
        }

        if chunk_id is not None:
            event["chunk_id"] = chunk_id

        if attempt is not None:
            event["attempt"] = attempt

        callback(event)

    @staticmethod
    def _summary(result: Any) -> str | None:
        if isinstance(result, str):
            return result.strip() or None

        if not isinstance(result, dict):
            return None

        for field in ("summary", "text"):
            value = result.get(field)

            if isinstance(value, str) and value.strip():
                return value.strip()

        return None

    @classmethod
    def _compact_highlights(
        cls,
        merged: dict[str, Any],
    ) -> list[dict[str, Any]]:
        """Project aligned highlights without references or provenance.

        The full merged output remains untouched for timeline alignment and
        editing. This projection is intended for downstream AI prompts where
        word-level references would waste context tokens.
        """
        candidates: list[dict[str, Any]] = []

        def collect(value: Any) -> None:
            if isinstance(value, dict):
                if isinstance(value.get("selected_text"), str):
                    candidates.append(value)
                    return

                for key in (
                    "highlights", "items", "records", "results"
                ):
                    nested = value.get(key)

                    if isinstance(nested, list):
                        for item in nested:
                            collect(item)
                        return

            elif isinstance(value, list):
                for item in value:
                    collect(item)

        for row in merged.get("items") or []:
            if isinstance(row, dict):
                collect(row.get("value"))

        if not candidates:
            collect(merged.get("merged_object"))

        compact: list[dict[str, Any]] = []

        for candidate in candidates:
            start = candidate.get("start")
            end = candidate.get("end")
            duration = candidate.get("duration")

            if (
                duration is None
                and isinstance(start, (int, float))
                and not isinstance(start, bool)
                and isinstance(end, (int, float))
                and not isinstance(end, bool)
                and end >= start
            ):
                duration = round(end - start, 3)

            values = {
                **candidate,
                "duration": duration,
            }

            compact.append({
                field: values.get(field)
                for field in cls.COMPACT_HIGHLIGHT_FIELDS
            })

        return compact

    @staticmethod
    def _json_result(value: Any) -> Any:
        try:
            json.dumps(
                value,
                ensure_ascii=False,
                allow_nan=False,
            )
        except (TypeError, ValueError, OverflowError) as exc:
            raise ValueError(
                "Provider returned a non-JSON-serializable result"
            ) from exc

        return value

    @staticmethod
    def _references(
        chunk: dict[str, Any],
    ) -> list[ContextReference]:
        return [
            ContextReference(**reference)
            for reference in chunk.get("references", [])
        ]


    @staticmethod
    def _align_highlights(
        result: Any,
        chunk: dict[str, Any],
    ) -> Any:
        """Match selected AI text to original Whisper word timings."""
        if not isinstance(result, dict):
            return result

        field = next(
            (
                name
                for name in (
                    "items", "highlights", "records", "results"
                )
                if isinstance(result.get(name), list)
                and any(
                    isinstance(item, dict)
                    and isinstance(item.get("selected_text"), str)
                    for item in result[name]
                )
            ),
            None,
        )

        if field is None:
            return result

        import re

        source_text = chunk.get("text") or ""
        references = chunk.get("references") or []
        word_refs = [
            ref for ref in references
            if isinstance(ref, dict)
            and ref.get("kind") == "word"
        ]

        words = source_text.split()
        can_align = (
            bool(words)
            and len(words) == len(word_refs)
            and len(word_refs) == len(references)
        )

        def terms(value: str) -> list[str]:
            return [
                part.casefold()
                for part in re.findall(
                    r"\w+", value, flags=re.UNICODE
                )
            ]

        tokens: list[str] = []
        positions: list[int] = []

        if can_align:
            for index, word in enumerate(words):
                for token in terms(word):
                    tokens.append(token)
                    positions.append(index)

        aligned: list[Any] = []

        for item in result[field]:
            if (
                not isinstance(item, dict)
                or not isinstance(item.get("selected_text"), str)
            ):
                aligned.append(item)
                continue

            updated = dict(item)

            for key in ("start", "end", "duration"):
                updated.pop(key, None)

            updated["references"] = []
            updated["alignment_status"] = (
                "unmatched" if can_align else "unavailable"
            )

            selected = terms(item["selected_text"])

            if can_align and selected:
                matches = [
                    index
                    for index in range(
                        len(tokens) - len(selected) + 1
                    )
                    if tokens[
                        index:index + len(selected)
                    ] == selected
                ]

                if len(matches) > 1:
                    updated["alignment_status"] = "ambiguous"

                elif len(matches) == 1:
                    first = positions[matches[0]]
                    last = positions[
                        matches[0] + len(selected) - 1
                    ]

                    chosen = word_refs[first:last + 1]
                    start = chosen[0].get("start")
                    end = chosen[-1].get("end")

                    valid = (
                        isinstance(start, (int, float))
                        and not isinstance(start, bool)
                        and isinstance(end, (int, float))
                        and not isinstance(end, bool)
                        and 0 <= start < end
                        and all(
                            isinstance(
                                ref.get("start"), (int, float)
                            )
                            and isinstance(
                                ref.get("end"), (int, float)
                            )
                            and ref["start"] <= ref["end"]
                            for ref in chosen
                        )
                    )

                    if valid:
                        updated.update({
                            "alignment_status": "matched",
                            "start": start,
                            "end": end,
                            "duration": round(end - start, 3),
                            "word_start_id": chosen[0].get(
                                "item_id"
                            ),
                            "word_end_id": chosen[-1].get(
                                "item_id"
                            ),
                            "matched_text": " ".join(
                                words[first:last + 1]
                            ),
                            "references": [
                                dict(ref) for ref in chosen
                            ],
                        })

            aligned.append(updated)

        return {**result, field: aligned}

    def _memory_context(
        self,
        memory: ContextMemory,
        *,
        query: str,
        index: int,
        options: BatchOptions,
    ) -> dict[str, Any]:
        if (
            not options.use_memory
            or options.memory_token_budget == 0
        ):
            return {
                "text": "",
                "entries": [],
                "selected_count": 0,
                "estimated_tokens": 0,
            }

        available = memory.select(
            query=query,
            token_budget=options.memory_token_budget,
            strategy=options.memory_strategy,
            before_index=index,
        )

        # Build exactly the text that will be sent downstream.
        # Leave room for source labels and separators.
        chosen: list[dict[str, Any]] = []
        sections: list[str] = []

        for entry in available:
            section = (
                f"[Previous chunk {entry.source_chunk_id}]\n"
                f"{entry.summary}"
            )

            candidate = "\n\n".join(
                [*sections, section]
            )

            if (
                self.estimator.estimate_text(candidate)
                > options.memory_token_budget
            ):
                continue

            sections.append(section)

            chosen.append({
                "id": entry.id,
                "chunk_id": entry.source_chunk_id,
                "index": entry.index,
                "summary": entry.summary,
                "references": [
                    ref.to_dict()
                    for ref in entry.references
                ],
            })

        text = "\n\n".join(sections)

        return {
            "text": text,
            "entries": chosen,
            "selected_count": len(chosen),
            "estimated_tokens": (
                self.estimator.estimate_text(text)
            ),
        }

    def run(
        self,
        chunks: list[dict[str, Any]],
        *,
        processor: Processor,
        options: BatchOptions | None = None,
        progress_callback: ProgressCallback | None = None,
        cancelled: CancelCallback | None = None,
        should_retry: RetryCallback | None = None,
        query: str = "",
        strategy: str = "chunked",
    ) -> dict[str, Any]:
        """Process all chunks and combine successful results.

        processor(chunk, memory_context) -> JSON-compatible output

        A processor may invoke the existing authenticated Gemini/OpenAI
        Workflow Node executor. No credentials are accepted here.
        """

        options = options or BatchOptions()

        if not isinstance(options, BatchOptions):
            raise TypeError("options must be BatchOptions")

        if not callable(processor):
            raise TypeError("processor must be callable")

        if progress_callback is not None and not callable(
            progress_callback
        ):
            raise TypeError(
                "progress_callback must be callable"
            )

        if cancelled is not None and not callable(cancelled):
            raise TypeError("cancelled must be callable")

        if should_retry is not None and not callable(
            should_retry
        ):
            raise TypeError("should_retry must be callable")

        if strategy not in {
            "direct",
            "chunked",
            "hierarchical",
        }:
            raise ValueError("Invalid processing strategy")

        self._validate_chunks(
            chunks,
            options.max_chunks,
        )

        total = len(chunks)

        memory = ContextMemory(
            estimator=self.estimator,
            max_entries=min(
                total,
                ContextMemory.MAX_ENTRIES,
            ),
            default_token_budget=max(
                1,
                options.memory_token_budget,
            ),
        )

        completed: list[dict[str, Any]] = []
        errors: list[dict[str, Any]] = []
        chunk_diagnostics: list[dict[str, Any]] = []
        processed = 0

        self._emit(
            progress_callback,
            stage="starting",
            message=f"Preparing {total} chunks",
            processed=0,
            total=total,
        )

        for position, chunk in enumerate(chunks):
            if cancelled is not None and cancelled():
                raise BatchCancelled(
                    f"Batch cancelled after {processed} chunks"
                )

            chunk_id = chunk["id"]

            self._emit(
                progress_callback,
                stage="processing",
                message=(
                    f"Processing chunk {position + 1}/{total}"
                ),
                processed=processed,
                total=total,
                chunk_id=chunk_id,
            )

            context = self._memory_context(
                memory,
                query=query,
                index=position,
                options=options,
            )

            # An independent copy avoids accidental mutation of
            # source chunks by an AI provider adapter.
            request_chunk = {
                **chunk,
                "references": [
                    dict(ref)
                    for ref in chunk.get("references", [])
                ],
            }

            result: Any = None
            failure: Exception | None = None
            attempts = 0

            for attempt in range(
                1,
                options.max_retries + 2,
            ):
                if cancelled is not None and cancelled():
                    raise BatchCancelled(
                        f"Batch cancelled at {chunk_id}"
                    )

                attempts = attempt

                try:
                    result = self._json_result(
                        processor(
                            request_chunk,
                            context,
                        )
                    )
                    failure = None
                    break

                except Exception as exc:
                    failure = exc

                    can_retry = (
                        attempt <= options.max_retries
                        and should_retry is not None
                        and should_retry(exc)
                    )

                    if not can_retry:
                        break

                    self._emit(
                        progress_callback,
                        stage="retrying",
                        message=(
                            f"Retrying {chunk_id} "
                            f"(attempt {attempt + 1})"
                        ),
                        processed=processed,
                        total=total,
                        chunk_id=chunk_id,
                        attempt=attempt + 1,
                    )

            if failure is not None:
                # Keep errors short; do not expose raw provider
                # exception content or possible request secrets.
                error = {
                    "chunk_id": chunk_id,
                    "index": position,
                    "attempts": attempts,
                    "error_type": type(failure).__name__,
                }
                errors.append(error)

                completed.append({
                    "chunk_id": chunk_id,
                    "status": "failed",
                })

                processed += 1

                self._emit(
                    progress_callback,
                    stage="chunk_failed",
                    message=f"Chunk {chunk_id} failed",
                    processed=processed,
                    total=total,
                    chunk_id=chunk_id,
                )

                if not options.allow_partial:
                    raise RuntimeError(
                        f"Batch stopped at chunk {chunk_id} "
                        f"after {attempts} attempt(s)"
                    ) from failure

                continue

            result = self._align_highlights(
                result, chunk
            )

            references = [
                dict(ref)
                for ref in chunk.get("references", [])
            ]

            completed.append({
                "chunk_id": chunk_id,
                "status": "completed",
                "result": result,
                "references": references,
            })

            # Bounded diagnostics; no word-reference duplication.
            preview = json.dumps(
                result, ensure_ascii=False, default=str
            )

            chunk_diagnostics.append({
                "chunk_id": chunk_id,
                "result_type": type(result).__name__,
                "result_keys": (
                    list(result.keys())
                    if isinstance(result, dict)
                    else []
                ),
                "response_preview": preview[:2000],
                "response_truncated": len(preview) > 2000,
            })

            if options.use_memory:
                summary = self._summary(result)

                if summary:
                    # Memory entries are generated ONLY from
                    # provider outputs, never from fake summaries.
                    summary = summary[
                        :ContextMemory.MAX_SUMMARY_CHARS
                    ]

                    memory.add(
                        entry_id=f"memory:{chunk_id}",
                        source_chunk_id=chunk_id,
                        summary=summary,
                        references=self._references(chunk),
                        index=position,
                    )

            processed += 1

            self._emit(
                progress_callback,
                stage="chunk_completed",
                message=(
                    f"Completed chunk {position + 1}/{total}"
                ),
                processed=processed,
                total=total,
                chunk_id=chunk_id,
            )

        self._emit(
            progress_callback,
            stage="merging",
            message="Merging batch results",
            processed=processed,
            total=total,
        )

        merged = ResultMerger().merge(
            completed,
            options=MergeOptions(
                mode=options.merge_mode,
                field=options.merge_field,
                conflict_policy=options.conflict_policy,
                allow_partial=options.allow_partial,
                max_items=options.max_merged_items,
            ),
        )

        warnings = list(merged["warnings"])
        compact_highlights = self._compact_highlights(merged)

        if (
            merged["items_count"] == 0
            and not merged["summaries"]
        ):
            warnings.append(
                "AI provider completed, but no extractable "
                "items or summary were found. Inspect "
                "chunk_diagnostics and Task Prompt."
            )

        if strategy == "hierarchical":
            warnings.append(
                "Chunk-level processing is complete. "
                "Final hierarchical AI aggregation is "
                "not implemented in this processor."
            )

        self._emit(
            progress_callback,
            stage="completed",
            message="Batch processing finished",
            processed=processed,
            total=total,
        )

        return {
            "status": merged["status"],
            "strategy": strategy,
            "total_chunks": total,
            "processed_chunks": processed,
            "successful_chunks": (
                merged["chunks_processed"]
            ),
            "failed_chunks": len(errors),
            "errors": errors,
            "merged": merged,
            "compact_highlights": compact_highlights,
            "memory": memory.export_json(),
            "memory_statistics": memory.statistics(),
            "warnings": warnings,
            "chunk_diagnostics": chunk_diagnostics,
            "requires_final_aggregation": (
                strategy == "hierarchical"
            ),
        }
