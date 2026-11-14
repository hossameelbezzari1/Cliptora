import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from app.workflows.BrowserLiveState import BrowserLiveState
from app.services.WorkflowBrowserPreview import read_browser_live_status


class BrowserLiveStateTests(unittest.TestCase):
    def test_command_diagnostics_are_published_and_sanitized(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            workdir = root / '1' / '2' / 'runs' / '3'
            workdir.mkdir(parents=True)
            with patch('app.workflows.MediaStorage.media_root', return_value=root / 'media'):
                live = BrowserLiveState(workdir, 'browser', 'playwright', 2)
                live.command_started(1, 'fill', '#studio-script')
                live.element_found(1)
                live.command_finished(1, 0.4567)
                live.command_started(2, 'click', '[data-generate]')
                live.command_failed(2, TimeoutError('button was not visible'), 1.25)
                result = read_browser_live_status(workdir)

            self.assertEqual(len(result['commands']), 2)
            self.assertEqual(result['commands'][0], {
                'index': 1,
                'command': 'fill',
                'status': 'completed',
                'target': '#studio-script',
                'element_status': 'found',
                'elapsed_seconds': 0.457,
            })
            self.assertEqual(result['commands'][1]['status'], 'failed')
            self.assertEqual(result['commands'][1]['element_status'], 'not_found')
            self.assertIn('TimeoutError', result['commands'][1]['error'])

    def test_target_label_is_bounded_in_persisted_state(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            workdir = root / '1' / '2' / 'runs' / '3'
            workdir.mkdir(parents=True)
            with patch('app.workflows.MediaStorage.media_root', return_value=root / 'media'):
                live = BrowserLiveState(workdir, 'browser', 'selenium', 1)
                live.command_started(1, 'click', 'x' * 1000)
            state_path = next((root / 'media').rglob('*.json'))
            state = json.loads(state_path.read_text(encoding='utf-8'))
            self.assertEqual(len(state['commands'][0]['target']), 300)


if __name__ == '__main__':
    unittest.main()
