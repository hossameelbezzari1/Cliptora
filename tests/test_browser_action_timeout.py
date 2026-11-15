import sys
import threading
import unittest
from pathlib import Path
from unittest.mock import MagicMock

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))

from app.workflows.BrowserDevSession import BrowserDevSession
from app.workflows.nodes.Browser import _action_timeout, _wait_state


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


class ActionTimeoutTests(unittest.TestCase):
    def test_action_timeout_defaults_to_the_node_timeout(self):
        self.assertEqual(_action_timeout({}, 15000), 15000)
        self.assertEqual(_action_timeout({'timeout_ms': None}, 15000), 15000)

    def test_action_timeout_can_extend_a_slow_wait(self):
        self.assertEqual(_action_timeout({'timeout_ms': 90000}, 15000), 90000)

    def test_action_timeout_rejects_values_playwright_cannot_use(self):
        for value in (0, -1, True, 'soon'):
            with self.assertRaises(ValueError):
                _action_timeout({'timeout_ms': value}, 1000)

    def test_wait_state_is_validated_and_case_insensitive(self):
        self.assertEqual(_wait_state({}), 'visible')
        self.assertEqual(_wait_state({'state': ' HIDDEN '}), 'hidden')
        self.assertEqual(_wait_state({'state': 'detached'}), 'detached')
        with self.assertRaises(ValueError):
            _wait_state({'state': 'gone'})


class DevWaitTests(unittest.TestCase):
    def test_dev_wait_uses_the_action_timeout(self):
        session = session_stub()
        page = MagicMock()
        page.url = 'https://example.com/studio'
        page.title.return_value = 'Studio'
        locator = page.locator.return_value

        result = session._execute_action(
            MagicMock(), page,
            {'command': 'wait', 'target': '[data-progress]', 'state': 'hidden', 'timeout_ms': 12345},
            'commands:7',
        )

        locator.wait_for.assert_called_once_with(state='hidden', timeout=12345)
        self.assertEqual(result['status'], 'completed')

    def test_dev_wait_defaults_to_the_session_timeout(self):
        session = session_stub()
        page = MagicMock()
        page.url = 'https://example.com/studio'
        page.title.return_value = 'Studio'
        locator = page.locator.return_value

        session._execute_action(
            MagicMock(), page,
            {'command': 'wait', 'target': '[data-output]', 'state': 'visible'},
            'commands:8',
        )

        locator.wait_for.assert_called_once_with(state='visible', timeout=5000)


if __name__ == '__main__':
    unittest.main()
