
import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  ArrowLeft,
  Check,
  ChevronDown,
  CircleHelp,
  Info,
  MoreVertical,
  RotateCcw,
} from 'lucide-react'
import { getNodeUI } from '../nodeRegistry'
import type { WorkflowStudioState } from '../useWorkflowStudio'
import type { WorkflowNode } from '../workflowTypes'
import { titleize } from './WorkflowNodeFields'

type Choice = {
  value: string
  label: string
  description?: string
}

const selectClass =
  'flex min-h-11 w-full items-center justify-between gap-3 rounded-xl border border-[#dedee1] bg-white px-3.5 py-2.5 text-left text-[13px] text-[#292929] outline-none transition focus:border-violet-500 focus:ring-2 focus:ring-violet-500/10 dark:border-[#414753] dark:bg-cl-dark-panel dark:text-white'

const inputClass =
  'min-h-11 w-full rounded-xl border border-[#dedee1] bg-white px-3.5 py-2.5 text-[13px] text-[#292929] outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-500/10 dark:border-[#414753] dark:bg-cl-dark-panel dark:text-white'

const missedChoices: Choice[] = [
  {
    value: 'most_recent_per_rule',
    label: 'Run the Most Recent Missed Execution Per Rule',
  },
  {
    value: 'most_recent',
    label: 'Run the Most Recent Missed Execution',
  },
  {
    value: 'skip',
    label: "Don't Run Missed Executions",
  },
]

const errorChoices: Choice[] = [
  {
    value: 'stop',
    label: 'Stop Workflow',
    description: 'Halt execution and fail workflow',
  },
  {
    value: 'continue',
    label: 'Continue',
    description: 'Pass error message as item in regular output',
  },
  {
    value: 'continue_error_output',
    label: 'Continue (using error output)',
    description: 'Pass item to an extra error output',
  },
]

function SettingLabel({
  children,
  help,
}: {
  children: ReactNode
  help?: string
}) {
  return (
    <div className="mb-2 flex items-center gap-2">
      <span className="text-[13px] font-medium text-[#292929] dark:text-white">
        {children}
      </span>

      {help && (
        <span className="group/help relative inline-flex">
          <CircleHelp
            size={15}
            className="cursor-help text-[#949494] dark:text-[#aeb5c1]"
          />

          <span className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-2 hidden w-[240px] -translate-x-1/2 rounded-lg bg-[#252525] px-3 py-2 text-[11px] leading-5 text-white shadow-lg group-hover/help:block group-focus-within/help:block">
            {help}
          </span>
        </span>
      )}
    </div>
  )
}

function SettingSelect({
  label,
  value,
  options,
  onChange,
  help,
  defaultValue,
}: {
  label: string
  value: string
  options: Choice[]
  onChange: (value: string) => void
  help?: string
  defaultValue?: string
}) {
  const [open, setOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open && !menuOpen) return

    const close = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !rootRef.current?.contains(event.target)
      ) {
        setOpen(false)
        setMenuOpen(false)
      }
    }

    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false)
        setMenuOpen(false)
      }
    }

    document.addEventListener('pointerdown', close)
    document.addEventListener('keydown', escape)

    return () => {
      document.removeEventListener('pointerdown', close)
      document.removeEventListener('keydown', escape)
    }
  }, [open, menuOpen])

  const selected = options.find(option => option.value === value)

  return (
    <div ref={rootRef} className="group/setting relative min-w-0">
      <div className="flex items-center justify-between gap-2">
        <SettingLabel help={help}>{label}</SettingLabel>

        {defaultValue !== undefined && (
          <div className="relative mb-1">
            <button
              type="button"
              aria-label={`${label} options`}
              title="Field options"
              onClick={() => {
                setMenuOpen(previous => !previous)
                setOpen(false)
              }}
              className="grid size-7 place-items-center rounded-lg text-[#777] opacity-0 transition-opacity group-hover/setting:opacity-100 focus:opacity-100 dark:text-[#b8bec7]"
            >
              <MoreVertical size={17} />
            </button>

            {menuOpen && (
              <div className="absolute right-0 top-8 z-[80] min-w-40 rounded-xl border border-[#e2e2e5] bg-white p-1.5 shadow-lg dark:border-[#414753] dark:bg-[#252b36]">
                <button
                  type="button"
                  className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-[12px] hover:bg-[#f3f3f5] dark:text-white dark:hover:bg-[#374151]"
                  onClick={() => {
                    onChange(defaultValue)
                    setMenuOpen(false)
                  }}
                >
                  <RotateCcw size={14} />
                  Reset Value
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      <button
        type="button"
        role="combobox"
        aria-label={label}
        aria-expanded={open}
        aria-controls={`${label.replace(/\W+/g, '-')}-options`}
        aria-haspopup="listbox"
        onClick={() => {
          setOpen(previous => !previous)
          setMenuOpen(false)
        }}
        className={`${selectClass} ${
          open ? 'border-violet-400 ring-2 ring-violet-500/10' : ''
        }`}
      >
        <span className="min-w-0 flex-1 truncate">
          {selected?.label ?? value}
        </span>

        <ChevronDown
          size={18}
          className={`shrink-0 text-[#777] transition-transform ${
            open ? 'rotate-180' : ''
          }`}
        />
      </button>

      {open && (
        <div
          id={`${label.replace(/\W+/g, '-')}-options`}
          role="listbox"
          aria-label={label}
          className="absolute left-0 right-0 top-full z-[70] mt-2 max-h-[330px] overflow-y-auto rounded-xl border border-[#e2e2e5] bg-white p-1 shadow-[0_12px_35px_#00000020] dark:border-[#414753] dark:bg-[#252b36]"
        >
          {options.map(option => (
            <button
              type="button"
              role="option"
              aria-selected={value === option.value}
              key={option.value}
              onClick={() => {
                onChange(option.value)
                setOpen(false)
              }}
              className={`flex w-full items-start justify-between gap-2 rounded-lg px-3 py-3 text-left transition-colors ${
                value === option.value
                  ? 'bg-[#f1f1f2] dark:bg-[#394252]'
                  : 'hover:bg-[#f5f5f6] dark:hover:bg-[#343b49]'
              }`}
            >
              <span className="min-w-0 flex-1">
                <span className="block text-[13px] font-medium leading-5 text-[#292929] dark:text-white">
                  {option.label}
                </span>

                {option.description && (
                  <span className="mt-1 block text-[11px] leading-5 text-[#858585] dark:text-[#b8bec7]">
                    {option.description}
                  </span>
                )}
              </span>

              {value === option.value && (
                <Check
                  size={16}
                  className="mt-1 shrink-0 text-violet-600 dark:text-violet-300"
                />
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function SettingSwitch({
  label,
  checked,
  onChange,
  disabled = false,
}: {
  label: string
  checked: boolean
  onChange: (value: boolean) => void
  disabled?: boolean
}) {
  return (
    <div className={disabled ? 'opacity-45' : ''}>
      <p className="mb-3 text-[13px] font-medium text-[#292929] dark:text-white">
        {label}
      </p>

      <button
        type="button"
        role="switch"
        aria-label={label}
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`relative h-[26px] w-[48px] rounded-full transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 disabled:cursor-not-allowed ${
          checked
            ? 'bg-[#8750f7]'
            : 'bg-[#edf0f4] dark:bg-[#525c6a]'
        }`}
      >
        <span
          className={`absolute left-[3px] top-[3px] size-5 rounded-full bg-white shadow-sm transition-transform ${
            checked ? 'translate-x-[22px]' : ''
          }`}
        />
      </button>
    </div>
  )
}

function NumberInput({
  label,
  value,
  min,
  max,
  onChange,
  description,
}: {
  label: string
  value: number
  min: number
  max: number
  onChange: (value: number) => void
  description?: string
}) {
  return (
    <div>
      <SettingLabel>{label}</SettingLabel>

      <input
        type="number"
        aria-label={label}
        min={min}
        max={max}
        step={1}
        className={inputClass}
        value={value}
        onChange={event => {
          const raw = event.target.value
          if (!raw.trim()) return

          const number = Number(raw)
          if (!Number.isInteger(number)) return

          onChange(Math.max(min, Math.min(max, number)))
        }}
      />

      {description && (
        <p className="mt-2 text-[11px] leading-5 text-[#858585] dark:text-[#b8bec7]">
          {description}
        </p>
      )}
    </div>
  )
}

function UnsupportedInfo({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-start gap-2 rounded-lg bg-[#f7f7f8] px-3 py-2.5 text-[11px] leading-5 text-[#777] dark:bg-[#29313d] dark:text-[#b8bec7]">
      <Info size={14} className="mt-0.5 shrink-0" />
      <span>{children}</span>
    </div>
  )
}

export function WorkflowNodeSettings({
  studio,
}: {
  studio: WorkflowStudioState
}) {
  const {
    selected,
    nodes,
    catalog,
    updateNode,
    updateSelectedSetting,
  } = studio

  if (!selected) return null

  const isSchedule =
    selected.type === 'core.schedule_trigger' ||
    selected.type === 'n8n.schedule.schedule-trigger'

  const NodeSettings = getNodeUI(selected.type)?.Settings

  // Schedule triggers use the shared settings form.
  // Other node-specific settings remain unchanged.
  if (NodeSettings && !isSchedule) {
    return (
      <NodeSettings
        node={selected}
        catalog={catalog.find(item => item.type === selected.type)}
        onChange={updateSelectedSetting}
        studio={studio}
      />
    )
  }

  const settings = selected.settings
  const retryEnabled = (selected.retry_limit ?? 1) > 0

  const savedPolicy = String(
    settings.missed_execution_policy ?? 'skip',
  )

  const missedPolicy =
    savedPolicy === 'run_once'
      ? 'most_recent'
      : missedChoices.some(option => option.value === savedPolicy)
        ? savedPolicy
        : 'skip'

  const rawGrace =
    settings.missed_execution_grace_period_seconds ??
    settings.missed_execution_grace_period ??
    0

  const grace = Number(rawGrace)

  const savedError = String(
    settings.__cliptora_execution_on_error ??
    settings.on_error ??
    'stop',
  )

  const errorMode = errorChoices.some(
    option => option.value === savedError,
  )
    ? savedError
    : 'stop'

  const notes = String(settings.__cliptora_ui_notes ?? '')
  const showNotes = settings.__cliptora_ui_note_visible === true

  const change = (key: string, value: unknown) => {
    updateSelectedSetting(key, value)
  }

  return (
    <div
      key={selected.id}
      className="space-y-7 pb-8 text-[#292929] dark:text-[#f3f4f6]"
      data-workflow-node-settings
    >
      {isSchedule && (
        <section className="space-y-5">
          <div>
            <SettingSelect
              label="If Execution Is Missed"
              value={missedPolicy}
              options={missedChoices}
              defaultValue="skip"
              help="Applies once an execution is later than the grace period set below."
              onChange={value => {
                change('missed_execution_policy', value)
              }}
            />
          </div>

          <NumberInput
            label="Missed Execution Grace Period (Seconds)"
            value={Number.isFinite(grace) ? grace : 0}
            min={0}
            max={86400}
            onChange={value => {
              change(
                'missed_execution_grace_period_seconds',
                value,
              )
            }}
          />

          <UnsupportedInfo>
            These missed-execution options are saved, but missed-run
            recovery is not yet implemented in the current scheduler.
          </UnsupportedInfo>
        </section>
      )}

      <section className="space-y-6">
        <SettingSwitch
  label="Always Output Data"
  checked={settings.__cliptora_always_output_data === true}
  onChange={value =>
    change('__cliptora_always_output_data', value)
  }
/>

<SettingSwitch
  label="Execute Once"
  checked={settings.__cliptora_execute_once === true}
  onChange={value =>
    change('__cliptora_execute_once', value)
  }
/>

        <SettingSwitch
          label="Retry On Fail"
          checked={retryEnabled}
          onChange={value => {
            updateNode(selected.id, {
              retry_limit: value
                ? Math.max(1, selected.retry_limit ?? 1)
                : 0,
            })
          }}
        />

        {retryEnabled && (
          <NumberInput
            label="Maximum retries"
            value={Math.max(1, selected.retry_limit ?? 1)}
            min={1}
            max={5}
            onChange={value => {
              updateNode(selected.id, {
                retry_limit: value,
              })
            }}
          />
        )}

        <div className="space-y-3">
          <SettingSelect
            label="On Error"
            help="Choose how execution failures should be handled."
            value={errorMode}
            options={errorChoices}
            defaultValue="stop"
            onChange={value => {
              change('__cliptora_execution_on_error', value)
            }}
          />

          {errorMode !== 'stop' && (
            <UnsupportedInfo>
              Continue modes are saved, but execution currently stops
              on unhandled node errors. Backend error routing is
              required to activate this behavior.
            </UnsupportedInfo>
          )}
        </div>
      </section>

      <section className="space-y-5">
        <div>
          <SettingLabel>Notes</SettingLabel>

          <textarea
            rows={5}
            aria-label="Notes"
            placeholder="Add a note about this node..."
            value={notes}
            onChange={event =>
              change('__cliptora_ui_notes', event.target.value)
            }
            className={`${inputClass} min-h-[115px] resize-y py-3 leading-6`}
          />
        </div>

        <SettingSwitch
          label="Display Note in Flow?"
          checked={showNotes}
          onChange={value =>
            change('__cliptora_ui_note_visible', value)
          }
        />
      </section>

      <details className="group rounded-xl border border-[#e7e7e9] bg-[#fafafa] p-3 dark:border-[#414753] dark:bg-[#252b36]">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-2 text-[12px] font-medium text-[#555] dark:text-[#d1d5db] [&::-webkit-details-marker]:hidden">
          Advanced Execution Settings

          <ChevronDown
            size={16}
            className="transition-transform group-open:rotate-180"
          />
        </summary>

        <div className="mt-5 space-y-5">
          <div>
            <SettingLabel>Execution condition</SettingLabel>

            <select
              aria-label="Execution condition"
              className={inputClass}
              value={selected.when}
              onChange={event => {
                updateNode(selected.id, {
                  when: event.target.value as WorkflowNode['when'],
                })
              }}
            >
              {([
                'always',
                'has_video',
                'has_transcript',
                'ai_enabled',
                'condition_true',
                'condition_false',
                'route_0',
                'route_1',
                'route_2',
                'route_3',
                'route_4',
                'route_fallback',
              ] as const).map(value => (
                <option key={value} value={value}>
                  {titleize(value)}
                </option>
              ))}
            </select>
          </div>

          <SettingSwitch
            label="Cache result for retries"
            checked={selected.cache ?? true}
            onChange={value =>
              updateNode(selected.id, { cache: value })
            }
          />

          <div className="space-y-2">
            <SettingLabel>Connected Inputs</SettingLabel>

            {selected.depends_on.length ? (
              selected.depends_on.map(id => {
                const upstream = nodes.find(item => item.id === id)
                const custom = upstream?.settings.__cliptora_ui_label

                const name =
                  typeof custom === 'string' && custom.trim()
                    ? custom.trim()
                    : catalog.find(
                        item => item.type === upstream?.type,
                      )?.label ?? 'Previous node'

                return (
                  <div
                    key={id}
                    className="flex items-center gap-2 rounded-lg border border-[#e7e7e9] bg-white p-2.5 text-[12px] text-[#555] dark:border-[#414753] dark:bg-cl-dark-panel dark:text-[#b8bec7]"
                  >
                    <ArrowLeft size={14} />
                    <span className="truncate">{name}</span>
                  </div>
                )
              })
            ) : (
              <p className="text-[11px] text-[#888] dark:text-[#b8bec7]">
                No previous nodes connected.
              </p>
            )}
          </div>
        </div>
      </details>
    </div>
  )
}
