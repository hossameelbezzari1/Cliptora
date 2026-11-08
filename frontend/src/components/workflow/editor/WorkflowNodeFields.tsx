
import {
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import {
  Check,
  ChevronDown,
  MoreVertical,
  RotateCcw,
} from 'lucide-react'
import { modelsForGeminiAction } from '../geminiModels'
import { modelsForOpenAIAction } from '../openAIModels'

export type FieldSchema = {
  type?: string
  title?: string
  description?: string
  enum?: unknown[]
  default?: unknown
  format?: string
  minimum?: number
  maximum?: number
}

type FieldMode = 'fixed' | 'expression'

export const inputClass =
  'min-h-10 w-full rounded-lg border border-[#dedede] dark:border-[#374151] bg-white dark:bg-cl-dark-panel px-3 py-2 text-[13px] text-[#272727] dark:text-[#f3f4f6] outline-none transition-colors focus:border-[#9461fc] focus:ring-2 focus:ring-[#9461fc]/10 disabled:bg-[#f7f7f7] dark:disabled:bg-[#1f2937] disabled:text-[#4b5563] dark:disabled:text-[#999]'

export const lightButton =
  'inline-flex min-h-9 items-center justify-center gap-1.5 rounded-full border border-[#e3e3e3] dark:border-[#374151] bg-white dark:bg-cl-dark-panel px-3 text-xs font-medium text-[#202020] dark:text-[#f3f4f6] shadow-sm transition-colors hover:bg-[#f5f5f5] dark:hover:bg-[#1f2937] disabled:cursor-not-allowed disabled:opacity-45'

export const getObject = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}

export const isExcel = (value: string) =>
  /excel|workbook/i.test(value)

export const titleize = (name: string) =>
  name.replace(/[_-]/g, ' ').replace(/\b\w/g, s => s.toUpperCase())

export const formatJSON = (value: unknown) =>
  JSON.stringify(value ?? null, null, 2)

const isExpression = (value: unknown): value is string =>
  typeof value === 'string' &&
  /^\s*\{\{[\s\S]*\}\}\s*$/.test(value)

function defaultValue(schema?: FieldSchema): unknown {
  if (schema?.default !== undefined) return schema.default

  if (schema?.type === 'boolean') return false
  if (schema?.type === 'array') return []
  if (schema?.type === 'object') return {}
  if (schema?.type === 'number' || schema?.type === 'integer') {
    return null
  }

  return ''
}

export function SectionLabel({
  children,
}: {
  children: ReactNode
}) {
  return (
    <p className="mb-2 text-[13px] font-medium text-[#303030] dark:text-[#f3f4f6]">
      {children}
    </p>
  )
}

function FieldToolbar({
  label,
  mode,
  onModeChange,
  onReset,
}: {
  label: string
  mode: FieldMode
  onModeChange: (mode: FieldMode) => void
  onReset: () => void
}) {
  const [menuOpen, setMenuOpen] = useState(false)

  return (
    <div className="mb-2 flex min-w-0 flex-wrap items-center justify-between gap-2">
      <span className="min-w-0 text-[13px] font-medium text-[#303030] dark:text-[#f3f4f6]">
        {label}
      </span>

      <div className="flex items-center gap-1">
        <div className="relative">
          <button
            type="button"
            aria-label={`Options for ${label}`}
            aria-expanded={menuOpen}
            title="Field options"
            onClick={() => setMenuOpen(!menuOpen)}
            className={`flex size-8 items-center justify-center rounded-full transition-colors ${
              menuOpen
                ? 'bg-[#e7e7e7] text-[#222] dark:bg-[#4b5563] dark:text-white'
                : 'text-[#666] hover:bg-[#eeeeee] dark:text-[#cbd5e1] dark:hover:bg-[#374151]'
            }`}
          >
            <MoreVertical size={18} />
          </button>

          {menuOpen && (
            <>
              <button
                type="button"
                aria-label="Close field menu"
                className="fixed inset-0 z-40 cursor-default"
                onClick={() => setMenuOpen(false)}
              />

              <div className="absolute right-0 top-10 z-50 min-w-[180px] overflow-hidden rounded-xl border border-[#e2e2e2] bg-white p-1.5 shadow-[0_8px_28px_#0000001a] dark:border-[#374151] dark:bg-[#252b36]">
                <button
                  type="button"
                  onClick={() => {
                    onReset()
                    setMenuOpen(false)
                  }}
                  className="flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-left text-[13px] text-[#333] hover:bg-[#f4f4f5] dark:text-[#e5e7eb] dark:hover:bg-[#374151]"
                >
                  <RotateCcw size={15} />
                  Reset Value
                </button>
              </div>
            </>
          )}
        </div>

        <div className="inline-flex h-9 items-center rounded-xl bg-[#ededed] p-[3px] dark:bg-[#303746]">
          {(['fixed', 'expression'] as const).map(item => (
            <button
              key={item}
              type="button"
              aria-pressed={mode === item}
              onClick={() => onModeChange(item)}
              className={`h-[30px] rounded-[9px] px-3 text-[12px] font-medium transition-all ${
                mode === item
                  ? 'bg-white text-[#222] shadow-sm dark:bg-[#4b5563] dark:text-white'
                  : 'text-[#656565] hover:text-[#222] dark:text-[#c4cad4] dark:hover:text-white'
              }`}
            >
              {item === 'fixed' ? 'Fixed' : 'Expression'}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

function ExpressionEditor({
  value,
  onChange,
  multiline = false,
}: {
  value: unknown
  onChange: (value: string) => void
  multiline?: boolean
}) {
  const current = typeof value === 'string' ? value : ''

  return (
    <div className="overflow-hidden rounded-lg border border-[#c5b0fc] bg-white focus-within:ring-2 focus-within:ring-violet-500/10 dark:border-[#7955ba] dark:bg-cl-dark-panel">
      <div className="flex items-center justify-between border-b border-[#eee8fa] bg-[#faf7ff] px-3 py-1.5 dark:border-[#47375e] dark:bg-[#30263e]">
        <span className="font-mono text-[11px] font-semibold text-[#8651d5] dark:text-[#c4a5ff]">
          fx Expression
        </span>

        <span className="text-[10px] text-[#96909e] dark:text-[#b2a7c5]">
          Dynamic value
        </span>
      </div>

      {multiline ? (
        <textarea
          rows={4}
          spellCheck={false}
          aria-label="Expression"
          className="min-h-[100px] w-full resize-y bg-transparent px-3 py-2.5 font-mono text-[12px] leading-5 text-[#333] outline-none dark:text-[#f3f4f6]"
          placeholder="{{ $json.field }}"
          value={current}
          onChange={event => onChange(event.target.value)}
        />
      ) : (
        <input
          type="text"
          spellCheck={false}
          aria-label="Expression"
          className="min-h-10 w-full bg-transparent px-3 py-2 font-mono text-[12px] text-[#333] outline-none dark:text-[#f3f4f6]"
          placeholder="{{ $json.field }}"
          value={current}
          onChange={event => onChange(event.target.value)}
        />
      )}

      <div className="border-t border-[#efefef] px-3 py-2 text-[11px] text-[#888] dark:border-[#374151] dark:text-[#aeb5c1]">
        Reference data from previous nodes using expressions.
      </div>
    </div>
  )
}

function useFieldMode(
  value: unknown,
  fallback: unknown,
  onChange: (value: unknown) => void,
) {
  const [mode, setMode] = useState<FieldMode>(
    isExpression(value) ? 'expression' : 'fixed',
  )

  const fixedValueRef = useRef<unknown>(
    isExpression(value) ? fallback : value ?? fallback,
  )

  useEffect(() => {
    if (isExpression(value)) {
      setMode('expression')
    } else if (mode === 'fixed') {
      fixedValueRef.current = value ?? fallback
    }
  }, [value, fallback, mode])

  const changeMode = (next: FieldMode) => {
    if (next === mode) return

    if (next === 'expression') {
      fixedValueRef.current = value ?? fallback
      setMode('expression')
      onChange('{{  }}')
      return
    }

    setMode('fixed')
    onChange(fixedValueRef.current ?? fallback)
  }

  const reset = () => {
    fixedValueRef.current = fallback
    setMode('fixed')
    onChange(fallback)
  }

  return { mode, changeMode, reset }
}

export function JsonField({
  label,
  value,
  onChange,
}: {
  label: string
  value: unknown
  onChange: (value: unknown) => void
}) {
  const fallback = {}
  const { mode, changeMode, reset } = useFieldMode(
    value,
    fallback,
    onChange,
  )

  const [draft, setDraft] = useState(() => formatJSON(value))
  const [error, setError] = useState('')

  useEffect(() => {
    setDraft(formatJSON(value))
    setError('')
  }, [value])

  const commit = () => {
    try {
      onChange(JSON.parse(draft) as unknown)
      setError('')
    } catch {
      setError('Invalid JSON — fix it before saving.')
    }
  }

  return (
    <div className="block min-w-0">
      <FieldToolbar
        label={label}
        mode={mode}
        onModeChange={changeMode}
        onReset={reset}
      />

      {mode === 'expression' ? (
        <ExpressionEditor
          value={value}
          onChange={onChange}
          multiline
        />
      ) : (
        <>
          <textarea
            rows={5}
            aria-label={label}
            spellCheck={false}
            className={`${inputClass} resize-y font-mono text-[11px]`}
            value={draft}
            onChange={event => setDraft(event.target.value)}
            onBlur={commit}
          />

          {error && (
            <span
              role="alert"
              className="mt-1 block text-[11px] text-red-600 dark:text-red-300"
            >
              {error}
            </span>
          )}
        </>
      )}
    </div>
  )
}

export function DynamicField({
  name,
  schema,
  value,
  onChange,
}: {
  name: string
  schema?: FieldSchema
  value: unknown
  onChange: (value: unknown) => void
}) {
  const label = schema?.title ?? titleize(name)

  const type = schema?.type ?? (
    typeof value === 'number'
      ? 'number'
      : typeof value === 'boolean'
        ? 'boolean'
        : typeof value === 'object' && value !== null
          ? 'object'
          : 'string'
  )

  const fallback = defaultValue(schema)
  const effective = value ?? fallback

  const { mode, changeMode, reset } = useFieldMode(
    value,
    fallback,
    onChange,
  )

  const description = schema?.description && (
    <span className="mt-1 block text-[11px] leading-4 text-[#888] dark:text-[#b8bec7]">
      {schema.description}
    </span>
  )

  // Objects and arrays use their own JSON editor.
  if (type === 'object' || type === 'array') {
    return (
      <div>
        <JsonField
          label={label}
          value={effective ?? (type === 'array' ? [] : {})}
          onChange={onChange}
        />
        {description}
      </div>
    )
  }

  const showExpression = mode === 'expression'

  const toolbar = (
    <FieldToolbar
      label={label}
      mode={mode}
      onModeChange={changeMode}
      onReset={reset}
    />
  )

  const expressionControl = (
    <ExpressionEditor
      value={value}
      onChange={onChange}
      multiline={['prompt', 'system_prompt'].includes(name)}
    />
  )

  if (schema?.enum?.length) {
    return (
      <div className="min-w-0">
        {toolbar}

        {showExpression ? expressionControl : (
          <div className="relative">
            <select
              aria-label={label}
              className={`${inputClass} appearance-none pr-10`}
              value={String(effective ?? '')}
              onChange={event => {
                onChange(
                  schema.enum?.find(
                    option => String(option) === event.target.value,
                  ) ?? event.target.value,
                )
              }}
            >
              <option value="">Choose…</option>

              {schema.enum.map(option => (
                <option key={String(option)} value={String(option)}>
                  {titleize(String(option))}
                </option>
              ))}
            </select>

            <ChevronDown
              size={16}
              className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[#888]"
            />
          </div>
        )}

        {description}
      </div>
    )
  }

  if (type === 'boolean') {
    return (
      <div className="min-w-0">
        {toolbar}

        {showExpression ? expressionControl : (
          <div className="flex min-h-10 items-center gap-3">
            <button
              type="button"
              role="switch"
              aria-label={label}
              aria-checked={Boolean(effective)}
              onClick={() => onChange(!effective)}
              className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${
                effective
                  ? 'bg-[#9461fc]'
                  : 'bg-[#e9edf2] dark:bg-[#555f6e]'
              }`}
            >
              <span className={`absolute left-[3px] top-[3px] size-[18px] rounded-full bg-white shadow-sm transition-transform ${
                effective ? 'translate-x-5' : ''
              }`} />

              {Boolean(effective) && (
                <Check
                  size={10}
                  strokeWidth={3}
                  className="absolute left-[6px] top-[7px] text-violet-600"
                />
              )}
            </button>

            <span className="text-[12px] text-[#777] dark:text-[#aab1bd]">
              {effective ? 'Enabled' : 'Disabled'}
            </span>
          </div>
        )}

        {description}
      </div>
    )
  }

  if (['prompt', 'system_prompt', 'image_urls'].includes(name)) {
    return (
      <div className="min-w-0">
        {toolbar}

        {showExpression ? expressionControl : (
          <textarea
            rows={name === 'system_prompt' ? 3 : 4}
            aria-label={label}
            className={`${inputClass} resize-y`}
            value={String(effective ?? '')}
            placeholder={
              name === 'image_urls'
                ? 'e.g. https://example.com/image.jpeg'
                : name === 'prompt'
                  ? "What's in this image?"
                  : undefined
            }
            onChange={event => onChange(event.target.value)}
          />
        )}

        {description}
      </div>
    )
  }

  const numeric = type === 'number' || type === 'integer'

  return (
    <div className="min-w-0">
      {toolbar}

      {showExpression ? expressionControl : (
        <input
          aria-label={label}
          type={numeric ? 'number' : 'text'}
          min={schema?.minimum}
          max={schema?.maximum}
          step={type === 'integer' ? 1 : undefined}
          className={inputClass}
          value={String(effective ?? '')}
          onChange={event => {
            if (numeric) {
              const raw = event.target.value
              onChange(raw === '' ? null : Number(raw))
            } else {
              onChange(event.target.value)
            }
          }}
        />
      )}

      {description}
    </div>
  )
}

export function ProviderModelField({
  provider,
  action,
  value,
  onChange,
}: {
  provider: 'OpenAI' | 'Gemini'
  action: string
  value: string
  onChange: (value: string) => void
}) {
  const options = provider === 'Gemini'
    ? modelsForGeminiAction(action)
    : modelsForOpenAIAction(action)

  const known = options.some(option => option.id === value)

  const [mode, setMode] = useState<'list' | 'custom'>(
    known ? 'list' : 'custom',
  )

  useEffect(() => {
    setMode(
      options.some(option => option.id === value)
        ? 'list'
        : 'custom',
    )
  }, [action, value])

  const selected = options.find(option => option.id === value)

  return (
    <div className="space-y-2">
      <SectionLabel>Model</SectionLabel>

      <div className="flex overflow-hidden rounded-lg border border-[#dedede] bg-white focus-within:border-[#9461fc] focus-within:ring-2 focus-within:ring-[#9461fc]/10 dark:border-[#374151] dark:bg-cl-dark-panel">
        <select
          aria-label="Model source"
          className="w-[112px] shrink-0 border-0 border-r border-[#e3e3e3] bg-[#fafafa] px-3 text-[12px] outline-none dark:border-[#374151] dark:bg-[#1f2937]"
          value={mode}
          onChange={event => {
            const next = event.target.value as 'list' | 'custom'
            setMode(next)

            if (next === 'list' && options.length > 0) {
              onChange(options[0].id)
            }
          }}
        >
          <option value="list">From list</option>
          <option value="custom">By model ID</option>
        </select>

        {mode === 'list' ? (
          <select
            aria-label={`${provider} model`}
            className="min-h-10 min-w-0 flex-1 border-0 bg-white px-3 py-2 text-[13px] outline-none dark:bg-cl-dark-panel dark:text-white"
            value={known ? value : options[0]?.id ?? ''}
            onChange={event => onChange(event.target.value)}
          >
            {options.map(option => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        ) : (
          <input
            aria-label={`Custom ${provider} model ID`}
            className="min-h-10 min-w-0 flex-1 border-0 bg-transparent px-3 py-2 font-mono text-[12px] outline-none dark:text-white"
            value={value}
            placeholder={
              provider === 'Gemini'
                ? 'Enter Gemini model ID'
                : 'Enter OpenAI model ID'
            }
            onChange={event => onChange(event.target.value)}
          />
        )}
      </div>

      <p className="text-[11px] leading-4 text-[#888] dark:text-[#b8bec7]">
        {selected?.description ??
          `Use an exact model ID available to the configured ${provider} API project.`}
      </p>
    </div>
  )
}
