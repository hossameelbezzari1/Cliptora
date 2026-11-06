import { useEffect, useState, type ReactNode } from 'react'
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
export const inputClass = 'min-h-10 w-full rounded-lg border border-[#dedede] dark:border-[#374151] bg-white dark:bg-cl-dark-panel px-3 py-2 text-[13px] text-[#272727] dark:text-[#f3f4f6] outline-none transition-colors focus:border-[#9461fc] focus:ring-2 focus:ring-[#9461fc]/10 disabled:bg-[#f7f7f7] dark:disabled:bg-[#1f2937] disabled:text-[#4b5563] dark:disabled:text-[#999]'
export const lightButton = 'inline-flex min-h-9 items-center justify-center gap-1.5 rounded-full border border-[#e3e3e3] dark:border-[#374151] bg-white dark:bg-cl-dark-panel px-3 text-xs font-medium text-[#202020] dark:text-[#f3f4f6] shadow-sm transition-colors hover:bg-[#f5f5f5] dark:hover:bg-[#1f2937] disabled:cursor-not-allowed disabled:opacity-45'
export const getObject = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
export const isExcel = (value: string) => /excel|workbook/i.test(value)
export const titleize = (name: string) => name.replace(/[_-]/g, ' ').replace(/\b\w/g, s => s.toUpperCase())
export const formatJSON = (value: unknown) => JSON.stringify(value ?? null, null, 2)

export function SectionLabel({ children }: { children: ReactNode }) { return <p className="mb-2 text-[13px] font-medium text-[#303030] dark:text-[#f3f4f6]">{children}</p> }

export function JsonField({ label, value, onChange }: { label: string; value: unknown; onChange: (value: unknown) => void }) {
  const [draft, setDraft] = useState(() => formatJSON(value))
  const [error, setError] = useState('')
  useEffect(() => { setDraft(formatJSON(value)); setError('') }, [value])
  return <label className="block space-y-2"><SectionLabel>{label}</SectionLabel><textarea rows={5} className={`${inputClass} resize-y font-mono text-[11px]`} value={draft} onChange={e => setDraft(e.target.value)} onBlur={() => { try { onChange(JSON.parse(draft) as unknown); setError('') } catch { setError('Invalid JSON — fix it before saving.') } }} />{error && <span role="alert" className="block text-[11px] text-red-600 dark:text-red-300">{error}</span>}</label>
}

export function DynamicField({ name, schema, value, onChange }: { name: string; schema?: FieldSchema; value: unknown; onChange: (value: unknown) => void }) {
  const label = schema?.title ?? titleize(name)
  const type = schema?.type ?? (typeof value === 'number' ? 'number' : typeof value === 'boolean' ? 'boolean' : typeof value === 'object' && value !== null ? 'object' : 'string')
  const effective = value ?? schema?.default
  if (schema?.enum?.length) return <label className="block"><SectionLabel>{label}</SectionLabel><select className={inputClass} value={String(effective ?? '')} onChange={e => onChange(schema.enum?.find(option => String(option) === e.target.value) ?? e.target.value)}><option value="">Choose…</option>{schema.enum.map(option => <option key={String(option)} value={String(option)}>{titleize(String(option))}</option>)}</select>{schema.description && <span className="mt-1 block text-[11px] leading-4 text-[#888] dark:text-[#b8bec7]">{schema.description}</span>}</label>
  if (type === 'boolean') return <label className="flex cursor-pointer items-center gap-3 py-1"><button type="button" role="switch" aria-checked={Boolean(effective)} onClick={() => onChange(!effective)} className={`relative h-6 w-11 rounded-full transition-colors ${effective ? 'bg-[#f3eefd] dark:bg-[#8550e9]' : 'bg-[#eef2f7] dark:bg-[#b6b6b6]'}`}><span className={`absolute left-[3px] top-[3px] size-[18px] rounded-full bg-white dark:bg-cl-dark-panel shadow-sm transition-transform ${effective ? 'translate-x-5' : ''}`} /></button><span className="text-[13px] text-[#393939] dark:text-[#f3f4f6]">{label}</span></label>
  if (type === 'object' || type === 'array') return <JsonField label={label} value={effective ?? (type === 'array' ? [] : {})} onChange={onChange}/>
  if (['prompt','system_prompt','image_urls'].includes(name)) return <label className="block"><SectionLabel>{label}</SectionLabel><textarea rows={name === 'system_prompt' ? 3 : 4} className={`${inputClass} resize-y`} value={String(effective ?? '')} placeholder={name === 'image_urls' ? 'e.g. https://example.com/image.jpeg' : name === 'prompt' ? "What's in this image?" : undefined} onChange={e => onChange(e.target.value)} />{schema?.description && <span className="mt-1 block text-[11px] leading-4 text-[#888] dark:text-[#b8bec7]">{schema.description}</span>}</label>
  return <label className="block"><SectionLabel>{label}</SectionLabel><input type={type === 'number' || type === 'integer' ? 'number' : 'text'} min={schema?.minimum} max={schema?.maximum} className={inputClass} value={String(effective ?? '')} onChange={e => onChange(type === 'number' || type === 'integer' ? (e.target.value === '' ? null : Number(e.target.value)) : e.target.value)} />{schema?.description && <span className="mt-1 block text-[11px] leading-4 text-[#888] dark:text-[#b8bec7]">{schema.description}</span>}</label>
}

export function ProviderModelField({ provider, action, value, onChange }: { provider: 'OpenAI' | 'Gemini'; action: string; value: string; onChange: (value: string) => void }) {
  const options = provider === 'Gemini' ? modelsForGeminiAction(action) : modelsForOpenAIAction(action)
  const known = options.some(option => option.id === value)
  const [mode, setMode] = useState<'list' | 'custom'>(known ? 'list' : 'custom')
  useEffect(() => { setMode(options.some(option => option.id === value) ? 'list' : 'custom') }, [action, value])
  const selected = options.find(option => option.id === value)
  return <div className="space-y-2"><SectionLabel>Model</SectionLabel><div className="flex overflow-hidden rounded-lg border border-[#dedede] dark:border-[#374151] bg-white dark:bg-cl-dark-panel focus-within:border-[#9461fc] focus-within:ring-2 focus-within:ring-[#9461fc]/10">
    <select aria-label="Model source" className="w-[112px] shrink-0 border-0 border-r border-[#e3e3e3] dark:border-[#374151] bg-[#fafafa] dark:bg-[#1f2937] px-3 text-[12px] outline-none" value={mode} onChange={event => { const next = event.target.value as 'list'|'custom'; setMode(next); if (next === 'list') onChange(options[0].id) }}><option value="list">From list</option><option value="custom">By model ID</option></select>
    {mode === 'list' ? <select aria-label={`${provider} model`} className="min-h-10 min-w-0 flex-1 border-0 bg-white dark:bg-cl-dark-panel px-3 py-2 text-[13px] outline-none" value={known ? value : options[0].id} onChange={event => onChange(event.target.value)}>{options.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}</select>
      : <input aria-label={`Custom ${provider} model ID`} className="min-h-10 min-w-0 flex-1 border-0 px-3 py-2 font-mono text-[12px] outline-none" value={value} placeholder={provider === 'Gemini' ? 'gemini-3.8-flash' : 'gpt-6.1-sol'} onChange={event => onChange(event.target.value)}/>}</div>
    <p className="text-[11px] leading-4 text-[#888] dark:text-[#b8bec7]">{selected?.description ?? `Use an exact model ID available to the configured ${provider} API project.`}</p>
  </div>
}
