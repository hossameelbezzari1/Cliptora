
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type ReactNode,
} from 'react'
import { WorkflowExpressionField } from './WorkflowExpressionField'
import {
  ChevronDown,
  ChevronRight,
  GripVertical,
  KeyRound,
  LoaderCircle,
  Plus,
  RefreshCw,
  Trash2,
  X,
} from 'lucide-react'
import { api } from '../../../lib/api'
import { mediaName } from '../../editor/library/mediaLibraryUtils'
import { InspectVideoSourceParameters } from '../InspectVideoPanels'
import { modelsForGeminiAction } from '../geminiModels'
import { modelsForOpenAIAction } from '../openAIModels'
import type { WorkflowNodeParametersProps } from '../nodeTypes'
import {
  DynamicField,
  JsonField,
  getObject,
  titleize,
  type FieldSchema,
} from './WorkflowNodeFields'
import { WorkflowInputSelector } from './WorkflowInputSelector'

type SchemaField = FieldSchema & {
  widget?: 'textarea' | 'model' | 'messages' | 'upstream' | 'json'
  accepts?: string[]
  group?: string
  placeholder?: string
  options?: Array<{ value: string; label: string }>
  visible_if?: Record<string, unknown>
}

type Action = {
  id: string
  label: string
  resource?: string
  icon?: string
}

type Credential = {
  id: number
  name: string
  provider: string
}

type ModelOption = {
  id: string
  label: string
  description?: string
}

type Message = {
  role: string
  text: string
  [key: string]: unknown
}

type Props = WorkflowNodeParametersProps

const hidden = new Set([
  'credential_id',
  'credential',
  'action',
  'operation',
  'source_id',
  'api_key',
  'password',
  'secret',
  'model',
  'model_by_id',
  'resource',
  'filters',
])

const fieldsOf = (value: unknown): Record<string, SchemaField> =>
  getObject(value) as Record<string, SchemaField>

const control =
  'block min-h-[49px] w-full min-w-0 rounded-xl border border-[#dedee1] bg-white px-3.5 py-2.5 text-[14px] text-[#262626] outline-none transition focus:border-[#a78bfa] focus:ring-2 focus:ring-violet-500/10 dark:border-[#414753] dark:bg-cl-dark-panel dark:text-[#f3f4f6]'

const smallButton =
  'grid size-9 shrink-0 place-items-center rounded-lg text-[#666] transition-colors hover:bg-[#f1f1f3] hover:text-[#222] dark:text-[#b8bec7] dark:hover:bg-[#273142] dark:hover:text-white disabled:opacity-40'

const addButton =
  'inline-flex min-h-10 items-center gap-2 rounded-full border border-[#e2e2e5] bg-white px-4 text-[14px] font-medium text-[#343434] shadow-[0_1px_2px_#00000010] transition hover:bg-[#f7f7f8] disabled:cursor-not-allowed disabled:opacity-40 dark:border-[#414753] dark:bg-cl-dark-panel dark:text-white dark:hover:bg-[#283244]'

function Label({ children }: { children: ReactNode }) {
  return (
    <span className="block text-[14px] font-medium text-[#292929] dark:text-[#f3f4f6]">
      {children}
    </span>
  )
}

function resourceOf(item: Action): string {
  if (item.resource?.trim()) return item.resource.trim()
  if (/file_search|search_store/i.test(item.id)) return 'File Search'
  if (/audio|recording|transcrib/i.test(item.id)) return 'Audio'
  if (/video/i.test(item.id)) return 'Video'
  if (/image/i.test(item.id)) return 'Image'
  if (/document/i.test(item.id)) return 'Document'
  if (/media_file/i.test(item.id)) return 'Media File'
  return 'Text'
}

function Toggle({
  label,
  value,
  disabled,
  onChange,
}: {
  label: string
  value: boolean
  disabled?: boolean
  onChange: (next: boolean) => void
}) {
  return (
    <div className="flex items-center gap-3 py-1">
      <button
        type="button"
        role="switch"
        aria-label={label}
        aria-checked={value}
        disabled={disabled}
        onClick={() => onChange(!value)}
        className={`relative h-[26px] w-[48px] shrink-0 rounded-full transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 disabled:opacity-50 ${value
            ? 'bg-[#00c853]'
            : 'bg-[#bdbdbd] dark:bg-[#67707c]'
          }`}
      >
        <span
          className={`absolute left-[3px] top-[3px] size-5 rounded-full bg-white shadow transition-transform ${value ? 'translate-x-[22px]' : ''
            }`}
        />
      </button>

      <span className="text-[14px] text-[#292929] dark:text-[#f3f4f6]">
        {label}
      </span>
    </div>
  )
}

type ScheduleUnit = 'seconds' | 'minutes' | 'hours' | 'days' | 'weeks' | 'months'

type ScheduleRule = Record<string, unknown>

const scheduleUnits: ScheduleUnit[] = [
  'seconds',
  'minutes',
  'hours',
  'days',
  'weeks',
  'months',
]

const scheduleDays = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
]

function scheduleUnit(value: unknown): ScheduleUnit | null {
  if (typeof value !== 'string') return null

  const normalized = value.toLowerCase().replace(/[{}]/g, '').trim()

  return scheduleUnits.find(unit => unit === normalized) ?? null
}

function scheduleDefault(unit: ScheduleUnit): ScheduleRule {
  const rule: ScheduleRule = {
    field: `{{ ${unit} }}`,
  }

  if (unit === 'seconds') rule.secondsInterval = 30
  if (unit === 'minutes') rule.minutesInterval = 5
  if (unit === 'hours') rule.hoursInterval = 1

  if (unit === 'days') {
    rule.daysInterval = 1
    rule.triggerAtHour = 0
    rule.triggerAtMinute = 0
  }

  if (unit === 'weeks') {
    rule.weeksInterval = 1
    rule.triggerAtDay = [1]
    rule.triggerAtHour = 0
    rule.triggerAtMinute = 0
  }

  if (unit === 'months') {
    rule.monthsInterval = 1
    rule.triggerAtDayOfMonth = 1
    rule.triggerAtHour = 0
    rule.triggerAtMinute = 0
  }

  return rule
}

function ScheduleRuleEditor({
  value,
  onChange,
}: {
  value: unknown
  onChange: (next: unknown) => void
}) {
  const [collapsed, setCollapsed] = useState<Record<number, boolean>>({})
  const [showRaw, setShowRaw] = useState(false)

  let parsed: Record<string, unknown> | null = null
  let invalid = false

  try {
    const result = typeof value === 'string'
      ? JSON.parse(value || '{}')
      : value ?? {}

    if (result && typeof result === 'object' && !Array.isArray(result)) {
      parsed = result as Record<string, unknown>
    } else {
      invalid = true
    }
  } catch {
    invalid = true
  }

  const raw = parsed?.interval
  const rules: ScheduleRule[] = Array.isArray(raw)
    ? raw.filter(item => item && typeof item === 'object' && !Array.isArray(item))
    : []

  const unsupported = rules.some(rule => scheduleUnit(rule.field) === null)
  const rawMode = showRaw || invalid || unsupported

  const save = (nextRules: ScheduleRule[]) => {
    const next = {
      ...(parsed ?? {}),
      interval: nextRules,
    }

    onChange(typeof value === 'string' ? JSON.stringify(next, null, 2) : next)
  }

  const changeRule = (index: number, patch: ScheduleRule) => {
    save(rules.map((rule, i) => i === index ? { ...rule, ...patch } : rule))
  }

  const setUnit = (index: number, unit: ScheduleUnit) => {
    const rule = rules[index]
    const old = String(rule.field ?? '')
    const field = old.includes('{{') ? `{{ ${unit} }}` : unit

    const next = scheduleDefault(unit)
    next.field = field

    save(rules.map((item, i) => i === index ? next : item))
  }

  const numeric = (
    rule: ScheduleRule,
    index: number,
    name: string,
    label: string,
    min: number,
    max: number,
    fallback: number,
  ) => {
    const stored = rule[name]
    const current = stored === undefined || stored === null
      ? fallback
      : Number(stored)

    return (
      <label className="block space-y-2">
        <Label>{label}</Label>
        <input
          type="number"
          min={min}
          max={max}
          step={1}
          className={control}
          value={Number.isFinite(current) ? current : fallback}
          onChange={event => {
            if (event.target.value === '') return
            const number = Number(event.target.value)
            if (!Number.isInteger(number)) return
            changeRule(index, { [name]: number })
          }}
          onBlur={() => {
            const number = Number(rule[name] ?? fallback)
            if (number < min || number > max || !Number.isInteger(number)) {
              changeRule(index, { [name]: fallback })
            }
          }}
        />
        <p className="text-[11px] text-[#888] dark:text-[#aab1bd]">
          Must be in range {min}-{max}
        </p>
      </label>
    )
  }

  const addRule = () => {
    save([...rules, scheduleDefault('days')])
    setCollapsed(previous => ({ ...previous, [rules.length]: false }))
  }

  if (rawMode) {
    return (
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <Label>Trigger Rules</Label>
          {!invalid && !unsupported && (
            <button
              type="button"
              className="text-[12px] font-medium text-violet-600 dark:text-violet-300"
              onClick={() => setShowRaw(false)}
            >
              Visual editor
            </button>
          )}
        </div>

        {(invalid || unsupported) && (
          <p className="text-[12px] text-amber-700 dark:text-amber-300">
            This schedule contains custom or unsupported values.
            Raw editing is available to preserve the existing configuration.
          </p>
        )}

        <JsonField
          label="Rule JSON"
          value={value ?? { interval: [] }}
          onChange={onChange}
        />
      </section>
    )
  }

  return (
    <section className="space-y-4">
      <div className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-3 text-[12px] leading-5 text-amber-950 dark:border-amber-700 dark:bg-amber-950/20 dark:text-amber-200">
        This workflow runs automatically according to the configured
        schedule when scheduling is enabled. Use Execute step to test
        the trigger manually.
      </div>

      <div className="flex items-center justify-between">
        <Label>Trigger Rules</Label>
        <button
          type="button"
          className={smallButton}
          title="Add trigger rule"
          aria-label="Add trigger rule"
          onClick={addRule}
        >
          <Plus size={23} />
        </button>
      </div>

      <div className="space-y-3">
        {rules.map((rule, index) => {
          const unit = scheduleUnit(rule.field) ?? 'days'
          const closed = collapsed[index] === true
          const intervalKey = `${unit}Interval`
          const defaults = scheduleDefault(unit)
          const fallback = Number(defaults[intervalKey] ?? 1)

          const maximum = unit === 'seconds' || unit === 'minutes'
            ? 59
            : unit === 'hours'
              ? 23
              : unit === 'days'
                ? 31
                : unit === 'weeks'
                  ? 52
                  : 12

          return (
            <div
              key={`${index}:${unit}`}
              className="overflow-hidden rounded-xl border border-[#e2e2e5] bg-white dark:border-[#414753] dark:bg-cl-dark-panel"
            >
              <div className="flex min-h-12 items-center gap-2 px-3">
                <button
                  type="button"
                  className="flex min-w-0 flex-1 items-center gap-2 text-left text-[13px] font-medium text-[#444] dark:text-white"
                  onClick={() => setCollapsed(previous => ({
                    ...previous,
                    [index]: !previous[index],
                  }))}
                >
                  {closed ? <ChevronRight size={17} /> : <ChevronDown size={17} />}
                  Trigger Interval {index + 1}
                </button>

                <button
                  type="button"
                  className={smallButton}
                  title="Remove rule"
                  aria-label={`Remove rule ${index + 1}`}
                  onClick={() => save(rules.filter((_, i) => i !== index))}
                >
                  <Trash2 size={17} />
                </button>
              </div>

              {!closed && (
                <div className="space-y-4 border-t border-[#ededee] px-3 pb-4 pt-4 dark:border-[#414753]">
                  <label className="block space-y-2">
                    <Label>Trigger Interval</Label>
                    <select
                      className={control}
                      value={unit}
                      onChange={event => setUnit(index, event.target.value as ScheduleUnit)}
                    >
                      {scheduleUnits.map(item => (
                        <option key={item} value={item}>
                          {item.charAt(0).toUpperCase() + item.slice(1)}
                        </option>
                      ))}
                    </select>
                  </label>

                  {numeric(
                    rule,
                    index,
                    intervalKey,
                    `${unit.charAt(0).toUpperCase() + unit.slice(1)} Between Triggers`,
                    1,
                    maximum,
                    fallback,
                  )}

                  {unit === 'weeks' && (
                    <div className="space-y-2">
                      <Label>Trigger on Weekdays</Label>
                      <div className="grid grid-cols-2 gap-2">
                        {scheduleDays.map((day, dayIndex) => {
                          const dayNumber = dayIndex + 1
                          const selected = Array.isArray(rule.triggerAtDay)
                            ? rule.triggerAtDay.map(Number)
                            : [Number(rule.triggerAtDay ?? 1)]

                          return (
                            <label
                              key={day}
                              className="flex items-center gap-2 text-[12px] text-[#444] dark:text-[#e5e7eb]"
                            >
                              <input
                                type="checkbox"
                                checked={selected.includes(dayNumber)}
                                onChange={event => {
                                  const next = event.target.checked
                                    ? [...new Set([...selected, dayNumber])]
                                    : selected.filter(item => item !== dayNumber)

                                  changeRule(index, { triggerAtDay: next })
                                }}
                              />
                              {day}
                            </label>
                          )
                        })}
                      </div>
                    </div>
                  )}

                  {unit === 'months' && numeric(
                    rule,
                    index,
                    'triggerAtDayOfMonth',
                    'Trigger on Day of Month',
                    1,
                    31,
                    1,
                  )}

                  {['days', 'weeks', 'months'].includes(unit) && (
                    <>
                      <label className="block space-y-2">
                        <Label>Trigger at Hour</Label>
                        <select
                          className={control}
                          value={Number(rule.triggerAtHour ?? 0)}
                          onChange={event => changeRule(index, {
                            triggerAtHour: Number(event.target.value),
                          })}
                        >
                          {Array.from({ length: 24 }, (_, hour) => (
                            <option key={hour} value={hour}>
                              {hour === 0
                                ? 'Midnight'
                                : hour === 12
                                  ? 'Noon'
                                  : `${String(hour).padStart(2, '0')}:00`}
                            </option>
                          ))}
                        </select>
                      </label>

                      {numeric(
                        rule,
                        index,
                        'triggerAtMinute',
                        'Trigger at Minute',
                        0,
                        59,
                        0,
                      )}
                    </>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {rules.length === 0 && (
        <div className="rounded-xl border border-dashed border-[#dedee1] px-4 py-6 text-center text-[13px] text-[#888] dark:border-[#414753]">
          No trigger rules configured.
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className={addButton} onClick={addRule}>
          <Plus size={18} />
          Add Rule
        </button>

        <button
          type="button"
          className="text-[12px] text-[#777] underline-offset-2 hover:underline dark:text-[#b8bec7]"
          onClick={() => setShowRaw(true)}
        >
          Edit JSON
        </button>
      </div>
    </section>
  )
}

function MessageEditor({
  node,
  studio,
  inputValue,
  value,
  onChange,
  upstreamPath,
  onUpstreamPathChange,
}: {
  node: Props['node']
  studio: Props['studio']
  inputValue: unknown
  value: unknown
  onChange: (next: Message[]) => void
  upstreamPath: string
  onUpstreamPathChange: (next: string) => void
}) {
  const messages: Message[] = Array.isArray(value)
    ? value.filter(
      (item): item is Message =>
        Boolean(item) &&
        typeof item === 'object' &&
        !Array.isArray(item),
    )
    : []

  const shown = messages.length
    ? messages
    : [{ role: 'user', text: '' }]

  const [closed, setClosed] = useState<Record<number, boolean>>({})
  const dragging = useRef<number | null>(null)

  const update = (index: number, patch: Partial<Message>) =>
    onChange(
      shown.map((message, i) =>
        i === index
          ? { ...message, ...patch }
          : message,
      ),
    )

  const add = () => {
    if (shown.length >= 30) return

    onChange([...shown, { role: 'user', text: '' }])

    setClosed(previous => ({
      ...previous,
      [shown.length]: false,
    }))
  }

  const move = (target: number) => {
    const from = dragging.current
    dragging.current = null

    if (
      from === null ||
      from === target ||
      from >= shown.length
    ) return

    const next = [...shown]
    const [item] = next.splice(from, 1)
    next.splice(target, 0, item)

    onChange(next)
  }

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <Label>Messages</Label>

        <button
          type="button"
          aria-label="Add message"
          title="Add message"
          disabled={shown.length >= 30}
          onClick={add}
          className={smallButton}
        >
          <Plus size={25} strokeWidth={1.8} />
        </button>
      </div>

      <div className="space-y-3">
        {shown.map((message, index) => {
          const legacyExpression = message.mode === undefined &&
            Boolean(upstreamPath) &&
            !String(message.text ?? '').trim()
          const messageMode = message.mode === 'expression' || legacyExpression
            ? 'expression'
            : 'fixed'
          const messagePath = typeof message.input_path === 'string'
            ? message.input_path
            : (messageMode === 'expression' ? upstreamPath : '')

          return (
          <div
            key={`${node.id}-message-${index}`}
            className="overflow-hidden rounded-[15px] border border-[#e2e2e5] bg-white dark:border-[#414753] dark:bg-cl-dark-panel"
            onDragOver={(event: DragEvent<HTMLDivElement>) =>
              event.preventDefault()
            }
            onDrop={(event: DragEvent<HTMLDivElement>) => {
              event.preventDefault()
              move(index)
            }}
          >
            <div className="flex min-h-[53px] items-center gap-2 px-3">
              <button
                type="button"
                aria-expanded={!closed[index]}
                onClick={() =>
                  setClosed(previous => ({
                    ...previous,
                    [index]: !previous[index],
                  }))
                }
                className="flex min-w-0 flex-1 items-center gap-2 text-left text-[14px] font-medium text-[#555] dark:text-[#ececf0]"
              >
                {closed[index] ? (
                  <ChevronRight size={17} />
                ) : (
                  <ChevronDown size={17} />
                )}
                Values {index + 1}
              </button>

              <button
                type="button"
                title="Delete message"
                aria-label={`Delete message ${index + 1}`}
                className={smallButton}
                onClick={() =>
                  onChange(
                    shown.filter((_, i) => i !== index),
                  )
                }
              >
                <Trash2 size={19} />
              </button>

              <button
                type="button"
                title="Drag to reorder messages"
                aria-label={`Drag message ${index + 1}`}
                className={`${smallButton} cursor-grab active:cursor-grabbing`}
                draggable={shown.length > 1}
                onDragStart={event => {
                  dragging.current = index
                  event.dataTransfer.effectAllowed = 'move'
                }}
                onDragEnd={() => {
                  dragging.current = null
                }}
              >
                <GripVertical size={19} />
              </button>
            </div>

            {!closed[index] && (
              <div className="space-y-4 px-4 pb-4 pt-2">
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <Label>Prompt</Label>

                    <div className="flex rounded-lg bg-[#e8e8e8] p-[3px] dark:bg-[#303746]">
                      {(['Fixed', 'Expression'] as const).map(
                        mode => (
                          <button
                            key={mode}
                            type="button"
                            aria-pressed={
                              messageMode === mode.toLowerCase()
                            }
                            onClick={() => update(index, {
                              mode: mode.toLowerCase(),
                              ...(mode === 'Expression' && !message.input_path
                                ? { input_path: upstreamPath }
                                : {}),
                            })}
                            className={`rounded-md px-2.5 py-1.5 text-[11px] transition-colors ${messageMode === mode.toLowerCase()
                                ? 'bg-white text-[#222] shadow-sm dark:bg-[#4a5567] dark:text-white'
                                : 'text-[#555] dark:text-[#c9ced7]'
                              }`}
                          >
                            {mode}
                          </button>
                        ),
                      )}
                    </div>
                  </div>

                  {messageMode === 'expression' ? (
                    <div className="rounded-lg border border-[#e6e6e9] p-3 dark:border-[#414753]">
                      <WorkflowInputSelector
                        node={node}
                        studio={studio}
                        inputValue={inputValue}
                        kind="text"
                        value={messagePath}
                        onChange={path => {
                          update(index, {
                            mode: 'expression',
                            input_path: path,
                          })
                          onUpstreamPathChange('')
                        }}
                      />

                      <p className="mt-2 text-[11px] leading-4 text-[#888] dark:text-[#b8bec7]">
                        The selected upstream value becomes this
                        message at execution time. Auto prefers
                        compact highlights, then uses the only
                        connected upstream node.
                      </p>
                    </div>
                  ) : (
                    <textarea
                      aria-label={`Message ${index + 1} prompt`}
                      className={`${control} min-h-[100px] resize-y`}
                      rows={4}
                      placeholder="e.g. Hello, how can you help me?"
                      value={String(message.text ?? '')}
                      onChange={event =>
                        update(index, {
                          text: event.target.value,
                        })
                      }
                    />
                  )}
                </div>

                <label className="block space-y-2">
                  <Label>Role</Label>

                  <select
                    aria-label={`Message ${index + 1} role`}
                    className={control}
                    value={String(message.role ?? 'user')}
                    onChange={event =>
                      update(index, {
                        role: event.target.value,
                      })
                    }
                  >
                    <option value="user">User</option>
                    <option value="model">Model</option>
                    <option value="system">System</option>
                  </select>
                </label>
              </div>
            )}
          </div>
          )
        })}
      </div>

      <button
        type="button"
        className={addButton}
        disabled={shown.length >= 30}
        onClick={add}
      >
        <Plus size={19} />
        Add Message
      </button>
    </section>
  )
}

function FieldWidget({
  name,
  field,
  value,
  onChange,
  node,
  studio,
  inputValue,
}: {
  name: string
  field: SchemaField
  value: unknown
  onChange: (next: unknown) => void
  node: Props['node']
  studio: Props['studio']
  inputValue: unknown
}) {
  const title = field.title ?? titleize(name)

  if (field.widget === 'upstream') {
    return (
      <WorkflowInputSelector
        node={node}
        studio={studio}
        inputValue={inputValue}
        kind={
          field.accepts?.includes('media')
            ? 'media'
            : 'text'
        }
        value={typeof value === 'string' ? value : ''}
        onChange={onChange}
      />
    )
  }

  if (field.widget === 'messages') {
    return (
      <MessageEditor
        node={node}
        studio={studio}
        inputValue={inputValue}
        value={value}
        onChange={onChange}
        upstreamPath=""
        onUpstreamPathChange={() => { }}
      />
    )
  }

  if (field.widget === 'json') {
    return (
      <JsonField
        label={title}
        value={value ?? field.default ?? {}}
        onChange={onChange}
      />
    )
  }

  if (field.widget === 'textarea') {
    return (
      <label className="block space-y-2">
        <Label>{title}</Label>

        <textarea
          rows={4}
          className={`${control} min-h-[100px] resize-y`}
          placeholder={field.placeholder ?? ''}
          value={String(value ?? field.default ?? '')}
          onChange={event =>
            onChange(event.target.value)
          }
        />

        {field.description && (
          <span className="block text-[11px] text-[#888]">
            {field.description}
          </span>
        )}
      </label>
    )
  }

  if (field.options?.length) {
    return (
      <WorkflowExpressionField
        label={title}
        type="select"
        options={field.options}
        value={value ?? field.default ?? field.options[0].value}
        defaultValue={field.default ?? field.options[0].value}
        inputData={inputValue}
        onChange={onChange}
        description={field.description}
      />
    )
  }

  return (
    <DynamicField
      name={name}
      schema={field}
      value={value}
      onChange={onChange}
    />
  )
}

export function WorkflowSchemaParameters({
  node,
  catalog,
  onChange,
  studio,
  inputValue,
  onManageCredentials,
  hasAgentModel,
}: WorkflowNodeParametersProps) {
  const settings = node.settings
  const configuredProvider = String(settings.provider ?? '').toLowerCase()
  const provider = node.type === 'ai.batch'
    ? (configuredProvider === 'gemini' || configuredProvider === 'openai'
      ? configuredProvider
      : '')
    : catalog?.credentials?.[0] ?? ''

  const [credentials, setCredentials] = useState<Credential[]>([])
  const [credentialsError, setCredentialsError] = useState('')
  const [credentialName, setCredentialName] =
    useState('My AI Connection')
  const [apiSecret, setApiSecret] = useState('')
  const [connectOpen, setConnectOpen] = useState(false)
  const [connecting, setConnecting] = useState(false)
  const [credentialNotice, setCredentialNotice] = useState('')

  const [models, setModels] = useState<string[]>([])
  const [modelsError, setModelsError] = useState('')
  const [loadingModels, setLoadingModels] = useState(false)
  const [modelMode, setModelMode] =
    useState<'list' | 'id'>('list')

  const [toolPicker, setToolPicker] = useState(false)
  const [optionPicker, setOptionPicker] = useState(false)
  const [addedOptions, setAddedOptions] = useState<string[]>([])

  const uploadRef = useRef<HTMLInputElement>(null)
  const modelRequest = useRef(0)

  const credentialId =
    typeof settings.credential_id === 'number' &&
      settings.credential_id > 0
      ? settings.credential_id
      : null

  const schemas = fieldsOf(
    getObject(catalog?.parameters_schema).properties,
  )

  const actionSchemas = getObject(catalog?.action_parameters)

  const actions: Action[] = (catalog?.actions ?? []).map(
    item =>
      typeof item === 'string'
        ? { id: item, label: titleize(item) }
        : item,
  )

  const actionField =
    Object.prototype.hasOwnProperty.call(settings, 'action') ||
      !Object.prototype.hasOwnProperty.call(settings, 'operation')
      ? 'action'
      : 'operation'

  const action = String(
    settings[actionField] ?? actions[0]?.id ?? '',
  )

  const properties = fieldsOf(actionSchemas[action])
  const fields = { ...schemas, ...properties }

  const resources = [...new Set(actions.map(resourceOf))]

  const resource = resourceOf(
    actions.find(item => item.id === action) ??
    actions[0] ??
    { id: '', label: '' },
  )

  const isGeminiMessage =
    node.type === 'ai.gemini' &&
    action === 'message_model'

  const modelAction =
    node.type === 'ai.batch' ? 'message_model' : action

  const isSource = catalog?.source_picker === true

  const isScheduleTrigger = /schedule|cron/i.test(node.type)

  const refreshCredentials = useCallback(async () => {
    if (!provider) return

    try {
      const list = await api<Credential[]>('/credentials')

      setCredentials(
        list.filter(item => item.provider === provider),
      )
      setCredentialsError('')
    } catch (error) {
      setCredentialsError(
        error instanceof Error
          ? error.message
          : String(error),
      )
    }
  }, [provider])

  const refreshModels = useCallback(async () => {
    const request = ++modelRequest.current

    setModels([])
    setModelsError('')

    if (!credentialId || !provider) {
      setLoadingModels(false)
      return
    }

    setLoadingModels(true)

    try {
      const result = await api<{ models: string[] }>(
        `/credentials/${credentialId}/models`,
      )

      if (request !== modelRequest.current) return

      setModels([
        ...new Set(
          (Array.isArray(result.models) ? result.models : [])
            .filter(
              (id): id is string =>
                typeof id === 'string',
            )
            .map(id =>
              id.replace(/^models\//, '').trim(),
            )
            .filter(Boolean),
        ),
      ])
    } catch (error) {
      if (request === modelRequest.current) {
        setModelsError(
          error instanceof Error
            ? error.message
            : String(error),
        )
      }
    } finally {
      if (request === modelRequest.current) {
        setLoadingModels(false)
      }
    }
  }, [credentialId, provider])

  useEffect(() => {
    void refreshCredentials()
  }, [refreshCredentials])

  useEffect(() => {
    void refreshModels()

    return () => {
      modelRequest.current += 1
    }
  }, [refreshModels])

  const connect = async () => {
    if (
      connecting ||
      !provider ||
      apiSecret.trim().length < 8 ||
      credentialName.trim().length < 2
    ) return

    setConnecting(true)
    setCredentialsError('')

    try {
      const created = await api<Credential>('/credentials', {
        method: 'POST',
        body: JSON.stringify({
          provider,
          name: credentialName.trim(),
          data:
            provider === 'ollama'
              ? { base_url: apiSecret.trim() }
              : { api_key: apiSecret.trim() },
        }),
      })

      setCredentials(previous => [
        created,
        ...previous,
      ])

      onChange('credential_id', created.id)

      setCredentialNotice(
        'Connection saved. Save the workflow to persist this selection.',
      )

      setApiSecret('')
      setConnectOpen(false)
    } catch (error) {
      setCredentialsError(
        error instanceof Error
          ? error.message
          : String(error),
      )
    } finally {
      setConnecting(false)
    }
  }

  const updateModel = (id: string) => {
    const model = id.replace(/^models\//, '')

    if (studio && node.type === 'ai.gemini') {
      studio.updateNode(node.id, {
        settings: {
          ...settings,
          model,
          model_by_id: '',
        },
      })
    } else {
      onChange('model', model)
    }
  }

  const currentModel = String(
    settings.model_by_id ||
    settings.model ||
    fields.model?.default ||
    '',
  ).replace(/^models\//, '')

  const suggestedModels = useMemo((): ModelOption[] => {
    if (provider === 'gemini') {
      return modelsForGeminiAction(modelAction).map(item => {
        const id = item.id.replace(/^models\//, '')

        return {
          ...item,
          id,
          label: `models/${id}`,
        }
      })
    }

    if (provider === 'openai') {
      return modelsForOpenAIAction(modelAction)
    }

    return (fields.model?.options ?? []).map(option => ({
      id: option.value,
      label: option.label,
    }))
  }, [provider, modelAction, fields.model])

  const filteredLive = models.filter(
    id =>
      provider !== 'gemini' ||
      modelAction !== 'message_model' ||
      (
        /^gemini-/i.test(id) &&
        !/(embedding|image|tts|speech|native-audio|live|realtime)/i.test(id)
      ),
  )

  const modelOptions = filteredLive.length
    ? filteredLive.map(id => ({
      id,
      label:
        provider === 'gemini'
          ? `models/${id}`
          : id,
    }))
    : suggestedModels

  const modelList: ModelOption[] =
    currentModel &&
      !modelOptions.some(item => item.id === currentModel)
      ? [
        {
          id: currentModel,
          label: `${provider === 'gemini' ? 'models/' : ''
            }${currentModel} (saved)`,
        },
        ...modelOptions,
      ]
      : modelOptions

  const visible = (field: SchemaField) =>
    !field.visible_if ||
    Object.entries(field.visible_if).every(
      ([name, expected]) => {
        const actual =
          settings[name] ?? fields[name]?.default

        return Array.isArray(expected)
          ? expected.includes(actual)
          : actual === expected
      },
    )

  const names = [
    ...new Set([
      ...Object.keys(fields),
      ...(!actions.length ? Object.keys(settings) : []),
    ]),
  ]
    .filter(
      name =>
        !hidden.has(name) &&
        !name.startsWith('__'),
    )
    .filter(
      name =>
        !actions.length ||
        name in properties ||
        (name in schemas && name !== 'prompt'),
    )
    .filter(name => visible(fields[name] ?? {}))

  const extraMain = new Set([
    'messages',
    'simplify_output',
    'output_content_as_json',
    'built_in_tools',
  ])

  const optionCandidates = names.filter(
    name => !extraMain.has(name),
  )

  const otherMain = !isGeminiMessage
    ? names.filter(
      name => fields[name]?.group !== 'Advanced' && !(isScheduleTrigger && name === 'rule'),
    )
    : []

  const optionNames = isGeminiMessage
    ? optionCandidates
    : names.filter(
      name => fields[name]?.group === 'Advanced',
    )

  const chosenOptions = [
    ...new Set([
      ...addedOptions,
      ...optionNames.filter(
        name =>
          settings[name] !== undefined &&
          settings[name] !== null &&
          settings[name] !== '' &&
          settings[name] !== fields[name]?.default,
      ),
    ]),
  ].filter(name => optionNames.includes(name))

  const remainingOptions = optionNames.filter(
    name => !chosenOptions.includes(name),
  )

  const tools = Array.isArray(settings.built_in_tools)
    ? settings.built_in_tools.filter(
      (item): item is string =>
        typeof item === 'string',
    )
    : []

  const addOption = (name: string) => {
    setAddedOptions(previous => [
      ...new Set([...previous, name]),
    ])
    setOptionPicker(false)
  }

  const removeOption = (name: string) => {
    setAddedOptions(previous =>
      previous.filter(item => item !== name),
    )
    onChange(name, fields[name]?.default ?? null)
  }

  const addTool = (id: string) => {
    onChange('built_in_tools', [
      ...new Set([...tools, id]),
    ])
    setToolPicker(false)
  }

  return (
    <div
      className="space-y-[27px] pb-6"
      data-schema-generated-parameters
    >
      {isSource && studio && (
        <InspectVideoSourceParameters
          sourceId={studio.sourceId}
          sources={studio.sources}
          mediaOptions={studio.editorMedia
            .filter(media => media.kind === 'video')
            .map(media => ({
              id: media.id,
              label: mediaName(media),
            }))}
          onSourceChange={studio.setSourceId}
          onMediaChange={id => {
            void studio.useMediaSource(id)
          }}
          onUpload={event => {
            void studio.upload(event)
          }}
          uploadRef={uploadRef}
          working={studio.working}
          isSourceNode={node.type === 'core.video_source'}
        />
      )}

      {provider && (
        <section className="space-y-3">
          <Label>Credential</Label>

          {credentials.length === 0 &&
            credentialId === null ? (
            <button
              type="button"
              onClick={() =>
                setConnectOpen(previous => !previous)
              }
              className="inline-flex max-w-full items-center gap-2 rounded-xl border border-[#e1e1e4] bg-white px-3.5 py-2.5 text-left text-[14px] text-[#2e2e2e] transition hover:bg-[#f8f8fa] dark:border-[#414753] dark:bg-cl-dark-panel dark:text-white dark:hover:bg-[#283244]"
            >
              <KeyRound
                size={17}
                className="shrink-0 text-violet-600"
              />

              <span className="truncate">
                Connect to{' '}
                {provider === 'gemini'
                  ? 'Google Gemini (PaLM) API'
                  : `${provider.toUpperCase()} API`}
              </span>
            </button>
          ) : (
            <div className="flex min-w-0 items-center gap-2">
              <select
                aria-label={`${provider} credential`}
                className={`${control} min-w-0 flex-1`}
                value={credentialId ?? ''}
                onChange={event =>
                  onChange(
                    'credential_id',
                    event.target.value
                      ? Number(event.target.value)
                      : null,
                  )
                }
              >
                <option value="">
                  Select a credential…
                </option>

                {credentialId &&
                  !credentials.some(
                    item => item.id === credentialId,
                  ) && (
                    <option value={credentialId}>
                      Credential #{credentialId} (not loaded)
                    </option>
                  )}

                {credentials.map(item => (
                  <option
                    key={item.id}
                    value={item.id}
                  >
                    {item.name}
                  </option>
                ))}
              </select>

              <button
                type="button"
                className={smallButton}
                title="Refresh credentials"
                aria-label="Refresh credentials"
                onClick={() =>
                  void refreshCredentials()
                }
              >
                <RefreshCw size={17} />
              </button>
            </div>
          )}

          <div className="flex items-center gap-4 text-[12px]">
            {(credentials.length > 0 ||
              credentialId !== null) && (
                <button
                  type="button"
                  className="font-medium text-violet-600 dark:text-violet-300"
                  onClick={() =>
                    setConnectOpen(previous => !previous)
                  }
                >
                  {connectOpen ? 'Cancel' : '+ Connect'}
                </button>
              )}

            {onManageCredentials && (
              <button
                type="button"
                onClick={onManageCredentials}
                className="text-[#767676] hover:underline"
              >
                Manage credentials
              </button>
            )}
          </div>

          {connectOpen && (
            <div className="space-y-3 rounded-xl border border-[#e4e4e6] p-3 dark:border-[#414753]">
              <input
                className={control}
                aria-label="Connection name"
                placeholder="Connection name"
                value={credentialName}
                onChange={event =>
                  setCredentialName(event.target.value)
                }
              />

              <input
                className={control}
                aria-label={
                  provider === 'ollama'
                    ? 'Base URL'
                    : 'API key'
                }
                type={
                  provider === 'ollama'
                    ? 'url'
                    : 'password'
                }
                autoComplete="off"
                placeholder={
                  provider === 'ollama'
                    ? 'Ollama base URL'
                    : 'API key'
                }
                value={apiSecret}
                onChange={event =>
                  setApiSecret(event.target.value)
                }
              />

              <button
                type="button"
                className={addButton}
                disabled={
                  connecting ||
                  apiSecret.trim().length < 8
                }
                onClick={() => void connect()}
              >
                {connecting && (
                  <LoaderCircle
                    size={15}
                    className="animate-spin"
                  />
                )}
                Save Connection
              </button>
            </div>
          )}

          {credentialsError && (
            <p
              role="alert"
              className="text-[12px] text-red-600"
            >
              {credentialsError}
            </p>
          )}

          {credentialNotice && (
            <p
              role="status"
              className="text-[12px] text-emerald-700 dark:text-emerald-300"
            >
              {credentialNotice}
            </p>
          )}
        </section>
      )}

      {actions.length > 1 && (
        <>
          <label className="block space-y-3">
            <Label>Resource</Label>

            <select
              className={control}
              value={resource}
              onChange={event => {
                const first = actions.find(
                  item =>
                    resourceOf(item) === event.target.value,
                )

                if (first) {
                  onChange(actionField, first.id)
                }
              }}
            >
              {resources.map(item => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </label>

          <label className="block space-y-3">
            <Label>Operation</Label>

            <select
              className={control}
              value={action}
              onChange={event =>
                onChange(actionField, event.target.value)
              }
            >
              {actions
                .filter(
                  item =>
                    resourceOf(item) === resource,
                )
                .map(item => (
                  <option
                    key={item.id}
                    value={item.id}
                  >
                    {item.label}
                  </option>
                ))}
            </select>
          </label>
        </>
      )}

      {catalog?.credentials?.includes('openai') &&
        node.type === 'ai.agent' &&
        !hasAgentModel && (
          <p
            role="alert"
            className="text-[12px] text-amber-700"
          >
            Connect a Chat Model to its required port.
          </p>
        )}

      {fields.model && visible(fields.model) && (
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <Label>Model</Label>

            {credentialId !== null && (
              <button
                type="button"
                className={smallButton}
                disabled={loadingModels}
                title="Refresh model list"
                aria-label="Refresh models"
                onClick={() => void refreshModels()}
              >
                <RefreshCw
                  size={17}
                  className={
                    loadingModels
                      ? 'animate-spin'
                      : ''
                  }
                />
              </button>
            )}
          </div>

          <div className="flex min-w-0 overflow-hidden rounded-xl border border-[#dedee1] bg-white focus-within:border-violet-400 dark:border-[#414753] dark:bg-cl-dark-panel">
            <select
              aria-label="Model selection mode"
              className="w-[125px] shrink-0 border-r border-[#dedee1] bg-transparent px-3 py-3 text-[13px] text-[#292929] outline-none dark:border-[#414753] dark:text-white"
              value={modelMode}
              onChange={event =>
                setModelMode(
                  event.target.value as 'list' | 'id',
                )
              }
            >
              <option value="list">
                From list
              </option>
              <option value="id">
                By ID
              </option>
            </select>

            {modelMode === 'list' ? (
              <select
                aria-label="Model"
                className="min-h-[49px] min-w-0 flex-1 bg-transparent px-3 text-[13px] text-[#292929] outline-none dark:text-white"
                value={
                  currentModel &&
                    modelList.some(
                      item => item.id === currentModel,
                    )
                    ? currentModel
                    : ''
                }
                onChange={event =>
                  updateModel(event.target.value)
                }
              >
                <option value="" disabled>
                  Select a model…
                </option>

                {modelList.map(model => (
                  <option
                    key={model.id}
                    value={model.id}
                  >
                    {model.label}
                  </option>
                ))}
              </select>
            ) : (
              <input
                aria-label="Model ID"
                className="min-h-[49px] min-w-0 flex-1 bg-transparent px-3 text-[13px] outline-none dark:text-white"
                placeholder="Exact provider model ID"
                value={currentModel}
                onChange={event =>
                  updateModel(event.target.value)
                }
              />
            )}
          </div>

          {loadingModels && (
            <p className="text-[11px] text-[#888]">
              Loading available models…
            </p>
          )}

          {credentialId === null && (
            <p className="text-[11px] text-[#888] dark:text-[#b8bec7]">
              Connect a credential to load the models
              available to your account.
            </p>
          )}

          {modelsError && (
            <p
              role="alert"
              className="text-[11px] text-amber-700 dark:text-amber-300"
            >
              {modelsError}
            </p>
          )}
        </section>
      )}

      {isGeminiMessage && (
        <MessageEditor
          key={`${node.id}:${action}`}
          node={node}
          studio={studio}
          inputValue={inputValue}
          value={settings.messages}
          onChange={messages =>
            onChange('messages', messages)
          }
          upstreamPath={
            typeof settings.input_path === 'string'
              ? settings.input_path
              : ''
          }
          onUpstreamPathChange={path =>
            onChange('input_path', path)
          }
        />
      )}

      {isGeminiMessage && (
        <div className="space-y-5">
          <Toggle
            label="Simplify Output"
            value={settings.simplify_output !== false}
            onChange={next =>
              onChange('simplify_output', next)
            }
          />

          <Toggle
            label="Output Content as JSON"
            value={
              settings.output_content_as_json === true ||
              settings.output_mode === 'json'
            }
            disabled={settings.output_mode === 'json'}
            onChange={next =>
              onChange('output_content_as_json', next)
            }
          />
        </div>
      )}

      {isScheduleTrigger && (
        <WorkflowExpressionField
          label="Trigger Interval"
          type="select"
          options={scheduleUnits.map(item => ({
            value: item,
            label: item.charAt(0).toUpperCase() + item.slice(1),
          }))}
          value={unit}
          defaultValue="days"
          onChange={next => {
            const selected = scheduleUnit(next)

            if (selected) {
              setUnit(index, selected)
            }
          }}
        />
      )}

      {otherMain.map(name => (
        <FieldWidget
          key={`${node.id}:${action}:${name}`}
          name={name}
          field={fields[name] ?? {}}
          value={settings[name]}
          node={node}
          studio={studio}
          inputValue={inputValue}
          onChange={next => {
            if (
              node.type === 'ai.batch' &&
              name === 'provider' &&
              next !== settings.provider
            ) {
              studio.updateNode(node.id, {
                settings: {
                  ...settings,
                  provider: next,
                  credential_id: null,
                  model: '',
                },
              })
            } else {
              onChange(name, next)
            }
          }}
        />
      ))}

      {isGeminiMessage && (
        <section className="space-y-4">
          <div className="flex items-center justify-between border-b border-[#ededee] pb-3 dark:border-[#414753]">
            <Label>Built-in Tools</Label>

            <button
              type="button"
              className={smallButton}
              title="Add built-in tool"
              aria-label="Add built-in tool"
              onClick={() =>
                setToolPicker(previous => !previous)
              }
            >
              <Plus size={23} />
            </button>
          </div>

          {tools.map(id => (
            <div
              key={id}
              className="flex min-h-11 items-center justify-between gap-2 rounded-xl border border-[#e5e5e7] px-3 dark:border-[#414753]"
            >
              <span className="text-[13px] text-[#333] dark:text-white">
                {id === 'google_search'
                  ? 'Google Search'
                  : id === 'code_execution'
                    ? 'Code Execution'
                    : titleize(id)}
              </span>

              <button
                type="button"
                className={smallButton}
                aria-label={`Remove ${id}`}
                onClick={() =>
                  onChange(
                    'built_in_tools',
                    tools.filter(item => item !== id),
                  )
                }
              >
                <Trash2 size={16} />
              </button>
            </div>
          ))}

          {toolPicker && (
            <div className="rounded-xl border border-[#e2e2e5] p-1 dark:border-[#414753]">
              {(
                [
                  ['google_search', 'Google Search'],
                  ['code_execution', 'Code Execution'],
                ] as const
              )
                .filter(([id]) => !tools.includes(id))
                .map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    disabled={
                      settings.output_mode === 'highlights'
                    }
                    onClick={() => addTool(id)}
                    className="block w-full rounded-lg px-3 py-2 text-left text-[13px] hover:bg-[#f4f4f5] disabled:opacity-40 dark:hover:bg-[#263040]"
                  >
                    {label}
                  </button>
                ))}

              {tools.length >= 2 && (
                <p className="px-3 py-2 text-[12px] text-[#888]">
                  All available tools have been added.
                </p>
              )}

              {settings.output_mode === 'highlights' && (
                <p className="px-3 py-2 text-[11px] text-amber-700">
                  Unavailable in Highlights mode.
                </p>
              )}
            </div>
          )}

          <button
            type="button"
            className={addButton}
            onClick={() =>
              setToolPicker(previous => !previous)
            }
          >
            <Plus size={19} />
            Add Built-in Tool
          </button>
        </section>
      )}

      {(isGeminiMessage || optionNames.length > 0) && (
        <section className="space-y-4">
          <div className="flex items-center justify-between border-b border-[#ededee] pb-3 dark:border-[#414753]">
            <Label>
              {isGeminiMessage
                ? 'Options'
                : 'Advanced Options'}
            </Label>

            <button
              type="button"
              className={smallButton}
              title="Add option"
              aria-label="Add option"
              onClick={() =>
                setOptionPicker(previous => !previous)
              }
            >
              <Plus size={23} />
            </button>
          </div>

          {chosenOptions.map(name => (
            <div
              key={`${action}:option:${name}`}
              className="relative rounded-xl border border-[#e7e7e9] p-3 pr-12 dark:border-[#414753]"
            >
              <button
                type="button"
                className={`${smallButton} absolute right-2 top-2`}
                aria-label={`Remove ${titleize(name)} option`}
                onClick={() => removeOption(name)}
              >
                <X size={16} />
              </button>

              <FieldWidget
                name={name}
                field={fields[name] ?? {}}
                value={settings[name]}
                node={node}
                studio={studio}
                inputValue={inputValue}
                onChange={next =>
                  onChange(name, next)
                }
              />
            </div>
          ))}

          {optionPicker && (
            <div className="max-h-48 overflow-y-auto rounded-xl border border-[#e4e4e6] p-1 dark:border-[#414753]">
              {remainingOptions.map(name => (
                <button
                  key={name}
                  type="button"
                  onClick={() => addOption(name)}
                  className="block w-full rounded-lg px-3 py-2 text-left text-[13px] hover:bg-[#f4f4f5] dark:hover:bg-[#263040]"
                >
                  {fields[name]?.title ?? titleize(name)}
                </button>
              ))}

              {remainingOptions.length === 0 && (
                <p className="px-3 py-2 text-[12px] text-[#888]">
                  No more options available for this operation.
                </p>
              )}
            </div>
          )}

          <button
            type="button"
            className={addButton}
            onClick={() =>
              setOptionPicker(previous => !previous)
            }
          >
            <Plus size={19} />
            Add Option
          </button>
        </section>
      )}

      {node.depends_on.length > 0 &&
        !names.some(
          name =>
            fields[name]?.widget === 'upstream',
        ) &&
        !isGeminiMessage && (
          <p className="text-[11px] text-[#888]">
            Connected upstream outputs are passed to
            this node by the workflow engine.
          </p>
        )}
    </div>
  )
}
