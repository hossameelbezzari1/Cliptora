"""Deterministic, resumable per-clip TTS using one Playwright browser context.

The only supported Take contract in this batch is WevoLabs' ``data-take`` DOM.
A download is never accepted unless a new Take ID appeared after Generate.
"""
from __future__ import annotations

import copy
import hashlib
import ipaddress
import json
import math
import os
import re
import shutil
import socket
import subprocess
import time
import uuid
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

from app.workflows.BrowserLiveState import BrowserLiveState
from app.workflows.MediaStorage import run_media_dir
from app.workflows.nodes.Browser import _captcha_element, _public_url, _selector

_MAX_DOWNLOAD = 50 * 1024 * 1024
_CACHE_VERSION = 2
_TAKE_SELECTOR = '[data-output] [data-take]'
_MP3_SELECTOR = '[data-act="mp3"]'
_GENERATE_SELECTOR = '[data-generate]'
_PROGRESS_SELECTOR = '[data-progress]'


def _number(value: Any, name: str, low: float, high: float) -> float:
    try:
        number = float(value)
    except (ValueError, TypeError, OverflowError) as exc:
        raise ValueError(f'{name} must be numeric') from exc
    if not math.isfinite(number) or not low <= number <= high:
        raise ValueError(f'{name} must be between {low} and {high}')
    return number


def _probe_audio(path: Path, *, require_mp3: bool = True) -> float:
    if path.is_symlink() or not path.is_file() or not 100 <= path.stat().st_size <= _MAX_DOWNLOAD:
        raise ValueError('Audio file is missing, empty or too large')
    try:
        result = subprocess.run(
            ['ffprobe', '-v', 'error', '-select_streams', 'a:0',
             '-show_entries', 'stream=codec_name:format=duration',
             '-of', 'json', str(path)],
            capture_output=True, text=True, timeout=30, check=True,
        )
        payload = json.loads(result.stdout)
        streams = payload.get('streams') or []
        if not streams:
            raise ValueError('Downloaded file has no audio stream')
        if require_mp3 and streams[0].get('codec_name') != 'mp3':
            raise ValueError('Generated file is not MP3 audio')
        seconds = float((payload.get('format') or {}).get('duration', 0))
    except (subprocess.SubprocessError, OSError, ValueError, TypeError, KeyError) as exc:
        raise ValueError('Invalid or undecodable audio file') from exc
    if not math.isfinite(seconds) or seconds <= 0:
        raise ValueError('Audio duration is invalid')
    return seconds


def _atempo(value: float) -> str:
    parts: list[str] = []
    while value > 2:
        parts.append('atempo=2.0')
        value /= 2
    while value < 0.5:
        parts.append('atempo=0.5')
        value /= 0.5
    parts.append(f'atempo={value:.8f}')
    return ','.join(parts)


def _normalize_audio(raw: Path, destination: Path, clip_seconds: float, max_speedup: float) -> float:
    """Decode, fit (within a bounded ratio), verify, then atomically publish."""
    _probe_audio(raw, require_mp3=False)
    token = uuid.uuid4().hex
    initial = destination.parent / f'.{destination.stem}.{token}.initial.mp3'
    ready = destination.parent / f'.{destination.stem}.{token}.ready.mp3'
    try:
        subprocess.run(
            ['ffmpeg', '-nostdin', '-hide_banner', '-loglevel', 'error', '-y',
             '-i', str(raw), '-vn', '-c:a', 'libmp3lame', '-b:a', '192k', str(initial)],
            check=True, timeout=120, capture_output=True,
        )
        seconds = _probe_audio(initial)
        if seconds > clip_seconds + 0.12:
            speedup = seconds / clip_seconds
            if speedup > max_speedup:
                raise ValueError(
                    f'Narration lasts {seconds:.2f}s but clip lasts {clip_seconds:.2f}s; '
                    f'required speed {speedup:.2f}x exceeds limit {max_speedup:.2f}x'
                )
            subprocess.run(
                ['ffmpeg', '-nostdin', '-hide_banner', '-loglevel', 'error', '-y',
                 '-i', str(initial), '-vn', '-filter:a', _atempo(speedup),
                 '-c:a', 'libmp3lame', '-b:a', '192k', str(ready)],
                check=True, timeout=120, capture_output=True,
            )
        else:
            initial.replace(ready)
        duration = _probe_audio(ready)
        if duration > clip_seconds + 0.12:
            raise ValueError('Normalized MP3 is still longer than its clip')
        os.replace(ready, destination)
        return duration
    finally:
        initial.unlink(missing_ok=True)
        ready.unlink(missing_ok=True)


def _voice_url(workdir: Path, path: Path) -> str:
    resolved = path.resolve()
    file_id = hashlib.sha256(str(resolved).encode('utf8')).hexdigest()[:24]
    workspace = workdir.resolve()
    return f'/api/v1/workflows/{workspace.parent.parent.name}/runs/{workspace.name}/audios/{file_id}'


def _text(group: dict, clip: dict) -> str:
    for value in (clip.get('selected_text'), clip.get('text'), clip.get('narration')):
        if isinstance(value, str) and value.strip():
            return value.strip()[:5000]
    if len(group.get('clips') or []) == 1:
        value = group.get('selected_text')
        if isinstance(value, str):
            return value.strip()[:5000]
    return ''


def _guard(route: Any, hosts: list[str]) -> None:
    request = route.request
    try:
        parsed = urlsplit(request.url)
        if parsed.scheme not in {'https', 'data', 'blob'}:
            route.abort()
            return
        if parsed.scheme == 'https':
            resolved = socket.getaddrinfo(parsed.hostname or '', 443, type=socket.SOCK_STREAM)
            if not resolved or any(not ipaddress.ip_address(row[4][0]).is_global for row in resolved):
                route.abort()
                return
            if request.is_navigation_request():
                _public_url(request.url, hosts)
        route.continue_()
    except (ValueError, OSError):
        route.abort()


def _digest(path: Path) -> str:
    hasher = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            hasher.update(chunk)
    return hasher.hexdigest()


def _fingerprint(*, instance_id: str, text: str, clip_seconds: float,
                 actions: list[dict], cfg: dict, url: str, browser_name: str) -> str:
    normalized_actions = []
    script = str(cfg.get('batch_script_selector') or '#studio-script')
    for action in actions:
        entry = dict(action)
        if entry.get('command') == 'fill' and entry.get('target') == script:
            entry['value'] = '<current clip text>'
        normalized_actions.append(entry)
    payload = {
        'version': _CACHE_VERSION, 'instance_id': instance_id, 'text': text,
        'clip_seconds': round(clip_seconds, 5), 'actions': normalized_actions,
        'script_selector': script, 'url': url, 'browser': browser_name,
        'max_speedup': cfg.get('batch_max_speedup', 2.0),
        'cache_salt': str(cfg.get('batch_cache_salt') or ''),
    }
    return hashlib.sha256(json.dumps(payload, sort_keys=True, ensure_ascii=False,
                                     default=str).encode('utf-8')).hexdigest()


def _save_json(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f'.{path.name}.{uuid.uuid4().hex}.tmp')
    try:
        temporary.write_text(json.dumps(payload, ensure_ascii=False, sort_keys=True), encoding='utf-8')
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def _checked_cache_file(audio: Path, metadata: Path, fingerprint: str,
                        clip_seconds: float) -> float | None:
    try:
        if audio.is_symlink() or metadata.is_symlink():
            return None
        record = json.loads(metadata.read_text(encoding='utf-8'))
        if record.get('fingerprint') != fingerprint or not re.fullmatch(r'[a-f0-9]{64}', str(record.get('sha256', ''))):
            return None
        if audio.stat().st_size != record.get('bytes') or _digest(audio) != record['sha256']:
            return None
        duration = _probe_audio(audio)
        return duration if duration <= clip_seconds + 0.12 else None
    except (OSError, ValueError, TypeError, KeyError, json.JSONDecodeError):
        return None


def _resume_file(folder: Path, cache_dir: Path, instance_id: str,
                 fingerprint: str, clip_seconds: float, *, allow_cache: bool) -> tuple[Path, float] | None:
    destination = folder / f'{instance_id}.mp3'
    if not allow_cache:
        return None
    duration = _checked_cache_file(destination, folder / f'{instance_id}.json',
                                   fingerprint, clip_seconds)
    if duration is not None:
        return destination, duration
    cache_audio = cache_dir / f'{fingerprint}.mp3'
    cache_json = cache_dir / f'{fingerprint}.json'
    duration = _checked_cache_file(cache_audio, cache_json, fingerprint, clip_seconds)
    if duration is None:
        return None
    temp = folder / f'.{instance_id}.{uuid.uuid4().hex}.resume.mp3'
    try:
        shutil.copy2(cache_audio, temp)
        if _probe_audio(temp) > clip_seconds + 0.12:
            return None
        os.replace(temp, destination)
        _save_json(folder / f'{instance_id}.json', json.loads(cache_json.read_text(encoding='utf-8')))
        return destination, duration
    finally:
        temp.unlink(missing_ok=True)


def _record_file(folder: Path, cache_dir: Path, instance_id: str,
                 fingerprint: str, duration: float, *, allow_cache: bool) -> None:
    destination = folder / f'{instance_id}.mp3'
    record = {
        'version': _CACHE_VERSION, 'fingerprint': fingerprint,
        'sha256': _digest(destination), 'bytes': destination.stat().st_size,
        'duration': round(duration, 6),
    }
    _save_json(folder / f'{instance_id}.json', record)
    if allow_cache:
        cache_dir.mkdir(parents=True, exist_ok=True)
        target = cache_dir / f'{fingerprint}.mp3'
        temporary = cache_dir / f'.{fingerprint}.{uuid.uuid4().hex}.mp3'
        try:
            shutil.copy2(destination, temporary)
            os.replace(temporary, target)
            _save_json(cache_dir / f'{fingerprint}.json', record)
        finally:
            temporary.unlink(missing_ok=True)


def _known_takes(page: Any) -> set[str]:
    # The current output and the old-takes list both use data-take IDs.
    values = page.locator('[data-take]').evaluate_all(
        '(elements) => elements.map(el => el.getAttribute("data-take")).filter(Boolean)'
    )
    return {str(item) for item in values if isinstance(item, str) and item}


def _new_take(page: Any, known: set[str], generation_timeout: int) -> str:
    handle = page.wait_for_function(
        """(known) => {
            const error = document.querySelector('[data-error]');
            if (error && !error.hidden && error.getClientRects().length)
                return {error: (error.textContent || 'Generation failed').trim().slice(0, 250)};
            const output = document.querySelector('[data-output]');
            if (!output || output.hidden) return false;
            const take = output.querySelector('[data-take]');
            if (!take) return false;
            const id = take.getAttribute('data-take');
            const button = take.querySelector('[data-act="mp3"]');
            if (!id || known.includes(id) || !button || button.disabled) return false;
            return {id};
        }""",
        arg=sorted(known), timeout=generation_timeout,
    )
    result = handle.json_value()
    if not isinstance(result, dict):
        raise RuntimeError('No newly generated Take appeared')
    if result.get('error'):
        raise RuntimeError(f'Voice generation failed: {result["error"]}')
    ident = result.get('id')
    if not isinstance(ident, str) or not ident or ident in known:
        raise RuntimeError('Generated Take was not fresh')
    return ident


def _validate_actions(actions: list[dict], script_selector: str) -> None:
    generate_indexes = [i for i, a in enumerate(actions)
                        if a.get('command') == 'click' and a.get('target') == _GENERATE_SELECTOR]
    download_indexes = [i for i, a in enumerate(actions) if a.get('command') == 'download']
    fill_indexes = [i for i, a in enumerate(actions)
                    if a.get('command') == 'fill' and a.get('target') == script_selector]
    if not (len(generate_indexes) == len(download_indexes) == len(fill_indexes) == 1
            and fill_indexes[0] < generate_indexes[0] < download_indexes[0]):
        raise ValueError('Batch requires one script fill, one [data-generate] click, '
                         'and one download, in that order')
    download_target = str(actions[download_indexes[0]].get('target') or '')
    if 'mp3' not in download_target.lower():
        raise ValueError('Download action must target an MP3 control')


def _perform_actions(page: Any, actions: list[dict], *, text: str,
                     script_selector: str, instance_id: str, folder: Path,
                     clip_seconds: float, max_speedup: float,
                     timeout: int, generation_timeout: int,
                     live: BrowserLiveState | None, clip_index: int,
                     workdir: Path) -> tuple[Path, float, str]:
    known: set[str] = set()
    fresh_id = ''
    for action_index, action in enumerate(actions, 1):
        command = str(action['command'])
        target = action.get('target')
        action_timeout = int(_number(action.get('timeout_ms') or timeout,
                                     'Action timeout', 1000, 120000))
        begun = time.monotonic()
        if live:
            live.command_started(action_index, f'{instance_id}: {command}', target)
        try:
            locator = _selector(page, target) if target is not None else None
            value = text if command == 'fill' and target == script_selector else str(action.get('value') or '')
            if command == 'wait':
                if locator is None:
                    raise ValueError('Wait command requires a target')
                state = str(action.get('state') or 'visible')
                # Generation can complete before a separate visible-progress wait runs.
                if target == _PROGRESS_SELECTOR and state == 'visible' and fresh_id:
                    pass
                else:
                    locator.wait_for(state=state, timeout=action_timeout)
            elif command == 'fill':
                if locator is None:
                    raise ValueError('Fill command requires a target')
                locator.fill(value, timeout=action_timeout)
                if target == script_selector and locator.input_value(timeout=action_timeout) != text:
                    raise RuntimeError('TTS input did not retain this clip text')
            elif command == 'click':
                if locator is None:
                    raise ValueError('Click command requires a target')
                if target == _GENERATE_SELECTOR:
                    known = _known_takes(page)
                    locator.click(timeout=action_timeout)
                    fresh_id = _new_take(page, known, generation_timeout)
                else:
                    locator.click(timeout=action_timeout)
            elif command == 'download':
                if not fresh_id:
                    raise RuntimeError('Download blocked: no verified new Take')
                take = page.locator(_TAKE_SELECTOR).filter(
                    has=page.locator(_MP3_SELECTOR)
                )
                # Never let a generic download selector click an earlier Take.
                matches = [entry for entry in take.all()
                           if entry.get_attribute('data-take') == fresh_id]
                if len(matches) != 1:
                    raise RuntimeError('New Take disappeared before download')
                button = matches[0].locator(_MP3_SELECTOR).first
                button.wait_for(state='visible', timeout=action_timeout)
                with page.expect_download(timeout=action_timeout) as event:
                    button.click(timeout=action_timeout)
                item = event.value
                failure = item.failure()
                if failure:
                    raise RuntimeError(f'Playwright download failed: {failure}')
                raw = folder / f'.{instance_id}.{uuid.uuid4().hex}.download'
                try:
                    item.save_as(str(raw))
                    destination = folder / f'{instance_id}.mp3'
                    duration = _normalize_audio(raw, destination, clip_seconds, max_speedup)
                finally:
                    raw.unlink(missing_ok=True)
                if live:
                    live.element_found(action_index)
                    live.command_finished(action_index, time.monotonic() - begun)
                return destination, duration, fresh_id
            elif command == 'double_click':
                if locator is None: raise ValueError('double_click requires target')
                locator.dblclick(timeout=action_timeout)
            elif command == 'hover':
                if locator is None: raise ValueError('hover requires target')
                locator.hover(timeout=action_timeout)
            elif command == 'press':
                if locator is None: raise ValueError('press requires target')
                locator.press(value, timeout=action_timeout)
            elif command == 'type':
                if locator is None: raise ValueError('type requires target')
                locator.press_sequentially(value, delay=int(action.get('delay_ms') or 0),
                                           timeout=action_timeout)
            elif command == 'select':
                if locator is None: raise ValueError('select requires target')
                locator.select_option(value, timeout=action_timeout)
            elif command == 'check':
                if locator is None: raise ValueError('check requires target')
                locator.check(timeout=action_timeout)
            elif command == 'uncheck':
                if locator is None: raise ValueError('uncheck requires target')
                locator.uncheck(timeout=action_timeout)
            elif command == 'scroll':
                page.mouse.wheel(0, int(action.get('pixels') or 600))
            elif command == 'screenshot':
                shots = run_media_dir(workdir) / 'browser'
                shots.mkdir(parents=True, exist_ok=True)
                name = f'voice_{clip_index:04d}_{action_index:02d}.png'
                page.screenshot(path=str(shots / name))
                if live:
                    live.frame(name, step=clip_index, label=f'{instance_id}: {command}', url=page.url)
            elif command == 'reload':
                page.reload(wait_until='domcontentloaded', timeout=action_timeout)
            else:
                raise ValueError(f'Unsupported batch command: {command}')
            if live:
                if locator is not None: live.element_found(action_index)
                live.command_finished(action_index, time.monotonic() - begun)
        except Exception as exc:
            if live:
                live.command_failed(action_index, exc, time.monotonic() - begun)
            raise
    raise RuntimeError('Browser Commands ended without downloading a new MP3')


def run_clip_voiceover_batch(*, node: dict, outputs: dict, workdir: Path,
                             actions: list[dict], attached: dict[str, dict],
                             browser_name: str, headless: bool, timeout: int,
                             hosts: list[str], url: str) -> dict:
    manifests = [item['clip_manifest'] for item in outputs.values()
                 if isinstance(item, dict) and isinstance(item.get('clip_manifest'), dict)]
    if len(manifests) != 1:
        raise ValueError('Per-clip voice-over requires exactly one connected clip_manifest')
    manifest = copy.deepcopy(manifests[0])
    if manifest.get('version') != 1 or not isinstance(manifest.get('groups'), list):
        raise ValueError('Expected clip_manifest version 1')
    clips = [(group, clip) for group in manifest['groups'] if isinstance(group, dict)
             for clip in group.get('clips', []) if isinstance(clip, dict)]
    cfg = node.get('settings') or {}
    limit = int(_number(cfg.get('batch_voiceover_limit', 100), 'Batch clips', 1, 200))
    if not 1 <= len(clips) <= limit:
        raise ValueError(f'Per-clip voice-over requires 1 to {limit} clips')
    if 'download' not in attached or attached['download'].get('enabled', True) is False:
        raise ValueError('Connect and enable Browser Download')
    script_selector = str(cfg.get('batch_script_selector') or '#studio-script')
    _validate_actions(actions, script_selector)
    all_ids = [str(clip.get('instance_id') or '') for _, clip in clips]
    if any(not re.fullmatch(r'[A-Za-z0-9_-]{1,120}', ident) for ident in all_ids) or len(all_ids) != len(set(all_ids)):
        raise ValueError('All clip instance IDs must be unique and safe')

    folder = run_media_dir(workdir) / 'audio' / 'voiceovers'
    cache_dir = run_media_dir(workdir).parent.parent / 'voiceover-cache'
    folder.mkdir(parents=True, exist_ok=True)
    callback = node.get('_progress_callback')
    cancelled = node.get('_cancelled_callback')
    live = BrowserLiveState(workdir, node['id'], 'playwright-clip-voiceovers', len(clips)) \
        if cfg.get('dev_mode') or 'live_preview' in attached else None
    allow_cache = bool(cfg.get('batch_resume', True)) and not bool(cfg.get('batch_force_regenerate', False))
    max_speedup = _number(cfg.get('batch_max_speedup', 2.0), 'Max narration speedup', 1, 4)
    generation_timeout = int(_number(cfg.get('batch_generation_timeout_ms', 180000),
                                     'Generation timeout', 5000, 300000))
    error_config = attached.get('error_handler') or {}
    retries = int(_number(error_config.get('retries', cfg.get('batch_retries', 2)),
                          'Retries', 0, 5))
    retry_delay = int(_number(error_config.get('retry_delay_ms', 1000),
                              'Retry delay', 0, 10000))
    strict = not bool(cfg.get('batch_allow_partial', False))
    results: list[dict[str, Any]] = []
    failed: list[dict[str, str]] = []
    skipped: list[dict[str, str]] = []
    reused = 0
    generated = 0

    def notify(index: int, message: str, status: str = 'running') -> None:
        if live:
            live.update(status=status, step=index, message=message)
        if callable(callback):
            callback({'stage': 'browser', 'message': message,
                      'progress': round(100 * index / len(clips), 2),
                      'processed': index, 'total': len(clips), 'unit': 'clips'})

    def voice_item(ident: str, path: Path, duration: float, text: str,
                   clip_seconds: float, take_id: str | None, status: str) -> dict:
        return {
            'instance_id': ident, 'path': str(path.resolve()), 'filename': path.name,
            'url': _voice_url(Path(workdir), path), 'mime_type': 'audio/mpeg',
            'duration': round(duration, 3), 'timeline_duration': round(clip_seconds, 3),
            'text': text, 'take_id': take_id, 'status': status,
        }

    # Do not launch Chromium when every required MP3 is already validated.
    pending: list[tuple[int, dict, dict, str, str, float, str]] = []
    for index, (group, clip) in enumerate(clips, 1):
        ident = str(clip['instance_id'])
        text = _text(group, clip)
        clip['selected_text'] = text
        clip.pop('voiceover_error', None)
        if not text:
            clip.pop('voiceover', None)
            clip['voiceover_status'] = 'skipped_no_text'
            skipped.append({'instance_id': ident, 'reason': 'no_text'})
            continue
        seconds = _number(clip['source_end'], 'Clip end', 0, 86400) - _number(
            clip['source_start'], 'Clip start', 0, 86400)
        if seconds <= 0:
            raise ValueError(f'Invalid clip duration for {ident}')
        fp = _fingerprint(instance_id=ident, text=text, clip_seconds=seconds,
                          actions=actions, cfg=cfg, url=url, browser_name=browser_name)
        cached = _resume_file(folder, cache_dir, ident, fp, seconds, allow_cache=allow_cache)
        if cached:
            audio, duration = cached
            item = voice_item(ident, audio, duration, text, seconds, None, 'reused')
            clip['voiceover'] = item
            clip['voiceover_status'] = 'reused'
            results.append(item)
            reused += 1
        else:
            clip.pop('voiceover', None)
            pending.append((index, group, clip, ident, text, seconds, fp))

    browser = None
    page = None
    last_url = url
    last_title = ''
    if pending:
        from playwright.sync_api import sync_playwright
        with sync_playwright() as playwright:
            browser = getattr(playwright, browser_name).launch(headless=headless)
            try:
                context = browser.new_context(accept_downloads=True)
                context.route('**/*', lambda route: _guard(route, hosts))
                page = context.new_page()
                page.set_default_timeout(timeout)
                for index, _, clip, ident, text, seconds, fp in pending:
                    if callable(cancelled) and cancelled():
                        raise RuntimeError('Per-clip voice-over batch cancelled')
                    error = None
                    notify(index - 1, f'Generating {ident}')
                    for attempt in range(1, retries + 2):
                        if callable(cancelled) and cancelled():
                            raise RuntimeError('Per-clip voice-over batch cancelled')
                        try:
                            page.goto(url, wait_until='domcontentloaded', timeout=timeout)
                            if _captcha_element(page) is not None:
                                raise RuntimeError('Human verification is required')
                            destination, duration, take_id = _perform_actions(
                                page, actions, text=text, script_selector=script_selector,
                                instance_id=ident, folder=folder, clip_seconds=seconds,
                                max_speedup=max_speedup, timeout=timeout,
                                generation_timeout=generation_timeout,
                                live=live, clip_index=index, workdir=Path(workdir),
                            )
                            _record_file(folder, cache_dir, ident, fp, duration,
                                         allow_cache=allow_cache)
                            item = voice_item(ident, destination, duration, text,
                                              seconds, take_id, 'generated')
                            clip['voiceover'] = item
                            clip['voiceover_status'] = 'generated'
                            results.append(item)
                            generated += 1
                            error = None
                            notify(index, f'Generated {ident} (attempt {attempt})')
                            break
                        except Exception as exc:
                            error = exc
                            if 'Human verification' in str(exc) or 'cancelled' in str(exc):
                                break
                            # Input or timing errors do not improve on retry.
                            if 'required speed' in str(exc) or 'Batch requires' in str(exc):
                                break
                            if attempt <= retries:
                                notify(index - 1, f'Retrying {ident} ({attempt + 1}/{retries + 1})')
                                time.sleep(retry_delay / 1000)
                    if error is not None:
                        clip.pop('voiceover', None)
                        clip['voiceover_status'] = 'failed'
                        clip['voiceover_error'] = f'{type(error).__name__}: {error}'[:300]
                        failed.append({'instance_id': ident, 'error': clip['voiceover_error']})
                        notify(index, f'Failed {ident}')
                        if 'Human verification' in str(error) or 'cancelled' in str(error):
                            if live:
                                live.finish('failed', f'Stopped at {ident}: human verification or cancellation')
                            raise RuntimeError(clip['voiceover_error']) from error
            finally:
                try:
                    last_url = page.url
                    last_title = page.title()[:500]
                except Exception:
                    pass
                browser.close()

    status = 'completed' if not failed else 'partial'
    if live:
        live.finish('failed' if failed and strict else status,
                    f'Generated {generated}; reused {reused}; failed {len(failed)}; skipped {len(skipped)}')
    if failed and strict:
        sample = ', '.join(f['instance_id'] for f in failed[:8])
        raise RuntimeError(
            f'Per-clip voice-over incomplete: {len(failed)} clip(s) failed ({sample}). '
            'Validated MP3 files were checkpointed; retry the run to resume.'
        )
    return {
        'status': status, 'clip_manifest': manifest, 'voiceovers': results,
        'voiceover_stats': {
            'total_clips': len(clips), 'generated': generated, 'reused': reused,
            'skipped_no_text': len(skipped), 'failed': len(failed),
        },
        'skipped_voiceovers': skipped, 'failed_voiceovers': failed,
        'url': last_url,
        'title': last_title,
        'attached_ports': sorted(attached),
    }
