"""Native word-level speech transcription for CLIPTORA (`audio.transcribe`).

Consumes an `audio.extract` artifact from a *connected* upstream node.
The engine persists the returned dict as the node's JSON artifact; all downstream
nodes keep receiving `words` and `segments` with the original contract.
"""
from __future__ import annotations

import math
import re
from functools import lru_cache
from pathlib import Path
from typing import Any

from app.helpers.transcript import as_words, group_words
from app.workflows.base import BaseNode

MODELS = frozenset({'tiny', 'base', 'small', 'medium', 'large-v3', 'turbo'})
DEVICES = frozenset({'cpu', 'auto', 'cuda'})
COMPUTE_TYPES = frozenset({'int8', 'float16', 'float32', 'auto'})


def _model(model_name: str, device: str, compute_type: str) -> Any:
    """Lazy-load only on first execution; hold warm model between executions."""
    try:
        from faster_whisper import WhisperModel
    except ImportError as exc:
        raise RuntimeError('Transcription requires faster-whisper. Install backend requirements.') from exc
    return WhisperModel(model_name, device=device, compute_type=compute_type)


_model = lru_cache(maxsize=2)(_model)


def _float(value: Any, label: str, minimum: float = 0, maximum: float = 86400) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError) as exc:
        raise ValueError(f'Invalid {label}') from exc
    if not math.isfinite(number) or not minimum <= number <= maximum:
        raise ValueError(f'{label} must be between {minimum} and {maximum}')
    return number


def _integer(value: Any, label: str, minimum: int, maximum: int) -> int:
    if isinstance(value, bool):
        raise ValueError(f'{label} must be an integer')
    try:
        number = int(str(value))
    except (ValueError, TypeError) as exc:
        raise ValueError(f'{label} must be an integer') from exc
    if str(number) != str(value).strip() or not minimum <= number <= maximum:
        raise ValueError(f'{label} must be between {minimum} and {maximum}')
    return number


def _audio_source(outputs: dict[str, Any], track: str, workdir: Path) -> tuple[Path, dict[str, Any]]:
    if track != 'auto' and not (track.isdecimal() and int(track) <= 31):
        raise ValueError('Audio track must be Auto or a number from 0 to 31')

    # Only read connected dependencies supplied by the workflow engine, never an
    # arbitrary browser path. Restrict result to the current project/run workspace.
    for raw in reversed(list(outputs.values())):
        if not isinstance(raw, dict):
            continue
        entries = raw.get('audio_files')
        chosen: dict[str, Any] | None = None
        if isinstance(entries, list) and entries:
            valid = [entry for entry in entries if isinstance(entry, dict)]
            if track == 'auto':
                chosen = valid[0] if valid else None
            else:
                chosen = next((entry for entry in valid if str(entry.get('track')) == track), None)
                if chosen is None:
                    raise ValueError(f'Audio track {track} was not extracted. Select a track available in Extract Audio.')
        elif isinstance(raw.get('audio_file'), dict):
            chosen = raw['audio_file']
            if track != 'auto' and str(chosen.get('track', 0)) != track:
                raise ValueError('Requested audio track was not extracted')

        path_value = chosen.get('path') if chosen else raw.get('audio')
        if not isinstance(path_value, str) or not path_value.strip():
            continue
        path = Path(path_value).resolve()
        root = workdir.resolve()
        if not path.is_relative_to(root):
            raise ValueError('Audio input must belong to the current workflow run')
        if not path.is_file() or path.stat().st_size == 0:
            raise ValueError('Extracted audio file is unavailable. Execute Extract Audio first.')
        offset = 0.0
        if chosen:
            offset = _float(chosen.get('source_start_seconds', 0), 'Audio source offset', maximum=10**9)
        elif isinstance(raw.get('source'), dict):
            offset = _float(raw['source'].get('source_start_seconds', 0), 'Audio source offset', maximum=10**9)
        return path, {'track': chosen.get('track', 0) if chosen else 0, 'source_start_seconds': offset}
    raise ValueError('No extracted audio received. Connect Extract Audio â†’ Transcribe Every Word and execute the previous node.')


class TranscribeEveryWordNode(BaseNode):
    type = 'audio.transcribe'

    @staticmethod
    def metadata() -> dict[str, Any]:
        return {
            'label': 'Transcribe Every Word',
            'group': 'Analysis',
            'description': 'Transcribe audio locally with word-by-word timestamps using faster-whisper.',
            'icon': 'captions',
            'input_types': ['audio', 'json'],
            'output_types': ['text', 'json'],
            'settings': {
                'model': 'small',
                'language': 'auto',
                'audio_track': 'auto',
                'beam_size': 5,
                'vad_filter': True,
                'vad_min_silence_ms': 500,
                'device': 'cpu',
                'compute_type': 'int8',
                'initial_prompt': '',
                'include_confidence': True,
            },
        }

    @staticmethod
    def execute(node: dict[str, Any], outputs: dict[str, Any], source: Path | None, workdir: Path) -> dict[str, Any]:
        cfg = node.get('settings') or {}
        name = str(cfg.get('model') or 'small')
        if name not in MODELS:
            raise ValueError('Unsupported Whisper model')
        device = str(cfg.get('device') or 'cpu')
        compute = str(cfg.get('compute_type') or 'int8')
        if device not in DEVICES or compute not in COMPUTE_TYPES:
            raise ValueError('Unsupported speech recognition device/compute type')
        if device == 'cpu' and compute == 'float16':
            raise ValueError('Float16 is intended for a CUDA GPU. Use int8 on CPU.')
        lang = str(cfg.get('language') or 'auto').strip().lower()
        if lang not in ('auto', 'none') and not re.fullmatch(r'[a-z]{2,3}', lang):
            raise ValueError('Language must be Auto or an ISO language code such as en, fr or ar')
        language = None if lang in ('auto', 'none') else lang
        beam = _integer(cfg.get('beam_size', 5), 'Beam size', 1, 10)
        silence = _integer(cfg.get('vad_min_silence_ms', 500), 'Minimum silence', 100, 5000)
        prompt = str(cfg.get('initial_prompt') or '').strip()
        if len(prompt) > 1000:
            raise ValueError('Vocabulary hint must not exceed 1000 characters')
        audio, info_source = _audio_source(outputs, str(cfg.get('audio_track') or 'auto'), workdir)
        offset = float(info_source['source_start_seconds'])

        _cliptora_transcribe_progress_callback = node.get('_progress_callback')
        if callable(_cliptora_transcribe_progress_callback):
            _cliptora_transcribe_progress_callback({
                'stage': 'loading_model', 'percent': 0,
                'processed_seconds': 0, 'total_seconds': 0,
                'words_processed': 0,
            })

        model = _model(name, device, compute)
        iterator, info = model.transcribe(
            str(audio),
            beam_size=beam,
            word_timestamps=True,
            vad_filter=cfg.get('vad_filter', True) is True,
            vad_parameters={'min_silence_duration_ms': silence},
            language=language,
            initial_prompt=prompt or None,
        )

        try:
            total_audio_seconds = max(0.0, float(getattr(info, 'duration', 0) or 0))
            if not math.isfinite(total_audio_seconds):
                total_audio_seconds = 0.0
        except (TypeError, ValueError):
            total_audio_seconds = 0.0
        processed_seconds = 0.0
        if callable(_cliptora_transcribe_progress_callback):
            _cliptora_transcribe_progress_callback({
                'stage': 'transcribing', 'percent': 0,
                'processed_seconds': 0, 'total_seconds': total_audio_seconds,
                'words_processed': 0,
            })

        raw_words: list[dict[str, Any]] = []
        transcript_segments: list[str] = []
        for segment in iterator:
            text = str(getattr(segment, 'text', '') or '').strip()
            if text:
                transcript_segments.append(text)
            for word in getattr(segment, 'words', None) or []:
                start = getattr(word, 'start', None)
                end = getattr(word, 'end', None)
                if start is None or end is None:
                    continue
                if not (math.isfinite(float(start)) and math.isfinite(float(end))):
                    continue
                if float(end) <= float(start):
                    continue
                raw_word = str(getattr(word, 'word', '') or '').strip()
                if not raw_word:
                    continue
                raw_words.append({
                    'start': float(start) + offset,
                    'end': float(end) + offset,
                    'text': raw_word,
                    'probability': getattr(word, 'probability', None),
                })
                if len(raw_words) > 150_000:
                    raise ValueError('Transcript exceeds the maximum of 150,000 words')
            if callable(_cliptora_transcribe_progress_callback):
                try:
                    segment_end = float(getattr(segment, 'end', 0) or 0)
                    if math.isfinite(segment_end):
                        processed_seconds = max(processed_seconds, segment_end)
                except (TypeError, ValueError):
                    pass
                percent = int(100 * processed_seconds / total_audio_seconds) if total_audio_seconds > 0 else 0
                _cliptora_transcribe_progress_callback({
                    'stage': 'transcribing',
                    'percent': min(99, max(0, percent)),
                    'processed_seconds': processed_seconds,
                    'total_seconds': total_audio_seconds,
                    'words_processed': len(raw_words),
                })

        # Preserves CLIPTORA's stable word IDs and segment structure used by
        # ai.highlights, caption.generate and timeline.cut_plan.
        words = as_words(raw_words)
        if cfg.get('include_confidence', True) is True:
            probabilities = { (round(float(w['start']), 3), round(float(w['end']), 3), w['text']): w.get('probability') for w in raw_words }
            for word in words:
                p = probabilities.get((word['start'], word['end'], word['text']))
                if p is not None:
                    try:
                        confidence = float(p)
                        if math.isfinite(confidence):
                            word['confidence'] = round(max(0.0, min(1.0, confidence)), 3)
                    except (TypeError, ValueError):
                        pass
        segments = group_words(words)
        text = ' '.join(transcript_segments).strip() or ' '.join(w['text'] for w in words)
        duration = getattr(info, 'duration', None)
        try:
            duration = round(float(duration), 3) if duration is not None else None
        except (TypeError, ValueError):
            duration = None
        probability = getattr(info, 'language_probability', None)
        try:
            probability = round(float(probability), 3) if probability is not None else None
        except (TypeError, ValueError):
            probability = None

        if callable(_cliptora_transcribe_progress_callback):
            _cliptora_transcribe_progress_callback({
                'stage': 'finalizing', 'percent': 99,
                'processed_seconds': total_audio_seconds or processed_seconds,
                'total_seconds': total_audio_seconds,
                'words_processed': len(words),
            })

        return {
            'status': 'completed',
            'text': text,
            'language': str(getattr(info, 'language', '') or language or 'unknown'),
            'language_probability': probability,
            'duration': duration,
            'source_start_seconds': offset,
            'word_count': len(words),
            'segment_count': len(segments),
            'words': words,
            'segments': segments,
            'audio_track': info_source['track'],
            'model': name,
        }


metadata = TranscribeEveryWordNode.metadata
execute = TranscribeEveryWordNode.execute
NODE = TranscribeEveryWordNode.definition()
