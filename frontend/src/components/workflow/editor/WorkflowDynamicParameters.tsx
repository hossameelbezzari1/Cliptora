
import {
  useEffect,
  useState,
} from 'react'
import {
  ChevronDown,
  ChevronRight,
  GripVertical,
  Plus,
  Trash2,
} from 'lucide-react'
import { WorkflowExpressionField } from './WorkflowExpressionField'
import { getObject, titleize } from './WorkflowNodeFields'

export type DynamicParameterSchema = {
  type?: string
  title?: string
  widget?: string
  description?: string
  default?: unknown
  item_default?: Record<string, unknown>
  properties?: Record<string, DynamicParameterSchema>
  options?: Array<{
    value: string | number
    label: string
  }>
  enum?: unknown[]
  visible_if?: Record<string, unknown>
  minimum?: number
  maximum?: number
  expression?: boolean
  collection_key?: string
  item_label?: string
  add_label?: string
  min_items?: number
  max_items?: number
  placeholder?: string
}

type RendererProps = {
  schema: Record<string, DynamicParameterSchema>
  values: Record<string, unknown>
  onChange: (name: string, value: unknown) => void
  inputData?: unknown
  exclude?: string[]
}

type FieldProps = {
  name: string
  schema: DynamicParameterSchema
  value: unknown
  onChange: (value: unknown) => void
  inputData?: unknown
}

const blocked = new Set([
  'credential_id',
  'credential',
  'api_key',
  'password',
  'secret',
  'access_token',
  'refresh_token',
])

const scheduleUnits = new Set([
  'seconds',
  'minutes',
  'hours',
  'days',
  'weeks',
  'months',
  'cron',
])

const control =
  'min-h-11 w-full rounded-xl border border-[#dedee1] bg-white px-3 text-[13px] text-[#292929] outline-none focus:border-violet-400 dark:border-[#414753] dark:bg-cl-dark-panel dark:text-white'

function isExpression(value: unknown): boolean {
  return (
    typeof value === 'string' &&
    /\{\{[\s\S]*?\}\}/.test(value)
  )
}

function normalizeScheduleUnit(value: unknown): unknown {
  if (typeof value !== 'string') return value

  const result = value
    .trim()
    .replace(/^\{\{\s*/, '')
    .replace(/\s*\}\}$/, '')
    .trim()
    .toLowerCase()

  return scheduleUnits.has(result) ? result : value
}

function defaultFor(schema: DynamicParameterSchema): unknown {
  if (schema.default !== undefined) {
    return structuredClone(schema.default)
  }

  if (schema.type === 'boolean') return false
  if (schema.type === 'object') return {}
  if (schema.type === 'array') return []
  if (schema.type === 'integer') return 0
  if (schema.type === 'number') return 0

  return ''
}

function optionItems(schema: DynamicParameterSchema) {
  if (schema.options?.length) {
    return schema.options.map(option => ({
      value: String(option.value),
      label: option.label,
    }))
  }

  return (schema.enum ?? []).map(option => ({
    value: String(option),
    label: titleize(String(option)),
  }))
}

function normalizeValue(
  name: string,
  value: unknown,
): unknown {
  if (name === 'field') {
    return normalizeScheduleUnit(value)
  }

  return value
}

function effectiveValues(
  schema: Record<string, DynamicParameterSchema>,
  values: Record<string, unknown>,
) {
  const result: Record<string, unknown> = {}

  for (const [name, field] of Object.entries(schema)) {
    result[name] = normalizeValue(
      name,
      values[name] ?? field.default,
    )
  }

  return result
}

function visible(
  field: DynamicParameterSchema,
  values: Record<string, unknown>,
): boolean {
  if (!field.visible_if) return true

  return Object.entries(field.visible_if).every(
    ([name, expected]) => {
      const actual = normalizeValue(name, values[name])

      const accepted = Array.isArray(expected)
        ? expected
        : [expected]

      // Unknown expressions cannot determine conditional UI.
      // Hide dependent fields until the value can be resolved.
      if (isExpression(actual)) return false

      return accepted.some(item =>
        String(item) === String(actual),
      )
    },
  )
}

function coerce(
  schema: DynamicParameterSchema,
  value: unknown,
): unknown {
  if (isExpression(value)) return value
  if (value === null || value === '') return value

  if (
    schema.type === 'integer' ||
    schema.type === 'number'
  ) {
    const n = Number(value)

    if (!Number.isFinite(n)) return value

    if (
      schema.type === 'integer' &&
      !Number.isInteger(n)
    ) return value

    return n
  }

  if (schema.type === 'boolean') {
    if (typeof value === 'boolean') return value
    return value === 'true'
  }

  return value
}

function BooleanParameter({
  label,
  value,
  onChange,
}: {
  label: string
  value: boolean
  onChange: (value: boolean) => void
}) {
  return (
    <div className="flex min-h-10 items-center gap-3">
      <button
        type="button"
        role="switch"
        aria-label={label}
        aria-checked={value}
        onClick={() => onChange(!value)}
        className={`relative h-[26px] w-[48px] shrink-0 rounded-full transition-colors ${
          value
            ? 'bg-[#00c853]'
            : 'bg-[#bdbdbd] dark:bg-[#66707e]'
        }`}
      >
        <span
          className={`absolute left-[3px] top-[3px] size-5 rounded-full bg-white shadow transition-transform ${
            value ? 'translate-x-[22px]' : ''
          }`}
        />
      </button>

      <span className="text-[13px] text-[#333] dark:text-white">
        {label}
      </span>
    </div>
  )
}

function JsonParameter({
  label,
  value,
  onChange,
}: {
  label: string
  value: unknown
  onChange: (value: unknown) => void
}) {
  const serialized = JSON.stringify(value ?? {}, null, 2)
  const [draft, setDraft] = useState(serialized)
  const [error, setError] = useState('')

  useEffect(() => {
    setDraft(serialized)
    setError('')
  }, [serialized])

  return (
    <div className="space-y-2">
      <label className="block text-[13px] font-medium dark:text-white">
        {label}
      </label>

      <textarea
        rows={5}
        value={draft}
        spellCheck={false}
        onChange={event => setDraft(event.target.value)}
        onBlur={() => {
          try {
            onChange(JSON.parse(draft))
            setError('')
          } catch {
            setError('Invalid JSON')
          }
        }}
        className={`${control} resize-y p-3 font-mono text-[12px]`}
      />

      {error && (
        <p role="alert" className="text-xs text-red-600">
          {error}
        </p>
      )}
    </div>
  )
}

function CollectionParameter({
  name,
  schema,
  value,
  onChange,
  inputData,
}: FieldProps) {
  const [collapsed, setCollapsed] = useState<
    Record<number, boolean>
  >({})

  const [dragFrom, setDragFrom] = useState<number | null>(
    null,
  )

  const key = schema.collection_key ?? 'items'
  const object = getObject(value ?? schema.default)
  const stored = object[key]

  const items: Record<string, unknown>[] =
    Array.isArray(stored)
      ? stored.map(item => getObject(item))
      : []

  const properties = schema.properties ?? {}
  const min = schema.min_items ?? 0
  const max = schema.max_items ?? 100

  const save = (next: Record<string, unknown>[]) => {
    onChange({
      ...object,
      [key]: next,
    })
  }

  const add = () => {
    if (items.length >= max) return

    const next = structuredClone(
      schema.item_default ?? {},
    )

    for (const [fieldName, field] of Object.entries(
      properties,
    )) {
      if (next[fieldName] === undefined) {
        next[fieldName] = defaultFor(field)
      }
    }

    save([...items, next])
    setCollapsed(previous => ({
      ...previous,
      [items.length]: false,
    }))
  }

  const update = (
    index: number,
    fieldName: string,
    nextValue: unknown,
  ) => {
    save(items.map((item, i) =>
      i === index
        ? {
            ...item,
            [fieldName]: coerce(
              properties[fieldName] ?? {},
              nextValue,
            ),
          }
        : item,
    ))
  }

  const remove = (index: number) => {
    if (items.length <= min) return

    save(items.filter((_, i) => i !== index))
    setCollapsed({})
  }

  const reorder = (from: number, to: number) => {
    if (
      from === to ||
      from < 0 ||
      to < 0 ||
      from >= items.length ||
      to >= items.length
    ) return

    const next = [...items]
    const [moved] = next.splice(from, 1)
    next.splice(to, 0, moved)

    save(next)
    setCollapsed({})
  }

  return (
    <section className="min-w-0 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-[14px] font-medium text-[#292929] dark:text-white">
          {schema.title ?? titleize(name)}
        </span>

        <button
          type="button"
          onClick={add}
          disabled={items.length >= max}
          className="grid size-9 place-items-center rounded-lg text-[#666] hover:bg-[#f3f3f5] disabled:opacity-40 dark:text-white dark:hover:bg-[#374151]"
          aria-label="Add rule"
        >
          <Plus size={22} />
        </button>
      </div>

      <div className="space-y-3">
        {items.map((item, index) => {
          const context = effectiveValues(properties, item)

          return (
            <div
              key={`${name}-${index}`}
              className="rounded-xl border border-[#e2e2e5] bg-white dark:border-[#414753] dark:bg-cl-dark-panel"
              onDragOver={event => event.preventDefault()}
              onDrop={event => {
                event.preventDefault()

                if (dragFrom !== null) {
                  reorder(dragFrom, index)
                }

                setDragFrom(null)
              }}
            >
              <div className="flex min-h-[50px] items-center gap-2 px-3">
                <button
                  type="button"
                  onClick={() => setCollapsed(previous => ({
                    ...previous,
                    [index]: !previous[index],
                  }))}
                  aria-expanded={!collapsed[index]}
                  className="flex min-w-0 flex-1 items-center gap-2 text-left text-[13px] font-medium text-[#444] dark:text-white"
                >
                  {collapsed[index] ? (
                    <ChevronRight size={17} />
                  ) : (
                    <ChevronDown size={17} />
                  )}

                  {schema.item_label ?? 'Item'} {index + 1}
                </button>

                <button
                  type="button"
                  draggable
                  title="Drag to reorder"
                  aria-label={`Drag rule ${index + 1}`}
                  onDragStart={event => {
                    setDragFrom(index)
                    event.dataTransfer.effectAllowed = 'move'
                  }}
                  onDragEnd={() => setDragFrom(null)}
                  className="cursor-grab rounded-lg p-2 text-[#888] active:cursor-grabbing"
                >
                  <GripVertical size={17} />
                </button>

                <button
                  type="button"
                  disabled={items.length <= min}
                  onClick={() => remove(index)}
                  aria-label={`Delete rule ${index + 1}`}
                  className="rounded-lg p-2 text-[#888] hover:text-red-600 disabled:opacity-30"
                >
                  <Trash2 size={17} />
                </button>
              </div>

              {!collapsed[index] && (
                <div className="space-y-[18px] border-t border-[#ededee] px-3 pb-4 pt-4 dark:border-[#414753]">
                  {Object.entries(properties)
                    .filter(([fieldName, field]) =>
                      !blocked.has(fieldName) &&
                      visible(field, context),
                    )
                    .map(([fieldName, field]) => (
                      <DynamicParameterField
                        key={`${name}-${index}-${fieldName}`}
                        name={fieldName}
                        schema={field}
                        value={normalizeValue(
                          fieldName,
                          item[fieldName] ?? field.default,
                        )}
                        inputData={inputData}
                        onChange={next =>
                          update(index, fieldName, next)
                        }
                      />
                    ))}
                </div>
              )}
            </div>
          )
        })}
      </div>

      <button
        type="button"
        disabled={items.length >= max}
        onClick={add}
        className="inline-flex min-h-10 items-center gap-2 rounded-full border border-[#e2e2e5] bg-white px-4 text-[13px] font-medium text-[#343434] shadow-sm hover:bg-[#f7f7f8] disabled:opacity-40 dark:border-[#414753] dark:bg-cl-dark-panel dark:text-white"
      >
        <Plus size={18} />
        {schema.add_label ?? 'Add Item'}
      </button>

      {items.length < min && (
        <p className="text-[11px] text-amber-700 dark:text-amber-300">
          At least {min} item(s) required.
        </p>
      )}
    </section>
  )
}

export function DynamicParameterField({
  name,
  schema,
  value,
  onChange,
  inputData,
}: FieldProps) {
  const effective = normalizeValue(
    name,
    value ?? defaultFor(schema),
  )

  const label = schema.title ?? titleize(name)
  const options = optionItems(schema)

  if (schema.widget === 'collection') {
    return (
      <CollectionParameter
        name={name}
        schema={schema}
        value={effective}
        onChange={onChange}
        inputData={inputData}
      />
    )
  }

  if (
    schema.type === 'object' ||
    schema.type === 'array'
  ) {
    return (
      <JsonParameter
        label={label}
        value={effective}
        onChange={onChange}
      />
    )
  }

  if (schema.type === 'boolean') {
    return (
      <BooleanParameter
        label={label}
        value={Boolean(effective)}
        onChange={onChange}
      />
    )
  }

  const select = options.length > 0 ||
    schema.widget === 'select'

  const fieldType = select
    ? 'select'
    : schema.widget === 'textarea'
      ? 'textarea'
      : schema.type === 'integer'
        ? 'integer'
        : schema.type === 'number'
          ? 'number'
          : 'text'

  // A field without expression support uses a plain control.
  if (schema.expression === false) {
    if (select) {
      return (
        <label className="block space-y-2">
          <span className="text-[13px] font-medium text-[#292929] dark:text-white">
            {label}
          </span>

          <select
            aria-label={label}
            className={control}
            value={String(effective ?? '')}
            onChange={event => onChange(
              coerce(schema, event.target.value),
            )}
          >
            {options.map(option => (
              <option
                key={option.value}
                value={option.value}
              >
                {option.label}
              </option>
            ))}
          </select>
        </label>
      )
    }

    return (
      <label className="block space-y-2">
        <span className="text-[13px] font-medium text-[#292929] dark:text-white">
          {label}
        </span>

        <input
          aria-label={label}
          className={control}
          type={
            schema.type === 'integer' ||
            schema.type === 'number'
              ? 'number'
              : 'text'
          }
          min={schema.minimum}
          max={schema.maximum}
          value={String(effective ?? '')}
          onChange={event => onChange(
            coerce(schema, event.target.value),
          )}
        />
      </label>
    )
  }

  return (
    <WorkflowExpressionField
      label={label}
      value={effective}
      defaultValue={defaultFor(schema)}
      type={fieldType}
      options={options}
      min={schema.minimum}
      max={schema.maximum}
      description={schema.description}
      placeholder={schema.placeholder}
      inputData={inputData}
      onChange={next => onChange(coerce(schema, next))}
    />
  )
}

export function WorkflowDynamicParameters({
  schema,
  values,
  onChange,
  inputData,
  exclude = [],
}: RendererProps) {
  const excluded = new Set([...blocked, ...exclude])
  const context = effectiveValues(schema, values)

  return (
    <div
      className="space-y-5 pb-3"
      data-dynamic-parameters
    >
      {Object.entries(schema)
        .filter(([name, field]) =>
          !excluded.has(name) &&
          !name.startsWith('__') &&
          visible(field, context),
        )
        .map(([name, field]) => (
          <DynamicParameterField
            key={name}
            name={name}
            schema={field}
            value={values[name]}
            inputData={inputData}
            onChange={next => onChange(name, next)}
          />
        ))}
    </div>
  )
}
