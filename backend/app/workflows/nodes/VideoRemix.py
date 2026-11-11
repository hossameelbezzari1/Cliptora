
"""Non-destructive CLIPTORA video remix nodes.

Each transformation consumes/returns a versioned JSON clip_manifest. Only
video.remix_render calls FFmpeg; preview operations never transcode media.
"""
from __future__ import annotations

import copy
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
        PREFIX + 'split': _op.__func__('split', 'lucide:split', 'Split Clips', {'min_seconds': 2.0, 'max_seconds': 3.0, 'remainder_policy': 'allow_short'}),
        PREFIX + 'duplicate': _op.__func__('duplicate', 'lucide:copy', 'Duplicate Clips', {'min_duplicates': 1, 'max_duplicates': 2, 'seed': 42}),
        PREFIX + 'shuffle': _op.__func__('shuffle', 'lucide:shuffle', 'Shuffle Clips', {'seed': 42, 'avoid_adjacent_identical': True}),
        PREFIX + 'zoom': _op.__func__('zoom', 'lucide:zoom-in', 'Zoom & Reframe', {'min_zoom_percent': 10.0, 'max_zoom_percent': 20.0, 'seed': 42}),
        PREFIX + 'merge': _op.__func__('merge', 'lucide:combine', 'Merge Clips', {}),
        PREFIX + 'preview': _op.__func__('preview', 'lucide:monitor-play', 'Preview Montage', {}),
        PREFIX + 'render': _op.__func__('render', 'lucide:film', 'Render Remix MP4', {'include_audio': True}),
    }

    parameter_fields = {
        kind: {'input_path': {'type': 'string', 'title': 'Input Data', 'widget': 'upstream', 'accepts': ['json']}}
        for kind in operations
    }

    parameter_fields[PREFIX + 'split'].update({
        'min_seconds': {'type': 'number', 'title': 'Min Clip (seconds)', 'minimum': 0.1, 'maximum': 60, 'expression': True},
        'max_seconds': {'type': 'number', 'title': 'Max Clip (seconds)', 'minimum': 0.1, 'maximum': 60, 'expression': True},
        'remainder_policy': {'type': 'string', 'title': 'Short Remainders', 'enum': ['allow_short', 'keep', 'skip', 'error']},
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
            words = []
            for value in outputs.values():
                if isinstance(value, dict) and isinstance(value.get('words'), list):
                    words = value['words']
                    break
            if strict and not words:
                raise ValueError('Strict text matching requires Transcribe Every Word connected')

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

                    if strict:
                        selected = re.sub(r'\W+', ' ', str(entry.get('selected_text') or '').lower()).strip()
                        transcript = ' '.join(
                            str(w.get('text') or '')
                            for w in words
                            if isinstance(w, dict)
                            and float(w.get('end', -1)) > a
                            and float(w.get('start', 1e10)) < b
                        )
                        normalized = re.sub(r'\W+', ' ', transcript.lower()).strip()

                        if not selected or selected != normalized:
                            raise ValueError('Selected text does not match timed transcript')

                    validated.append({
                        **entry,
                        'start': a,
                        'end': b,
                        'duration': round(b - a, 3),
                    })

                except (ValueError, TypeError) as exc:
                    rejected.append({'index': index, 'reason': str(exc)})

            return {
                'highlights': validated,
                'rejected': rejected,
                'stats': {
                    'valid': len(validated),
                    'rejected': len(rejected),
                },
            }

        if action == 'cut':
            candidates = _highlights(outputs, path)
            padding = _num(cfg.get('padding', 0), 'padding', 0, 30)
            groups = []

            for index, entry in enumerate(candidates):
                if not isinstance(entry, dict):
                    raise ValueError('Invalid highlight entry')

                start = _num(entry.get('start'), 'highlight start')
                end = _num(entry.get('end'), 'highlight end')

                if end <= start:
                    raise ValueError('Highlight end must be greater than start')

                start = max(0, start - padding)
                end = end + padding

                gid = f'group_{index+1:04d}'
                cid = f'{gid}_clip_0001'

                groups.append({
                    'group_id': gid,
                    'label': _label(index),
                    'title': str(entry.get('title') or f'Highlight {index+1}')[:160],
                    'clips': [{
                        'clip_id': cid,
                        'original_clip_id': cid,
                        'instance_id': cid,
                        'label': f'{_label(index)}1',
                        'source_start': round(start, 3),
                        'source_end': round(end, 3),
                        'duration': round(end - start, 3),
                        'order': 0,
                        'transforms': {},
                    }],
                })

            return _finish({'version': 1, 'groups': groups})

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

            for group in manifest['groups']:
                split = []

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
                        split.append(clip)
                        warnings.append(
                            f'Kept {clip["instance_id"]}: outside duration bounds'
                        )
                        continue

                    else:
                        count = max(1, minimum_count)
                        warnings.append(
                            f'{clip["instance_id"]}: allowed short section outside minimum duration'
                        )

                    for i in range(count):
                        left = clip['source_start'] + duration * i / count
                        right = clip['source_start'] + duration * (i + 1) / count

                        new = copy.deepcopy(clip)
                        new['clip_id'] = f'{clip["clip_id"]}_s{i+1:03d}'
                        new['original_clip_id'] = new['clip_id']
                        new['instance_id'] = f'{clip["instance_id"]}_s{i+1:03d}'
                        new['duplicate_of'] = None
                        new['label'] = f"{group.get('label', group['group_id'])}{len(split)+1}"
                        new['source_start'] = round(left, 6)
                        new['source_end'] = round(right, 6)
                        split.append(new)

                group['clips'] = split

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

        elif action in {'merge', 'preview'}:
            plan = _cut_plan(manifest)
            output = _finish(manifest, cut_plan=plan)

            if action == 'preview':
                output['preview'] = {
                    'mode': 'browser',
                    'requires_ffmpeg': False,
                    'duration': output['stats']['duration'],
                    'clips': len(plan),
                }

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

        if not plan or len(plan) > 600:
            raise ValueError('Render requires 1 to 600 clips')

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
                'audio_included': audio,
            },
        )
