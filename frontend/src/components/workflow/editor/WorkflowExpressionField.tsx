
import {
  useEffect,
  useRef,
  useState,
  type FocusEvent,
  type ReactNode,
} from 'react'
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Expand,
  MoreVertical,
  RotateCcw,
} from 'lucide-react'

export type ExpressionOption = {
  value: string
  label: string
}

export type WorkflowExpressionFieldProps = {
  label: string
  value: unknown
  onChange: (value: unknown) => void
  defaultValue?: unknown
  type?: 'text' | 'number' | 'integer' | 'select' | 'textarea'
  options?: ExpressionOption[]
  min?: number
  max?: number
  placeholder?: string
  description?: string
  inputData?: unknown
  disabled?: boolean
}

type FieldMode = 'fixed' | 'expression'

const inputClass =
  'min-h-11 w-full min-w-0 rounded-xl border border-[#dedee1] bg-white px-3 text-[13px] text-[#292929] outline-none transition focus:border-violet-400 dark:border-[#414753] dark:bg-cl-dark-panel dark:text-white'

const isExpression = (value: unknown) =>
  typeof value === 'string' &&
  /\{\{[\s\S]*?\}\}/.test(value)

const stringify = (value: unknown): string => {
  if (typeof value === 'string') return value
  if (value === undefined || value === null) return ''
  if (typeof value === 'object') return JSON.stringify(value, null, 2)
  return String(value)
}

function pathValue(source: unknown, path: string): unknown {
  const parts = path
    .replace(/\[(\d+)\]/g, '.$1')
    .split('.')
    .filter(Boolean)

  let current: unknown = source

  for (const part of parts) {
    if (
      part === '__proto__' ||
      part === 'prototype' ||
      part === 'constructor'
    ) return undefined

    if (
      !current ||
      typeof current !== 'object'
    ) return undefined

    current = (current as Record<string, unknown>)[part]
  }

  return current
}

function previewValue(
  expression: string,
  item: unknown,
): { value: string; resolved: boolean } {
  if (!isExpression(expression)) {
    return { value: expression, resolved: true }
  }

  let resolved = true

  const result = expression.replace(
    /\{\{([\s\S]*?)\}\}/g,
    (original, raw: string) => {
      const source = raw.trim()

      if (source === '$json') {
        return item === undefined
          ? (resolved = false, original)
          : stringify(item)
      }

      const match = source.match(
        /^\$json(?:\.([A-Za-z0-9_.-]+)|\[['"]([^'"]+)['"]\])$/,
      )

      if (!match) {
        resolved = false
        return original
      }

      const data = pathValue(item, match[1] ?? match[2])

      if (data === undefined) {
        resolved = false
        return original
      }

      return stringify(data)
    },
  )

  return { value: result, resolved }
}

function itemsFrom(value: unknown): unknown[] {
  if (Array.isArray(value)) return value
  if (value === undefined || value === null) return []
  return [value]
}

function IconButton({
  title,
  children,
  onClick,
  disabled,
}: {
  title: string
  children: ReactNode
  onClick: () => void
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      disabled={disabled}
      onClick={onClick}
      className="grid size-8 shrink-0 place-items-center rounded-lg text-[#777] hover:bg-[#ededf0] hover:text-[#222] disabled:opacity-30 dark:text-[#bbc2cf] dark:hover:bg-[#374151] dark:hover:text-white"
    >
      {children}
    </button>
  )
}

export function WorkflowExpressionField({
  label,
  value,
  onChange,
  defaultValue = '',
  type = 'text',
  options = [],
  min,
  max,
  placeholder,
  description,
  inputData,
  disabled = false,
}: WorkflowExpressionFieldProps) {
  const [mode, setMode] = useState<FieldMode>(
    isExpression(value) ? 'expression' : 'fixed',
  )
  const [menuOpen, setMenuOpen] = useState(false)
  const [hover, setHover] = useState(false)
  const [focused, setFocused] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [itemIndex, setItemIndex] = useState(0)

  const rootRef = useRef<HTMLDivElement>(null)
  const fixedRef = useRef<unknown>(
    isExpression(value) ? defaultValue : value ?? defaultValue,
  )

  const items = itemsFrom(inputData)
  const index = Math.min(itemIndex, Math.max(0, items.length - 1))
  const preview = previewValue(
    stringify(value ?? defaultValue),
    items[index],
  )

  useEffect(() => {
    if (isExpression(value)) setMode('expression')
  }, [value])

  useEffect(() => {
    if (mode === 'fixed') {
      fixedRef.current = value ?? defaultValue
    }
  }, [value, defaultValue, mode])

  const switchMode = (next: FieldMode) => {
    if (next === mode) return

    if (next === 'expression') {
      fixedRef.current = value ?? defaultValue
      setMode('expression')
      onChange(stringify(value ?? defaultValue))
      return
    }

    setMode('fixed')
    setExpanded(false)
    onChange(fixedRef.current ?? defaultValue)
  }

  const reset = () => {
    fixedRef.current = defaultValue
    setMode('fixed')
    setMenuOpen(false)
    setExpanded(false)
    onChange(defaultValue)
  }

  const changeNumeric = (raw: string) => {
    if (raw === '') {
      onChange(null)
      return
    }

    const number = Number(raw)
    if (!Number.isFinite(number)) return
    if (type === 'integer' && !Number.isInteger(number)) return
    onChange(number)
  }

  const blur = (event: FocusEvent<HTMLDivElement>) => {
    const next = event.relatedTarget

    if (
      next instanceof Node &&
      rootRef.current?.contains(next)
    ) return

    setFocused(false)
  }

  const showResult =
    mode === 'expression' && (hover || focused)

  return (
    <div
      ref={rootRef}
      className="group/param relative min-w-0"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onFocusCapture={() => setFocused(true)}
      onBlurCapture={blur}
    >
      <div className="mb-2 flex min-h-8 items-center justify-between gap-2">
        <span className="min-w-0 text-[13px] font-medium text-[#303030] dark:text-[#f3f4f6]">
          {label}
        </span>

        <div
          className={`flex shrink-0 items-center gap-1 transition-opacity duration-150 ${
            hover || focused || menuOpen
              ? 'opacity-100'
              : 'opacity-0'
          }`}
        >
          <div className="relative">
            <IconButton
              title="Field options"
              onClick={() => setMenuOpen(!menuOpen)}
            >
              <MoreVertical size={17} />
            </IconButton>

            {menuOpen && (
              <>
                <button
                  type="button"
                  className="fixed inset-0 z-40 cursor-default"
                  aria-label="Close options"
                  onClick={() => setMenuOpen(false)}
                />

                <div className="absolute right-0 top-9 z-50 min-w-40 rounded-xl border border-[#e2e2e5] bg-white p-1.5 shadow-lg dark:border-[#414753] dark:bg-[#252b36]">
                  <button
                    type="button"
                    onClick={reset}
                    className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-[12px] hover:bg-[#f4f4f6] dark:text-white dark:hover:bg-[#374151]"
                  >
                    <RotateCcw size={15} />
                    Reset Value
                  </button>
                </div>
              </>
            )}
          </div>

          <div className="flex h-8 items-center rounded-lg bg-[#e9e9ea] p-[2px] dark:bg-[#303746]">
            {(['fixed', 'expression'] as const).map(item => (
              <button
                key={item}
                type="button"
                disabled={disabled}
                aria-pressed={mode === item}
                onClick={() => switchMode(item)}
                className={`rounded-md px-2.5 py-1.5 text-[11px] font-medium transition ${
                  mode === item
                    ? 'bg-white text-[#222] shadow-sm dark:bg-[#4b5563] dark:text-white'
                    : 'text-[#666] dark:text-[#c6ccd6]'
                }`}
              >
                {item === 'fixed' ? 'Fixed' : 'Expression'}
              </button>
            ))}
          </div>
        </div>
      </div>

      {mode === 'fixed' ? (
        type === 'select' ? (
          <div className="relative">
            <select
              aria-label={label}
              disabled={disabled}
              className={`${inputClass} appearance-none pr-10`}
              value={stringify(value ?? defaultValue)}
              onChange={event => onChange(event.target.value)}
            >
              {options.map(option => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>

            <ChevronDown
              size={17}
              className="pointer-events-none absolute right-3 top-3 text-[#888]"
            />
          </div>
        ) : type === 'textarea' ? (
          <textarea
            aria-label={label}
            disabled={disabled}
            rows={4}
            value={stringify(value ?? defaultValue)}
            placeholder={placeholder}
            onChange={event => onChange(event.target.value)}
            className={`${inputClass} resize-y py-3`}
          />
        ) : (
          <input
            aria-label={label}
            disabled={disabled}
            className={inputClass}
            type={
              type === 'number' || type === 'integer'
                ? 'number'
                : 'text'
            }
            min={min}
            max={max}
            step={type === 'integer' ? 1 : undefined}
            placeholder={placeholder}
            value={stringify(value ?? defaultValue)}
            onChange={event => {
              if (type === 'number' || type === 'integer') {
                changeNumeric(event.target.value)
              } else {
                onChange(event.target.value)
              }
            }}
          />
        )
      ) : (
        <div className="relative">
          <div className="flex min-h-11 min-w-0 overflow-hidden rounded-xl border border-violet-400 bg-white focus-within:ring-2 focus-within:ring-violet-500/10 dark:border-violet-600 dark:bg-cl-dark-panel">
            <span className="flex w-10 shrink-0 items-center justify-center border-r border-violet-200 bg-[#faf8ff] font-serif text-[19px] italic text-[#8e73ba] dark:border-[#51406e] dark:bg-[#30283c]">
              fx
            </span>

            {expanded || type === 'textarea' ? (
              <textarea
                aria-label={`${label} expression`}
                disabled={disabled}
                spellCheck={false}
                rows={expanded ? 7 : 3}
                className="min-w-0 flex-1 resize-y bg-transparent px-3 py-2.5 font-mono text-[12px] text-[#292929] outline-none dark:text-white"
                placeholder="{{ $json.field }}"
                value={stringify(value ?? defaultValue)}
                onChange={event => onChange(event.target.value)}
              />
            ) : (
              <input
                aria-label={`${label} expression`}
                disabled={disabled}
                spellCheck={false}
                className="h-11 min-w-0 flex-1 bg-transparent px-3 font-mono text-[12px] text-[#292929] outline-none dark:text-white"
                placeholder="{{ $json.field }}"
                value={stringify(value ?? defaultValue)}
                onChange={event => onChange(event.target.value)}
              />
            )}

            <IconButton
              title={expanded ? 'Collapse editor' : 'Expand editor'}
              onClick={() => setExpanded(!expanded)}
            >
              <Expand size={16} />
            </IconButton>
          </div>

          {showResult && (
            <div className="absolute left-0 right-0 top-full z-30 mt-1 overflow-hidden rounded-xl border border-[#e2e2e5] bg-white shadow-[0_12px_35px_#00000020] dark:border-[#414753] dark:bg-[#252b36]">
              <div className="flex items-center justify-between gap-2 px-3 pt-3">
                <span className="text-[14px] font-semibold text-[#292929] dark:text-white">
                  Result
                </span>

                <div className="flex items-center gap-1">
                  <span className="text-[11px] text-[#888]">
                    Item {index}
                  </span>

                  <IconButton
                    title="Previous item"
                    disabled={index === 0}
                    onClick={() => setItemIndex(index - 1)}
                  >
                    <ChevronLeft size={15} />
                  </IconButton>

                  <IconButton
                    title="Next item"
                    disabled={index >= items.length - 1}
                    onClick={() => setItemIndex(index + 1)}
                  >
                    <ChevronRight size={15} />
                  </IconButton>
                </div>
              </div>

              <div className="max-h-48 overflow-y-auto px-3 py-4">
                <pre className="whitespace-pre-wrap break-words font-mono text-[12px] text-[#363636] dark:text-[#f3f4f6]">
                  {preview.value || '(empty)'}
                </pre>

                {!preview.resolved && (
                  <p className="mt-2 text-[11px] leading-4 text-amber-700 dark:text-amber-300">
                    Expression cannot be resolved from the available input.
                  </p>
                )}
              </div>

              <div className="border-t border-[#ededee] px-3 py-2.5 text-[11px] text-[#888] dark:border-[#414753]">
                Tip: Anything inside {'{{ }}'} is an expression.
              </div>
            </div>
          )}
        </div>
      )}

      {description && (
        <p className="mt-1.5 text-[11px] leading-4 text-[#888] dark:text-[#b8bec7]">
          {description}
        </p>
      )}
    </div>
  )
}
