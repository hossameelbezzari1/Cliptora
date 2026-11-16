import { useEffect, useMemo, useState } from 'react'
import type { DteAdapterRule, DteSchema, DteUnitConversion } from '../types/dteContracts'

type Upstream = { path: string; label?: string; sample: unknown; sourceSchema?: DteSchema }
type Props = {
  nodeId: string
  upstream: Upstream[]
  expectedSchema: DteSchema
  settings: Record<string, unknown>
  onChange: (patch: Record<string, unknown>) => void
  disabled?: boolean
}

type Field = { path: string; type: string; required: boolean }
const control = 'w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-800 outline-none focus:border-sky-400'
const conversions: Array<{ label: string; from: DteUnitConversion['from']; to: DteUnitConversion['to'] }> = [
  { label: 'milliseconds → seconds', from: 'ms', to: 's' },
  { label: 'seconds → milliseconds', from: 's', to: 'ms' },
  { label: 'minutes → seconds', from: 'minutes', to: 'seconds' },
  { label: 'seconds → minutes', from: 'seconds', to: 'minutes' },
  { label: 'Hz → kHz', from: 'hz', to: 'khz' },
  { label: 'kHz → Hz', from: 'khz', to: 'hz' },
]

function fieldsInSchema(schema: DteSchema | undefined, prefix = '', depth = 0, required = true): Field[] {
  if (!schema || depth > 8) return []
  if (schema.type === 'array') return fieldsInSchema(schema.items, prefix + '[]', depth + 1, required)
  if (schema.type === 'object') {
    return Object.entries(schema.properties ?? {}).flatMap(([key, child]) =>
      fieldsInSchema(child, prefix ? `${prefix}.${key}` : key, depth + 1, required && (schema.required ?? []).includes(key)),
    )
  }
  return prefix ? [{ path: prefix, type: schema.type ?? 'unknown', required }] : []
}

function fieldsInSample(value: unknown, prefix = '', depth = 0): Field[] {
  if (depth > 8) return []
  if (Array.isArray(value)) return value.length ? fieldsInSample(value[0], prefix + '[]', depth + 1) : []
  if (value !== null && typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>).slice(0, 128).flatMap(([key, child]) =>
      fieldsInSample(child, prefix ? `${prefix}.${key}` : key, depth + 1),
    )
  }
  const type = value === null ? 'null' : typeof value
  return prefix ? [{ path: prefix, type, required: true }] : []
}

function initialMapping(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const result: Record<string, string> = {}
  for (const [source, destination] of Object.entries(value)) {
    if (typeof destination === 'string') result[destination] = source
  }
  return result
}

export function WorkflowDynamicTypePanel({ nodeId, upstream, expectedSchema, settings, onChange, disabled = false }: Props) {
  const [sourcePath, setSourcePath] = useState(String(settings.type_input_path || upstream[0]?.path || ''))
  const [targetPath, setTargetPath] = useState(String(settings.type_target_path || sourcePath))
  const [choices, setChoices] = useState<Record<string, string>>(() => initialMapping(
    (settings.type_adapter_rule as DteAdapterRule | undefined)?.mapping,
  ))
  const [unitChanges, setUnitChanges] = useState<Record<string, string>>(() => {
    const result: Record<string, string> = {}
    for (const item of (settings.type_adapter_rule as DteAdapterRule | undefined)?.conversions ?? []) {
      result[item.path] = `${item.from}:${item.to}`
    }
    return result
  })
  const [message, setMessage] = useState('')
  const [schemaDraft, setSchemaDraft] = useState(() => JSON.stringify(expectedSchema, null, 2))
  useEffect(() => {
    const nextPath = String(settings.type_input_path || upstream[0]?.path || '')
    setSourcePath(nextPath)
    setTargetPath(String(settings.type_target_path || nextPath))
    setChoices(initialMapping((settings.type_adapter_rule as DteAdapterRule | undefined)?.mapping))
    const updatedUnits: Record<string, string> = {}
    for (const unit of (settings.type_adapter_rule as DteAdapterRule | undefined)?.conversions ?? []) {
      updatedUnits[unit.path] = `${unit.from}:${unit.to}`
    }
    setUnitChanges(updatedUnits)
    setMessage('')
    setSchemaDraft(JSON.stringify(expectedSchema, null, 2))
  // New node selection owns the reset, edits are preserved while typing.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeId])
  const selected = upstream.find(item => item.path === sourcePath)
  const sources = useMemo(() => {
    const byPath = new Map<string, Field>()
    for (const field of fieldsInSchema(selected?.sourceSchema)) byPath.set(field.path, field)
    for (const field of fieldsInSample(selected?.sample)) byPath.set(field.path, field)
    return [...byPath.values()]
  }, [selected])
  const targets = useMemo(() => fieldsInSchema(expectedSchema), [expectedSchema])
  const matched = targets.filter(field => choices[field.path] && sources.some(item => item.path === choices[field.path]))
  const requiredMissing = targets.filter(field => field.required && !matched.some(item => item.path === field.path))

  const suggest = () => {
    const next: Record<string, string> = { ...choices }
    for (const target of targets) {
      if (next[target.path]) continue
      const exact = sources.find(source => source.path === target.path && (source.type === target.type || target.type === 'number' && source.type === 'number'))
      if (exact) next[target.path] = exact.path
    }
    setChoices(next)
    setMessage('Exact field names suggested. Renamed fields and unit changes must be approved explicitly.')
  }

  const approve = () => {
    if (!Object.keys(expectedSchema).length) { setMessage('Define an expected schema first.'); return }
    if (!selected) { setMessage('Select an upstream source first.'); return }
    const chosenTarget = targetPath || selected.path
    if (!/^[A-Za-z_][A-Za-z0-9_-]*(?:\.[A-Za-z_][A-Za-z0-9_-]*)*$/.test(chosenTarget)) {
      setMessage('Target path must contain object fields only: no array indexes or wildcards.')
      return
    }
    const mapping: Record<string, string> = {}
    const changes: DteUnitConversion[] = []
    for (const target of targets) {
      const source = choices[target.path]
      if (!source) continue
      if (Object.prototype.hasOwnProperty.call(mapping, source)) { setMessage(`Source field ${source} was selected twice.`); return }
      mapping[source] = target.path
      const key = unitChanges[target.path]
      if (key) {
        const [from, to] = key.split(':')
        changes.push({ path: target.path, from: from as DteUnitConversion['from'], to: to as DteUnitConversion['to'] })
      }
    }
    if (requiredMissing.length) { setMessage(`Required field(s) not mapped: ${requiredMissing.map(v => v.path).join(', ')}`); return }
    const rule: DteAdapterRule = {
      id: `node_${nodeId}_mapping`, version: 1, mapping, conversions: changes,
      target_schema: expectedSchema,
      ...(selected.sourceSchema ? { source_schema: selected.sourceSchema } : {}),
    }
    onChange({
      type_validation_mode: 'adapt', type_input_path: selected.path, type_target_path: chosenTarget,
      type_input_schema: expectedSchema, type_source_schema: selected.sourceSchema ?? {}, type_adapter_rule: rule,
    })
    setMessage('Approved rule added to node settings. Backend validates it again at runtime.')
  }

  const safeAuto = () => {
    if (!Object.keys(expectedSchema).length) { setMessage('Define an expected schema first.'); return }
    if (!selected) return
    const chosenTarget = targetPath || selected.path
    if (!/^[A-Za-z_][A-Za-z0-9_-]*(?:\.[A-Za-z_][A-Za-z0-9_-]*)*$/.test(chosenTarget)) {
      setMessage('Target path must contain object fields only: no array indexes or wildcards.')
      return
    }
    onChange({
      type_validation_mode: 'auto', type_input_path: selected.path, type_target_path: chosenTarget,
      type_input_schema: expectedSchema, type_source_schema: selected.sourceSchema ?? {}, type_adapter_rule: {},
    })
    setMessage('Safe auto mode enabled. Backend will refuse alias and semantic conversions without an approved rule.')
  }

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 text-slate-800 shadow-sm dark:border-[#414753] dark:bg-[#202631] dark:text-white">
      <header className="mb-3">
        <h3 className="text-sm font-semibold">Dynamic Type Compatibility</h3>
        <p className="mt-1 text-xs text-slate-500">Structural mapping, versioned rules, and explicit unit conversion</p>
      </header>
      <details className="mb-3 rounded-xl border border-slate-200 p-2.5 text-xs dark:border-[#414753]" open={!Object.keys(expectedSchema).length}>
        <summary className="cursor-pointer font-medium">Expected JSON schema {Object.keys(expectedSchema).length ? '(advanced)' : '(required when undeclared)'}</summary>
        <textarea rows={5} spellCheck={false} className={`${control} mt-2 font-mono`}
          value={schemaDraft} disabled={disabled}
          onChange={event => setSchemaDraft(event.target.value)} />
        <button type="button" disabled={disabled} onClick={() => {
          try {
            const parsed: unknown = JSON.parse(schemaDraft)
            if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Expected schema must be an object.')
            onChange({ type_input_schema: parsed })
            setMessage('Expected schema updated. The backend will validate this contract.')
          } catch (reason) {
            setMessage(reason instanceof Error ? reason.message : 'Invalid JSON schema')
          }
        }} className="mt-2 rounded-lg border border-slate-200 px-3 py-1.5 dark:border-[#414753]">Apply expected schema</button>
      </details>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="space-y-1 text-xs font-medium text-slate-600">
          <span>Upstream output</span>
          <select className={control} disabled={disabled} value={sourcePath} onChange={e => { setSourcePath(e.target.value); setMessage('') }}>
            <option value="">Choose connected output</option>
            {upstream.map(item => <option value={item.path} key={item.path}>{item.label || item.path}</option>)}
          </select>
        </label>
        <label className="space-y-1 text-xs font-medium text-slate-600">
          <span>Local target path</span>
          <input className={control} disabled={disabled} value={targetPath} onChange={e => setTargetPath(e.target.value)} placeholder="source.clip_manifest" />
        </label>
      </div>
      <div className="mt-4 flex items-center justify-between gap-3">
        <span className="text-xs font-semibold">Map source fields to expected fields</span>
        <button type="button" onClick={suggest} disabled={disabled} className="rounded-lg bg-slate-100 px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-200">Suggest exact matches</button>
      </div>
      <div className="mt-2 max-h-96 space-y-2 overflow-auto">
        {targets.length === 0 && <p className="text-xs text-slate-500">Destination contract has no primitive fields.</p>}
        {targets.map(target => (
          <div key={target.path} className="grid grid-cols-1 gap-2 rounded-xl bg-slate-50 p-2.5 sm:grid-cols-3">
            <div className="min-w-0 text-xs"><span className="block truncate font-medium" title={target.path}>{target.path}</span>
              <span className="text-slate-500">{target.type}{target.required ? ' · required' : ' · optional'}</span></div>
            <select className={control} disabled={disabled} value={choices[target.path] || ''} onChange={e => setChoices(current => ({ ...current, [target.path]: e.target.value }))}>
              <option value="">Select source field</option>
              {sources.map(source => <option key={source.path} value={source.path}>{source.path} ({source.type})</option>)}
            </select>
            <select className={control} disabled={disabled} value={unitChanges[target.path] || ''} onChange={e => setUnitChanges(current => ({ ...current, [target.path]: e.target.value }))}>
              <option value="">No unit conversion</option>
              {conversions.map(item => <option key={`${item.from}:${item.to}`} value={`${item.from}:${item.to}`}>{item.label}</option>)}
            </select>
          </div>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button type="button" onClick={approve} disabled={disabled || !selected} className="rounded-xl bg-sky-600 px-3 py-2 text-xs font-medium text-white disabled:opacity-50">Approve and save rule</button>
        <button type="button" onClick={safeAuto} disabled={disabled || !selected} className="rounded-xl border border-slate-200 px-3 py-2 text-xs font-medium">Safe auto (exact only)</button>
        <button type="button" onClick={() => onChange({ type_validation_mode: 'legacy' })} disabled={disabled} className="rounded-xl px-3 py-2 text-xs text-slate-500">Legacy mode</button>
      </div>
      {requiredMissing.length > 0 && <p className="mt-2 text-xs text-amber-700">Missing required mapping: {requiredMissing.map(v => v.path).join(', ')}</p>}
      {message && <p className="mt-2 text-xs text-slate-600" role="status">{message}</p>}
    </section>
  )
}