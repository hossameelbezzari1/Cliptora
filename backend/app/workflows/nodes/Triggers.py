from __future__ import annotations
from datetime import datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo
from app.workflows.Node import Node

class TriggersNode(Node):
    family = 'triggers'
    group = 'Triggers'
    icon = 'lucide:zap'
    operations = {
        'core.manual_trigger': {'icon':'lucide:play', 'label': 'Manual Trigger', 'settings': {}},
        'core.schedule_trigger': {'icon':'lucide:calendar-clock', 'label': 'Schedule Trigger', 'settings': {'timezone':'UTC', 'enabled':True}},
    }

    parameter_fields = {'core.schedule_trigger': {
        'timezone': {'type':'string','default':'UTC'},
        'enabled': {'type':'boolean','default':True},
        'rule': {'type':'object','widget':'json','group':'Advanced','description':'Schedule rules are persisted; automatic scheduling requires an enabled scheduler.'},
    }}

    def execute_operation(self, operation, node, outputs, source, workdir):
        if operation == 'core.manual_trigger':
            return {'trigger': {'status': 'received', 'type': 'manual'}}
        if operation == 'core.schedule_trigger':
            utc = datetime.now(timezone.utc)
            zone = str(node.get('settings', {}).get('timezone') or 'UTC')
            try: local = utc.astimezone(ZoneInfo(zone))
            except Exception as ex: raise ValueError('Invalid schedule timezone') from ex
            stamp = local.strftime('%I:%M:%S %p').lstrip('0').lower()
            suffix = 'th' if 11 <= local.day % 100 <= 13 else {1:'st',2:'nd',3:'rd'}.get(local.day % 10,'th')
            offset = local.strftime('%z');offset = f'{offset[:3]}:{offset[3:]}'
            return {'timestamp':local.isoformat(timespec='milliseconds'),
                    'Readable date':f'{local.strftime("%B")} {local.day}{suffix} {local.year}, {stamp}',
                    'Readable time':stamp,'Day of week':local.strftime('%A'),'Year':str(local.year),
                    'Month':local.strftime('%B'),'Day of month':str(local.day),
                    'Hour':local.strftime('%H'),'Minute':local.strftime('%M'),'Second':local.strftime('%S'),
                    'Timezone':f'{zone} (UTC{offset})'}
        raise ValueError(f'Unsupported trigger operation: {operation}')
