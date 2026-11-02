"""Select the single project-owned media source for a CLIPTORA workflow run.

The caller MUST validate ownership of the returned source ID before accessing
any files. This helper only reads node settings; it never accepts file paths.
"""
from __future__ import annotations

from typing import Any

SOURCE_NODE_TYPES = frozenset({
    'core.video_source',
    'media.probe',
    'audio.extract',
    'video.render',
})


def select_workflow_source_id(
    nodes: list[dict[str, Any]], explicit_source_id: int | None = None,
) -> int | None:
    """Find video selected in Inspect Video (or legacy Source Video).

    Reject conflicts instead of silently running with a different asset.
    This is intentionally shared by both API-created and scheduled runs.
    """
    ids: set[int] = set()
    for node in nodes:
        if node.get('type') not in SOURCE_NODE_TYPES:
            continue
        settings = node.get('settings') or {}
        if not isinstance(settings, dict):
            raise ValueError('Invalid source settings')
        source_id = settings.get('source_id')
        if source_id is None:
            continue
        if type(source_id) is not int or source_id < 1:
            raise ValueError('Invalid source video ID')
        ids.add(source_id)
    if len(ids) > 1:
        raise ValueError('Workflow nodes reference different source videos')

    node_source_id = next(iter(ids), None)
    if explicit_source_id is not None:
        if type(explicit_source_id) is not int or explicit_source_id < 1:
            raise ValueError('Invalid requested source video ID')
        if node_source_id is not None and node_source_id != explicit_source_id:
            raise ValueError('Run source does not match the selected workflow video')
    return node_source_id if node_source_id is not None else explicit_source_id
