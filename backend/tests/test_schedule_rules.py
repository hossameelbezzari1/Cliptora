import unittest
from datetime import datetime, timezone
from app.workers.schedule_rules import matches_rule, cron_matches, due


class ScheduleRuleTests(unittest.TestCase):
    def dt(self, date='2026-11-02T12:00:00+00:00'):
        return datetime.fromisoformat(date)

    def test_days(self):
        assert matches_rule({'field':'days','daysInterval':1,'triggerAtHour':12,'triggerAtMinute':0}, self.dt(), 'UTC')
        assert not matches_rule({'field':'days','daysInterval':1,'triggerAtHour':13}, self.dt(), 'UTC')

    def test_seconds(self):
        assert matches_rule({'field':'seconds','secondsInterval':30}, self.dt(), 'UTC')
        assert not matches_rule({'field':'seconds','secondsInterval':30}, self.dt('2026-11-02T12:00:03+00:00'), 'UTC')

    def test_weekday(self):
        assert matches_rule({'field':'weeks','weeksInterval':1,'triggerAtDay':1,'triggerAtHour':12}, self.dt(), 'UTC')

    def test_cron(self):
        assert cron_matches('0 12 * * 1', self.dt())
        assert not cron_matches('15 12 * * 1', self.dt())
        assert cron_matches('*/15 * * * *', self.dt())

    def test_due_cron(self):
        assert due({'enabled': True, 'timezone': 'UTC', 'rule': {'interval': [{'field': 'cron', 'expression': '0 12 * * 1'}]}}, self.dt())

    def test_disabled(self):
        assert not due({'enabled':False, 'rule':{'interval':[{'field':'seconds','secondsInterval':1}]}}, self.dt())

    def test_expressions_not_run_as_python(self):
        with self.assertRaises(ValueError):
            matches_rule({'field':'days','daysInterval':'{{ eval() }}','triggerAtHour':12}, self.dt(), 'UTC')

    def test_invalid_timezone(self):
        with self.assertRaises(ValueError):
            matches_rule({'field':'days'}, self.dt(), '../etc/passwd')


if __name__ == '__main__':
    unittest.main()
