"""CLIPTORA native Extract Audio node (audio.extract).

The string ``audio`` output is intentionally retained for existing transcription
nodes. Rich metadata and authenticated media URLs are additive.
"""
from __future__ import annotations

import json
import re
import uuid
from pathlib import Path
from typing import Any

from app.helpers.media import tool
from app.workflows.base import BaseNode

FORMATS = {
    'wav': ('wav', 'pcm_s16le', 'audio/wav'),
    'mp3': ('mp3', 'libmp3lame', 'audio/mpeg'),
    'aac': ('m4a', 'aac', 'audio/mp4'),
    'flac': ('flac', 'flac', 'audio/flac'),
    'copy': ('mka', 'copy', 'audio/x-matroska'),
}


def _number(value: Any, name: str, *, minimum: float = 0, maximum: float = 86400) -> float:
    try:
        result = float(value)
    except (TypeError, ValueError) as exc:
        raise ValueError(f'Invalid {name}') from exc
    if not minimum <= result <= maximum or result != result:
        raise ValueError(f'{name} must be between {minimum} and {maximum}')
    return result


def _name(value: Any, source: Path) -> str:
    pattern = str(value or '{{video_name}}_audio')
    if len(pattern) > 120:
        raise ValueError('Output filename is too long')
    pattern = pattern.replace('{{video_name}}', source.stem)
    if '{{' in pattern or '}}' in pattern:
        raise ValueError('Only {{video_name}} is supported in output filename')
    result = re.sub(r'[^\w.-]+', '_', pattern, flags=re.UNICODE).strip('._')[:80]
    if not result or result.startswith('.'):
        raise ValueError('Invalid output filename')
    return result


def _track_metadata(source: Path) -> tuple[list[dict[str, Any]], float]:
    result = json.loads(tool(
        'ffprobe', '-v', 'error', '-select_streams', 'a',
        '-show_entries', 'stream=index,codec_name,channels,sample_rate:format=duration',
        '-of', 'json', str(source), timeout=120,
    ))
    streams = result.get('streams', [])
    duration = _number((result.get('format') or {}).get('duration') or 0, 'Video duration', maximum=10**9)
    return streams, duration


def _output_metadata(path: Path) -> dict[str, Any]:
    result = json.loads(tool(
        'ffprobe', '-v', 'error', '-select_streams', 'a:0',
        '-show_entries', 'stream=codec_name,sample_rate,channels:format=duration',
        '-of', 'json', str(path), timeout=120,
    ))
    stream = (result.get('streams') or [{}])[0]
    fmt = result.get('format') or {}
    duration = float(fmt.get('duration') or 0)
    return {
        'codec': str(stream.get('codec_name') or ''),
        'sample_rate': int(stream.get('sample_rate') or 0),
        'channels': int(stream.get('channels') or 0),
        'duration': round(duration, 3),
        'size_bytes': path.stat().st_size,
    }


class ExtractAudioNode(BaseNode):
    type = 'audio.extract'

    @staticmethod
    def metadata() -> dict[str, Any]:
        return {
            'label': 'Extract Audio', 'group': 'Audio & Media',
            'description': 'Extract one or all audio tracks from a video with FFmpeg.',
            'icon': 'audio-lines',
            'input_types': ['video', 'json'], 'output_types': ['audio', 'json'],
            'settings': {
                'source_mode': 'auto', 'audio_track': 'auto',
                'output_format': 'wav', 'sample_rate': '16000',
                'channels': 'mono', 'trim_enabled': False,
                'start_seconds': 0, 'end_seconds': None,
                'normalize': False, 'output_filename': '{{video_name}}_audio',
            },
        }

    @staticmethod
    def execute(node: dict[str, Any], outputs: dict[str, Any], source: Path | None, workdir: Path) -> dict[str, Any]:
        settings = node.get('settings') or {}
        if source is None or not source.is_file():
            raise ValueError('Extract Audio requires a selected workflow video. Choose one in Parameters.')
        # The workflow engine supplies the authenticated project-owned source.
        mode = str(settings.get('source_mode') or 'auto')
        if mode not in ('auto', 'workflow'):
            raise ValueError('Unsupported video input mode')
        audio_format = str(settings.get('output_format') or 'wav').lower()
        if audio_format not in FORMATS:
            raise ValueError('Unsupported output audio format')
        ext, codec, _mime = FORMATS[audio_format]
        track = str(settings.get('audio_track') or 'auto').strip().lower()
        streams, source_duration = _track_metadata(source)
        if not streams:
            raise ValueError('This video has no audio stream to extract')
        if track in ('auto', 'all'):
            selected = list(range(len(streams))) if track == 'all' else [0]
        elif track.isdecimal() and int(track) < len(streams):
            selected = [int(track)]
        else:
            raise ValueError(f'Audio track {track!r} is not available. Available tracks: 0–{len(streams)-1}')

        trim = settings.get('trim_enabled') is True
        start = _number(settings.get('start_seconds', 0) or 0, 'Trim start', maximum=10**9) if trim else 0.0
        end_raw = settings.get('end_seconds')
        end = _number(end_raw, 'Trim end', maximum=10**9) if trim and end_raw not in ('', None) else None
        if trim and (start >= source_duration or (end is not None and (end <= start or end > source_duration + 0.1))):
            raise ValueError('Trim range must be within video duration, with end greater than start')
        if audio_format == 'copy' and (bool(settings.get('normalize')) or str(settings.get('sample_rate') or 'auto') not in ('auto', 'original') or str(settings.get('channels') or 'original') not in ('original', 'auto')):
            raise ValueError('Copy original audio cannot resample, change channels, or normalize')

        rate = str(settings.get('sample_rate') or '16000')
        if rate not in ('auto', 'original', '16000', '44100', '48000'):
            raise ValueError('Unsupported sample rate')
        channels = str(settings.get('channels') or 'mono')
        if channels not in ('original', 'auto', 'mono', 'stereo'):
            raise ValueError('Unsupported channel mode')
        file_base = _name(settings.get('output_filename'), source)
        destination = workdir / 'audio'
        destination.mkdir(parents=True, exist_ok=True)
        node_id = str(node['id'])
        if not re.fullmatch(r'[A-Za-z][A-Za-z0-9_-]{0,47}', node_id):
            raise ValueError('Invalid node id')

        # The workspace is bound to user/project/run by workflow_service.py.
        try:
            run_id = int(workdir.name)
            project_id = int(workdir.parent.parent.name)
        except ValueError:
            run_id = project_id = None  # Standalone/unit execution; URLs omitted.

        rendered: list[dict[str, Any]] = []
        for ordinal in selected:
            postfix = f'_track{ordinal}' if len(selected) > 1 else ''
            filename = f'{node_id}_{file_base}{postfix}.{ext}'
            target = destination / filename
            temporary = destination / f'.{uuid.uuid4().hex}.{ext}'
            args: list[str] = ['ffmpeg', '-nostdin', '-hide_banner', '-loglevel', 'error', '-y', '-i', str(source)]
            if trim:
                args.extend(['-ss', str(start)])
                if end is not None:
                    args.extend(['-t', str(end-start)])
            args.extend(['-map', f'0:a:{ordinal}', '-vn', '-sn', '-dn', '-c:a', codec])
            if audio_format != 'copy':
                if rate not in ('auto', 'original'):
                    args.extend(['-ar', rate])
                if channels == 'mono':
                    args.extend(['-ac', '1'])
                elif channels == 'stereo':
                    args.extend(['-ac', '2'])
                if settings.get('normalize') is True:
                    args.extend(['-af', 'loudnorm=I=-16:TP=-1.5:LRA=11'])
            args.append(str(temporary))
            try:
                tool(*args, timeout=5400)
                if not temporary.is_file() or temporary.stat().st_size <= 0:
                    raise RuntimeError('FFmpeg did not create an audio file')
                temporary.replace(target)
            finally:
                temporary.unlink(missing_ok=True)
            entry = {
                'filename': filename,
                'format': audio_format,
                'stream_index': int(streams[ordinal].get('index', ordinal)),
                'track': ordinal,
                'source_start_seconds': start if trim else 0.0,
                'path': str(target),
                **_output_metadata(target),
            }
            if run_id is not None and project_id is not None:
                url = f'/api/v1/workflows/{project_id}/runs/{run_id}/audio/{node_id}/{ordinal}'
                entry['url'] = url
                entry['download_url'] = url + '?download=true'
            rendered.append(entry)

        # audio string is a required backward-compatible handoff to audio.transcribe.
        return {
            'status': 'completed', 'audio': rendered[0]['path'],
            'audio_file': rendered[0], 'audio_files': rendered,
            'source': {'filename': source.name, 'duration': round(source_duration, 3)},
        }


metadata = ExtractAudioNode.metadata
execute = ExtractAudioNode.execute
NODE = ExtractAudioNode.definition()
