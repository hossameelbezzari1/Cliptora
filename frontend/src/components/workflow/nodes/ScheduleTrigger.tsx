import { useState } from 'react'
import {
  AlertTriangle, CalendarClock, ChevronDown, Clock3, Code2,
  Info, Plus, Trash2,
} from 'lucide-react'
import type { WorkflowNodeParametersProps, WorkflowNodeUI } from '../nodeTypes'

const fieldClass = 'min-h-10 w-full rounded-lg border border-[#dedee3] bg-white px-3 py-2.5 text-[13px] text-[#272727] outline-none transition-colors focus:border-[#8b5cf6] focus:ring-2 focus:ring-violet-100'
const noteClass = 'text-[11px] leading-5 text-[#767676]'
const intervals = [
  ['seconds', 'Seconds'], ['minutes', 'Minutes'], ['hours', 'Hours'],
  ['days', 'Days'], ['weeks', 'Weeks'], ['months', 'Months'],
  ['cron', 'Custom (Cron)'],
] as const

type Interval = (typeof intervals)[number][0]
type Rule = Record<string, unknown>
type InputValue = string | number

type ControlProps = {
  id: string
  label: string
  value: unknown
  onChange: (value: InputValue) => void
  type?: 'number' | 'text' | 'select'
  min?: number
  max?: number
  help?: string
  options?: readonly (readonly [string | number, string])[]
  modes: Record<string, boolean>
  setModes: (updater: (current: Record<string, boolean>) => Record<string, boolean>) => void
}

function isExpression(value: unknown) {
  return typeof value === 'string' && (/^\s*=\s*\{\{/.test(value) || /^\s*\{\{/.test(value))
}

function valueText(value: unknown) {
  return value === null || value === undefined ? '' : String(value)
}

function Control({ id, label, value, onChange, type = 'number', min, max, help, options, modes, setModes }: ControlProps) {
  const expression = modes[id] ?? isExpression(value)
  const setExpression = (next: boolean) => {
    setModes(current => ({ ...current, [id]: next }))
    if (next && !isExpression(value)) onChange(`{{ ${valueText(value)} }}`)
    if (!next && isExpression(value)) {
      const raw = valueText(value).replace(/^\s*=?\s*\{\{\s*/, '').replace(/\s*\}\}\s*$/, '')
      if (type === 'select') {
        const valid = options?.some(option => String(option[0]) === raw)
        onChange(valid ? raw : String(options?.[0]?.[0] ?? ''))
      } else if (type === 'number') {
        const n = Number(raw)
        onChange(Number.isFinite(n) ? Math.max(min ?? -Infinity, Math.min(max ?? Infinity, n)) : min ?? 0)
      } else onChange(raw)
    }
  }
  return <div className="space-y-1.5">
    <div className="flex min-h-6 items-center justify-between gap-3">
      <label htmlFor={id} className="text-[12px] font-medium text-[#272727]">{label}</label>
      <div className="inline-flex shrink-0 rounded-lg bg-[#eeeeef] p-[3px] text-[11px]" aria-label={`${label} value mode`}>
        <button type="button" onClick={() => setExpression(false)} aria-pressed={!expression}
          className={`cursor-pointer rounded-md px-2 py-1 ${!expression ? 'bg-white text-[#222] shadow-sm' : 'text-[#666] hover:text-[#222]'}`}>Fixed</button>
        <button type="button" onClick={() => setExpression(true)} aria-pressed={expression}
          className={`cursor-pointer rounded-md px-2 py-1 ${expression ? 'bg-white text-[#222] shadow-sm' : 'text-[#666] hover:text-[#222]'}`}>Expression</button>
      </div>
    </div>
    {expression ? <div className="overflow-hidden rounded-lg border border-[#9568f6] bg-white focus-within:ring-2 focus-within:ring-violet-100">
      <div className="flex items-center gap-2 px-3 py-2">
        <span aria-hidden="true" className="font-serif text-[16px] italic text-[#9362ec]">fx</span>
        <input id={id} type="text" spellCheck={false} autoComplete="off" className="min-w-0 flex-1 bg-transparent font-mono text-[12px] text-[#242424] outline-none"
          value={valueText(value)} placeholder="{{ $now }}" onChange={event => onChange(event.target.value)}/>
        <Code2 size={15} className="shrink-0 text-[#8b5cf6]" />
      </div>
      <div className="border-t border-[#e9e4f7] bg-[#fcfaff] px-3 py-2 text-[11px] leading-5 text-[#777]">
        Expression saved as text. Evaluation requires a compatible backend expression resolver; arbitrary JavaScript is not executed.
      </div>
    </div> : type === 'select' ? <div className="relative">
      <select id={id} className={`${fieldClass} cursor-pointer appearance-none pr-10`} value={valueText(value)}
        onChange={event => {
          const raw = event.target.value
          onChange(options?.some(option => typeof option[0] === 'number' && String(option[0]) === raw) ? Number(raw) : raw)
        }}>
        {options?.map(([optionValue, text]) => <option key={String(optionValue)} value={String(optionValue)}>{text}</option>)}
      </select>
      <ChevronDown aria-hidden="true" size={15} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[#666]" />
    </div> : <input id={id} type={type} min={min} max={max} step={1} className={fieldClass}
      value={valueText(value)} onChange={event => {
        if (type === 'number') {
          const next = Number(event.target.value)
          onChange(Number.isFinite(next) ? Math.max(min ?? -Infinity, Math.min(max ?? Infinity, next)) : min ?? 0)
        } else onChange(event.target.value)
      }} />}
    {help && <p className={noteClass}>{help}</p>}
  </div>
}

function ruleValue(rule: Rule, field: string, fallback: InputValue): InputValue {
  const value = rule[field]
  return typeof value === 'string' || typeof value === 'number' ? value : fallback
}

function normalizedRules(settings: Record<string, unknown>): Rule[] {
  const root = settings.rule
  const interval = root && typeof root === 'object' && !Array.isArray(root)
    ? (root as Record<string, unknown>).interval : undefined
  return Array.isArray(interval) && interval.length
    ? interval.filter((item): item is Rule => Boolean(item) && typeof item === 'object' && !Array.isArray(item))
    : [{ field: 'days', daysInterval: 1, triggerAtHour: 0, triggerAtMinute: 0 }]
}

function hourLabel(hour: number): string {
  if (hour === 0) return 'Midnight'
  if (hour === 12) return 'Noon'
  return `${hour % 12 || 12}:00 ${hour < 12 ? 'AM' : 'PM'}`
}

const hourOptions = Array.from({ length: 24 }, (_, hour) => [hour, hourLabel(hour)] as const)
const weekdayOptions = [
  [0, 'Sunday'], [1, 'Monday'], [2, 'Tuesday'], [3, 'Wednesday'],
  [4, 'Thursday'], [5, 'Friday'], [6, 'Saturday'],
] as const

const intervalLabels: Record<Interval, string> = {
  seconds: 'Seconds', minutes: 'Minutes', hours: 'Hours', days: 'Days',
  weeks: 'Weeks', months: 'Months', cron: 'Custom Cron',
}

export function ScheduleParameters({ node, onChange, catalog }: WorkflowNodeParametersProps) {
  const settings = node.settings
  const rules = normalizedRules(settings)
  const [modes, setModes] = useState<Record<string, boolean>>({})
  const timezone = valueText(settings.timezone) || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  const unavailable = catalog?.status === 'unavailable' || catalog?.backend_executor === null

  const updateRules = (next: Rule[]) => {
    const oldRoot = settings.rule && typeof settings.rule === 'object' && !Array.isArray(settings.rule)
      ? settings.rule as Record<string, unknown> : {}
    onChange('rule', { ...oldRoot, interval: next })
  }
  const change = (index: number, field: string, value: InputValue) => updateRules(rules.map((rule, i) => i === index ? { ...rule, [field]: value } : rule))
  const addRule = () => updateRules([...rules, { field: 'days', daysInterval: 1, triggerAtHour: 0, triggerAtMinute: 0 }])
  const removeRule = (index: number) => { if (rules.length > 1) updateRules(rules.filter((_, i) => i !== index)) }

  return <div className="space-y-5" data-schedule-trigger>
    {node.type === 'core.schedule_trigger' && <label className="flex cursor-pointer items-center justify-between gap-3 border-b border-[#ececec] pb-4 text-[12px] text-[#333]">
      <span><strong className="block text-[13px] font-medium">Enable schedule</strong><span className="mt-1 block text-[11px] text-[#858585]">Enabled workflows run on schedule when the scheduler worker is running.</span></span>
      <input type="checkbox" checked={settings.enabled === true} onChange={event => onChange('enabled', event.target.checked)} className="size-4 shrink-0 accent-violet-600"/>
    </label>}
    <div className="flex items-start gap-2 rounded-lg border border-[#edcb6a] bg-[#fff9e9] px-3 py-3 text-[12px] leading-[1.5] text-[#644916]">
      <Info size={15} className="mt-0.5 shrink-0" />
      <span>{unavailable
        ? 'Schedule configuration is editable, but automatic execution is not enabled: the current backend catalog marks this trigger unavailable. A native scheduler must be installed before it can run on time.'
        : 'Set the time intervals for this trigger. Running the workflow manually tests its nodes; automatic scheduling requires a running backend scheduler.'}</span>
    </div>

    <div className="flex items-center justify-between border-b border-[#e7e7e7] pb-2">
      <div className="flex items-center gap-2 text-[13px] font-semibold text-[#2d2d2d]"><CalendarClock size={16}/>Trigger Rules</div>
      <span className="text-[11px] text-[#858585]">{rules.length} {rules.length === 1 ? 'rule' : 'rules'}</span>
    </div>

    {rules.map((rule, index) => {
      const field = valueText(rule.field || 'days')
      const selectedInterval: Interval = intervals.some(([name]) => name === field) ? field as Interval : 'days'
      const control = (name: string, label: string, fallback: InputValue, opts: Omit<ControlProps, 'id' | 'label' | 'value' | 'onChange' | 'modes' | 'setModes'> = {}) =>
        <Control key={name} id={`${node.id}-${index}-${name}`} label={label} value={ruleValue(rule, name, fallback)}
          onChange={value => change(index, name, value)} modes={modes} setModes={setModes} {...opts}/>
      return <div key={`${node.id}:${index}`} className="space-y-4 border-b border-[#ececec] pb-5 last:border-b-0 last:pb-0">
        {rules.length > 1 && <div className="flex items-center justify-between text-[12px] font-semibold text-[#444]">
          <span>Rule {index + 1}</span>
          <button type="button" disabled={rules.length <= 1} onClick={() => removeRule(index)}
            className="inline-flex cursor-pointer items-center gap-1.5 text-[11px] font-medium text-[#777] hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-40"
            aria-label={`Remove rule ${index + 1}`}><Trash2 size={14}/>Remove</button>
        </div>}

        <Control id={`${node.id}-${index}-field`} label="Trigger Interval" type="select"
          value={ruleValue(rule, 'field', 'days')} options={intervals} modes={modes} setModes={setModes}
          onChange={value => change(index, 'field', value)} />

        {selectedInterval === 'seconds' && control('secondsInterval', 'Seconds Between Triggers', 30,
          { min: 1, max: 59, help: 'Must be in range 1–59.' })}
        {selectedInterval === 'minutes' && control('minutesInterval', 'Minutes Between Triggers', 1,
          { min: 1, max: 59, help: 'Must be in range 1–59.' })}
        {selectedInterval === 'hours' && control('hoursInterval', 'Hours Between Triggers', 1,
          { min: 1, max: 23, help: 'Must be in range 1–23.' })}
        {selectedInterval === 'days' && control('daysInterval', 'Days Between Triggers', 1,
          { min: 1, max: 31, help: 'Must be in range 1–31.' })}
        {selectedInterval === 'weeks' && <>
          {control('weeksInterval', 'Weeks Between Triggers', 1, { min: 1, max: 52 })}
          {control('triggerAtDay', 'Trigger on Weekday', 1, { type: 'select', options: weekdayOptions })}
        </>}
        {selectedInterval === 'months' && <>
          {control('monthsInterval', 'Months Between Triggers', 1, { min: 1, max: 12 })}
          {control('triggerAtDayOfMonth', 'Trigger on Day of Month', 1,
            { min: 1, max: 31, help: 'Day 29–31 may not exist every month.' })}
        </>}
        {['days', 'weeks', 'months'].includes(selectedInterval) && <>
          {control('triggerAtHour', 'Trigger at Hour', 0, { type: 'select', options: hourOptions })}
          {control('triggerAtMinute', 'Trigger at Minute', 0, { min: 0, max: 59, help: 'Must be in range 0–59.' })}
        </>}
        {selectedInterval === 'cron' && control('expression', 'Cron Expression', '0 0 * * *',
          { type: 'text', help: 'Use a 5-field cron expression (minute hour day month weekday). Validation and timed execution depend on the backend scheduler.' })}
        <p className="flex items-center gap-1 text-[11px] text-[#858585]"><Clock3 size={13}/>{intervalLabels[selectedInterval]} · {timezone}</p>
      </div>
    })}

    <button type="button" onClick={addRule}
      className="flex min-h-9 w-full cursor-pointer items-center justify-center gap-2 rounded-full border border-[#e4e4e4] bg-[#f7f7f7] px-3 text-[12px] font-medium text-[#333] transition-colors hover:bg-[#ededed]">
      <Plus size={15}/> Add Rule
    </button>

    <div className="space-y-2 border-t border-[#e7e7e7] pt-4">
      <label htmlFor={`${node.id}-timezone`} className="block text-[12px] font-medium text-[#303030]">Timezone</label>
      <input id={`${node.id}-timezone`} className={fieldClass} value={timezone}
        onChange={event => onChange('timezone', event.target.value)} placeholder="Africa/Casablanca"/>
      <p className={noteClass}>IANA timezone, for example Africa/Casablanca or UTC. A backend scheduler must apply this timezone.</p>
    </div>
  </div>
}

export function ScheduleSettings({ node, onChange, studio }: WorkflowNodeParametersProps) {
  const settings = node.settings
  const grace = Number(settings.missed_execution_grace_period ?? 0)
  const policy = valueText(settings.missed_execution_policy) || 'skip'
  const controlClass = `${fieldClass} cursor-pointer`
  const retry = (node.retry_limit ?? 0) > 0
  const switchRow = (label: string, value: boolean, handler: (next: boolean) => void, disabled = false) =>
    <label className={`flex cursor-pointer flex-col gap-2 text-[12px] font-medium text-[#292929] ${disabled ? 'opacity-50' : ''}`}>
      {label}
      <span className="relative inline-flex h-[21px] w-[38px] items-center">
        <input type="checkbox" className="peer sr-only" checked={value} disabled={disabled} onChange={event => handler(event.target.checked)} />
        <span className={`absolute inset-0 rounded-full transition-colors ${value ? 'bg-[#8756ef]' : 'bg-[#c2c2c2]'} peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-violet-500`} />
        <span className={`absolute left-[3px] size-[15px] rounded-full bg-white shadow-sm transition-transform ${value ? 'translate-x-[17px]' : ''}`} />
      </span>
    </label>
  return <div className="space-y-5" data-schedule-settings>
    <div className="space-y-1.5">
      <label htmlFor={`${node.id}-missed`} className="text-[12px] font-medium text-[#292929]">If Execution Is Missed</label>
      <select id={`${node.id}-missed`} className={controlClass} value={policy} onChange={event => onChange('missed_execution_policy', event.target.value)}>
        <option value="skip">Don't Run Missed Executions</option>
        <option value="run_once">Run Once After a Missed Execution</option>
      </select>
      <p className={noteClass}>Saved for a future scheduler. Does not change execution until the backend supports missed runs.</p>
    </div>
    <div className="space-y-1.5">
      <label htmlFor={`${node.id}-grace`} className="text-[12px] font-medium text-[#292929]">Missed Execution Grace Period (Seconds)</label>
      <input id={`${node.id}-grace`} type="number" className={fieldClass} min={0} max={86400} value={Number.isFinite(grace) ? grace : 0}
        onChange={event => onChange('missed_execution_grace_period', Math.max(0, Math.min(86400, Number(event.target.value) || 0)))}/>
    </div>
    {switchRow('Always Output Data', false, () => {}, true)}
    {switchRow('Execute Once', false, () => {}, true)}
    {switchRow('Retry On Fail', retry, enabled => studio?.updateNode(node.id, { retry_limit: enabled ? 1 : 0 }))}
    {retry && <div className="space-y-1.5"><label htmlFor={`${node.id}-retries`} className="text-[12px] font-medium text-[#292929]">Maximum retries</label>
      <input id={`${node.id}-retries`} type="number" min={1} max={5} className={fieldClass} value={node.retry_limit ?? 1}
        onChange={event => studio?.updateNode(node.id, { retry_limit: Math.max(1, Math.min(5, Number(event.target.value) || 1)) })}/></div>}
    <div className="space-y-1.5"><label htmlFor={`${node.id}-error`} className="text-[12px] font-medium text-[#292929]">On Error</label>
      <select id={`${node.id}-error`} className={controlClass} value="stop" disabled><option value="stop">Stop Workflow</option></select>
    </div>
    <div className="space-y-1.5"><label htmlFor={`${node.id}-notes`} className="text-[12px] font-medium text-[#292929]">Notes</label>
      <textarea id={`${node.id}-notes`} rows={5} className={`${fieldClass} min-h-[110px] resize-y`} value={valueText(settings.__cliptora_ui_notes)}
        onChange={event => onChange('__cliptora_ui_notes', event.target.value)}/>
    </div>
    {switchRow('Display Note in Flow?', settings.__cliptora_ui_note_visible === true,
      value => onChange('__cliptora_ui_note_visible', value))}
    <p className="flex items-start gap-2 border-t border-[#e8e8e8] pt-3 text-[11px] leading-5 text-[#777]"><AlertTriangle size={15} className="mt-0.5 shrink-0"/>
      Scheduler-specific missed-execution policies are settings only until a backend scheduler is connected.
    </p>
  </div>
}

const node: WorkflowNodeUI = {
  type: 'n8n.schedule.schedule-trigger',
  Icon: CalendarClock,
  Parameters: ScheduleParameters,
  Settings: ScheduleSettings,
}
export default node
