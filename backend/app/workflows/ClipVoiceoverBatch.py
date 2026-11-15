"""Deterministic per-clip TTS generation through one Playwright session."""
from __future__ import annotations

import copy
import hashlib
import ipaddress
import math
import re
import socket
import subprocess
import time
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

from app.workflows.BrowserLiveState import BrowserLiveState
from app.workflows.MediaStorage import run_media_dir
from app.workflows.nodes.Browser import _captcha_element, _public_url, _selector


def _duration(path: Path) -> float:
    probe = subprocess.run(
        ['ffprobe', '-v', 'error', '-show_entries', 'format=duration',
         '-of', 'default=noprint_wrappers=1:nokey=1', str(path)],
        capture_output=True, text=True, timeout=30, check=True,
    )
    value = float(probe.stdout.strip())
    if not math.isfinite(value) or value <= 0:
        raise ValueError('Generated voice-over has invalid duration')
    return value


def _atempo(value: float) -> str:
    parts = []
    while value > 2:
        parts.append('atempo=2.0')
        value /= 2
    while value < 0.5:
        parts.append('atempo=0.5')
        value /= 0.5
    parts.append(f'atempo={value:.8f}')
    return ','.join(parts)


def _normalize_audio(downloaded: Path, destination: Path, clip_seconds: float) -> float:
    initial = destination.with_suffix('.initial.mp3')
    subprocess.run(
        ['ffmpeg', '-nostdin', '-hide_banner', '-loglevel', 'error', '-y',
         '-i', str(downloaded), '-vn', '-c:a', 'libmp3lame', '-b:a', '192k', str(initial)],
        check=True, timeout=120, capture_output=True,
    )
    seconds = _duration(initial)
    if seconds > clip_seconds + 0.12:
        ratio = seconds / clip_seconds
        subprocess.run(
            ['ffmpeg', '-nostdin', '-hide_banner', '-loglevel', 'error', '-y',
             '-i', str(initial), '-vn', '-filter:a', _atempo(ratio),
             '-c:a', 'libmp3lame', '-b:a', '192k', str(destination)],
            check=True, timeout=120, capture_output=True,
        )
        initial.unlink(missing_ok=True)
    else:
        initial.replace(destination)
    final_seconds = _duration(destination)
    if not destination.is_file() or destination.stat().st_size < 100:
        raise ValueError('Audio conversion produced no MP3')
    return final_seconds


def _voice_url(workdir: Path, path: Path) -> str:
    resolved = path.resolve()
    file_id = hashlib.sha256(str(resolved).encode('utf8')).hexdigest()[:24]
    project_id = workdir.resolve().parent.parent.name
    run_id = workdir.resolve().name
    return f'/api/v1/workflows/{project_id}/runs/{run_id}/audios/{file_id}'


def _text(group: dict, clip: dict) -> str:
    for value in (clip.get('selected_text'), clip.get('text'), clip.get('narration')):
        if isinstance(value, str) and value.strip():
            return value.strip()[:5000]
    if len(group.get('clips') or []) == 1:
        value = group.get('selected_text')
        if isinstance(value, str):
            return value.strip()[:5000]
    return ''


def _guard(route, hosts: list[str]) -> None:
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


def run_clip_voiceover_batch(*, node: dict, outputs: dict, workdir: Path,
                             actions: list[dict], attached: dict[str, dict],
                             browser_name: str, headless: bool, timeout: int,
                             hosts: list[str], url: str) -> dict:
    manifests = [value.get('clip_manifest') for value in outputs.values()
                 if isinstance(value, dict) and isinstance(value.get('clip_manifest'), dict)]
    if len(manifests) != 1:
        raise ValueError('Per-clip voice-over requires exactly one connected clip_manifest')
    manifest = copy.deepcopy(manifests[0])
    if manifest.get('version') != 1 or not isinstance(manifest.get('groups'), list):
        raise ValueError('Unsupported clip_manifest for per-clip voice-over')
    clips = [(group, clip) for group in manifest['groups'] if isinstance(group, dict)
             for clip in group.get('clips', []) if isinstance(clip, dict)]
    limit = int((node.get('settings') or {}).get('batch_voiceover_limit', 100))
    if not 1 <= len(clips) <= min(200, max(1, limit)):
        raise ValueError(f'Per-clip voice-over requires 1 to {min(200, max(1, limit))} clips')
    if 'download' not in attached or attached['download'].get('enabled', True) is False:
        raise ValueError('Connect and enable Browser Download for per-clip voice-over')
    if not any(action.get('command') == 'download' for action in actions):
        raise ValueError('Browser Commands must contain one download command')

    cfg = node.get('settings') or {}
    script_selector = str(cfg.get('batch_script_selector') or '#studio-script')
    audio_folder = run_media_dir(workdir) / 'audio' / 'voiceovers'
    audio_folder.mkdir(parents=True, exist_ok=True)
    callback = node.get('_progress_callback')
    live = BrowserLiveState(workdir, node['id'], 'playwright-clip-voiceovers', len(clips)) \
        if cfg.get('dev_mode') or 'live_preview' in attached else None
    results: list[dict[str, Any]] = []
    failed: list[dict[str, str]] = []
    skipped: list[dict[str, str]] = []

    from playwright.sync_api import sync_playwright
    with sync_playwright() as playwright:
        browser = getattr(playwright, browser_name).launch(headless=headless)
        try:
            context = browser.new_context(accept_downloads=True)
            context.route('**/*', lambda route: _guard(route, hosts))
            page = context.new_page()
            page.set_default_timeout(timeout)
            for clip_index, (group, clip) in enumerate(clips, 1):
                instance_id = str(clip.get('instance_id') or '')
                if not re.fullmatch(r'[A-Za-z0-9_-]{1,120}', instance_id):
                    raise ValueError('Clip instance IDs must be safe filenames')
                text = _text(group, clip)
                clip['selected_text'] = text
                if not text:
                    clip['voiceover_status'] = 'skipped_no_text'
                    skipped.append({'instance_id': instance_id, 'reason': 'no_text'})
                    if callable(callback):
                        callback({'stage': 'browser', 'message': f'Skipped {instance_id}: no text',
                                  'progress': round(100 * clip_index / len(clips), 2),
                                  'processed': clip_index, 'total': len(clips), 'unit': 'clips'})
                    continue
                if live:
                    live.update(status='running', step=clip_index - 1,
                                message=f'Generating {instance_id}', url=page.url)
                downloaded: Path | None = None
                try:
                    page.goto(url, wait_until='domcontentloaded', timeout=timeout)
                    if _captcha_element(page) is not None:
                        raise RuntimeError('Human verification is required')
                    for action_index, action in enumerate(actions, 1):
                        command = action['command']
                        target = action.get('target')
                        locator = _selector(page, target) if target is not None else None
                        value = text if command == 'fill' and target == script_selector else str(action.get('value', ''))
                        if command == 'wait':
                            if locator is None: raise ValueError('wait requires target')
                            locator.wait_for(state=str(action.get('state', 'visible')), timeout=timeout)
                        elif command == 'fill':
                            if locator is None: raise ValueError('fill requires target')
                            locator.fill(value, timeout=timeout)
                        elif command == 'click':
                            if locator is None: raise ValueError('click requires target')
                            locator.click(timeout=timeout)
                        elif command == 'double_click':
                            if locator is None: raise ValueError('double_click requires target')
                            locator.dblclick(timeout=timeout)
                        elif command == 'hover':
                            if locator is None: raise ValueError('hover requires target')
                            locator.hover(timeout=timeout)
                        elif command == 'press':
                            if locator is None: raise ValueError('press requires target')
                            locator.press(value, timeout=timeout)
                        elif command == 'select':
                            if locator is None: raise ValueError('select requires target')
                            locator.select_option(value, timeout=timeout)
                        elif command == 'download':
                            if locator is None: raise ValueError('download requires target')
                            with page.expect_download(timeout=timeout) as event:
                                locator.click(timeout=timeout)
                            item = event.value
                            raw = audio_folder / f'.{instance_id}.download'
                            item.save_as(str(raw))
                            if not 100 <= raw.stat().st_size <= 50 * 1024 * 1024:
                                raise ValueError('Downloaded voice-over has invalid size')
                            destination = audio_folder / f'{instance_id}.mp3'
                            try:
                                seconds = _normalize_audio(
                                    raw, destination,
                                    float(clip['source_end']) - float(clip['source_start']),
                                )
                            finally:
                                raw.unlink(missing_ok=True)
                            downloaded = destination
                        elif command == 'scroll':
                            page.mouse.wheel(0, int(action.get('pixels', 600)))
                        elif command == 'reload':
                            page.reload(wait_until='domcontentloaded', timeout=timeout)
                        elif command == 'screenshot':
                            folder = run_media_dir(workdir) / 'browser'
                            folder.mkdir(parents=True, exist_ok=True)
                            page.screenshot(path=str(folder / f'voice_{clip_index:04d}_{action_index:02d}.png'))
                        else:
                            raise ValueError(f'Unsupported batch command: {command}')
                    if downloaded is None:
                        raise ValueError('Commands completed without an MP3 download')
                    voiceover = {
                        'instance_id': instance_id,
                        'path': str(downloaded.resolve()),
                        'filename': downloaded.name,
                        'url': _voice_url(Path(workdir), downloaded),
                        'mime_type': 'audio/mpeg',
                        'duration': round(seconds, 3),
                        'timeline_duration': round(float(clip['source_end']) - float(clip['source_start']), 3),
                        'text': text,
                    }
                    clip['voiceover'] = voiceover
                    clip['voiceover_status'] = 'generated'
                    results.append(voiceover)
                    if live:
                        live.update(status='running', step=clip_index,
                                    message=f'Generated {instance_id}', url=page.url)
                except Exception as exc:
                    clip['voiceover_status'] = 'failed'
                    clip['voiceover_error'] = f'{type(exc).__name__}: {exc}'[:300]
                    failed.append({'instance_id': instance_id, 'error': clip['voiceover_error']})
                if callable(callback):
                    callback({'stage': 'browser', 'message': f'Voice-over {clip_index}/{len(clips)}',
                              'progress': round(100 * clip_index / len(clips), 2),
                              'processed': clip_index, 'total': len(clips), 'unit': 'clips'})
            status = 'completed' if not failed else 'partial'
            if live:
                live.finish(status, f'Generated {len(results)}/{len(clips)} clip voice-overs')
            return {
                'status': status,
                'clip_manifest': manifest,
                'voiceovers': results,
                'voiceover_stats': {
                    'total_clips': len(clips), 'generated': len(results),
                    'skipped_no_text': len(skipped), 'failed': len(failed),
                },
                'skipped_voiceovers': skipped,
                'failed_voiceovers': failed,
                'url': page.url,
                'title': page.title()[:500],
                'attached_ports': sorted(attached),
            }
        finally:
            browser.close()
