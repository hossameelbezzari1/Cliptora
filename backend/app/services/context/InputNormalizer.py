
"""Universal input normalization for CLIPTORA Smart Context.

Converts workflow outputs into ContextItem objects while preserving
source identifiers, timestamps, pages and record references.

No AI provider or video-specific service dependency is required.
"""

from __future__ import annotations

import json
from typing import Any

from app.services.context.ContextSchemas import (
    ContextItem,
    ContextReference,
    VALID_INPUT_TYPES,
)


class InputNormalizer:
    MAX_ITEMS = 100_000
    MAX_TEXT_CHARS = 10_000_000

    def detect_type(self, value: Any) -> str:
        """Detect a supported data type without changing its content."""

        if isinstance(value, str):
            return "text"

        if isinstance(value, list):
            if not value:
                return "records"

            if self._looks_like_words(value):
                return "transcript"

            return "records"

        if isinstance(value, dict):
            if isinstance(value.get("words"), list):
                return "transcript"

            if isinstance(value.get("segments"), list):
                segments = value["segments"]

                if segments and all(
                    isinstance(item, dict)
                    and "text" in item
                    and "start" in item
                    and "end" in item
                    for item in segments
                ):
                    return "transcript"

            if isinstance(value.get("pages"), list):
                return "document"

            for key in ("records", "rows", "items"):
                if isinstance(value.get(key), list):
                    return "records"

            if (
                isinstance(value.get("text"), str)
                and any(
                    key in value
                    for key in (
                        "page",
                        "page_number",
                        "document_id",
                    )
                )
            ):
                return "document"

            if (
                isinstance(value.get("text"), str)
                or isinstance(value.get("transcript"), str)
            ):
                return "text"

            if any(
                key in value
                for key in (
                    "duration",
                    "width",
                    "height",
                    "codec",
                    "mime_type",
                    "format",
                )
            ):
                return "media_metadata"

            return "json"

        return "json"

    @staticmethod
    def _looks_like_words(value: list[Any]) -> bool:
        return bool(value) and all(
            isinstance(item, dict)
            and "text" in item
            and "start" in item
            and "end" in item
            for item in value[: min(len(value), 20)]
        )

    @staticmethod
    def _to_text(value: Any) -> str:
        if isinstance(value, str):
            return value

        return json.dumps(
            value,
            ensure_ascii=False,
            allow_nan=False,
            default=str,
        )

    @staticmethod
    def _identifier(value: Any, fallback: str) -> str:
        if value is None:
            return fallback

        text = str(value).strip()

        return text if text else fallback

    @staticmethod
    def _number(value: Any) -> float | None:
        if value is None or isinstance(value, bool):
            return None

        try:
            number = float(value)
        except (ValueError, TypeError, OverflowError):
            return None

        import math

        if not math.isfinite(number) or number < 0:
            return None

        return number

    def _reference(
        self,
        *,
        source_id: str,
        kind: str,
        item_id: str | None = None,
        start: Any = None,
        end: Any = None,
        page: Any = None,
        row: Any = None,
    ) -> ContextReference:
        start_value = self._number(start)
        end_value = self._number(end)

        if (
            start_value is not None
            and end_value is not None
            and end_value < start_value
        ):
            raise ValueError(
                "Input contains an invalid timestamp range"
            )

        page_value = self._nonnegative_int(page)
        row_value = self._nonnegative_int(row)

        return ContextReference(
            source_id=source_id,
            kind=kind,
            item_id=item_id,
            start=start_value,
            end=end_value,
            page=page_value,
            row=row_value,
        )

    @staticmethod
    def _nonnegative_int(value: Any) -> int | None:
        if value is None or isinstance(value, bool):
            return None

        try:
            number = int(value)
        except (ValueError, TypeError, OverflowError):
            return None

        return number if number >= 0 else None

    def _check_size(
        self,
        items: list[ContextItem],
    ) -> list[ContextItem]:
        if len(items) > self.MAX_ITEMS:
            raise ValueError(
                "Input exceeds the maximum number of context items"
            )

        total_chars = sum(len(item.text) for item in items)

        if total_chars > self.MAX_TEXT_CHARS:
            raise ValueError(
                "Input exceeds the in-memory normalization limit. "
                "Use streaming or paginated input processing."
            )

        return items

    def _normalize_words(
        self,
        words: list[Any],
        source_id: str,
    ) -> list[ContextItem]:
        if len(words) > self.MAX_ITEMS:
            raise ValueError(
                "Transcript has too many words for in-memory normalization"
            )

        items: list[ContextItem] = []

        for index, word in enumerate(words):
            if not isinstance(word, dict):
                raise ValueError(
                    f"Transcript word {index} must be an object"
                )

            word_id = self._identifier(
                word.get("id"),
                str(index),
            )

            text = str(word.get("text") or "")

            if not text.strip():
                continue

            reference = self._reference(
                source_id=source_id,
                kind="word",
                item_id=word_id,
                start=word.get("start"),
                end=word.get("end"),
            )

            items.append(
                ContextItem(
                    id=f"{source_id}:word:{word_id}",
                    text=text,
                    input_type="transcript",
                    references=[reference],
                    metadata={
                        "word_id": word_id,
                        "word_index": index,
                    },
                )
            )

        return items

    def _normalize_segments(
        self,
        segments: list[Any],
        source_id: str,
    ) -> list[ContextItem]:
        items: list[ContextItem] = []

        for index, segment in enumerate(segments):
            if not isinstance(segment, dict):
                raise ValueError(
                    f"Segment {index} must be an object"
                )

            segment_id = self._identifier(
                segment.get("id"),
                str(index),
            )

            text = str(segment.get("text") or "")

            if not text.strip():
                continue

            reference = self._reference(
                source_id=source_id,
                kind="segment",
                item_id=segment_id,
                start=segment.get("start"),
                end=segment.get("end"),
            )

            items.append(
                ContextItem(
                    id=f"{source_id}:segment:{segment_id}",
                    text=text,
                    input_type="transcript",
                    references=[reference],
                    metadata={
                        "segment_id": segment_id,
                        "segment_index": index,
                    },
                )
            )

        return items

    def _normalize_pages(
        self,
        pages: list[Any],
        source_id: str,
    ) -> list[ContextItem]:
        items: list[ContextItem] = []

        for index, page in enumerate(pages):
            if isinstance(page, str):
                text = page
                page_number = index + 1
            elif isinstance(page, dict):
                text = self._to_text(
                    page.get("text", "")
                )
                page_number = page.get(
                    "page_number",
                    page.get("page", index + 1),
                )
            else:
                raise ValueError(
                    f"Document page {index} is invalid"
                )

            if not text.strip():
                continue

            page_id = self._identifier(
                page_number,
                str(index + 1),
            )

            reference = self._reference(
                source_id=source_id,
                kind="page",
                item_id=page_id,
                page=page_number,
            )

            items.append(
                ContextItem(
                    id=f"{source_id}:page:{page_id}",
                    text=text,
                    input_type="document",
                    references=[reference],
                    metadata={
                        "page_number": page_number,
                    },
                )
            )

        return items

    def _normalize_records(
        self,
        records: list[Any],
        source_id: str,
    ) -> list[ContextItem]:
        items: list[ContextItem] = []

        for index, record in enumerate(records):
            if isinstance(record, dict):
                record_id = self._identifier(
                    record.get("id"),
                    str(index),
                )
            else:
                record_id = str(index)

            reference = self._reference(
                source_id=source_id,
                kind="record",
                item_id=record_id,
                row=index,
            )

            items.append(
                ContextItem(
                    id=f"{source_id}:record:{index}",
                    text=self._to_text(record),
                    input_type="records",
                    references=[reference],
                    metadata={
                        "record_id": record_id,
                        "record_index": index,
                    },
                )
            )

        return items

    def _normalize_single(
        self,
        value: Any,
        source_id: str,
        input_type: str,
    ) -> list[ContextItem]:
        if isinstance(value, dict):
            if input_type in ("text", "document"):
                text = value.get(
                    "text",
                    value.get("transcript"),
                )

                if text is None:
                    text = self._to_text(value)
                elif not isinstance(text, str):
                    text = self._to_text(text)
            else:
                text = self._to_text(value)
        else:
            text = self._to_text(value)

        reference = self._reference(
            source_id=source_id,
            kind=input_type,
            item_id="0",
            page=(
                value.get(
                    "page_number",
                    value.get("page"),
                )
                if isinstance(value, dict)
                else None
            ),
        )

        return [
            ContextItem(
                id=f"{source_id}:item:0",
                text=text,
                input_type=input_type,
                references=[reference],
            )
        ]

    def normalize(
        self,
        value: Any,
        *,
        source_id: str = "upstream",
        input_type: str = "auto",
    ) -> list[ContextItem]:
        """Normalize upstream data to referenced context items.

        Returns ContextItem objects, not their serialized dictionaries.
        """

        if input_type not in VALID_INPUT_TYPES:
            raise ValueError(
                f"Unsupported input type: {input_type}"
            )

        if (
            not isinstance(source_id, str)
            or not source_id.strip()
        ):
            raise ValueError(
                "source_id must be a nonempty string"
            )

        source_id = source_id.strip()

        if value is None:
            return []

        detected = (
            self.detect_type(value)
            if input_type == "auto"
            else input_type
        )

        if detected == "transcript":
            if isinstance(value, dict):
                if isinstance(value.get("words"), list):
                    items = self._normalize_words(
                        value["words"],
                        source_id,
                    )
                elif isinstance(
                    value.get("segments"),
                    list,
                ):
                    items = self._normalize_segments(
                        value["segments"],
                        source_id,
                    )
                else:
                    items = self._normalize_single(
                        value,
                        source_id,
                        "transcript",
                    )

            elif isinstance(value, list):
                items = self._normalize_words(
                    value,
                    source_id,
                )

            else:
                items = self._normalize_single(
                    value,
                    source_id,
                    "transcript",
                )

        elif detected == "document":
            if (
                isinstance(value, dict)
                and isinstance(value.get("pages"), list)
            ):
                items = self._normalize_pages(
                    value["pages"],
                    source_id,
                )
            else:
                items = self._normalize_single(
                    value,
                    source_id,
                    "document",
                )

        elif detected == "records":
            if isinstance(value, list):
                records = value

            elif isinstance(value, dict):
                records = None

                for key in ("records", "rows", "items"):
                    if isinstance(value.get(key), list):
                        records = value[key]
                        break

                if records is None:
                    records = [value]
            else:
                records = [value]

            items = self._normalize_records(
                records,
                source_id,
            )

        else:
            items = self._normalize_single(
                value,
                source_id,
                detected,
            )

        return self._check_size(items)

    def normalize_json(
        self,
        value: Any,
        *,
        source_id: str = "upstream",
        input_type: str = "auto",
    ) -> list[dict[str, Any]]:
        """Return JSON-serializable normalized items."""

        return [
            item.to_dict()
            for item in self.normalize(
                value,
                source_id=source_id,
                input_type=input_type,
            )
        ]
