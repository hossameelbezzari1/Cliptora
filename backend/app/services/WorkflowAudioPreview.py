"""Project-owned audio previews for workflow runs.

Lists playable files already saved by the workflow engine or browser tools.
No client-controlled filesystem paths are ever accepted. Audio generation
itself remains the responsibility of the workflow nodes.
"""
from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path
from typing import Any

from app.workflows.MediaStorage import run_media_dir

AUDIO_TYPES = {
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
    '.m4a': 'audio/mp4',
    '.ogg': 'audio/ogg',
    '.flac': 'audio/flac',
    '.aac': 'audio/aac',
    '.opus': 'audio/ogg',
}
MAX_AUDIO_FILES = 160
MAX_BYTES = 260 * 1024 * 1024
GROUP_PATTERN = re.compile(r'group[_-]([0-9]{1,8})', re.I)


def _metadata(workspace: Path) -> dict[str, dict[str, str]]:
    """Match known artifact filenames to group and producing node, if provided."""
    result: dict[str, dict[str, str]] = {}
    bytes_read = 0
    for artifact in sorted(workspace.glob('*.json'))[:105]:
        if not artifact.is_file() or artifact.is_symlink():
            continue
        try:
            size = artifact.stat().st_size
            if size > 3 * 1024 * 1024 or bytes_read + size > 12 * 1024 * 1024:
                continue
            bytes_read += size
            payload = json.loads(artifact.read_text(encoding='utf8'))
        except (OSError, ValueError, UnicodeError):
            continue
        if not isinstance(payload, dict):
            continue
        node = artifact.stem

        def walk(data: Any, group: str | None = None, depth: int = 0) -> None:
            if depth > 5:
                return
            if isinstance(data, dict):
                assigned = data.get('group_id')
                group = str(assigned)[:80] if isinstance(assigned, (str, int)) else group
                names = [data.get(k) for k in ('file', 'filename', 'audio_path', 'file_path', 'path', 'media_path', 'local_path', 'downloaded_file', 'audio_file')]
                for name in names:
                    if not isinstance(name, str) or not name or len(name) > 1024:
                        continue
                    basename = Path(name.replace('\\', '/')).name
                    if basename.lower().endswith(tuple(AUDIO_TYPES)):
                        result[basename] = {'node_id': node, **({'group_id': group} if group else {})}
                for key in ('voiceovers', 'downloads', 'audio_files', 'generated_audio', 'files', 'result', 'agent'):
                    if key in data:
                        walk(data[key], group, depth + 1)
            elif isinstance(data, list):
                for item in data[:160]:
                    walk(item, group, depth + 1)

        walk(payload)
    return result


def scan_run_audio(workspace: Path) -> list[tuple[dict[str, Any], Path]]:
    """Enumerate audio in strictly owned per-run folders, no symlink escapes."""
    workspace = workspace.resolve()
    media = run_media_dir(workspace).resolve()
    roots = (media, workspace / 'audio', workspace / 'browser', workspace / 'voiceovers')
    metadata = _metadata(workspace)
    found: dict[str, tuple[dict[str, Any], Path]] = {}

    for root in roots:
        if not root.is_dir() or root.is_symlink():
            continue
        # rglob never follows directory symlinks by default. Resolved path
        # confinement additionally rejects links and external targets.
        for examined, path in enumerate(root.rglob('*')):
            if len(found) >= MAX_AUDIO_FILES or examined > 5000:
                break
            if path.suffix.casefold() not in AUDIO_TYPES or path.is_symlink() or not path.is_file():
                continue
            resolved = path.resolve()
            if not resolved.is_relative_to(root.resolve()):
                continue
            try:
                size = resolved.stat().st_size
            except OSError:
                continue
            if not 0 < size <= MAX_BYTES:
                continue
            key = str(resolved)
            if key in found:
                continue
            relative = resolved.relative_to(root.resolve()).as_posix()
            file_id = hashlib.sha256(key.encode('utf8')).hexdigest()[:24]
            saved = metadata.get(resolved.name, {})
            group_id = saved.get('group_id')
            match = GROUP_PATTERN.search(resolved.name)
            if not group_id and match:
                group_id = f'group_{match.group(1)}'
            node_id = saved.get('node_id')
            path_parts = {part.lower() for part in resolved.relative_to(root.resolve()).parts[:-1]}
            origin = root.name.lower()
            is_voiceover = bool(group_id) or origin in {'browser', 'voiceovers'} or bool(path_parts & {'browser', 'voiceovers', 'generated', 'agent', 'downloads'})
            if node_id and (node_id.startswith('ai_agent') or node_id.startswith('browser_')):
                is_voiceover = True
            category = 'voiceover' if is_voiceover else 'extracted'
            label = f'{group_id.replace("_", " ").title()} · {resolved.name}' if group_id else resolved.name
            info: dict[str, Any] = {
                'id': file_id,
                'name': label,
                'filename': resolved.name,
                'category': category,
                'format': resolved.suffix[1:].upper(),
                'size_bytes': size,
                'group_id': group_id,
                'node_id': node_id,
            }
            found[key] = (info, resolved)

    return sorted(found.values(), key=lambda row: (row[0]['category'] != 'voiceover', row[0]['group_id'] or '', row[0]['filename']))


def get_audio_by_id(workspace: Path, file_id: str) -> tuple[dict[str, Any], Path] | None:
    if not re.fullmatch(r'[a-f0-9]{24}', file_id):
        return None
    for info, path in scan_run_audio(workspace):
        if info['id'] == file_id:
            return info, path
    return None
