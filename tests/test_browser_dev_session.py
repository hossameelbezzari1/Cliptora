import threading
import unittest
import sys
import socket
from pathlib import Path
from unittest.mock import MagicMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))

from app.workflows.BrowserDevSession import BrowserDevSession
from app.workflows.nodes.Browser import _public_url


def session_stub() -> BrowserDevSession:
    session = object.__new__(BrowserDevSession)
    session.timeout_ms = 5000
    session.allowed_hosts = ['example.com']
    session.download_dir = Path('.')
    session.history = {}
    session._lock = threading.RLock()
    session.status = 'ready'
    session.message = ''
    session.current_url = ''
    session.title = ''
    session.updated_at = 0
    return session


class BrowserDevSessionTests(unittest.TestCase):
    def test_public_url_retries_transient_dns_failure(self):
        resolved = [(socket.AF_INET, socket.SOCK_STREAM, 0, '', ('149.56.38.248', 443))]
        with patch('app.workflows.nodes.Browser.socket.getaddrinfo', side_effect=[
            socket.gaierror('temporary failure'),
            socket.gaierror('temporary failure'),
            resolved,
        ]), patch('app.workflows.nodes.Browser.time.sleep') as sleep:
            result = _public_url('https://wevolabs.com/', ['wevolabs.com'])

        self.assertEqual(result, 'https://wevolabs.com/')
        self.assertEqual(sleep.call_count, 2)

    def test_fill_command_uses_existing_page_and_records_success(self):
        session = session_stub()
        page = MagicMock()
        page.url = 'https://example.com/studio'
        page.title.return_value = 'Studio'
        locator = page.locator.return_value

        result = session._execute_action(
            MagicMock(), page,
            {'command': 'fill', 'target': '#studio-script', 'value': 'hello'},
            'commands:0',
        )

        locator.wait_for.assert_called_once_with(state='attached', timeout=5000)
        locator.fill.assert_called_once_with('hello', timeout=5000)
        self.assertEqual(result['status'], 'completed')
        self.assertEqual(result['element_status'], 'found')
        self.assertEqual(session.history['commands:0']['status'], 'completed')
        self.assertEqual(session.current_url, 'https://example.com/studio')

    def test_missing_element_records_failed_command(self):
        session = session_stub()
        page = MagicMock()
        page.url = 'https://example.com/studio'
        page.title.return_value = 'Studio'
        page.locator.return_value.wait_for.side_effect = TimeoutError('not found')

        with self.assertRaisesRegex(RuntimeError, 'not found'):
            session._execute_action(
                MagicMock(), page,
                {'command': 'click', 'target': '[data-generate]'},
                'commands:1',
            )

        result = session.history['commands:1']
        self.assertEqual(result['status'], 'failed')
        self.assertEqual(result['element_status'], 'not_found')
        self.assertIn('TimeoutError', result['error'])


if __name__ == '__main__':
    unittest.main()
