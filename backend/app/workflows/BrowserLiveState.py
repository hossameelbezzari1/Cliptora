"""Persist read-only, authenticated browser preview state for one workflow run.

This is a filesystem-backed polling transport, not video streaming or remote control.
All writes are atomic and the node's Playwright/Selenium thread owns the browser.
"""
from __future__ import annotations

import json
import os
import re
import time
from pathlib import Path
from typing import Any

from app.workflows.MediaStorage import run_media_dir

_FILE = '.live-preview.json'
_SAFE_FILE = re.compile(r'^[A-Za-z0-9_-][A-Za-z0-9_.-]{0,119}\.png$')


def preview_folder(workdir: Path) -> Path:
    folder = (run_media_dir(workdir) / 'browser').resolve()
    folder.mkdir(parents=True, exist_ok=True)
    return folder


class BrowserLiveState:
    def __init__(self, workdir: Path, node_id: str, provider: str, total: int):
        self.folder = preview_folder(workdir)
        self.node_id = str(node_id)[:48]
        self.provider = provider
        self.total = total
        self.started = time.time()
        self.state: dict[str, Any] = {
            'node_id': self.node_id, 'provider': provider,
            'status': 'starting', 'step': 0, 'total': total,
            'message': 'Opening browser', 'url': '', 'frames': [],
            'started_at': self.started,
        }
        self.publish()

    def publish(self) -> None:
        # Atomic replace avoids a reader observing partial JSON.
        destination = self.folder / _FILE
        temporary = self.folder / f'.live-preview.{os.getpid()}.tmp'
        payload = dict(self.state)
        payload['updated_at'] = time.time()
        data = json.dumps(payload, ensure_ascii=False, allow_nan=False)
        temporary.write_text(data, encoding='utf-8')
        os.replace(temporary, destination)

    def update(self, *, status: str | None = None, step: int | None = None,
               message: str | None = None, url: str | None = None) -> None:
        if status is not None:
            self.state['status'] = status
        if step is not None:
            self.state['step'] = max(0, min(self.total, step))
        if message is not None:
            self.state['message'] = str(message)[:300]
        if url is not None:
            self.state['url'] = str(url)[:2000]
        self.publish()

    def frame(self, filename: str, *, step: int, label: str, url: str = '') -> None:
        if not _SAFE_FILE.fullmatch(filename):
            raise ValueError('Invalid browser preview frame filename')
        frames = self.state['frames']
        frames.append({
            'file': filename,
            'step': step,
            'label': str(label)[:90],
            'url': url[:2000],
            'timestamp': time.time(),
        })
        # Keep a bounded number of snapshots in manifest; old files remain artifacts.
        if len(frames) > 120:
            del frames[:-120]
        self.publish()

    def finish(self, status: str, message: str = '') -> None:
        self.update(status=status, message=message or status)
