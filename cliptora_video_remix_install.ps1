$ErrorActionPreference = 'Stop'
$root = 'C:\xampp\htdocs\CLIPTORA'
if (-not (Test-Path $root -PathType Container)) { throw "CLIPTORA project not found at $root" }
$utf8 = [System.Text.UTF8Encoding]::new($false)
function Read-Source([string]$path) {
  $full = Join-Path $root $path
  if (-not (Test-Path $full -PathType Leaf)) { throw "Missing source file: $path" }
  return [System.IO.File]::ReadAllText($full).Replace("`r`n", "`n")
}
function Replace-Checked([string]$content, [string]$old, [string]$new, [string]$label) {
  if ($content.Contains($new)) { return $content }
  if (-not $content.Contains($old)) { throw "Unexpected source structure: $label. Nothing written." }
  return $content.Replace($old, $new)
}
$changes = @{}
$files = @{}

$files['backend\app\workflows\nodes\VideoRemix.py'] = @'
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
                        transcript = ' '.join(str(w.get('text') or '') for w in words
                                          if isinstance(w, dict) and float(w.get('end', -1)) > a
                                          and float(w.get('start', 1e10)) < b)
                        normalized = re.sub(r'\W+', ' ', transcript.lower()).strip()
                        if not selected or selected != normalized:
                            raise ValueError('Selected text does not match timed transcript')
                    validated.append({**entry, 'start': a, 'end': b, 'duration': round(b-a, 3)})
                except (ValueError, TypeError) as exc:
                    rejected.append({'index': index, 'reason': str(exc)})
            return {'highlights': validated, 'rejected': rejected, 'stats': {'valid': len(validated), 'rejected': len(rejected)}}

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
                    'group_id': gid, 'label': _label(index),
                    'title': str(entry.get('title') or f'Highlight {index+1}')[:160],
                    'clips': [{
                        'clip_id': cid, 'original_clip_id': cid, 'instance_id': cid,
                        'label': f'{_label(index)}1',
                        'source_start': round(start, 3), 'source_end': round(end, 3),
                        'duration': round(end-start, 3), 'order': 0,
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
                        warnings.append(f'Skipped {clip["instance_id"]}: cannot split within duration bounds')
                        continue
                    elif policy == 'error':
                        raise ValueError(f'Cannot split {clip["instance_id"]} into {low}-{high}s clips')
                    elif policy == 'keep':
                        split.append(clip)
                        warnings.append(f'Kept {clip["instance_id"]}: outside duration bounds')
                        continue
                    else:
                        count = max(1, minimum_count)
                        warnings.append(f'{clip["instance_id"]}: allowed short section outside minimum duration')
                    for i in range(count):
                        left = clip['source_start'] + duration*i/count
                        right = clip['source_start'] + duration*(i+1)/count
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
                group['clips'] = _ordered(group['clips'], _rng(seed, group['group_id']), avoid)

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
                output['preview'] = {'mode': 'browser', 'requires_ffmpeg': False,
                                     'duration': output['stats']['duration'], 'clips': len(plan)}
            return output

        elif action == 'render':
            return self._render(manifest, cfg, source, workdir)
        else:
            raise ValueError(f'Unsupported video remix operation: {operation}')

        return _finish(manifest, warnings=warnings)

    @staticmethod
    def _render(manifest: dict, cfg: dict, source: Path | None, workdir: Path) -> dict:
        if source is None or not source.is_file():
            raise ValueError('Render Remix requires a selected source video')
        plan = _cut_plan(manifest)
        if not plan or len(plan) > 600:
            raise ValueError('Render requires 1 to 600 clips')
        ffprobe = subprocess.run(
            ['ffprobe', '-v', 'error', '-show_entries', 'stream=codec_type,width,height',
             '-of', 'json', str(source)], capture_output=True, text=True, timeout=30, check=True,
        )
        streams = json.loads(ffprobe.stdout).get('streams') or []
        video = next((s for s in streams if s.get('codec_type') == 'video'), None)
        if not video:
            raise ValueError('Selected source has no video stream')
        width, height = int(video['width']), int(video['height'])
        if width < 2 or height < 2:
            raise ValueError('Invalid source resolution')
        width -= width % 2
        height -= height % 2
        audio = bool(cfg.get('include_audio', True) and any(s.get('codec_type') == 'audio' for s in streams))
        filters = []
        concat = []
        for i, clip in enumerate(plan):
            a, b = clip['source_start'], clip['source_end']
            zoom = _num((clip.get('transforms') or {}).get('zoom', 1), 'Zoom', 1, 3)
            video_chain = f'[0:v:0]trim=start={a:.6f}:end={b:.6f},setpts=PTS-STARTPTS'
            if zoom > 1:
                video_chain += (f',crop=trunc(iw/{zoom:.6f}/2)*2:trunc(ih/{zoom:.6f}/2)*2:'
                                '(iw-ow)/2:(ih-oh)/2')
            video_chain += f',scale={width}:{height},setsar=1,format=yuv420p[v{i}]'
            filters.append(video_chain)
            concat.append(f'[v{i}]')
            if audio:
                filters.append(f'[0:a:0]atrim=start={a:.6f}:end={b:.6f},asetpts=PTS-STARTPTS,'
                               f'aresample=48000[a{i}]')
                concat.append(f'[a{i}]')
        filters.append(''.join(concat) + f'concat=n={len(plan)}:v=1:a={int(audio)}[outv]' + ('[outa]' if audio else ''))
        try:
            folder = run_media_dir(workdir) / 'videos'
        except ValueError:
            folder = Path(workdir) / 'videos'
        folder.mkdir(parents=True, exist_ok=True)
        target = folder / 'final.mp4'  # API's existing /runs/{id}/video endpoint
        with tempfile.TemporaryDirectory(prefix='cliptora-remix-', dir=folder) as tmp:
            script = Path(tmp) / 'filters.txt'
            script.write_text(';'.join(filters), encoding='utf-8')
            output = Path(tmp) / 'output.mp4'
            cmd = ['ffmpeg', '-nostdin', '-hide_banner', '-loglevel', 'error', '-y',
                   '-i', str(source), '-filter_complex_script', str(script),
                   '-map', '[outv]']
            if audio:
                cmd.extend(['-map', '[outa]'])
            else:
                cmd.append('-an')
            cmd.extend(['-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '20'])
            if audio:
                cmd.extend(['-c:a', 'aac', '-b:a', '192k'])
            cmd.extend(['-movflags', '+faststart', str(output)])
            media.tool(*cmd, timeout=3600)
            if not output.is_file() or output.stat().st_size <= 0:
                raise RuntimeError('FFmpeg produced no output')
            output.replace(target)
        return _finish(manifest, cut_plan=plan, render={
            'status': 'completed', 'filename': 'final.mp4',
            'video_path': str(target), 'mime_type': 'video/mp4',
            'duration': round(sum(c['duration'] for c in plan), 3), 'audio_included': audio,
        })
'@

$files['frontend\src\components\workflow\preview\WorkflowRemixOutput.tsx'] = @'
import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, Play, Pause, RotateCcw } from 'lucide-react'
import type { WorkflowNodeOutputProps } from '../nodeTypes'

type Clip = {
  clip_id: string
  label?: string
  original_clip_id?: string
  instance_id: string
  duplicate_of?: string | null
  source_start: number
  source_end: number
  transforms?: { zoom?: number }
}
type Group = { group_id: string; label: string; title?: string; clips: Clip[] }
type Manifest = { version: number; groups: Group[] }

type PlayItem = Clip & { group: string; name: string; index: number }

const object = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
const seconds = (value: number) => Number.isFinite(value) ? value.toFixed(2) + 's' : '—'

export function WorkflowRemixOutput({ value, mediaUrl }: WorkflowNodeOutputProps) {
  const result = object(value)
  const manifest = object(result.clip_manifest) as Partial<Manifest>
  const groups = Array.isArray(manifest.groups) ? manifest.groups : []
  const clips = useMemo(() => groups.flatMap(group =>
    (Array.isArray(group.clips) ? group.clips : []).map((clip, index) => ({
      ...clip,
      group: group.label || group.group_id,
      name: clip.label || `${group.label || group.group_id}${index + 1}`,
      index,
    }))), [groups])
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [playing, setPlaying] = useState(false)
  const videoRef = useRef<HTMLVideoElement>(null)
  const sequenceRef = useRef(false)
  const shouldPlay = useRef(false)
  const selectedIndexRef = useRef(0)
  selectedIndexRef.current = selectedIndex
  const selected = clips[selectedIndex] ?? clips[0]
  const total = clips.reduce((sum, clip) => sum + Math.max(0, clip.source_end - clip.source_start), 0)

  useEffect(() => {
    shouldPlay.current = false
    sequenceRef.current = false
    setPlaying(false)
    setSelectedIndex(0)
    if (videoRef.current && clips.length) {
      videoRef.current.pause()
      videoRef.current.currentTime = clips[0].source_start
    }
  }, [mediaUrl, result.clip_manifest])

  const go = (index: number, sequence: boolean, autoplay = true) => {
    if (!clips[index]) return
    const player = videoRef.current
    sequenceRef.current = sequence
    shouldPlay.current = autoplay
    setSelectedIndex(index)
    selectedIndexRef.current = index
    if (!player) return
    player.pause()
    const target = clips[index].source_start
    if (Math.abs(player.currentTime - target) < 0.04 && autoplay) {
      void player.play().catch(() => { shouldPlay.current = false; setPlaying(false) })
    } else {
      player.currentTime = target
    }
    setPlaying(false)
  }

  const advance = () => {
    if (!sequenceRef.current) {
      videoRef.current?.pause()
      shouldPlay.current = false
      setPlaying(false)
      return
    }
    const next = selectedIndexRef.current + 1
    if (next >= clips.length) {
      videoRef.current?.pause()
      shouldPlay.current = false
      sequenceRef.current = false
      setPlaying(false)
      return
    }
    go(next, true)
  }

  if (!clips.length) {
    const count = Array.isArray(result.highlights) ? result.highlights.length : 0
    return <div className="space-y-2 p-4 text-xs text-[#666] dark:text-[#b8bec7]">
      <p className="font-semibold">{count} validated highlights</p>
      <p>{count ? 'Connect Cut Highlights to see the visual clip timeline.' : 'No clips were generated in this run.'}</p>
      {Array.isArray(result.rejected) && result.rejected.length > 0 &&
        <p>{result.rejected.length} items were rejected. Inspect JSON for details.</p>}
    </div>
  }

  return <div className="space-y-3 p-3 text-[#333] dark:text-[#f3f4f6]">
    <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
      <span className="font-semibold">{groups.length} Groups · {clips.length} Clips</span>
      <span className="text-[#777] dark:text-[#b8bec7]">{seconds(total)} total</span>
    </div>
    <div className="relative overflow-hidden rounded-lg bg-black aspect-video">
      {mediaUrl ? <video ref={videoRef} src={mediaUrl} playsInline preload="metadata"
        className="h-full w-full object-contain"
        style={{ transform: `scale(${selected?.transforms?.zoom ?? 1})` }}
        onSeeked={() => {
          if (shouldPlay.current) {
            void videoRef.current?.play().catch(() => {
              setPlaying(false)
              shouldPlay.current = false
            })
          }
        }}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onTimeUpdate={() => {
          const index = selectedIndexRef.current
          const active = clips[index]
          if (active && videoRef.current && videoRef.current.currentTime >= active.source_end - 0.04) advance()
        }}
        onEnded={advance}
      /> : <div className="absolute inset-0 grid place-content-center px-3 text-center text-xs text-white/75">
        Select this video from the Media Library to enable playback preview.
      </div>}
    </div>
    <div className="flex items-center justify-between gap-2">
      <button type="button" disabled={!mediaUrl || !clips.length} onClick={() => go(0, true)}
        className="flex items-center gap-1.5 rounded-md bg-violet-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40">
        {playing ? <Pause size={13} /> : <Play size={13} />}
        Play montage
      </button>
      <div className="flex items-center gap-1">
        <button title="Previous clip" type="button" className="rounded-md p-1.5 hover:bg-[#eee] dark:hover:bg-[#374151]" onClick={() => go(Math.max(0, selectedIndex - 1), false)}><ChevronLeft size={17} /></button>
        <span className="text-xs tabular-nums">{selectedIndex + 1}/{clips.length}</span>
        <button title="Next clip" type="button" className="rounded-md p-1.5 hover:bg-[#eee] dark:hover:bg-[#374151]" onClick={() => go(Math.min(clips.length - 1, selectedIndex + 1), false)}><ChevronRight size={17} /></button>
        <button title="Restart clip" type="button" className="rounded-md p-1.5 hover:bg-[#eee] dark:hover:bg-[#374151]" onClick={() => go(selectedIndex, true)}><RotateCcw size={15} /></button>
      </div>
    </div>
    <div className="space-y-2">
      {groups.map(group => {
        const indices = clips.map((clip, i) => ({ clip, i })).filter(({ clip }) => clip.group === (group.label || group.group_id))
        return <section key={group.group_id} className="space-y-1.5">
          <p className="text-xs font-semibold">Group {group.label || group.group_id} · {group.title ?? ''}</p>
          <div className="flex flex-wrap gap-1.5">
            {indices.map(({ clip, i }) => <button key={clip.instance_id} type="button" onClick={() => go(i, false)}
              className={`min-w-[68px] rounded-md border px-2 py-1.5 text-left text-[11px] ${i === selectedIndex ? 'border-violet-600 bg-violet-50 text-violet-700 dark:bg-violet-950/30 dark:text-violet-200' : 'border-[#ddd] dark:border-[#4b5563]'}`}>
              <span className="block font-semibold">{clip.name}{clip.duplicate_of ? ' ↻' : ''}</span>
              <span className="block opacity-70">{seconds(clip.source_end - clip.source_start)}</span>
              <span className="block opacity-60">{seconds(clip.source_start)}–{seconds(clip.source_end)}</span>
            </button>)}
          </div>
        </section>
      })}
    </div>
    <p className="text-[11px] text-[#888] dark:text-[#aaa]">Browser preview uses the original video, seeks between segments, and applies CSS zoom. Small playback gaps may occur; final MP4 uses FFmpeg.</p>
  </div>
}
'@

$files['backend\tests\test_video_remix_nodes.py'] = @'
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
'@


$path = 'frontend\src\components\workflow\nodeTypes.ts'
$c = Read-Source $path
$c = Replace-Checked $c ('export type WorkflowNodeOutputProps = {' + "`n" + '  value: unknown' + "`n" + '}') ('export type WorkflowNodeOutputProps = {' + "`n" + '  value: unknown' + "`n" + '  mediaUrl?: string' + "`n" + '}') $path
$changes[$path] = $c

$path = 'frontend\src\components\workflow\nodeRegistry.ts'
$c = Read-Source $path
$c = Replace-Checked $c "import type { WorkflowNodeUI } from './nodeTypes'" ("import type { WorkflowNodeUI } from './nodeTypes'" + "`n" + "import { WorkflowRemixOutput } from './preview/WorkflowRemixOutput'") $path
$c = Replace-Checked $c '  return registered.get(type)' ("  return registered.get(type) ?? (type.startsWith('video.remix_')" + "`n" + '    ? { type, Output: WorkflowRemixOutput }' + "`n" + '    : undefined)') $path
$changes[$path] = $c

$path = 'frontend\src\components\workflow\editor\WorkflowNodeDataPanel.tsx'
$c = Read-Source $path
$c = Replace-Checked $c "import { WorkflowToolIcon } from '../WorkflowToolIcon'" ("import { WorkflowToolIcon } from '../WorkflowToolIcon'" + "`n" + "import { fileUrl } from '../../../lib/api'") $path
$needle = '  const activeVideoSource = sources.find(source => source.id === sourceId) ?? null'
$addition = @'
  const sourceMediaUrl = activeVideoSource
    ? (studio.previewMedia
      ? fileUrl(studio.previewMedia.id)
      : `${import.meta.env.VITE_API_URL ?? 'http://127.0.0.1:8000/api/v1'}/workflows/${studio.projectId}/sources/${activeVideoSource.id}/stream`)
    : undefined
'@
$c = Replace-Checked $c $needle ($needle + "`n" + $addition.TrimEnd()) $path
$c = Replace-Checked $c '<CustomOutput value={value} />' '<CustomOutput value={value} mediaUrl={sourceMediaUrl} />' $path
$changes[$path] = $c

$path = 'backend\app\http\controllers\WorkflowController.py'
$c = Read-Source $path
$needle = '    def start_run(self, project_id: int, body: StartRun,'
$addition = @'
    def source_video(self, project_id: int, source_id: int,
                     db: Session = Depends(wf_db), user: User = Depends(current_user)):
        return self.service.source_video(project_id=project_id, source_id=source_id,
                                         db=db, user=user)

'@
$c = Replace-Checked $c $needle ($addition + $needle) $path
$needle = "router.add_api_route('/{project_id}/runs', controller.start_run"
$c = Replace-Checked $c $needle ("router.add_api_route('/{project_id}/sources/{source_id}/stream', controller.source_video, methods=['GET'])" + "`n" + $needle) $path
$changes[$path] = $c

$path = 'backend\app\services\WorkflowService.py'
$c = Read-Source $path
$needle = '    def start_run(self, project_id: int, body: StartRun,'
$addition = @'
    def source_video(self, project_id: int, source_id: int,
                     db: Session = Depends(wf_db), user: User = Depends(current_user)):
        """Authorized video streaming for browser-only remix preview."""
        authorize(db, project_id, user.id)
        item = owner(db, WorkflowSource, source_id, user.id, project_id)
        try:
            path = source_location(db, item)
        except FileNotFoundError as exc:
            raise HTTPException(404, "Workflow source video not found") from exc
        mime = {".mp4": "video/mp4", ".webm": "video/webm",
                ".mov": "video/quicktime", ".m4v": "video/mp4",
                ".mkv": "video/x-matroska"}.get(path.suffix.lower())
        if not mime:
            raise HTTPException(415, "Unsupported preview media format")
        return FileResponse(path, media_type=mime, content_disposition_type="inline",
                            headers={"Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff"})

'@
$c = Replace-Checked $c $needle ($addition + $needle) $path
$changes[$path] = $c

# Only after all structural checks pass do we write any source file.
foreach ($entry in $changes.GetEnumerator()) {
  $full = Join-Path $root $entry.Key
  [System.IO.File]::WriteAllText($full, $entry.Value, $utf8)
}
foreach ($entry in $files.GetEnumerator()) {
  $full = Join-Path $root $entry.Key
  $folder = Split-Path $full -Parent
  if (-not (Test-Path $folder -PathType Container)) { New-Item -ItemType Directory -Force -Path $folder | Out-Null }
  [System.IO.File]::WriteAllText($full, $entry.Value + "`n", $utf8)
}

Set-Location (Join-Path $root 'backend')
Write-Host 'Video Remix nodes installed. Run tests:' -ForegroundColor Green
Write-Host '  python -m pytest tests/test_video_remix_nodes.py -q' -ForegroundColor Cyan
Write-Host '  python -m compileall app' -ForegroundColor Cyan
Write-Host 'Then restart FastAPI and Vite to refresh the dynamic node catalogs.' -ForegroundColor Yellow
