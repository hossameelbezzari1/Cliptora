"""Small, deterministic UTC/IANA-timezone schedule matcher for CLIPTORA.

This module does not evaluate arbitrary expressions or JavaScript. Cron accepts
five standard numeric fields; named months/days are deliberately unsupported.
"""
from __future__ import annotations

from datetime import datetime, date
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError


def _int(value: object, low: int, high: int) -> int:
    if type(value) is not int or not low <= value <= high:
        raise ValueError(f"Expected integer between {low} and {high}")
    return value


def _cron_field(value: str, current: int, low: int, high: int) -> bool:
    if len(value) > 100 or not value:
        raise ValueError('Invalid cron field')
    for token in value.split(','):
        step = 1
        if '/' in token:
            base, step_text = token.split('/', 1)
            if not step_text.isdecimal():
                raise ValueError('Invalid cron step')
            step = _int(int(step_text), 1, high - low + 1)
        else:
            base = token
        if base == '*':
            start, end = low, high
        elif '-' in base:
            left, right = base.split('-', 1)
            if not left.isdecimal() or not right.isdecimal():
                raise ValueError('Invalid cron range')
            start, end = _int(int(left), low, high), _int(int(right), low, high)
            if start > end:
                raise ValueError('Reversed cron range')
        elif base.isdecimal():
            start = _int(int(base), low, high)
            end = high if '/' in token else start
        else:
            raise ValueError('Cron fields must be numeric')
        if start <= current <= end and (current - start) % step == 0:
            return True
    return False


def cron_matches(cron: str, local: datetime) -> bool:
    fields = cron.strip().split()
    if len(fields) != 5:
        raise ValueError('Cron must have exactly 5 fields')
    minute, hour, dom, month, dow = fields
    if not (_cron_field(minute, local.minute, 0, 59)
            and _cron_field(hour, local.hour, 0, 23)
            and _cron_field(month, local.month, 1, 12)):
        return False
    dom_hit = _cron_field(dom, local.day, 1, 31)
    dow_hit = _cron_field(dow, local.isoweekday() % 7, 0, 6)
    # Standard cron semantics: DOM or DOW if both are constrained.
    return (dom_hit or dow_hit) if dom != '*' and dow != '*' else (dom_hit and dow_hit)


def matches_rule(rule: dict, utc: datetime, timezone_name: str) -> bool:
    if utc.tzinfo is None:
        raise ValueError('UTC datetime must be timezone-aware')
    try:
        local = utc.astimezone(ZoneInfo(timezone_name))
    except (ZoneInfoNotFoundError, ValueError) as exc:
        raise ValueError(f'Invalid timezone: {timezone_name}') from exc

    field = rule.get('field', 'days')
    epoch_seconds = int(utc.timestamp())
    if field == 'seconds':
        return epoch_seconds % _int(rule.get('secondsInterval', 30), 1, 59) == 0
    if local.second:
        return False
    if field == 'minutes':
        n = _int(rule.get('minutesInterval', 1), 1, 59)
        return epoch_seconds // 60 % n == 0
    if field == 'hours':
        n = _int(rule.get('hoursInterval', 1), 1, 23)
        return local.minute == 0 and epoch_seconds // 3600 % n == 0

    if field == 'cron':
        expression = rule.get('expression', '0 0 * * *')
        if not isinstance(expression, str):
            raise ValueError('Cron expression must be a string')
        return cron_matches(expression, local)
    minute = _int(rule.get('triggerAtMinute', 0), 0, 59)
    hour = _int(rule.get('triggerAtHour', 0), 0, 23)
    if local.minute != minute or local.hour != hour:
        return False
    if field == 'days':
        n = _int(rule.get('daysInterval', 1), 1, 31)
        return (local.date() - date(1970, 1, 1)).days % n == 0
    if field == 'weeks':
        n = _int(rule.get('weeksInterval', 1), 1, 52)
        day = _int(rule.get('triggerAtDay', 1), 0, 6)
        weeks_since_epoch = (local.date() - date(1970, 1, 5)).days // 7
        return local.isoweekday() % 7 == day and weeks_since_epoch % n == 0
    if field == 'months':
        n = _int(rule.get('monthsInterval', 1), 1, 12)
        day = _int(rule.get('triggerAtDayOfMonth', 1), 1, 31)
        months_since_epoch = (local.year - 1970) * 12 + (local.month - 1)
        return local.day == day and months_since_epoch % n == 0
    raise ValueError(f'Unknown schedule interval: {field}')


def due(settings: dict, utc: datetime) -> bool:
    if settings.get('enabled') is not True:
        return False
    root = settings.get('rule', {})
    intervals = root.get('interval') if isinstance(root, dict) else None
    if not isinstance(intervals, list) or not 1 <= len(intervals) <= 30:
        raise ValueError('Schedule requires 1 to 30 interval rules')
    zone = settings.get('timezone') or 'UTC'
    if not isinstance(zone, str) or len(zone) > 80:
        raise ValueError('Invalid timezone')
    return any(matches_rule(rule, utc, zone) for rule in intervals if isinstance(rule, dict))
