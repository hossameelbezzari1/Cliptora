import { CalendarClock } from 'lucide-react'
import type { WorkflowNodeUI } from '../nodeTypes'
import { ScheduleParameters, ScheduleSettings } from './ScheduleTrigger'

function formatOutput(value: unknown): unknown {
  if (value == null || Array.isArray(value)) return value
  if (typeof value !== 'object') return value
  const item = value as Record<string, unknown>
  if (typeof item.timestamp !== 'string' || typeof item['Readable date'] !== 'string') return value
  return [item]
}

const node: WorkflowNodeUI = {
  type: 'core.schedule_trigger',
  Icon: CalendarClock,
  Parameters: ScheduleParameters,
  Settings: ScheduleSettings,
  formatOutput,
}
export default node
