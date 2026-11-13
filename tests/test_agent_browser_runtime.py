"""Focused tests, run with PYTHONPATH=backend python -m unittest discover -s tests."""
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

from app.workflows.AgentBrowserRuntime import _decision, run_browser_agent


class TestAgentBrowser(unittest.TestCase):
    def test_rejects_unapproved_code(self):
        with self.assertRaises(ValueError):
            _decision('{"action":"evaluate","code":"alert(1)"}')

    def test_accepts_valid_json(self):
        self.assertEqual(_decision('```json\n{"action":"finish","result":"ok"}\n```')['action'], 'finish')

    def test_reuses_single_browser_for_multiple_agent_steps(self):
        fake_pw = MagicMock()
        fake_browser = fake_pw.chromium.launch.return_value
        fake_page = fake_browser.new_context.return_value.new_page.return_value
        fake_page.url = 'https://example.com/'
        decisions = iter([
            {"text": '{"action":"scroll","pixels":250}'},
            {"text": '{"action":"finish","result":"Done"}'},
        ])
        ctx = MagicMock()
        ctx.__enter__.return_value = fake_pw
        with patch('playwright.sync_api.sync_playwright', return_value=ctx), \
             patch('app.workflows.AgentBrowserRuntime._public_url', side_effect=lambda x, h: x), \
             patch('app.workflows.AgentBrowserRuntime._snapshot', return_value={'elements': []}), \
             patch('app.workflows.AgentBrowserRuntime._captcha_element', return_value=None):
            result = run_browser_agent(
                cfg={'max_iterations': 3},
                request_cfg={'prompt': 'scroll then finish', 'system_prompt': 'follow the task'},
                browser_node={'id':'browser1', 'settings':{'url':'https://example.com/', 'allowed_hosts':['example.com']}},
                model_invoke=lambda _: next(decisions),
                outputs={}, workdir=Path('/tmp/cliptora-test'),
            )
        self.assertEqual(result['agent']['status'], 'completed')
        self.assertEqual(result['agent']['iterations'], 2)
        self.assertEqual(fake_pw.chromium.launch.call_count, 1)
        fake_page.mouse.wheel.assert_called_once_with(0, 250)
        fake_browser.close.assert_called_once()


if __name__ == '__main__':
    unittest.main()
