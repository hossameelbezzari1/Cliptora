"""Non-destructive CLIPTORA video remix nodes.

Each transformation consumes/returns a versioned JSON clip_manifest. Only
video.remix_render calls FFmpeg; preview operations never transcode media.
"""
from __future__ import annotations

import copy
import hashlib
import json
import math
import random
import re
import subprocess
import tempfile
from collections import Counter
from pathlib import Path
from typing import Any

from app.workflows.Node import Node
from app.workflows.InputResolver import resolve_input_path
from app.workflows.MediaStorage import run_media_dir
from app.helpers import Media as media

PREFIX = 'video.remix_'


def _num(value: Any, label: str, minimum: float = 0, maximum: float = 86400) -> float:
    try:
        parsed = float(value)
    except (ValueError, TypeError, OverflowError) as exc:
        raise ValueError(f'{label} must be a finite number') from exc
    if not math.isfinite(parsed) or not minimum <= parsed <= maximum:
        raise ValueError(f'{label} must be between {minimum} and {maximum}')
    return parsed


def _int(value: Any, label: str, minimum: int, maximum: int) -> int:
    if isinstance(value, bool):
        raise ValueError(f'{label} must be an integer')
    try:
        n = int(value)
    except (ValueError, TypeError, OverflowError) as exc:
        raise ValueError(f'{label} must be an integer') from exc
    if str(n) != str(value).strip() and not (isinstance(value, float) and value.is_integer()):
        raise ValueError(f'{label} must be an integer')
    if not minimum <= n <= maximum:
        raise ValueError(f'{label} must be between {minimum} and {maximum}')
    return n


def _label(index: int) -> str:
    result = ''
    while True:
        index, r = divmod(index, 26)
        result = chr(65 + r) + result
        if index == 0:
            return result
        index -= 1


def _extract(outputs: dict[str, Any], path: str, field: str) -> Any:
    if path.strip():
        value = resolve_input_path(outputs, path)
        if isinstance(value, dict) and field in value:
            return value[field]
        return value
    candidates = []
    for item in outputs.values():
        if not isinstance(item, dict):
            continue
        if field in item:
            candidates.append(item[field])
        elif field == 'highlights' and isinstance(item.get('json'), dict) and 'highlights' in item['json']:
            candidates.append(item['json']['highlights'])
        elif field == 'highlights' and 'compact_highlights' in item:
            candidates.append(item['compact_highlights'])
    if len(candidates) != 1:
        raise ValueError(f'Connect exactly one {field} source or select Input Data path')
    return candidates[0]


def _highlights(outputs: dict[str, Any], path: str) -> list[dict]:
    value = _extract(outputs, path, 'highlights')
    if not isinstance(value, list):
        raise ValueError('Highlights input must be a JSON array')
    return value



def _normalize_timed_words(value: Any) -> list[dict[str, Any]]:
    """Normalize original Whisper word timings in source-video seconds.

    The word's midpoint is its unique owner when intervals are subdivided. This
    prevents a word from being narrated twice on two neighboring clips.
    """
    if not isinstance(value, list):
        raise ValueError('Word timings must be a words[] array from Transcribe Every Word')
    normalized: list[dict[str, Any]] = []
    for index, item in enumerate(value):
        if not isinstance(item, dict):
            raise ValueError(f'Invalid timed word #{index + 1}')
        word = str(item.get('text') or item.get('word') or '').strip()
        if not word:
            continue
        start = _num(item.get('start'), f'Word #{index + 1} start')
        end = _num(item.get('end'), f'Word #{index + 1} end')
        if end <= start:
            raise ValueError(f'Word #{index + 1} has nonpositive duration')
        normalized.append({
            'id': item.get('id', index + 1),
            'text': word,
            'start': start,
            'end': end,
        })
    normalized.sort(key=lambda item: (item['start'], item['end']))
    return normalized


def _connected_timed_words(outputs: dict[str, Any]) -> list[dict[str, Any]] | None:
    """Read a directly connected Whisper output, without inventing missing data."""
    candidates = [item['words'] for item in outputs.values()
                  if isinstance(item, dict) and isinstance(item.get('words'), list)]
    if not candidates:
        return None
    if any(candidate != candidates[0] for candidate in candidates[1:]):
        raise ValueError('Multiple different word-timing sources: connect one Transcribe Every Word output')
    return _normalize_timed_words(candidates[0])


def _interval_words(words: list[dict[str, Any]], left: float, right: float) -> list[dict[str, Any]]:
    """Assign every word to at most one adjoining interval using its midpoint."""
    return [word for word in words
            if left <= (word['start'] + word['end']) / 2 < right]


def _spoken_text(words: list[dict[str, Any]]) -> str:
    text = ' '.join(word['text'] for word in words)
    if len(text) > 5000:
        raise ValueError('Clip narration exceeds 5000 characters; split the clip further')
    return text


def _word_aligned_edges(start: float, end: float, count: int,
                        words: list[dict[str, Any]], minimum: float,
                        maximum: float) -> tuple[list[float], int]:
    """Prefer breaks between Whisper words while preserving clip duration bounds.

    If there is no feasible word break, keep the time-based split instead of
    silently generating a clip outside the configured duration range.
    """
    if count <= 1:
        return [start, end], 0
    duration = end - start
    typical = duration / count
    effective_min = min(minimum, typical)
    effective_max = max(maximum, typical)
    ordered = _interval_words(words, start, end)
    choices: list[float] = []
    for previous, following in zip(ordered, ordered[1:]):
        # In a pause the midpoint is a safe, natural cut position. When Whisper
        # words overlap, put the boundary between their word midpoints.
        if previous['end'] <= following['start']:
            candidate = (previous['end'] + following['start']) / 2
        else:
            candidate = (
                (previous['start'] + previous['end']) / 2
                + (following['start'] + following['end']) / 2
            ) / 2
        if start < candidate < end:
            choices.append(candidate)
    edges = [start]
    unsnapped = 0
    for boundary_index in range(1, count):
        remaining = count - boundary_index
        lower = max(edges[-1] + effective_min, end - remaining * effective_max)
        upper = min(edges[-1] + effective_max, end - remaining * effective_min)
        ideal = start + duration * boundary_index / count
        if lower > upper + 1e-7:
            raise ValueError('Impossible clip duration bounds during word alignment')
        options = [value for value in choices if lower - 1e-8 <= value <= upper + 1e-8
                   and value > edges[-1] + 1e-8]
        if options:
            chosen = min(options, key=lambda value: (abs(value - ideal), value))
        else:
            unsnapped += 1
            chosen = min(max(ideal, lower), upper)
        edges.append(chosen)
    edges.append(end)
    return edges, unsnapped

def _manifest(outputs: dict[str, Any], path: str) -> dict:
    value = _extract(outputs, path, 'clip_manifest')
    if not isinstance(value, dict) or value.get('version') != 1 or not isinstance(value.get('groups'), list):
        raise ValueError('Expected clip_manifest version 1 with groups array')
    result = copy.deepcopy(value)
    seen: set[str] = set()
    for group in result['groups']:
        if not isinstance(group, dict) or not isinstance(group.get('clips'), list):
            raise ValueError('Invalid clip group')
        for clip in group['clips']:
            if not isinstance(clip, dict):
                raise ValueError('Invalid clip entry')
            key = str(clip.get('instance_id') or '')
            if not key or key in seen:
                raise ValueError('Clip instance IDs must be nonempty and unique')
            seen.add(key)
            a = _num(clip.get('source_start'), 'clip start')
            b = _num(clip.get('source_end'), 'clip end')
            if b <= a:
                raise ValueError('Clip end must be greater than start')
    return result


def _inspect_preview_audio(path: Path) -> float:
    """Cheap decode sanity check. Never transcodes or writes to the MP3."""
    try:
        completed = subprocess.run(
            ['ffprobe', '-v', 'error', '-select_streams', 'a:0',
             '-show_entries', 'stream=codec_name:format=duration',
             '-of', 'json', str(path)],
            capture_output=True, text=True, timeout=20, check=True,
        )
        info = json.loads(completed.stdout)
        streams = info.get('streams') or []
        if not streams or streams[0].get('codec_name') != 'mp3':
            raise ValueError('not an MP3 audio stream')
        length = _num((info.get('format') or {}).get('duration'),
                      'Probed audio duration', 0.001, 86400)
        return length
    except (OSError, subprocess.SubprocessError, json.JSONDecodeError,
            TypeError, KeyError, ValueError) as exc:
        raise ValueError('MP3 failed FFprobe verification') from exc


def _preview_timeline(manifest: dict, workdir: Path, cfg: dict) -> dict[str, Any]:
    """Build a browser-playable schedule. Never return filesystem paths in it.

    Each voice is checked against this exact run and its clip instance ID.
    The authenticated /audios/{file_id} endpoint already resolves the ID from
    the run's owned media folder; the browser never receives an arbitrary path.
    """
    workspace = Path(workdir).resolve()
    allowed = (run_media_dir(workspace) / 'audio' / 'voiceovers').resolve()
    project_id = workspace.parent.parent.name
    run_id = workspace.name
    if not project_id.isdecimal() or not run_id.isdecimal():
        raise ValueError('Preview requires a standard CLIPTORA run workspace')

    timeline: list[dict[str, Any]] = []
    missing: list[str] = []
    invalid: list[dict[str, str]] = []
    position = 0.0
    voiced = 0
    silent = 0
    for group in manifest['groups']:
        for clip in group['clips']:
            ident = str(clip['instance_id'])
            length = _num(clip['source_end'], 'Clip end') - _num(clip['source_start'], 'Clip start')
            script = str(clip.get('selected_text') or '').strip()
            event: dict[str, Any] = {
                'instance_id': ident,
                'group_id': str(group.get('group_id') or ''),
                'label': str(clip.get('label') or ident)[:120],
                'timeline_start': round(position, 6),
                'timeline_end': round(position + length, 6),
                'duration': round(length, 6),
                'source_start': round(float(clip['source_start']), 6),
                'source_end': round(float(clip['source_end']), 6),
                'selected_text': script,
                'transforms': copy.deepcopy(clip.get('transforms') or {}),
                'voiceover': None,
                'voiceover_status': 'silent' if not script else 'missing',
            }
            position += length
            voice = clip.get('voiceover')
            if not isinstance(voice, dict):
                if script:
                    missing.append(ident)
                else:
                    silent += 1
            else:
                try:
                    if str(voice.get('instance_id') or ident) != ident:
                        raise ValueError('voiceover instance_id does not match this clip')
                    raw = voice.get('path')
                    if not isinstance(raw, str) or not raw:
                        raise ValueError('voiceover has no MP3 file path')
                    candidate = Path(raw)
                    if candidate.is_symlink() or candidate.suffix.casefold() != '.mp3':
                        raise ValueError('voiceover is not a regular MP3')
                    resolved = candidate.resolve()
                    if resolved.parent != allowed or not resolved.is_file() or resolved.stat().st_size <= 100:
                        raise ValueError('voiceover MP3 is missing or outside this run')
                    seconds = _num(voice.get('duration'), 'Voice-over duration', 0.001, 86400)
                    verified_seconds = _inspect_preview_audio(resolved)
                    if abs(verified_seconds - seconds) > 0.15:
                        raise ValueError('voiceover duration metadata disagrees with MP3')
                    if verified_seconds > length + 0.12:
                        raise ValueError(f'voiceover {verified_seconds:.2f}s exceeds clip {length:.2f}s')
                    file_id = hashlib.sha256(str(resolved).encode('utf-8')).hexdigest()[:24]
                    event['voiceover'] = {
                        'instance_id': ident,
                        'url': f'/api/v1/workflows/{project_id}/runs/{run_id}/audios/{file_id}',
                        'duration': round(seconds, 6),
                        'filename': resolved.name,
                        'mime_type': 'audio/mpeg',
                    }
                    event['voiceover_status'] = 'ready'
                    voiced += 1
                except (ValueError, OSError, TypeError) as exc:
                    invalid.append({'instance_id': ident, 'reason': str(exc)[:200]})
                    event['voiceover_status'] = 'invalid'
                    if not script:
                        silent += 1
            timeline.append(event)

    group_voiceovers = sum(isinstance(group.get('voiceover'), dict) for group in manifest['groups'])
    issues: list[str] = []
    if missing:
        issues.append(f'{len(missing)} narrated clips have no MP3')
    if invalid:
        issues.append(f'{len(invalid)} voice-over files failed validation')
    if group_voiceovers:
        issues.append('Legacy per-group voiceovers are not supported in per-clip browser preview')

    source_audio = bool(cfg.get('include_audio', True))
    original_volume = _num(cfg.get('original_audio_volume', 0.18), 'Original audio volume', 0, 1)
    return {
        'mode': 'browser',
        'requires_ffmpeg': False,
        'duration': round(position, 6),
        'clips': len(timeline),
        'voiced_clips': voiced,
        'silent_clips': silent,
        'missing_voiceovers': missing,
        'invalid_voiceovers': invalid,
        'issues': issues,
        'ready': not issues,
        'include_original_audio': source_audio,
        'original_audio_volume': original_volume,
        'timeline': timeline,
    }


def _stats(manifest: dict) -> dict:
    groups = manifest['groups']
    clips = [clip for group in groups for clip in group['clips']]
    return {
        'groups': len(groups), 'clips': len(clips),
        'duration': round(sum(clip['source_end'] - clip['source_start'] for clip in clips), 3),
        'duplicates': sum(bool(clip.get('duplicate_of')) for clip in clips),
    }


def _finish(manifest: dict, **extra: Any) -> dict:
    for group in manifest['groups']:
        for index, clip in enumerate(group['clips']):
            clip['order'] = index
            clip['duration'] = round(clip['source_end'] - clip['source_start'], 3)
    return {'clip_manifest': manifest, 'stats': _stats(manifest), **extra}


def _rng(seed: int, group: str) -> random.Random:
    return random.Random(f'cliptora-video-remix:{seed}:{group}')


def _ordered(clips: list[dict], rng: random.Random, avoid_adjacent: bool) -> list[dict]:
    pool = list(clips)
    if not avoid_adjacent:
        rng.shuffle(pool)
        return pool
    counts = Counter(str(clip.get('original_clip_id') or clip['clip_id']) for clip in pool)
    if counts and max(counts.values()) > (len(pool) + 1) // 2:
        raise ValueError('Cannot shuffle without adjacent identical clips: reduce duplication count')
    result: list[dict] = []
    while pool:
        previous = str(result[-1].get('original_clip_id') or result[-1]['clip_id']) if result else None
        options = [clip for clip in pool if str(clip.get('original_clip_id') or clip['clip_id']) != previous]
        if not options:
            raise ValueError('Cannot shuffle without adjacent identical clips')
        maximum = max(counts[str(c.get('original_clip_id') or c['clip_id'])] for c in options)
        choices = [c for c in options if counts[str(c.get('original_clip_id') or c['clip_id'])] == maximum]
        chosen = rng.choice(choices)
        pool.remove(chosen)
        counts[str(chosen.get('original_clip_id') or chosen['clip_id'])] -= 1
        result.append(chosen)
    return result


def _cut_plan(manifest: dict) -> list[dict]:
    result = []
    at = 0.0
    for group in manifest['groups']:
        for clip in group['clips']:
            duration = clip['source_end'] - clip['source_start']
            result.append({
                'instance_id': clip['instance_id'],
                'group_id': group['group_id'],
                'source_start': round(clip['source_start'], 3),
                'source_end': round(clip['source_end'], 3),
                'duration': round(duration, 3),
                'timeline_start': round(at, 3),
                'transforms': clip.get('transforms', {}),
                'selected_text': str(clip.get('selected_text') or ''),
                'voiceover_status': clip.get('voiceover_status'),
                'voiceover': copy.deepcopy(clip.get('voiceover')) if isinstance(clip.get('voiceover'), dict) else None,
            })
            at += duration
    return result


class VideoRemixNode(Node):
    family = 'video_remix'
    group = 'Video Remix'
    icon = 'lucide:clapperboard'

    @staticmethod
    def _op(action: str, icon: str, label: str, settings: dict) -> dict:
        return {'label': label, 'icon': icon, 'settings': {'input_path': '', **settings},
                'input_types': ['json'], 'output_types': ['json']}

    operations = {
        PREFIX + 'validate': _op.__func__('validate', 'lucide:shield-check', 'Validate Highlights', {'strict_text_match': False}),
        PREFIX + 'cut': _op.__func__('cut', 'lucide:scissors', 'Cut Highlights', {'padding': 0}),
        PREFIX + 'split': _op.__func__('split', 'lucide:split', 'Split Clips', {'min_seconds': 2.0, 'max_seconds': 3.0, 'remainder_policy': 'allow_short', 'require_word_timings': True, 'align_boundaries_to_words': True}),
        PREFIX + 'duplicate': _op.__func__('duplicate', 'lucide:copy', 'Duplicate Clips', {'min_duplicates': 1, 'max_duplicates': 2, 'seed': 42}),
        PREFIX + 'shuffle': _op.__func__('shuffle', 'lucide:shuffle', 'Shuffle Clips', {'seed': 42, 'avoid_adjacent_identical': True}),
        PREFIX + 'zoom': _op.__func__('zoom', 'lucide:zoom-in', 'Zoom & Reframe', {'min_zoom_percent': 10.0, 'max_zoom_percent': 20.0, 'seed': 42}),
        PREFIX + 'merge': _op.__func__('merge', 'lucide:combine', 'Merge Clips', {}),
        PREFIX + 'attach_voice': _op.__func__('attach_voice', 'lucide:audio-lines', 'Attach Voice-over to Groups', {}),
        PREFIX + 'preview': _op.__func__('preview', 'lucide:monitor-play', 'Preview Montage', {'include_audio': True, 'original_audio_volume': 0.18, 'require_clip_voiceovers': False}),
        PREFIX + 'render': _op.__func__('render', 'lucide:film', 'Render Remix MP4', {'include_audio': True, 'original_audio_volume': 0.18, 'require_group_voiceovers': False, 'require_clip_voiceovers': False}),
    }

    parameter_fields = {
        kind: {'input_path': {'type': 'string', 'title': 'Input Data', 'widget': 'upstream', 'accepts': ['json']}}
        for kind in operations
    }

    parameter_fields[PREFIX + 'split'].update({
        'min_seconds': {'type': 'number', 'title': 'Min Clip (seconds)', 'minimum': 0.1, 'maximum': 60, 'expression': True},
        'max_seconds': {'type': 'number', 'title': 'Max Clip (seconds)', 'minimum': 0.1, 'maximum': 60, 'expression': True},
        'remainder_policy': {'type': 'string', 'title': 'Short Remainders', 'enum': ['allow_short', 'keep', 'skip', 'error']},
        'require_word_timings': {'type': 'boolean', 'title': 'Require Word Timings for Narrated Splits'},
        'align_boundaries_to_words': {'type': 'boolean', 'title': 'Prefer Cuts Between Spoken Words'},
    })

    parameter_fields[PREFIX + 'duplicate'].update({
        'min_duplicates': {'type': 'integer', 'title': 'Min Copies per Group', 'minimum': 0, 'maximum': 200},
        'max_duplicates': {'type': 'integer', 'title': 'Max Copies per Group', 'minimum': 0, 'maximum': 200},
        'seed': {'type': 'integer', 'title': 'Random Seed'},
    })

    parameter_fields[PREFIX + 'zoom'].update({
        'min_zoom_percent': {'type': 'number', 'title': 'Minimum Zoom Increase (%)', 'minimum': 0, 'maximum': 200},
        'max_zoom_percent': {'type': 'number', 'title': 'Maximum Zoom Increase (%)', 'minimum': 0, 'maximum': 200},
        'seed': {'type': 'integer', 'title': 'Random Seed'},
    })

    parameter_fields[PREFIX + 'preview'].update({
        'include_audio': {'type': 'boolean', 'title': 'Include Original Audio'},
        'original_audio_volume': {'type': 'number', 'title': 'Original Audio Volume with Voice-over',
                                  'minimum': 0, 'maximum': 1, 'default': 0.18},
        'require_clip_voiceovers': {'type': 'boolean', 'title': 'Require Voice-over for Every Clip with Text'},
    })

    parameter_fields[PREFIX + 'render'].update({
        'include_audio': {'type': 'boolean', 'title': 'Include Original Audio'},
        'require_group_voiceovers': {'type': 'boolean', 'title': 'Require Voice-over for Every Group'},
        'require_clip_voiceovers': {'type': 'boolean', 'title': 'Require Voice-over for Every Clip with Text'},
        'original_audio_volume': {'type': 'number', 'title': 'Original Audio Volume with Voice-over',
                                  'minimum': 0, 'maximum': 1, 'default': 0.18},
    })

    parameter_fields[PREFIX + 'shuffle'].update({
        'seed': {'type': 'integer', 'title': 'Random Seed'},
        'avoid_adjacent_identical': {'type': 'boolean', 'title': 'Prevent Identical Neighbors'},
    })

    def execute_operation(self, operation, node, outputs, source, workdir):
        cfg = node.get('settings') or {}
        path = str(cfg.get('input_path') or '')
        action = operation.removeprefix(PREFIX)

        if action == 'validate':
            candidates = _highlights(outputs, path)
            strict = bool(cfg.get('strict_text_match', False))
            direct_words = _connected_timed_words(outputs)
            if strict and direct_words is None:
                raise ValueError(
                    'Strict text matching requires a direct connection from '
                    'Transcribe Every Word to Validate Highlights'
                )

            validated, rejected = [], []
            known_duration = None
            if source is not None and source.is_file():
                try:
                    details = subprocess.run(
                        ['ffprobe', '-v', 'error', '-show_entries', 'format=duration',
                         '-of', 'default=noprint_wrappers=1:nokey=1', str(source)],
                        capture_output=True, text=True, timeout=20, check=True,
                    )
                    known_duration = _num(details.stdout.strip(), 'video duration')
                except (subprocess.SubprocessError, ValueError, FileNotFoundError):
                    pass

            for index, entry in enumerate(candidates):
                try:
                    if not isinstance(entry, dict):
                        raise ValueError('Not a highlight object')
                    a = _num(entry.get('start'), 'highlight start')
                    b = _num(entry.get('end'), 'highlight end')
                    if b <= a:
                        raise ValueError('End must follow start')
                    if known_duration is not None and b > known_duration + 0.05:
                        raise ValueError('Highlight ends beyond source video')

                    # Attach the *source* timed words to this highlight, so Cut
                    # and Split can keep them even when Whisper is not connected
                    # directly to those later nodes.
                    if direct_words is not None:
                        timed_words = _interval_words(direct_words, a, b)
                    elif isinstance(entry.get('timed_words'), list):
                        timed_words = _interval_words(
                            _normalize_timed_words(entry['timed_words']), a, b
                        )
                    else:
                        timed_words = None

                    if strict:
                        selected = re.sub(
                            r'\W+', ' ', str(entry.get('selected_text') or '').casefold()
                        ).strip()
                        spoken = re.sub(
                            r'\W+', ' ', _spoken_text(timed_words or []).casefold()
                        ).strip()
                        if not selected or selected != spoken:
                            raise ValueError('Selected text does not match timed transcript')

                    item = {
                        **entry,
                        'start': a,
                        'end': b,
                        'duration': round(b - a, 3),
                    }
                    if timed_words is not None:
                        item['timed_words'] = timed_words
                    validated.append(item)
                except (ValueError, TypeError) as exc:
                    rejected.append({'index': index, 'reason': str(exc)})

            return {
                'highlights': validated,
                'rejected': rejected,
                'stats': {
                    'valid': len(validated),
                    'rejected': len(rejected),
                    'word_timings_available': direct_words is not None
                    or any(isinstance(item.get('timed_words'), list) for item in validated),
                },
            }

        if action == 'cut':
            candidates = _highlights(outputs, path)
            direct_words = _connected_timed_words(outputs)
            padding = _num(cfg.get('padding', 0), 'padding', 0, 30)
            groups = []
            warnings = []

            for index, entry in enumerate(candidates):
                if not isinstance(entry, dict):
                    raise ValueError('Invalid highlight entry')
                selected_start = _num(entry.get('start'), 'highlight start')
                selected_end = _num(entry.get('end'), 'highlight end')
                if selected_end <= selected_start:
                    raise ValueError('Highlight end must be greater than start')
                start = max(0, selected_start - padding)
                end = selected_end + padding
                gid = f'group_{index + 1:04d}'
                cid = f'{gid}_clip_0001'

                if isinstance(entry.get('timed_words'), list):
                    timed_words = _interval_words(
                        _normalize_timed_words(entry['timed_words']),
                        selected_start, selected_end,
                    )
                elif direct_words is not None:
                    timed_words = _interval_words(direct_words, selected_start, selected_end)
                else:
                    timed_words = None

                original_text = str(entry.get('selected_text') or entry.get('text') or '').strip()
                if timed_words is not None and not timed_words and original_text:
                    raise ValueError(
                        f'{gid}: this highlight contains narration text but no '
                        'Whisper words in its source time range. Check source video, '
                        'word offsets and highlight start/end times.'
                    )
                selected_text = _spoken_text(timed_words) if timed_words is not None else original_text[:5000]
                if timed_words is None and original_text:
                    warnings.append(
                        f'{gid}: no word timings attached; connect Transcribe Every Word '
                        'to Validate Highlights (or Cut Highlights) before splitting narrated clips'
                    )

                group = {
                    'group_id': gid,
                    'label': _label(index),
                    'title': str(entry.get('title') or f'Highlight {index + 1}')[:160],
                    'selected_text': selected_text,
                    'word_timing_status': 'available' if timed_words is not None else 'missing',
                    'clips': [{
                        'clip_id': cid,
                        'original_clip_id': cid,
                        'instance_id': cid,
                        'label': f'{_label(index)}1',
                        'selected_text': selected_text,
                        'text_source': 'whisper_words' if timed_words is not None else 'highlight_text',
                        'source_start': round(start, 6),
                        'source_end': round(end, 6),
                        'duration': round(end - start, 3),
                        'order': 0,
                        'transforms': {},
                    }],
                }
                if timed_words is not None:
                    group['timed_words'] = timed_words
                groups.append(group)

            return _finish({'version': 1, 'groups': groups}, warnings=warnings)

        manifest = _manifest(outputs, path)
        warnings = []

        if action == 'split':
            low = _num(cfg.get('min_seconds', 2), 'Minimum clip seconds', 0.1, 60)
            high = _num(cfg.get('max_seconds', 3), 'Maximum clip seconds', 0.1, 60)
            if high < low:
                raise ValueError('Max clip duration cannot be less than min')

            policy = str(cfg.get('remainder_policy') or 'allow_short')
            if policy not in {'allow_short', 'keep', 'skip', 'error'}:
                raise ValueError('Invalid remainder policy')
            require_words = bool(cfg.get('require_word_timings', True))
            align_edges = bool(cfg.get('align_boundaries_to_words', True))
            direct_words = _connected_timed_words(outputs)
            split_stats = {'clips_with_text': 0, 'clips_without_text': 0,
                           'missing_timing_sources': 0, 'non_word_aligned_boundaries': 0}

            for group in manifest['groups']:
                split: list[dict] = []
                # Persisted timed words come from Cut Highlights. A direct
                # Whisper connection is also supported, but not required here.
                if isinstance(group.get('timed_words'), list):
                    group_words = _normalize_timed_words(group['timed_words'])
                elif direct_words is not None:
                    group_words = direct_words
                    group['timed_words'] = _interval_words(
                        direct_words,
                        min(clip['source_start'] for clip in group['clips'])
                        if group['clips'] else 0,
                        max(clip['source_end'] for clip in group['clips'])
                        if group['clips'] else 0,
                    )
                    group['word_timing_status'] = 'available'
                else:
                    group_words = None

                for clip in group['clips']:
                    duration = clip['source_end'] - clip['source_start']
                    minimum_count = math.ceil((duration - 1e-8) / high)
                    maximum_count = math.floor((duration + 1e-8) / low)

                    if minimum_count <= maximum_count and maximum_count >= 1:
                        count = max(1, minimum_count)
                    elif policy == 'skip':
                        warnings.append(
                            f'Skipped {clip["instance_id"]}: cannot split within duration bounds'
                        )
                        continue
                    elif policy == 'error':
                        raise ValueError(
                            f'Cannot split {clip["instance_id"]} into {low}-{high}s clips'
                        )
                    elif policy == 'keep':
                        if group_words is not None:
                            existing_words = _interval_words(
                                group_words, clip['source_start'], clip['source_end']
                            )
                            clip['selected_text'] = _spoken_text(existing_words)
                            clip['text_source'] = 'whisper_words'
                        split.append(clip)
                        warnings.append(
                            f'Kept {clip["instance_id"]}: outside duration bounds'
                        )
                        if str(clip.get('selected_text') or '').strip():
                            split_stats['clips_with_text'] += 1
                        else:
                            split_stats['clips_without_text'] += 1
                        continue
                    else:
                        count = max(1, minimum_count)
                        warnings.append(
                            f'{clip["instance_id"]}: allowed short section outside minimum duration'
                        )

                    own_words = (
                        _interval_words(group_words, clip['source_start'], clip['source_end'])
                        if group_words is not None else None
                    )
                    has_narration = bool(str(clip.get('selected_text') or
                                             group.get('selected_text') or '').strip())
                    if count > 1 and own_words is None and has_narration:
                        split_stats['missing_timing_sources'] += 1
                        if require_words:
                            raise ValueError(
                                f'Cannot produce correct per-clip text for {clip["instance_id"]}: '
                                'Whisper word timings are missing. Connect Transcribe Every '
                                'Word to Validate Highlights (or Cut Highlights), then rerun '
                                'Validate → Cut → Split.'
                            )
                        warnings.append(
                            f'{clip["instance_id"]}: no word timings; split clips will '
                            'have no narration rather than repeat an entire group script'
                        )

                    if align_edges and own_words is not None:
                        edges, not_aligned = _word_aligned_edges(
                            clip['source_start'], clip['source_end'], count,
                            own_words, low, high,
                        )
                        split_stats['non_word_aligned_boundaries'] += not_aligned
                        if not_aligned:
                            warnings.append(
                                f'{clip["instance_id"]}: {not_aligned} split boundaries '
                                'could not be placed between Whisper words'
                            )
                    else:
                        edges = [
                            clip['source_start'] + duration * i / count
                            for i in range(count + 1)
                        ]

                    for i in range(count):
                        left, right = edges[i], edges[i + 1]
                        new = copy.deepcopy(clip)
                        new['clip_id'] = f'{clip["clip_id"]}_s{i+1:03d}'
                        new['original_clip_id'] = new['clip_id']
                        new['instance_id'] = f'{clip["instance_id"]}_s{i+1:03d}'
                        new['duplicate_of'] = None
                        new['label'] = f"{group.get('label', group['group_id'])}{len(split)+1}"
                        new['source_start'] = round(left, 6)
                        new['source_end'] = round(right, 6)
                        if own_words is not None:
                            selected_words = _interval_words(own_words, left, right)
                            new['selected_text'] = _spoken_text(selected_words)
                            new['text_source'] = 'whisper_words'
                            new['word_start_id'] = selected_words[0]['id'] if selected_words else None
                            new['word_end_id'] = selected_words[-1]['id'] if selected_words else None
                        elif count == 1:
                            new['selected_text'] = str(clip.get('selected_text') or
                                                       group.get('selected_text') or '')[:5000]
                            new['text_source'] = 'highlight_text'
                        else:
                            new['selected_text'] = ''
                            new['text_source'] = 'missing_word_timings'
                        # Splitting invalidates any earlier audio generated for a parent.
                        new.pop('voiceover', None)
                        new.pop('voiceover_status', None)
                        new.pop('voiceover_error', None)
                        if new['selected_text']:
                            split_stats['clips_with_text'] += 1
                        else:
                            split_stats['clips_without_text'] += 1
                        split.append(new)

                group['clips'] = split

            return _finish(manifest, warnings=warnings, split_stats=split_stats)

        elif action == 'duplicate':
            minimum = _int(cfg.get('min_duplicates', 1), 'Min duplicates', 0, 200)
            maximum = _int(cfg.get('max_duplicates', 2), 'Max duplicates', 0, 200)

            if minimum > maximum:
                raise ValueError('Min duplicates cannot exceed max duplicates')

            seed = _int(cfg.get('seed', 42), 'Seed', -2147483648, 2147483647)

            for group in manifest['groups']:
                original = list(group['clips'])
                if not original:
                    continue

                rng = _rng(seed, group['group_id'])
                count = rng.randint(minimum, maximum)

                for i in range(count):
                    source_clip = rng.choice(original)
                    duplicate = copy.deepcopy(source_clip)
                    duplicate['instance_id'] = f'{source_clip["instance_id"]}_copy{i+1:04d}'
                    duplicate['duplicate_of'] = source_clip['instance_id']
                    group['clips'].append(duplicate)

        elif action == 'shuffle':
            seed = _int(cfg.get('seed', 42), 'Seed', -2147483648, 2147483647)
            avoid = bool(cfg.get('avoid_adjacent_identical', True))

            for group in manifest['groups']:
                group['clips'] = _ordered(
                    group['clips'],
                    _rng(seed, group['group_id']),
                    avoid,
                )

        elif action == 'zoom':
            low = _num(cfg.get('min_zoom_percent', 10), 'Min zoom', 0, 200)
            high = _num(cfg.get('max_zoom_percent', 20), 'Max zoom', 0, 200)

            if low > high:
                raise ValueError('Min zoom cannot exceed max zoom')

            seed = _int(cfg.get('seed', 42), 'Seed', -2147483648, 2147483647)

            for group in manifest['groups']:
                rng = _rng(seed, group['group_id'])

                for clip in group['clips']:
                    factor = round(1 + rng.uniform(low, high) / 100, 5)
                    clip.setdefault('transforms', {})['zoom'] = factor
                    clip['transforms']['position_x'] = 0.5
                    clip['transforms']['position_y'] = 0.5

        elif action == 'attach_voice':
            items = [item['voiceovers'] for item in outputs.values()
                     if isinstance(item, dict) and isinstance(item.get('voiceovers'), list)]
            if len(items) != 1:
                raise ValueError('Attach Voice-over requires exactly one AI Agent voiceovers output')
            entries = items[0]
            expected = {str(group['group_id']) for group in manifest['groups']}
            got = {str(item.get('group_id')) for item in entries if isinstance(item, dict)}
            if len(entries) != len(expected) or got != expected:
                raise ValueError('Each video group must have exactly one matching voice-over')
            folder = (run_media_dir(workdir) / 'audio' / 'voiceovers').resolve()
            by_group = {str(entry['group_id']): entry for entry in entries}
            for group in manifest['groups']:
                entry = by_group[str(group['group_id'])]
                path = Path(str(entry.get('path') or '')).resolve()
                if not path.is_file() or path.parent != folder or path.suffix.lower() != '.mp3':
                    raise ValueError('Voice-over file missing or outside this run')
                group_seconds = sum(float(clip['source_end']) - float(clip['source_start'])
                                    for clip in group['clips'])
                ffprobe = subprocess.run(
                    ['ffprobe', '-v', 'error', '-show_entries', 'format=duration',
                     '-of', 'default=noprint_wrappers=1:nokey=1', str(path)],
                    capture_output=True, text=True, timeout=30, check=True,
                )
                seconds = _num(ffprobe.stdout.strip(), 'Voice-over duration', 0.05, 3600)
                if seconds > group_seconds + 0.12:
                    raise ValueError(f'Voice-over for group {group["group_id"]} is too long. '
                                     'Shorten it and regenerate instead of cutting spoken words.')
                group['voiceover'] = {'path': str(path), 'mime_type': 'audio/mpeg',
                                      'duration': round(seconds, 3)}
            return _finish(manifest, cut_plan=_cut_plan(manifest), voiceovers_attached=len(entries))

        elif action in {'merge', 'preview'}:
            plan = _cut_plan(manifest)
            output = _finish(manifest, cut_plan=plan)

            if action == 'preview':
                schedule = _preview_timeline(manifest, workdir, cfg)
                if cfg.get('require_clip_voiceovers') and not schedule['ready']:
                    raise ValueError('Preview cannot verify all clip voiceovers: '
                                     + '; '.join(schedule['issues']))
                output['preview'] = schedule

            return output

        elif action == 'render':
            return self._render(
                manifest,
                cfg,
                source,
                workdir,
                node.get('_progress_callback'),
            )

        else:
            raise ValueError(f'Unsupported video remix operation: {operation}')

        return _finish(manifest, warnings=warnings)

    @staticmethod
    def _render(
        manifest: dict,
        cfg: dict,
        source: Path | None,
        workdir: Path,
        progress_callback=None,
    ) -> dict:
        if source is None or not source.is_file():
            raise ValueError('Render Remix requires a selected source video')

        plan = _cut_plan(manifest)
        total_duration = sum(c['duration'] for c in plan)

        if not plan or len(plan) > 600:
            raise ValueError('Render requires 1 to 600 clips')
        if cfg.get('require_group_voiceovers') and any(
                not isinstance(group.get('voiceover'), dict) for group in manifest['groups']):
            raise ValueError('Voice-over is required for every group. Connect Attach Voice-over to Groups before Render.')
        missing_clip_voiceovers = [
            str(clip.get('instance_id'))
            for group in manifest['groups']
            for clip in group['clips']
            if str(clip.get('selected_text') or '').strip()
            and not isinstance(clip.get('voiceover'), dict)
        ]
        if cfg.get('require_clip_voiceovers') and missing_clip_voiceovers:
            sample = ', '.join(missing_clip_voiceovers[:8])
            raise ValueError(
                f'{len(missing_clip_voiceovers)} clips with text have no voice-over: {sample}. '
                'Regenerate the missing clip audio before rendering.'
            )

        if any(isinstance(clip.get('voiceover'), dict)
               for group in manifest['groups'] for clip in group['clips']):
            preflight = _preview_timeline(manifest, workdir, cfg)
            if preflight['invalid_voiceovers']:
                raise ValueError('Invalid clip voiceovers: ' + ', '.join(
                    item['instance_id'] + ': ' + item['reason']
                    for item in preflight['invalid_voiceovers'][:5]))

        ffprobe = subprocess.run(
            [
                'ffprobe',
                '-v', 'error',
                '-show_entries', 'stream=codec_type,width,height',
                '-of', 'json',
                str(source),
            ],
            capture_output=True,
            text=True,
            timeout=30,
            check=True,
        )

        streams = json.loads(ffprobe.stdout).get('streams') or []
        video = next(
            (s for s in streams if s.get('codec_type') == 'video'),
            None,
        )

        if not video:
            raise ValueError('Selected source has no video stream')

        width, height = int(video['width']), int(video['height'])

        if width < 2 or height < 2:
            raise ValueError('Invalid source resolution')

        width -= width % 2
        height -= height % 2

        audio = bool(
            cfg.get('include_audio', True)
            and any(s.get('codec_type') == 'audio' for s in streams)
        )

        filters = []
        concat = []

        for i, clip in enumerate(plan):
            a, b = clip['source_start'], clip['source_end']
            zoom = _num(
                (clip.get('transforms') or {}).get('zoom', 1),
                'Zoom',
                1,
                3,
            )

            video_chain = (
                f'[0:v:0]trim=start={a:.6f}:end={b:.6f},'
                'setpts=PTS-STARTPTS'
            )

            if zoom > 1:
                video_chain += (
                    f',crop=trunc(iw/{zoom:.6f}/2)*2:'
                    f'trunc(ih/{zoom:.6f}/2)*2:'
                    '(iw-ow)/2:(ih-oh)/2'
                )

            video_chain += (
                f',scale={width}:{height},'
                f'setsar=1,format=yuv420p[v{i}]'
            )

            filters.append(video_chain)
            concat.append(f'[v{i}]')

            if audio:
                filters.append(
                    f'[0:a:0]atrim=start={a:.6f}:end={b:.6f},'
                    f'asetpts=PTS-STARTPTS,aresample=48000[a{i}]'
                )
                concat.append(f'[a{i}]')

        filters.append(
            ''.join(concat)
            + f'concat=n={len(plan)}:v=1:a={int(audio)}[outv]'
            + ('[outa]' if audio else '')
        )

        try:
            folder = run_media_dir(workdir) / 'videos'
        except ValueError:
            folder = Path(workdir) / 'videos'

        folder.mkdir(parents=True, exist_ok=True)

        target = folder / 'final.mp4'

        with tempfile.TemporaryDirectory(
            prefix='cliptora-remix-',
            dir=folder,
        ) as tmp:
            script = Path(tmp) / 'filters.txt'
            script.write_text(';'.join(filters), encoding='utf-8')

            output = Path(tmp) / 'output.mp4'

            cmd = [
                'ffmpeg',
                '-nostdin',
                '-hide_banner',
                '-loglevel', 'error',
                '-nostats',
                '-progress', 'pipe:1',
                '-y',
                '-i', str(source),
                '-/filter_complex', str(script),
                '-map', '[outv]',
            ]

            if audio:
                cmd.extend(['-map', '[outa]'])
            else:
                cmd.append('-an')

            cmd.extend([
                '-c:v', 'libx264',
                '-pix_fmt', 'yuv420p',
                '-crf', '20',
            ])

            if audio:
                cmd.extend(['-c:a', 'aac', '-b:a', '192k'])

            cmd.extend([
                '-movflags', '+faststart',
                str(output),
            ])

            try:
                # Modern FFmpeg: load the filtergraph from a file.
                media.tool_progress(
                    *cmd,
                    timeout=3600,
                    total_seconds=total_duration,
                    progress_callback=progress_callback,
                )

            except RuntimeError as exc:
                message = str(exc).casefold()

                if (
                    'unrecognized option' not in message
                    or 'filter_complex' not in message
                ):
                    raise

                # Older FFmpeg: use the legacy file option.
                cmd[cmd.index('-/filter_complex')] = '-filter_complex_script'

                try:
                    media.tool_progress(
                    *cmd,
                    timeout=3600,
                    total_seconds=total_duration,
                    progress_callback=progress_callback,
                )

                except RuntimeError as legacy_exc:
                    legacy_message = str(legacy_exc).casefold()

                    if (
                        'unrecognized option' not in legacy_message
                        or 'filter_complex_script' not in legacy_message
                    ):
                        raise

                    # Last fallback: use the standard inline filtergraph.
                    inline_cmd = list(cmd)
                    option_index = inline_cmd.index('-filter_complex_script')

                    inline_cmd[option_index] = '-filter_complex'
                    inline_cmd[option_index + 1] = ';'.join(filters)

                    command_length = len(
                        subprocess.list2cmdline(inline_cmd)
                    )

                    if command_length >= 30000:
                        raise RuntimeError(
                            'This FFmpeg build does not support filtergraph files, '
                            'and the remix graph is too large for the Windows command line. '
                            'Update FFmpeg to a current build.'
                        ) from legacy_exc

                    media.tool_progress(
                        *inline_cmd,
                        timeout=3600,
                        total_seconds=total_duration,
                        progress_callback=progress_callback,
                    )

            if not output.is_file() or output.stat().st_size <= 0:
                raise RuntimeError('FFmpeg produced no output')

            # Add one voice-over per clip at its exact montage timestamp.
            clip_voice_items = [item for item in plan if isinstance(item.get('voiceover'), dict)]
            voice_groups = [g for g in manifest['groups'] if isinstance(g.get('voiceover'), dict)]
            if clip_voice_items and voice_groups:
                raise ValueError('Use either per-clip or per-group voice-overs, not both')
            if clip_voice_items:
                allowed_folder = (run_media_dir(workdir) / 'audio' / 'voiceovers').resolve()
                audio_inputs = []
                lines = []
                for j, item in enumerate(clip_voice_items, 1):
                    candidate = Path(str(item['voiceover'].get('path') or '')).resolve()
                    if (not candidate.is_relative_to(allowed_folder) or candidate.suffix.lower() != '.mp3'
                            or not candidate.is_file()):
                        raise ValueError('Clip voice-over must be a generated MP3 within this run')
                    audio_inputs.extend(['-i', str(candidate)])
                    start = float(item['timeline_start'])
                    duration = float(item['duration'])
                    delay = round(start * 1000)
                    lines.append(f'[{j}:a:0]atrim=duration={duration:.6f},asetpts=PTS-STARTPTS,'
                                 f'apad=whole_dur={duration:.6f},atrim=duration={duration:.6f},'
                                 f'adelay={delay}|{delay},apad=whole_dur={total_duration:.6f},'
                                 f'atrim=duration={total_duration:.6f}[c{j}]')
                if audio:
                    volume = _num(cfg.get('original_audio_volume', 0.18), 'Original audio volume', 0, 1)
                    lines.append(f'[0:a:0]volume={volume:.4f}[bed]')
                else:
                    lines.append(f'anullsrc=r=48000:cl=stereo,atrim=duration={total_duration:.6f}[bed]')
                mixed = '[bed]' + ''.join(f'[c{j}]' for j in range(1, len(clip_voice_items)+1))
                lines.append(f'{mixed}amix=inputs={len(clip_voice_items)+1}:duration=first:'
                             f'dropout_transition=0,atrim=duration={total_duration:.6f}[mixed]')
                merged = Path(tmp) / 'remix_clip_voice.mp4'
                mix_cmd = ['ffmpeg','-nostdin','-hide_banner','-loglevel','error','-y',
                           '-i',str(output),*audio_inputs,'-filter_complex',';'.join(lines),
                           '-map','0:v:0','-map','[mixed]','-c:v','copy','-c:a','aac',
                           '-b:a','192k','-movflags','+faststart',str(merged)]
                subprocess.run(mix_cmd, check=True, timeout=1200, capture_output=True)
                if not merged.is_file() or merged.stat().st_size <= 0:
                    raise RuntimeError('FFmpeg could not merge per-clip voice-overs')
                merged.replace(output)
            elif voice_groups:
                if len(voice_groups) != len(manifest['groups']):
                    raise ValueError('Some groups have no voice-over; refusing incomplete render')
                allowed_folder = (run_media_dir(workdir) / 'audio' / 'voiceovers').resolve()
                starts = {}
                cursor = 0.0
                for group in manifest['groups']:
                    gid = str(group['group_id'])
                    duration = sum(float(c['source_end']) - float(c['source_start']) for c in group['clips'])
                    starts[gid] = (cursor, duration)
                    cursor += duration
                audio_inputs = []
                lines = []
                for j, group in enumerate(voice_groups, 1):
                    candidate = Path(group['voiceover']['path']).resolve()
                    if candidate.parent != allowed_folder or candidate.suffix.lower() != '.mp3' or not candidate.is_file():
                        raise ValueError('Voice-over must be a generated MP3 within this run')
                    start, duration = starts[str(group['group_id'])]
                    audio_inputs.extend(['-i', str(candidate)])
                    delay = round(start * 1000)
                    lines.append(f'[{j}:a:0]atrim=duration={duration:.6f},asetpts=PTS-STARTPTS,'
                                 f'adelay={delay}|{delay},apad=whole_dur={total_duration:.6f},'
                                 f'atrim=duration={total_duration:.6f}[v{j}]')
                if audio:
                    volume = _num(cfg.get('original_audio_volume', 0.18), 'Original audio volume', 0, 1)
                    lines.append(f'[0:a:0]volume={volume:.4f}[bed]')
                else:
                    lines.append(f'anullsrc=r=48000:cl=stereo,atrim=duration={total_duration:.6f}[bed]')
                mixed = '[bed]' + ''.join(f'[v{j}]' for j in range(1, len(voice_groups)+1))
                lines.append(f'{mixed}amix=inputs={len(voice_groups)+1}:duration=first:'
                             f'dropout_transition=0,atrim=duration={total_duration:.6f}[mixed]')
                merged = Path(tmp) / 'remix_voice.mp4'
                mix_cmd = ['ffmpeg','-nostdin','-hide_banner','-loglevel','error','-y',
                           '-i',str(output),*audio_inputs,'-filter_complex',';'.join(lines),
                           '-map','0:v:0','-map','[mixed]','-c:v','copy','-c:a','aac',
                           '-b:a','192k','-movflags','+faststart',str(merged)]
                subprocess.run(mix_cmd, check=True, timeout=1200, capture_output=True)
                if not merged.is_file() or merged.stat().st_size <= 0:
                    raise RuntimeError('FFmpeg could not merge group voice-overs')
                merged.replace(output)
            output.replace(target)

        return _finish(
            manifest,
            cut_plan=plan,
            render={
                'status': 'completed',
                'filename': 'final.mp4',
                'video_path': str(target),
                'mime_type': 'video/mp4',
                'duration': round(sum(c['duration'] for c in plan), 3),
                'audio_included': bool(
                    audio
                    or any(g.get('voiceover') for g in manifest['groups'])
                    or any(isinstance(c.get('voiceover'), dict) for g in manifest['groups'] for c in g['clips'])
                ),
                'voiceover_groups': sum(bool(g.get('voiceover')) for g in manifest['groups']),
                'voiceover_clips': sum(
                    isinstance(clip.get('voiceover'), dict)
                    for group in manifest['groups'] for clip in group['clips']
                ),
            },
        )

# CLIPTORA - Continuous Group Narration Preview
# Append after the VideoRemixNode class.

_original_remix_preview_timeline = _preview_timeline


def _preview_timeline(
    manifest: dict,
    workdir: Path,
    cfg: dict,
) -> dict[str, Any]:
    """
    Continuous audio for a whole remix group.

    Example:
        Group A = A1, A2, A3, A1, A5, A4

    The group has one MP3, while the video clips
    are split, duplicated and shuffled.
    """

    has_group_voice = any(
        isinstance(group.get("voiceover"), dict)
        for group in manifest["groups"]
    )

    if not has_group_voice:
        return _original_remix_preview_timeline(
            manifest, workdir, cfg
        )

    workspace = Path(workdir).resolve()

    folder = (
        run_media_dir(workspace)
        / "audio"
        / "voiceovers"
    ).resolve()

    project_id = workspace.parent.parent.name
    run_id = workspace.name

    if (
        not project_id.isdecimal()
        or not run_id.isdecimal()
    ):
        raise ValueError(
            "Invalid workflow workspace for audio preview"
        )

    items = []
    missing = []
    invalid = []
    issues = []

    position = 0.0
    voiced = 0
    silent = 0
    group_voices = 0

    for group in manifest["groups"]:
        group_start = position
        group_id = str(group.get("group_id") or "")
        clips = group["clips"]

        group_seconds = sum(
            float(clip["source_end"])
            - float(clip["source_start"])
            for clip in clips
        )

        source_voice = group.get("voiceover")
        playable = None
        problem = None

        if isinstance(source_voice, dict):
            group_voices += 1

            try:
                value = str(
                    source_voice.get("path") or ""
                )
                candidate = Path(value)

                if (
                    not value
                    or candidate.is_symlink()
                    or candidate.suffix.lower() != ".mp3"
                ):
                    raise ValueError(
                        "Group voiceover is not an MP3 file"
                    )

                resolved = candidate.resolve()

                if (
                    resolved.parent != folder
                    or not resolved.is_file()
                ):
                    raise ValueError(
                        "Group voiceover is missing "
                        "or outside this run"
                    )

                duration = _inspect_preview_audio(
                    resolved
                )

                expected = _num(
                    source_voice.get("duration"),
                    "Group voiceover duration",
                    0.001,
                    86400,
                )

                if abs(duration - expected) > 0.15:
                    raise ValueError(
                        "Group voiceover duration "
                        "metadata mismatch"
                    )

                if duration > group_seconds + 0.12:
                    raise ValueError(
                        "Group voiceover is longer "
                        "than its montage clips"
                    )

                audio_id = hashlib.sha256(
                    str(resolved).encode("utf8")
                ).hexdigest()[:24]

                playable = {
                    "url": (
                        f"/api/v1/workflows/{project_id}"
                        f"/runs/{run_id}/audios/{audio_id}"
                    ),
                    "duration": round(duration, 5),
                    "filename": resolved.name,
                    "mime_type": "audio/mpeg",
                    "playback_mode": "group",
                    "group_id": group_id,
                    "timeline_start": round(
                        group_start, 6
                    ),
                }

            except (
                ValueError, OSError, TypeError
            ) as exc:
                problem = str(exc)[:250]

        for clip in clips:
            identity = str(clip["instance_id"])

            seconds = (
                float(clip["source_end"])
                - float(clip["source_start"])
            )

            script = str(
                clip.get("selected_text") or ""
            ).strip()

            event = {
                "instance_id": identity,
                "group_id": group_id,
                "label": str(
                    clip.get("label") or identity
                )[:120],
                "timeline_start": round(
                    position, 6
                ),
                "timeline_end": round(
                    position + seconds, 6
                ),
                "duration": round(seconds, 6),
                "source_start": round(
                    float(clip["source_start"]), 6
                ),
                "source_end": round(
                    float(clip["source_end"]), 6
                ),
                "selected_text": script,
                "transforms": copy.deepcopy(
                    clip.get("transforms") or {}
                ),
                "voiceover": None,
                "voiceover_status": (
                    "missing" if script else "silent"
                ),
            }

            position += seconds

            clip_voice = clip.get("voiceover")

            if isinstance(clip_voice, dict):
                invalid.append({
                    "instance_id": identity,
                    "reason": (
                        "Do not mix group "
                        "and clip narration"
                    ),
                })
                event["voiceover_status"] = "invalid"

            elif source_voice is not None:
                if playable is None:
                    invalid.append({
                        "instance_id": identity,
                        "reason": (
                            problem
                            or "Invalid group voiceover"
                        ),
                    })
                    event["voiceover_status"] = "invalid"

                else:
                    event["voiceover"] = dict(playable)
                    event["voiceover_status"] = "ready"
                    voiced += 1

            elif script:
                missing.append(identity)

            else:
                silent += 1

            items.append(event)

    if missing:
        issues.append(
            f"{len(missing)} narrated clips have no audio"
        )

    if invalid:
        issues.append(
            f"{len(invalid)} clips have invalid narration"
        )

    return {
        "mode": "browser",
        "requires_ffmpeg": False,
        "duration": round(position, 6),
        "clips": len(items),
        "voiced_clips": voiced,
        "silent_clips": silent,
        "group_voiceovers": group_voices,
        "missing_voiceovers": missing,
        "invalid_voiceovers": invalid,
        "issues": issues,
        "ready": not issues,
        "include_original_audio": bool(
            cfg.get("include_audio", True)
        ),
        "original_audio_volume": _num(
            cfg.get("original_audio_volume", 0.18),
            "Original audio volume",
            0,
            1,
        ),
        "timeline": items,
    }
