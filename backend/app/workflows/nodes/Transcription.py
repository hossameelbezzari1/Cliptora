
from __future__ import annotations

import hashlib
import json
import math
import re
from pathlib import Path
from typing import Any

from app.workflows.Node import Node
from app.workflows.MediaStorage import run_media_dir
from app.helpers.Transcript import group_words


class TranscriptionNode(Node):
    family = 'transcription'
    group = 'Audio'
    icon = 'lucide:captions'

    operations = {
        'audio.transcribe': {
            'icon': 'lucide:mic',
            'label': 'Transcribe Every Word',
            'settings': {
                'model': 'small',
                'language': None,
                'beam_size': 5,
                'device': 'cpu',
                'compute_type': 'int8',
                'vad_filter': True,
                'include_confidence': True,
            },
        },
    }

    parameter_fields = {
        'audio.transcribe': {
            'model': {
                'type': 'string',
                'title': 'Whisper Model',
                'options': [
                    {'value': v, 'label': v}
                    for v in (
                        'tiny', 'base', 'small',
                        'medium', 'large-v3', 'turbo',
                    )
                ],
            },
            'language': {
                'type': 'string',
                'title': 'Language',
                'options': [
                    {'value': v, 'label': v}
                    for v in (
                        'auto', 'en', 'fr', 'ar', 'es',
                        'de', 'pt', 'it', 'tr', 'hi',
                        'ru', 'zh', 'ja', 'ko',
                    )
                ],
            },
            'audio_track': {
                'type': 'string',
                'default': 'auto',
            },
            'vad_min_silence_ms': {
                'type': 'integer',
                'default': 500,
                'minimum': 100,
                'maximum': 5000,
            },
            'vad_filter': {
                'type': 'boolean',
                'default': True,
            },
            'include_confidence': {
                'type': 'boolean',
                'default': True,
            },
            'beam_size': {
                'type': 'integer',
                'default': 5,
                'minimum': 1,
                'maximum': 10,
                'group': 'Advanced',
            },
            'device': {
                'type': 'string',
                'enum': ['cpu', 'auto', 'cuda'],
                'group': 'Advanced',
            },
            'compute_type': {
                'type': 'string',
                'enum': [
                    'int8', 'auto', 'float32', 'float16',
                ],
                'group': 'Advanced',
            },
            'initial_prompt': {
                'type': 'string',
                'widget': 'textarea',
                'group': 'Advanced',
            },
        }
    }

    def execute_operation(
        self,
        operation,
        node,
        outputs,
        source,
        workdir,
    ):
        cfg = node.get('settings') or {}
        callback = node.get('_progress_callback')

        def report(
            stage: str,
            message: str,
            **metrics: Any,
        ) -> None:
            if callable(callback):
                callback({
                    'stage': stage,
                    'message': message,
                    **metrics,
                })

        model = str(cfg.get('model') or 'small')

        if model not in {
            'tiny', 'base', 'small', 'medium',
            'large-v2', 'large-v3',
            'large-v3-turbo', 'turbo',
        }:
            raise ValueError('Invalid Whisper model')

        language = cfg.get('language') or None

        if language == 'auto':
            language = None

        if language and not re.fullmatch(
            '[a-z]{2,3}', str(language)
        ):
            raise ValueError(
                'Invalid transcription language'
            )

        device = str(cfg.get('device') or 'cpu')

        if device not in {'cpu', 'cuda', 'auto'}:
            raise ValueError('Invalid Whisper device')

        compute_type = str(
            cfg.get('compute_type')
            or ('int8' if device == 'cpu' else 'float16')
        )

        if device == 'cpu' and compute_type == 'float16':
            raise ValueError(
                'float16 is not available on CPU'
            )

        beam = int(cfg.get('beam_size', 5))

        if not 1 <= beam <= 10:
            raise ValueError('beam_size out of range')

        wanted = str(
            cfg.get('audio_track', 'auto')
        )

        if wanted != 'auto' and not wanted.isdigit():
            raise ValueError(
                'audio_track must be auto or a valid numeric index'
            )

        entries: list[dict] = []

        for parent in outputs.values():
            if (
                isinstance(parent, dict)
                and isinstance(parent.get('audio_files'), list)
            ):
                entries.extend(
                    item
                    for item in parent['audio_files']
                    if isinstance(item, dict)
                )
            elif (
                isinstance(parent, dict)
                and parent.get('audio')
            ):
                entries.append({
                    'path': parent['audio'],
                    'track': 0,
                })

        if not entries:
            raise ValueError(
                'Connect Extract Audio before Transcribe Every Word'
            )

        if wanted == 'auto':
            entry = entries[0]
        else:
            entry = next(
                (
                    item
                    for item in entries
                    if str(item.get('track', 0)) == wanted
                ),
                None,
            )

        if entry is None:
            raise ValueError(
                'Selected audio track was not extracted'
            )

        track = int(entry.get('track', 0))

        audio = Path(str(entry['path'])).resolve()

        # Current storage: storage/media/<user>/<project>/
        # workflow-runs/<run_id>/audio
        #
        # Legacy storage: storage/workflows/<user>/<project>/
        # runs/<run_id>/audio
        allowed_audio_dirs = (
            (run_media_dir(workdir) / 'audio').resolve(),
            (workdir / 'audio').resolve(),
        )

        if not audio.is_file() or not any(
            audio.is_relative_to(folder)
            for folder in allowed_audio_dirs
        ):
            raise ValueError(
                'Audio must belong to current workflow run'
            )

        signature = {
            'path': str(audio),
            'size': audio.stat().st_size,
            'mtime': audio.stat().st_mtime_ns,
            'model': model,
            'language': language,
            'beam': beam,
            'device': device,
            'compute': compute_type,
            'vad': cfg.get('vad_filter', True),
            'confidence': cfg.get(
                'include_confidence', True
            ),
            'offset': entry.get(
                'source_start_seconds', 0
            ),
            'initial_prompt': str(
                cfg.get('initial_prompt') or ''
            )[:1000],
            'min_silence': cfg.get(
                'vad_min_silence_ms', 500
            ),
        }

        fingerprint = hashlib.sha256(
            json.dumps(
                signature,
                sort_keys=True,
            ).encode()
        ).hexdigest()

        cache = workdir / f'transcript_{fingerprint}.json'

        if cache.is_file():
            try:
                cached = json.loads(
                    cache.read_text(
                        encoding='utf8'
                    )
                )

                if (
                    isinstance(cached.get('words'), list)
                    and 'language' in cached
                    and 'segments' in cached
                ):
                    report(
                        'cache_hit',
                        'Using saved transcription',
                        progress=99,
                        words_processed=len(
                            cached['words']
                        ),
                        segments_processed=len(
                            cached['segments']
                        ),
                    )
                    return cached

            except (ValueError, OSError, AttributeError):
                pass

        report(
            'loading_model',
            f'Loading faster-whisper model: {model}',
        )

        from faster_whisper import WhisperModel

        whisper = WhisperModel(
            model,
            device=device,
            compute_type=compute_type,
        )

        kwargs: dict[str, Any] = {
            'language': language,
            'beam_size': beam,
            'word_timestamps': True,
            'vad_filter': bool(
                cfg.get('vad_filter', True)
            ),
        }

        if cfg.get('initial_prompt'):
            kwargs['initial_prompt'] = str(
                cfg['initial_prompt']
            )[:1000]

        if kwargs['vad_filter']:
            silence = int(
                cfg.get('vad_min_silence_ms') or 500
            )

            if not 100 <= silence <= 5000:
                raise ValueError(
                    'vad_min_silence_ms must be between 100 and 5000'
                )

            kwargs['vad_parameters'] = {
                'min_silence_duration_ms': silence
            }

        report(
            'preparing_audio',
            'Preparing audio for recognition',
        )

        segments, info = whisper.transcribe(
            str(audio),
            **kwargs,
        )

        offset = float(
            entry.get('source_start_seconds') or 0
        )

        raw_duration = float(
            getattr(info, 'duration', 0) or 0
        )

        duration = (
            raw_duration
            if math.isfinite(raw_duration)
            and raw_duration > 0
            else 0.0
        )

        report(
            'transcribing',
            'Recognizing words and timestamps',
            processed_seconds=0,
            total_seconds=duration,
            words_processed=0,
            segments_processed=0,
            progress=0 if duration else None,
        )

        words: list[dict] = []
        segment_count = 0
        processed_seconds = 0.0

        for segment in segments:
            segment_count += 1

            end = float(
                getattr(segment, 'end', 0) or 0
            )

            if math.isfinite(end):
                processed_seconds = max(
                    processed_seconds,
                    end,
                )

            for word in getattr(
                segment, 'words', None
            ) or []:
                text = str(
                    getattr(word, 'word', '')
                ).strip()

                if not text:
                    continue

                item = {
                    'id': len(words) + 1,
                    'text': text,
                    'start': round(
                        float(word.start) + offset, 3
                    ),
                    'end': round(
                        float(word.end) + offset, 3
                    ),
                }

                probability = getattr(
                    word, 'probability', None
                )

                if (
                    cfg.get('include_confidence', True)
                    and probability is not None
                ):
                    item['confidence'] = round(
                        float(probability), 4
                    )

                words.append(item)

            report(
                'transcribing',
                'Recognizing words and timestamps',
                processed_seconds=(
                    round(
                        min(
                            processed_seconds, duration
                        ),
                        2,
                    )
                    if duration
                    else round(
                        processed_seconds, 2
                    )
                ),
                total_seconds=(
                    round(duration, 2)
                    if duration
                    else 0
                ),
                words_processed=len(words),
                segments_processed=segment_count,
                progress=(
                    min(
                        99,
                        int(
                            processed_seconds
                            / duration * 100
                        ),
                    )
                    if duration
                    else None
                ),
            )

        report(
            'finalizing',
            'Grouping words and saving transcript',
            progress=99,
            processed_seconds=round(
                duration or processed_seconds, 2
            ),
            total_seconds=round(duration, 2),
            words_processed=len(words),
            segments_processed=segment_count,
        )

        result = {
            'text': ' '.join(
                word['text'] for word in words
            ),
            'words': words,
            'segments': group_words(words),
            'word_count': len(words),
            'segment_count': segment_count,
            'duration': (
                round(duration, 3)
                if duration
                else None
            ),
            'source_start_seconds': offset,
            'language': str(info.language),
            'audio_track': track,
            'model': model,
            'method': 'faster_whisper',
        }

        temp = cache.with_suffix('.tmp')

        temp.write_text(
            json.dumps(
                result,
                ensure_ascii=False,
            ),
            encoding='utf8',
        )

        temp.replace(cache)

        return result
