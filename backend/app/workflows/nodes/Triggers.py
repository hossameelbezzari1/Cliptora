
from __future__ import annotations

from datetime import datetime, timezone
from zoneinfo import ZoneInfo

from app.workflows.Node import Node


def option(value: str | int, label: str) -> dict:
    return {"value": value, "label": label}


def integer_field(
    title: str,
    default: int,
    minimum: int,
    maximum: int,
    visible_if: dict | None = None,
) -> dict:
    result = {
        "type": "integer",
        "title": title,
        "default": default,
        "minimum": minimum,
        "maximum": maximum,
        "expression": True,
    }
    if visible_if:
        result["visible_if"] = visible_if
    return result


SCHEDULE_UNITS = [
    option("seconds", "Seconds"),
    option("minutes", "Minutes"),
    option("hours", "Hours"),
    option("days", "Days"),
    option("weeks", "Weeks"),
    option("months", "Months"),
    option("cron", "Custom (Cron)"),
]

WEEKDAYS = [
    option(1, "Monday"),
    option(2, "Tuesday"),
    option(3, "Wednesday"),
    option(4, "Thursday"),
    option(5, "Friday"),
    option(6, "Saturday"),
    option(0, "Sunday"),
]

HOURS = [
    option(
        hour,
        "Midnight" if hour == 0 else
        "Noon" if hour == 12 else
        f"{hour:02d}:00",
    )
    for hour in range(24)
]


class TriggersNode(Node):
    family = "triggers"
    group = "Triggers"
    icon = "lucide:zap"

    operations = {
        "core.manual_trigger": {
            "icon": "lucide:play",
            "label": "Manual Trigger",
            "settings": {},
        },
        "core.schedule_trigger": {
            "icon": "lucide:calendar-clock",
            "label": "Schedule Trigger",
            "settings": {
                "timezone": "UTC",
                "enabled": True,
                "rule": {
                    "interval": [
                        {
                            "field": "days",
                            "daysInterval": 1,
                            "triggerAtHour": 0,
                            "triggerAtMinute": 0,
                        }
                    ]
                },
            },
        },
    }

    parameter_fields = {
        "core.schedule_trigger": {
            "timezone": {
                "type": "string",
                "title": "Timezone",
                "default": "UTC",
                "expression": False,
            },
            "enabled": {
                "type": "boolean",
                "title": "Enabled",
                "default": True,
                "expression": False,
            },
            "rule": {
                "type": "object",
                "title": "Trigger Rules",
                "widget": "collection",
                "expression": False,
                "collection_key": "interval",
                "min_items": 1,
                "max_items": 30,
                "add_label": "Add Rule",
                "item_label": "Trigger Interval",
                "default": {
                    "interval": [
                        {
                            "field": "days",
                            "daysInterval": 1,
                            "triggerAtHour": 0,
                            "triggerAtMinute": 0,
                        }
                    ]
                },
                "item_default": {
                    "field": "days",
                    "daysInterval": 1,
                    "triggerAtHour": 0,
                    "triggerAtMinute": 0,
                },
                "properties": {
                    "field": {
                        "type": "string",
                        "title": "Trigger Interval",
                        "widget": "select",
                        "default": "days",
                        "expression": False,
                        "options": SCHEDULE_UNITS,
                    },
                    "secondsInterval": integer_field(
                        "Seconds Between Triggers",
                        30, 1, 59,
                        {"field": ["seconds"]},
                    ),
                    "minutesInterval": integer_field(
                        "Minutes Between Triggers",
                        5, 1, 59,
                        {"field": ["minutes"]},
                    ),
                    "hoursInterval": integer_field(
                        "Hours Between Triggers",
                        1, 1, 23,
                        {"field": ["hours"]},
                    ),
                    "daysInterval": integer_field(
                        "Days Between Triggers",
                        1, 1, 31,
                        {"field": ["days"]},
                    ),
                    "weeksInterval": integer_field(
                        "Weeks Between Triggers",
                        1, 1, 52,
                        {"field": ["weeks"]},
                    ),
                    "monthsInterval": integer_field(
                        "Months Between Triggers",
                        1, 1, 12,
                        {"field": ["months"]},
                    ),
                    "triggerAtDay": {
                        "type": "integer",
                        "title": "Trigger on Weekday",
                        "widget": "select",
                        "default": 1,
                        "options": WEEKDAYS,
                        "visible_if": {
                            "field": ["weeks"]
                        },
                        "expression": False,
                    },
                    "triggerAtDayOfMonth": integer_field(
                        "Trigger on Day of Month",
                        1, 1, 31,
                        {"field": ["months"]},
                    ),
                    "triggerAtHour": {
                        "type": "integer",
                        "title": "Trigger at Hour",
                        "widget": "select",
                        "default": 0,
                        "options": HOURS,
                        "visible_if": {
                            "field": ["days", "weeks", "months"]
                        },
                        "expression": False,
                    },
                    "triggerAtMinute": integer_field(
                        "Trigger at Minute",
                        0, 0, 59,
                        {
                            "field": [
                                "days", "weeks", "months"
                            ]
                        },
                    ),
                    "expression": {
                        "type": "string",
                        "title": "Cron Expression",
                        "default": "0 0 * * *",
                        "visible_if": {
                            "field": ["cron"]
                        },
                        "description": "Five-field cron expression.",
                        "expression": False,
                    },
                },
            },
        },
    }

    def execute_operation(
        self,
        operation,
        node,
        outputs,
        source,
        workdir,
    ):
        if operation == "core.manual_trigger":
            return {
                "trigger": {
                    "status": "received",
                    "type": "manual",
                }
            }

        if operation == "core.schedule_trigger":
            utc = datetime.now(timezone.utc)
            zone = str(
                node.get("settings", {}).get("timezone")
                or "UTC"
            )

            try:
                local = utc.astimezone(ZoneInfo(zone))
            except Exception as exc:
                raise ValueError(
                    "Invalid schedule timezone"
                ) from exc

            stamp = (
                local.strftime("%I:%M:%S %p")
                .lstrip("0")
                .lower()
            )

            suffix = (
                "th"
                if 11 <= local.day % 100 <= 13
                else {
                    1: "st",
                    2: "nd",
                    3: "rd",
                }.get(local.day % 10, "th")
            )

            offset = local.strftime("%z")
            offset = f"{offset[:3]}:{offset[3:]}"

            return {
                "timestamp": local.isoformat(
                    timespec="milliseconds"
                ),
                "Readable date": (
                    f"{local.strftime('%B')} "
                    f"{local.day}{suffix} "
                    f"{local.year}, {stamp}"
                ),
                "Readable time": stamp,
                "Day of week": local.strftime("%A"),
                "Year": str(local.year),
                "Month": local.strftime("%B"),
                "Day of month": str(local.day),
                "Hour": local.strftime("%H"),
                "Minute": local.strftime("%M"),
                "Second": local.strftime("%S"),
                "Timezone": f"{zone} (UTC{offset})",
            }

        raise ValueError(
            f"Unsupported trigger operation: {operation}"
        )
