import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import patch

from app.workflows.nodes.schedule_trigger import ScheduleTriggerNode, format_schedule_event


class ScheduleTriggerOutputTests(unittest.TestCase):
    def test_n8n_fields_and_dst_in_new_york(self):
        instant = datetime.fromisoformat('2026-10-31T19:19:03.537+00:00')
        result = format_schedule_event(instant, 'America/New_York')
        self.assertEqual(result, {
            'timestamp': '2026-10-31T15:19:03.537-04:00',
            'Readable date': 'October 31st 2026, 3:19:03 pm',
            'Readable time': '3:19:03 pm',
            'Day of week': 'Saturday',
            'Year': '2026',
            'Month': 'October',
            'Day of month': '31',
            'Hour': '15',
            'Minute': '19',
            'Second': '03',
            'Timezone': 'America/New_York (UTC-04:00)',
        })
        self.assertEqual(len(result), 11)

    def test_ordinal_11th_12th_13th_and_21st(self):
        for day, suffix in [(1, '1st'), (2, '2nd'), (3, '3rd'), (11, '11th'), (12, '12th'), (13, '13th'), (21, '21st'), (22, '22nd'), (23, '23rd'), (31, '31st')]:
            result = format_schedule_event(datetime(2026, 1, day, tzinfo=timezone.utc), 'UTC')
            self.assertIn(f'January {suffix} 2026', result['Readable date'])

    def test_daylight_saving_switch(self):
        instant = datetime.fromisoformat('2026-11-01T07:00:00+00:00')
        result = format_schedule_event(instant, 'America/New_York')
        self.assertEqual(result['timestamp'], '2026-11-01T02:00:00.000-05:00')
        self.assertEqual(result['Timezone'], 'America/New_York (UTC-05:00)')

    def test_utc_fallback(self):
        instant = datetime.fromisoformat('2026-10-31T19:19:03.000+00:00')
        result = format_schedule_event(instant)
        self.assertEqual(result['Hour'], '19')
        self.assertEqual(result['Timezone'], 'UTC (UTC+00:00)')

    def test_invalid_timezone_raises(self):
        with self.assertRaises(ValueError):
            format_schedule_event(datetime.now(timezone.utc), 'Invalid/Timezone')

    def test_schedule_executor_returns_flat_dict(self):
        node = {'type': 'core.schedule_trigger', 'settings': {'timezone': 'America/New_York'}}
        result = ScheduleTriggerNode.execute(node, {}, None, Path('.'))
        self.assertIsInstance(result, dict)
        self.assertEqual(result['Timezone'].split(' ')[0], 'America/New_York')
        self.assertIn('Readable time', result)
        self.assertNotIn('trigger', result)


if __name__ == '__main__':
    unittest.main()
