"""Native Schedule Trigger (core.schedule_trigger), registered by node discovery.

The scheduler creates workflow runs; this executor also supports manual tests.
Do not evaluate UI expressions as Python/JavaScript.
"""
from __future__ import annotations

import calendar
from datetime import datetime, timezone, timedelta
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError
from pathlib import Path
from typing import Any

from app.workflows.base import BaseNode



def _ordinal(day: int) -> str:
    if 10 < day % 100 < 14:
        return f'{day}th'
    return f"{day}{ {1: 'st', 2: 'nd', 3: 'rd'}.get(day % 10, 'th')}"


def format_schedule_event(instant: datetime, timezone_name: str = 'UTC') -> dict[str, str]:
    """One n8n-style schedule item. Uses the configured IANA timezone.

    Keep the node's actual artifact a dictionary: the workflow engine needs
    dict-shaped outputs, while the frontend node UI wraps it as a 1-item array.
    """
    if instant.tzinfo is None:
        raise ValueError('Schedule event instant must have a timezone')
    try:
        local = instant.astimezone(ZoneInfo(timezone_name))
    except (ZoneInfoNotFoundError, ValueError, TypeError) as exc:
        raise ValueError(f'Invalid schedule timezone: {timezone_name}') from exc

    readable_time = f'{local.hour % 12 or 12}:{local.minute:02d}:{local.second:02d} {"am" if local.hour < 12 else "pm"}'
    readable_date = f'{calendar.month_name[local.month]} {_ordinal(local.day)} {local.year}, {readable_time}'
    offset = local.utcoffset() or timedelta(0)
    offset_seconds = int(offset.total_seconds())
    sign = '+' if offset_seconds >= 0 else '-'
    offset_seconds = abs(offset_seconds)
    zone_offset = f'UTC{sign}{offset_seconds // 3600:02d}:{(offset_seconds % 3600) // 60:02d}'

    return {
        'timestamp': local.isoformat(timespec='milliseconds'),
        'Readable date': readable_date,
        'Readable time': readable_time,
        'Day of week': calendar.day_name[local.weekday()],
        'Year': str(local.year),
        'Month': calendar.month_name[local.month],
        'Day of month': str(local.day),
        'Hour': f'{local.hour:02d}',
        'Minute': f'{local.minute:02d}',
        'Second': f'{local.second:02d}',
        'Timezone': f'{timezone_name} ({zone_offset})',
    }

class ScheduleTriggerNode(BaseNode):
    type = 'core.schedule_trigger'

    @staticmethod
    def metadata() -> dict[str, Any]:
        return {
            'label': 'Schedule Trigger',
            'group': 'Triggers',
            'icon': 'schedule',
            'settings': {
                'enabled': False,
                'timezone': 'UTC',
                'rule': {
                    'interval': [
                        {
                            'field': 'days',
                            'daysInterval': 1,
                            'triggerAtHour': 0,
                            'triggerAtMinute': 0,
                        }
                    ]
                },
            },
            'actions': [],
            'input_types': [],
            'output_types': ['json'],
            'parameters_schema': {
                'type': 'object',
                'properties': {
                    'enabled': {'type': 'boolean', 'title': 'Enable schedule'},
                    'timezone': {'type': 'string', 'title': 'Timezone'},
                    'rule': {'type': 'object', 'title': 'Trigger rules'},
                },
            },
        }

    @staticmethod
    def execute(node: dict[str, Any], outputs: dict[str, Any], source: Path | None, workdir: Path) -> dict[str, Any]:
        settings = node.get('settings') or {}
        timezone_name = settings.get('timezone') or 'UTC'
        if not isinstance(timezone_name, str) or len(timezone_name) > 80:
            raise ValueError('Invalid schedule timezone')
        return format_schedule_event(datetime.now(timezone.utc), timezone_name)


metadata = ScheduleTriggerNode.metadata
execute = ScheduleTriggerNode.execute
NODE = ScheduleTriggerNode.definition()
