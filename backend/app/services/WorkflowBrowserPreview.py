"""Private, read-only browser screenshot inventory for one CLIPTORA workflow run.

The browser automation already captures image frames in its per-run browser
artifact directory. This adapter never launches a browser or exposes paths.
"""
from __future__ import annotations

import hashlib
import json
import re
from urllib.parse import urlsplit
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from app.workflows.MediaStorage import run_media_dir

FRAME_TYPES = {'.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp'}
MAX_FRAMES = 120
MAX_FRAME_BYTES = 15 * 1024 * 1024
MAX_EXAMINED = 5000
ID_PATTERN = re.compile(r'[a-f0-9]{24}\Z')


def scan_browser_frames(workspace: Path) -> list[tuple[dict[str, Any], Path]]:
    """Return screenshot frames (oldest to newest), confined to this run only."""
    workspace = workspace.resolve()
    media = run_media_dir(workspace)
    roots = (media / 'browser', workspace / 'browser',
             media / 'browser_live', workspace / 'browser_live', workspace / '.browser_live')
    found: dict[str, tuple[dict[str, Any], Path]] = {}

    for root in roots:
        if not root.is_dir() or root.is_symlink():
            continue
        safe_root = root.resolve()
        for index, path in enumerate(root.rglob('*')):
            if index >= MAX_EXAMINED:
                break
            if path.suffix.casefold() not in FRAME_TYPES or path.is_symlink() or not path.is_file():
                continue
            resolved = path.resolve()
            if not resolved.is_relative_to(safe_root):
                continue
            try:
                stat = resolved.stat()
            except OSError:
                continue
            if stat.st_size < 100 or stat.st_size > MAX_FRAME_BYTES:
                continue
            key = str(resolved)
            if key in found:
                continue
            # Opaque stable ID; never accepts arbitrary file paths from clients.
            file_id = hashlib.sha256(key.encode('utf-8')).hexdigest()[:24]
            stem = resolved.stem
            label = stem.replace('_', ' ').replace('-', ' ')[:100]
            modified_ms = int(stat.st_mtime_ns / 1_000_000)
            found[key] = ({
                'id': file_id,
                'filename': resolved.name,
                'label': label,
                'modified_ms': modified_ms,
                'captured_at': datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc).isoformat(),
                'size_bytes': stat.st_size,
            }, resolved)

    # When a run has hundreds of screenshots, retain the latest frames and
    # sort chronologically so the player can navigate back in time.
    rows = sorted(found.values(), key=lambda row: (row[0]['modified_ms'], row[0]['filename']))
    return rows[-MAX_FRAMES:]


def find_browser_frame(workspace: Path, file_id: str) -> tuple[dict[str, Any], Path] | None:
    if not ID_PATTERN.fullmatch(file_id):
        return None
    for info, path in scan_browser_frames(workspace):
        if info['id'] == file_id:
            return info, path
    return None


def read_browser_live_status(workspace: Path) -> dict[str, Any]:
    """Best-effort, whitelisted status from optional BrowserLiveState JSON files.

    Does not expose arbitrary run JSON, URL queries, cookies, or page content.
    The screenshot inventory remains functional even without a status file.
    """
    workspace = workspace.resolve()
    media = run_media_dir(workspace)
    folders = (workspace, media / 'browser', workspace / 'browser',
               media / 'browser_live', workspace / 'browser_live', workspace / '.browser_live')
    candidates: list[Path] = []
    for folder in folders:
        if not folder.is_dir() or folder.is_symlink():
            continue
        for path in list(folder.glob('*.json'))[:100]:
            if re.search(r'browser|live|preview', path.stem, re.I) and path.is_file() and not path.is_symlink():
                candidates.append(path)
    candidates.sort(key=lambda path: path.stat().st_mtime if path.exists() else 0, reverse=True)
    for path in candidates[:20]:
        try:
            if path.stat().st_size > 128 * 1024:
                continue
            data = json.loads(path.read_text(encoding='utf-8'))
        except (OSError, UnicodeError, ValueError):
            continue
        if not isinstance(data, dict):
            continue
        # BrowserLiveState may nest the active status below `current`.
        current = data.get('current') if isinstance(data.get('current'), dict) else data
        status = current.get('status') or current.get('state')
        message = current.get('message')
        url = current.get('url')
        if not any(isinstance(item, (str, int)) for item in (status, message, url)):
            continue
        result: dict[str, Any] = {}
        if isinstance(status, str): result['status'] = status[:32]
        if isinstance(message, str): result['message'] = message[:200]
        if isinstance(url, str):
            try:
                parsed = urlsplit(url)
                if parsed.scheme == 'https' and parsed.hostname:
                    result['url'] = f'{parsed.scheme}://{parsed.hostname}{parsed.path[:180]}'
            except ValueError:
                pass
        for key in ('step', 'total'):
            value = current.get(key)
            if type(value) is int and 0 <= value <= 100000:
                result[key] = value
        commands = current.get('commands')
        if isinstance(commands, list):
            safe_commands = []
            for item in commands[-100:]:
                if not isinstance(item, dict) or type(item.get('index')) is not int:
                    continue
                row: dict[str, Any] = {'index': item['index']}
                for key, limit in (
                    ('command', 60), ('status', 20), ('target', 300),
                    ('element_status', 20), ('error', 300),
                ):
                    value = item.get(key)
                    if isinstance(value, str):
                        row[key] = value[:limit]
                elapsed = item.get('elapsed_seconds')
                if isinstance(elapsed, (int, float)) and 0 <= elapsed <= 86400:
                    row['elapsed_seconds'] = round(float(elapsed), 3)
                safe_commands.append(row)
            result['commands'] = safe_commands
        if result:
            return result
    return {}
