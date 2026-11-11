from __future__ import annotations

from pathlib import Path
import pytest

from app.workflows.nodes.VideoRemix import VideoRemixNode


def run(action: str, deps: dict, **settings):
    kind = 'video.remix_' + action
    return VideoRemixNode().execute(kind, {'id': 'test', 'type': kind, 'settings': settings}, deps, None, Path('.'))


def sample():
    v = run('validate', {'gemini': {'highlights': [
        {'title': 'Intro', 'start': 1.0, 'end': 11.0},
        {'title': 'Feature', 'start': 25.0, 'end': 35.0},
    ]}})
    c = run('cut', {'validated': v})
    s = run('split', {'cut': c}, min_seconds=2, max_seconds=3)
    return s


def test_split_keeps_source_ranges_and_duration():
    result = sample()
    assert result['stats']['groups'] == 2
    assert result['stats']['clips'] == 8
    for group in result['clip_manifest']['groups']:
        assert len(group['clips']) == 4
        assert all(2 <= c['duration'] <= 3 for c in group['clips'])


def test_duplicate_is_per_group_and_does_not_repeat_every_clip():
    result = run('duplicate', {'split': sample()}, min_duplicates=1, max_duplicates=2, seed=42)
    for group in result['clip_manifest']['groups']:
        assert 5 <= len(group['clips']) <= 6
        assert 1 <= sum(c.get('duplicate_of') is not None for c in group['clips']) <= 2
        ids = [c['instance_id'] for c in group['clips']]
        assert len(ids) == len(set(ids))


def test_shuffle_never_places_same_original_adjacent_and_seed_stable():
    dup = run('duplicate', {'split': sample()}, min_duplicates=2, max_duplicates=2, seed=1)
    first = run('shuffle', {'d': dup}, seed=12)
    second = run('shuffle', {'d': dup}, seed=12)
    assert first == second
    for group in first['clip_manifest']['groups']:
        ids = [c['original_clip_id'] for c in group['clips']]
        assert all(a != b for a, b in zip(ids, ids[1:]))


def test_zoom_merge_preview_keep_manifest_and_dont_render():
    dup = run('duplicate', {'s': sample()}, min_duplicates=1, max_duplicates=1)
    shuf = run('shuffle', {'d': dup})
    zoom = run('zoom', {'s': shuf}, min_zoom_percent=10, max_zoom_percent=20)
    merged = run('merge', {'z': zoom})
    preview = run('preview', {'m': merged})
    assert preview['preview']['requires_ffmpeg'] is False
    assert len(preview['cut_plan']) == preview['stats']['clips']
    assert all(1.10 <= c['transforms']['zoom'] <= 1.20 for g in preview['clip_manifest']['groups'] for c in g['clips'])
    offsets = [c['timeline_start'] for c in preview['cut_plan']]
    assert offsets == sorted(offsets)


def test_reject_invalid_and_impossible_shuffle():
    rejected = run('validate', {'gemini': {'json': {'highlights': [
        {'start': -1, 'end': 3},
        {'start': 5, 'end': 2},
    ]}}})
    assert rejected['stats']['valid'] == 0
    assert rejected['stats']['rejected'] == 2
    cut = run('cut', {'gemini': {'highlights': [{'start': 1, 'end': 3}]}})
    dup = run('duplicate', {'c': cut}, min_duplicates=2, max_duplicates=2)
    with pytest.raises(ValueError, match='Cannot shuffle'):
        run('shuffle', {'d': dup})


def test_input_path_manual_selection():
    out = run('cut', {'abc': {'data': {'highlights': [{'start': 5, 'end': 10}]}}}, input_path='abc.data.highlights')
    assert out['stats']['groups'] == 1
