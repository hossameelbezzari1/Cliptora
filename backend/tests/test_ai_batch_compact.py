from app.services.context.AIBatchProcessor import (
    AIBatchProcessor,
    BatchOptions,
)
from app.services.context.TokenEstimator import TokenEstimator


def _word_references(words):
    return [
        {
            "source_id": "transcript-1",
            "kind": "word",
            "item_id": f"word-{index}",
            "start": index * 0.5,
            "end": (index + 1) * 0.5,
            "metadata": {
                "speaker": "Speaker 1",
                "diagnostic": "alignment-metadata-" * 12,
            },
        }
        for index, _ in enumerate(words)
    ]


def test_compact_highlights_reduce_tokens_and_preserve_full_alignment():
    words = [f"word{index}" for index in range(80)]
    selected = " ".join(words[20:35])
    chunks = [{
        "id": "chunk-1",
        "index": 0,
        "text": " ".join(words),
        "references": _word_references(words),
    }]

    def provider(chunk, memory):
        return {
            "items": [{
                "title": "Compact highlight",
                "selected_text": selected,
                "score": 0.94,
                "reason": "Strong standalone moment",
            }]
        }

    result = AIBatchProcessor().run(
        chunks,
        processor=provider,
        options=BatchOptions(memory_token_budget=0),
    )

    compact = result["compact_highlights"]
    full_value = result["merged"]["items"][0]["value"]

    assert len(compact) == 1
    assert set(compact[0]) == {
        "title", "selected_text", "start", "end",
        "duration", "score", "reason",
    }
    assert compact[0]["selected_text"] == selected
    assert compact[0]["duration"] == 7.5
    assert "references" not in compact[0]
    assert len(full_value["references"]) == 15
    assert full_value["word_start_id"] == "word-20"
    assert full_value["word_end_id"] == "word-34"

    estimator = TokenEstimator()
    full_tokens = estimator.estimate_json(result)
    compact_tokens = estimator.estimate_json(compact)

    assert compact_tokens < full_tokens / 20
    assert compact_tokens < 200


def test_compact_highlights_keeps_stable_fields_when_alignment_is_missing():
    merged = {
        "items": [{
            "value": {
                "title": "Unaligned",
                "selected_text": "A useful sentence",
                "score": 0.7,
                "reason": "Useful",
                "references": [{"large": "not copied"}],
            }
        }],
        "merged_object": {},
    }

    compact = AIBatchProcessor._compact_highlights(merged)

    assert compact == [{
        "title": "Unaligned",
        "selected_text": "A useful sentence",
        "start": None,
        "end": None,
        "duration": None,
        "score": 0.7,
        "reason": "Useful",
    }]
