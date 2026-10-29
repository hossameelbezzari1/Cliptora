import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type PointerEvent as ReactPointerEvent, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import {
  ArrowLeft, ArrowRight, Check, CircleAlert, Copy, Search, GripVertical, ChevronRight, Database,
  Film, FolderOpen, LoaderCircle, Play, Plus, RefreshCw, Settings2, Upload, X, Zap,
} from 'lucide-react'
import { api } from '../../lib/api'
import type { WorkflowNode } from './workflowTypes'
import type { WorkflowStudioState } from './useWorkflowStudio'
import { WorkflowToolIcon } from './WorkflowToolIcon'
import { defaultModelForGeminiAction, modelsForGeminiAction } from './geminiModels'
import { defaultModelForOpenAIAction, modelsForOpenAIAction } from './openAIModels'
import { mediaName } from '../editor/library/mediaLibraryUtils'

type Props = {
  studio: WorkflowStudioState
  onClose: () => void
  /** Optional future single-node executor: not provided by current FastAPI routes. */
  onExecuteStep?: (nodeId: string) => Promise<void>
  onManageCredentials?: () => void
}
type DataView = 'schema' | 'table' | 'json'
type Tab = 'parameters' | 'settings'
type MobilePanel = 'input' | 'parameters' | 'output'
type JsonObject = Record<string, unknown>
type FieldSchema = {
  type?: string
  title?: string
  description?: string
  enum?: unknown[]
  default?: unknown
  format?: string
  minimum?: number
  maximum?: number
}

const inputClass = 'min-h-10 w-full rounded-lg border border-[#dedede] bg-white px-3 py-2 text-[13px] text-[#272727] outline-none transition-colors focus:border-[#9461fc] focus:ring-2 focus:ring-[#9461fc]/10 disabled:bg-[#f7f7f7] disabled:text-[#999]'
const lightButton = 'inline-flex min-h-9 items-center justify-center gap-1.5 rounded-full border border-[#e3e3e3] bg-white px-3 text-xs font-medium text-[#202020] shadow-sm transition-colors hover:bg-[#f5f5f5] disabled:cursor-not-allowed disabled:opacity-45'
const getObject = (value: unknown): JsonObject => value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : {}
const isExcel = (value: string) => /excel|workbook/i.test(value)
const titleize = (name: string) => name.replace(/[_-]/g, ' ').replace(/\b\w/g, s => s.toUpperCase())
const formatJSON = (value: unknown) => JSON.stringify(value ?? null, null, 2)

function BrandIcon({ text, type, size = 23 }: { text: string; type: string; size?: number }) {
  return <WorkflowToolIcon type={type} label={text} size={size} />
}

function EmptyData({ title, message, action, icon }: { title: string; message: string; action?: ReactNode; icon?: ReactNode }) {
  return <div className="flex h-full min-h-[250px] flex-col items-center justify-center px-5 text-center">
    <div className="mb-3 flex size-9 items-center justify-center text-[#454545]">{icon ?? <ArrowRight size={30} strokeWidth={1.7}/>}</div>
    <p className="text-[15px] font-medium text-[#424242]">{title}</p>
    {action && <div className="mt-4">{action}</div>}
    <p className="mt-4 max-w-[280px] text-[13px] leading-relaxed text-[#646464]">{message}</p>
  </div>
}

type InspectorSource = { id: string; label: string; value: unknown }

function displayValue(value: unknown): string {
  if (value === null) return 'null'
  if (value === undefined) return '—'
  if (typeof value === 'string') return value
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

function dataRows(value: unknown): JsonObject[] {
  if (Array.isArray(value)) return value.map(item => typeof item === 'object' && item !== null && !Array.isArray(item) ? item as JsonObject : { value: item })
  const object = getObject(value)
  for (const field of ['items', 'data', 'rows']) {
    if (Array.isArray(object[field])) return dataRows(object[field])
  }
  if (value === undefined || value === null) return []
  return [Object.keys(object).length ? object : { value }]
}

function countItems(value: unknown) { return dataRows(value).length }

function JsonSyntax({ value }: { value: unknown }) {
  const source = formatJSON(value)
  const tokens = source.split(/("(?:\\.|[^"\\])*"\s*:|"(?:\\.|[^"\\])*"|\b(?:true|false|null)\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g)
  return <pre className="whitespace-pre-wrap break-words font-mono text-[12px] leading-[1.8] text-[#454545]">{tokens.map((token, index) => {
    const trimmed = token.trim()
    const color = trimmed.startsWith('"') && trimmed.endsWith(':') ? 'text-[#586575]'
      : trimmed.startsWith('"') ? 'text-[#8a36e7]'
        : /^(?:true|false|null)$/.test(trimmed) ? 'text-[#c55c1c]'
          : /^-?\d/.test(trimmed) ? 'text-[#14965e]' : ''
    return <span key={index} className={color}>{token}</span>
  })}</pre>
}

function SchemaBranch({ name, value, level = 0 }: { name: string; value: unknown; level?: number }) {
  const nested = value !== null && typeof value === 'object'
  const isArray = Array.isArray(value)
  const entries = isArray ? (value.length ? [['0', value[0]] as const] : []) : Object.entries(getObject(value))
  const kind = isArray ? '[]' : nested ? '{}' : typeof value === 'number' ? '#' : typeof value === 'string' ? 'Aa' : '•'
  return <div className="min-w-0" style={{ paddingLeft: level ? 13 : 0 }}>
    {nested ? <details open={level < 2} className="group/branch">
      <summary className="flex cursor-pointer list-none items-center gap-2 rounded-md py-1 text-[12px] hover:bg-[#ededed] [&::-webkit-details-marker]:hidden">
        <ChevronRight size={14} className="shrink-0 text-[#777] transition-transform group-open/branch:rotate-90" />
        <span className="rounded border border-[#e7e7e7] bg-white px-1.5 py-0.5 font-mono text-[11px] text-[#777]">{kind}</span>
        <span className="truncate font-medium text-[#333]">{name}</span>
        <span className="text-[11px] text-[#999]">{isArray ? `${value.length} items` : `${entries.length} fields`}</span>
      </summary>
      <div className="ml-[7px] border-l border-dashed border-[#d3d8e0] pl-2">
        {entries.map(([key, item]) => <SchemaBranch key={key} name={isArray ? `item ${Number(key) + 1} (example)` : key} value={item} level={level + 1} />)}
      </div>
    </details> : <div className="flex min-w-0 items-center gap-2 rounded-md py-[5px] text-[12px] hover:bg-[#ededed]">
      <span className="w-[14px] shrink-0" />
      <span className="rounded border border-[#e7e7e7] bg-white px-1.5 py-0.5 font-mono text-[11px] text-[#777]">{kind}</span>
      <span className="shrink-0 font-medium text-[#333]">{name}</span>
      <span className="min-w-0 truncate text-[#555]" title={displayValue(value)}>{displayValue(value)}</span>
    </div>}
  </div>
}

function DataInspector({ value, view, label, query, onCopy }: { value: unknown; view: DataView; label: string; query: string; onCopy: () => void }) {
  if (value == null) return <EmptyData title={`No ${label.toLowerCase()} data`} message="Run the workflow to inspect actual execution data." />
  const rows = dataRows(value)
  const q = query.toLowerCase().trim()
  const matchingRows = q ? rows.filter(row => JSON.stringify(row).toLowerCase().includes(q)) : rows
  if (view === 'json') return <div className="relative min-h-0 p-4">
    <button type="button" onClick={onCopy} title="Copy JSON" aria-label={`Copy ${label} JSON`} className="absolute right-5 top-5 grid size-8 place-items-center rounded-full border border-[#e3e3e3] bg-white text-[#555] shadow-sm hover:bg-[#efefef]"><Copy size={15} /></button>
    <div className="overflow-auto pr-10"><JsonSyntax value={q ? matchingRows : value}/></div>
  </div>
  if (view === 'table') {
    const visibleRows = matchingRows.slice(0, 500)
    const columns = [...new Set(visibleRows.flatMap(row => Object.keys(row)))].slice(0, 50)
    if (!columns.length) return <p className="p-4 text-[12px] text-[#888]">No matching data.</p>
    return <div className="min-h-0 overflow-auto p-3"><table className="w-full min-w-[300px] border-collapse text-left text-[12px]">
      <thead><tr>{columns.map(column => <th key={column} className="sticky top-0 whitespace-nowrap border border-[#d9d9de] bg-[#f2f2f2] p-2 font-semibold text-[#333]">{column}</th>)}</tr></thead>
      <tbody>{visibleRows.map((row, index) => <tr key={index} className="hover:bg-white">{columns.map(column => <td key={column} className="max-w-[260px] truncate border border-[#dedee3] px-2 py-2 text-[#454545]" title={displayValue(row[column])}>{displayValue(row[column])}</td>)}</tr>)}</tbody>
    </table>{matchingRows.length > 500 && <p className="p-2 text-xs text-[#888]">Showing the first 500 of {matchingRows.length} items.</p>}</div>
  }
  if (!matchingRows.length) return <p className="p-4 text-[12px] text-[#888]">No matching data.</p>
  return <div className="min-h-0 space-y-2 overflow-auto p-3">
    {matchingRows.slice(0, 50).map((record, index) => <details key={index} open={index === 0} className="rounded-md">
      <summary className="cursor-pointer rounded-md px-2 py-2 text-[12px] font-medium text-[#444] hover:bg-[#ededed]">{matchingRows.length > 1 ? `Item ${index + 1}` : 'Fields'}</summary>
      <div className="pl-1">{Object.entries(record).map(([key, item]) => <SchemaBranch key={key} name={key} value={item} />)}</div>
    </details>)}
    {matchingRows.length > 50 && <p className="p-2 text-xs text-[#888]">Showing 50 of {matchingRows.length} items.</p>}
  </div>
}

function PanelDivider({ side, onPointerDown, onKeyDown }: {
  side: 'input' | 'output'
  onPointerDown: (event: ReactPointerEvent<HTMLDivElement>, side: 'input' | 'output') => void
  onKeyDown: (event: ReactKeyboardEvent<HTMLDivElement>, side: 'input' | 'output') => void
}) {
  return <div role="separator" aria-label={`Resize ${side} and parameters panels`} aria-orientation="vertical"
    aria-valuemin={15} aria-valuemax={85} tabIndex={0}
    onPointerDown={event => onPointerDown(event, side)} onKeyDown={event => onKeyDown(event, side)}
    className="group relative z-20 hidden w-[9px] cursor-col-resize touch-none items-stretch justify-center bg-white outline-none hover:bg-[#ede5ff] focus-visible:bg-[#ede5ff] lg:flex">
    <span className="pointer-events-none absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-[#dddde2] group-hover:bg-[#8659e8]" />
    <span className="pointer-events-none absolute top-[0px] left-1/2 z-30 grid h-6 w-[36px] -translate-x-1/2 place-items-center rounded-b-lg border border-t-0 border-[#dddde2] bg-white text-[#909090] shadow-sm group-hover:text-[#8450e6]"><GripVertical size={17} className="rotate-90" /></span>
  </div>
}

function SectionLabel({ children }: { children: ReactNode }) { return <p className="mb-2 text-[13px] font-medium text-[#303030]">{children}</p> }

function JsonField({ label, value, onChange }: { label: string; value: unknown; onChange: (value: unknown) => void }) {
  const [draft, setDraft] = useState(() => formatJSON(value))
  const [error, setError] = useState('')
  useEffect(() => { setDraft(formatJSON(value)); setError('') }, [value])
  return <label className="block space-y-2"><SectionLabel>{label}</SectionLabel><textarea rows={5} className={`${inputClass} resize-y font-mono text-[11px]`} value={draft} onChange={e => setDraft(e.target.value)} onBlur={() => { try { onChange(JSON.parse(draft) as unknown); setError('') } catch { setError('Invalid JSON — fix it before saving.') } }} />{error && <span role="alert" className="block text-[11px] text-red-600">{error}</span>}</label>
}

function DynamicField({ name, schema, value, onChange }: { name: string; schema?: FieldSchema; value: unknown; onChange: (value: unknown) => void }) {
  const label = schema?.title ?? titleize(name)
  const type = schema?.type ?? (typeof value === 'number' ? 'number' : typeof value === 'boolean' ? 'boolean' : typeof value === 'object' && value !== null ? 'object' : 'string')
  const effective = value ?? schema?.default
  if (schema?.enum?.length) return <label className="block"><SectionLabel>{label}</SectionLabel><select className={inputClass} value={String(effective ?? '')} onChange={e => onChange(schema.enum?.find(option => String(option) === e.target.value) ?? e.target.value)}><option value="">Choose…</option>{schema.enum.map(option => <option key={String(option)} value={String(option)}>{titleize(String(option))}</option>)}</select>{schema.description && <span className="mt-1 block text-[11px] leading-4 text-[#888]">{schema.description}</span>}</label>
  if (type === 'boolean') return <label className="flex cursor-pointer items-center gap-3 py-1"><button type="button" role="switch" aria-checked={Boolean(effective)} onClick={() => onChange(!effective)} className={`relative h-6 w-11 rounded-full transition-colors ${effective ? 'bg-[#8550e9]' : 'bg-[#b6b6b6]'}`}><span className={`absolute left-[3px] top-[3px] size-[18px] rounded-full bg-white shadow-sm transition-transform ${effective ? 'translate-x-5' : ''}`} /></button><span className="text-[13px] text-[#393939]">{label}</span></label>
  if (type === 'object' || type === 'array') return <JsonField label={label} value={effective ?? (type === 'array' ? [] : {})} onChange={onChange}/>
  if (['prompt','system_prompt','image_urls','mask_image_url'].includes(name)) return <label className="block"><SectionLabel>{label}</SectionLabel><textarea rows={name === 'system_prompt' ? 3 : name === 'mask_image_url' ? 2 : 4} className={`${inputClass} resize-y`} value={String(effective ?? '')} placeholder={name === 'image_urls' ? 'e.g. https://example.com/image.jpeg' : name === 'mask_image_url' ? 'e.g. https://example.com/mask.png' : name === 'prompt' ? "What's in this image?" : undefined} onChange={e => onChange(e.target.value)} />{schema?.description && <span className="mt-1 block text-[11px] leading-4 text-[#888]">{schema.description}</span>}</label>
  return <label className="block"><SectionLabel>{label}</SectionLabel><input type={type === 'number' || type === 'integer' ? 'number' : 'text'} min={schema?.minimum} max={schema?.maximum} className={inputClass} value={String(effective ?? '')} onChange={e => onChange(type === 'number' || type === 'integer' ? (e.target.value === '' ? null : Number(e.target.value)) : e.target.value)} />{schema?.description && <span className="mt-1 block text-[11px] leading-4 text-[#888]">{schema.description}</span>}</label>
}

function ProviderModelField({ provider, action, value, onChange }: { provider: 'OpenAI' | 'Gemini'; action: string; value: string; onChange: (value: string) => void }) {
  const options = provider === 'Gemini' ? modelsForGeminiAction(action) : modelsForOpenAIAction(action)
  const known = options.some(option => option.id === value)
  const [mode, setMode] = useState<'list' | 'custom'>(known ? 'list' : 'custom')
  useEffect(() => { setMode(options.some(option => option.id === value) ? 'list' : 'custom') }, [action, value])
  const selected = options.find(option => option.id === value)
  return <div className="space-y-2"><SectionLabel>Model</SectionLabel><div className="flex overflow-hidden rounded-lg border border-[#dedede] bg-white focus-within:border-[#9461fc] focus-within:ring-2 focus-within:ring-[#9461fc]/10">
    <select aria-label="Model source" className="w-[112px] shrink-0 border-0 border-r border-[#e3e3e3] bg-[#fafafa] px-3 text-[12px] outline-none" value={mode} onChange={event => { const next = event.target.value as 'list'|'custom'; setMode(next); if (next === 'list') onChange(options[0].id) }}><option value="list">From list</option><option value="custom">By model ID</option></select>
    {mode === 'list' ? <select aria-label={`${provider} model`} className="min-h-10 min-w-0 flex-1 border-0 bg-white px-3 py-2 text-[13px] outline-none" value={known ? value : options[0].id} onChange={event => onChange(event.target.value)}>{options.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}</select>
      : <input aria-label={`Custom ${provider} model ID`} className="min-h-10 min-w-0 flex-1 border-0 px-3 py-2 font-mono text-[12px] outline-none" value={value} placeholder={provider === 'Gemini' ? 'gemini-3.8-flash' : 'gpt-6.1-sol'} onChange={event => onChange(event.target.value)}/>}</div>
    <p className="text-[11px] leading-4 text-[#888]">{selected?.description ?? `Use an exact model ID available to the configured ${provider} API project.`}</p>
  </div>
}

export function WorkflowNodeEditor({ studio, onClose, onExecuteStep, onManageCredentials }: Props) {
  const {
    projectId, selected, selectedCatalog, run, working, save, start, updateSelectedSetting, updateNode,
    sourceId, setSourceId, sources, editorMedia, useMediaSource, fileInput, upload,
  } = studio
  const [tab, setTab] = useState<Tab>('parameters')
  const [mobilePanel, setMobilePanel] = useState<MobilePanel>('parameters')
  const [inputView, setInputView] = useState<DataView>('schema')
  const [outputView, setOutputView] = useState<DataView>('schema')
  const [inputValue, setInputValue] = useState<unknown>(null)
  const [outputValue, setOutputValue] = useState<unknown>(null)
  const [loadingData, setLoadingData] = useState(false)
  const [localError, setLocalError] = useState('')
  const [testing, setTesting] = useState(false)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [openAIConfigured, setOpenAIConfigured] = useState<boolean | null>(null)
  const [geminiConfigured, setGeminiConfigured] = useState<boolean | null>(null)
  const [ollamaStatus, setOllamaStatus] = useState<{ configured: boolean; reachable: boolean; base_url: string; models: string[] } | null>(null)
  const dataRequestRef = useRef(0)
  const layoutRef = useRef<HTMLDivElement>(null)
  const activeResize = useRef<{ side: 'input' | 'output'; startX: number; sizes: [number, number, number] } | null>(null)
  const triggerResizeRef = useRef<{ startX: number; startWidth: number } | null>(null)
  const [triggerParametersWidth, setTriggerParametersWidth] = useState(() => {
    try {
      const saved = Number(window.localStorage.getItem('cliptora.workflow.nodeEditor.triggerParametersWidth'))
      if (Number.isFinite(saved) && saved >= 25 && saved <= 75) return saved
    } catch {}
    return 38
  })
  const [panelSizes, setPanelSizes] = useState<[number, number, number]>(() => {
    try {
      const saved = JSON.parse(window.localStorage.getItem('cliptora.workflow.nodeEditor.panelSizes') ?? 'null') as unknown
      if (Array.isArray(saved) && saved.length === 3 && saved.every(x => typeof x === 'number' && Number.isFinite(x) && x >= 16) && Math.abs(saved.reduce((a: number,b: number) => a + b, 0) - 100) < 1) return [saved[0], saved[1], saved[2]]
    } catch { /* Use default pane proportions. */ }
    return [33, 34, 33]
  })
  const [dataSearchOpen, setDataSearchOpen] = useState<'input' | 'output' | null>(null)
  const [inputQuery, setInputQuery] = useState('')
  const [outputQuery, setOutputQuery] = useState('')
  const [selectedInputId, setSelectedInputId] = useState('')
  const [copyStatus, setCopyStatus] = useState('')

  const resizePanels = useCallback((sizes: [number, number, number], side: 'input' | 'output', delta: number): [number, number, number] => {
    if (side === 'input') {
      const first = Math.max(17, Math.min(sizes[0] + sizes[1] - 27, sizes[0] + delta))
      return [first, sizes[0] + sizes[1] - first, sizes[2]]
    }
    const middle = Math.max(27, Math.min(sizes[1] + sizes[2] - 17, sizes[1] + delta))
    return [sizes[0], middle, sizes[1] + sizes[2] - middle]
  }, [])

  const onTriggerResizePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    triggerResizeRef.current = { startX: event.clientX, startWidth: triggerParametersWidth }
    event.currentTarget.setPointerCapture(event.pointerId)
  }
  const onResizePointerDown = (event: ReactPointerEvent<HTMLDivElement>, side: 'input' | 'output') => {
    if (event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    activeResize.current = { side, startX: event.clientX, sizes: panelSizes }
    event.currentTarget.setPointerCapture(event.pointerId)
  }
  const onResizeMove = useCallback((event: PointerEvent) => {
    const triggerState = triggerResizeRef.current
    const triggerWidth = layoutRef.current?.clientWidth
    if (triggerState && triggerWidth) {
      setTriggerParametersWidth(Math.max(25, Math.min(75,
        triggerState.startWidth + 100 * (event.clientX - triggerState.startX) / Math.max(1, triggerWidth - 9))))
      return
    }
    const state = activeResize.current
    const width = layoutRef.current?.clientWidth
    if (!state || !width) return
    setPanelSizes(resizePanels(state.sizes, state.side, ((event.clientX - state.startX) / Math.max(1, width - 18)) * 100))
  }, [resizePanels])
  const onResizeStop = useCallback(() => {
    if (triggerResizeRef.current) {
      triggerResizeRef.current = null
      setTriggerParametersWidth(current => {
        try { window.localStorage.setItem('cliptora.workflow.nodeEditor.triggerParametersWidth', String(current)) } catch {}
        return current
      })
      return
    }
    if (!activeResize.current) return
    activeResize.current = null
    setPanelSizes(current => {
      try { window.localStorage.setItem('cliptora.workflow.nodeEditor.panelSizes', JSON.stringify(current)) } catch {}
      return current
    })
  }, [])
  useEffect(() => {
    window.addEventListener('pointermove', onResizeMove)
    window.addEventListener('pointerup', onResizeStop)
    window.addEventListener('pointercancel', onResizeStop)
    return () => {
      window.removeEventListener('pointermove', onResizeMove)
      window.removeEventListener('pointerup', onResizeStop)
      window.removeEventListener('pointercancel', onResizeStop)
    }
  }, [onResizeMove, onResizeStop])
  const onResizeKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>, side: 'input' | 'output') => {
    if (!['ArrowLeft', 'ArrowRight', 'Home'].includes(event.key)) return
    event.preventDefault()
    const next = event.key === 'Home' ? [33, 34, 33] as [number, number, number] : resizePanels(panelSizes, side, event.key === 'ArrowLeft' ? -3 : 3)
    setPanelSizes(next)
    try { window.localStorage.setItem('cliptora.workflow.nodeEditor.panelSizes', JSON.stringify(next)) } catch {}
  }

  const selectedType = selected?.type?.toLowerCase() ?? ''
  const selectedLabel = (selectedCatalog?.label ?? '').toLowerCase()
  const isManualTrigger = /manual[._-]?trigger|trigger[._-]?manual|when[._ -]?click|execute[._ -]?workflow/.test(`${selectedType} ${selectedLabel}`)
  const isEntryTrigger = selected != null && selected.depends_on.length === 0 &&
    (/trigger|webhook|schedule|cron/.test(selectedType) || /trigger|when clicking/.test(selectedLabel) || isManualTrigger)
  const onTriggerResizeKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home'].includes(event.key)) return
    event.preventDefault()
    const next = event.key === 'Home' ? 38 : Math.max(25, Math.min(75, triggerParametersWidth + (event.key === 'ArrowLeft' ? -3 : 3)))
    setTriggerParametersWidth(next)
    try { window.localStorage.setItem('cliptora.workflow.nodeEditor.triggerParametersWidth', String(next)) } catch {}
  }
  useEffect(() => {
    if (isEntryTrigger && mobilePanel === 'input') setMobilePanel('parameters')
  }, [isEntryTrigger, mobilePanel])

  const openAINode = selected?.type === 'ai.openai'
  const geminiNode = selected?.type === 'ai.gemini'
  const ollamaNode = selected?.type === 'ai.ollama'
  const providerNode = openAINode || geminiNode || ollamaNode
  const agentNode = selected?.type === 'ai.agent'
  const providerAction = String(selected?.settings?.action ?? 'message_model')
  const providerCapability = selectedCatalog?.action_capabilities?.[providerAction]
  const providerResource = providerAction.includes('image') ? 'Image'
    : providerAction.includes('audio') || providerAction.includes('recording') ? 'Audio'
      : providerAction.includes('file_search') ? 'File Search'
        : providerAction.includes('file') || providerAction.includes('document') ? 'File'
          : providerAction.includes('conversation') ? 'Conversation'
            : providerAction.includes('video') ? 'Video'
            : 'Text'
  const title = providerNode ? (providerCapability?.label ?? selectedCatalog?.label ?? 'AI') : selectedCatalog?.label ?? selected?.type ?? 'Node'
  const isApp = /excel|gmail|google|telegram|outlook|onedrive|openai|gemini|ollama|anthropic/i.test(`${title} ${selected?.type ?? ''}`)
  const selectedId = selected?.id
  const result = selectedId ? run?.results?.[selectedId] : undefined
  const dependencies = useMemo(() => selected?.depends_on ?? [], [selected?.depends_on])
  const settings = selected?.settings ?? {}
  const actions = selectedCatalog?.actions ?? []
  const schema = getObject(selectedCatalog?.parameters_schema)
  const properties = getObject(schema.properties) as Record<string, FieldSchema>
  const excelNode = isExcel(`${title} ${selected?.type ?? ''}`)
  const sourceNode = selected?.type === 'core.video_source'
  const excelDefaults: Record<string, FieldSchema> = excelNode ? {
    return_all: { type: 'boolean', title: 'Return All', default: false },
    limit: { type: 'integer', title: 'Limit', default: 100, minimum: 1 },
    fields: { type: 'string', title: 'Fields' },
  } : {}
  const fields = { ...excelDefaults, ...properties }
  const openAIFields: Record<string, string[]> = {
    message_model: ['reasoning_effort','system_prompt','prompt','input_path','max_output_tokens'],
    classify_violations: ['prompt','input_path','simplify_output'],
    analyze_image: ['reasoning_effort','prompt','image_urls','max_output_tokens','simplify_output'],
    generate_image: ['prompt','image_size','simplify_output'],
    edit_image: ['prompt','image_urls','mask_image_url','image_size','image_input_fidelity','simplify_output'],
  }
  const geminiFields: Record<string, string[]> = {
    message_model: ['system_prompt','prompt','input_path','max_output_tokens','simplify_output'],
    generate_image: ['prompt','input_path','image_aspect_ratio','simplify_output'],
    create_file_search_store: ['display_name'],
    delete_file_search_store: ['store_name'],
    list_file_search_stores: [],
  }
  const ollamaFields: Record<string, string[]> = {
    message_model: ['system_prompt','prompt','input_path','temperature','max_output_tokens','simplify_output'],
    analyze_image: ['system_prompt','prompt','image_urls','input_path','temperature','max_output_tokens','simplify_output'],
  }
  const allKeys = [...new Set([...Object.keys(fields), ...Object.keys(settings)])].filter(key => !['credential_id','credential','operation','action','resource','filters','source_id','__cliptora_ui_source_handles','__cliptora_ui_target_handles','__cliptora_ui_notes','__cliptora_ui_note_visible','__cliptora_ui_label','__cliptora_ui_pinned'].includes(key))
  const keys = openAINode ? (openAIFields[providerAction] ?? []) : geminiNode ? (geminiFields[providerAction] ?? []) : ollamaNode ? (ollamaFields[providerAction] ?? []) : allKeys
  const operationKey = Object.prototype.hasOwnProperty.call(settings, 'action') && !Object.prototype.hasOwnProperty.call(settings, 'operation') ? 'action' : 'operation'
  const resourceValue = String(settings.resource ?? (excelNode ? 'Workbook' : 'Message'))
  const operationValue = String(settings[operationKey] ?? (actions[0] ?? ''))
  const credentialNeeded = !ollamaNode && (isApp || Boolean(selectedCatalog?.credentials?.length))
  const targetHandles = getObject(settings.__cliptora_ui_target_handles)
  const agentInputs = Object.values(targetHandles).map(String)
  const hasAgentModel = !agentNode || agentInputs.includes('chat_model')
  const requiresOpenAI = openAINode || agentNode
  const requiresGemini = geminiNode
  const requiresOllama = ollamaNode

  useEffect(() => {
    if (!requiresOpenAI) { setOpenAIConfigured(null); return }
    let active = true
    api<{ configured: boolean }>('/workflows/openai/status')
      .then(status => { if (active) setOpenAIConfigured(status.configured) })
      .catch(() => { if (active) setOpenAIConfigured(false) })
    return () => { active = false }
  }, [requiresOpenAI])

  useEffect(() => {
    if (!requiresGemini) { setGeminiConfigured(null); return }
    let active = true
    api<{ configured: boolean }>('/workflows/gemini/status')
      .then(status => { if (active) setGeminiConfigured(status.configured) })
      .catch(() => { if (active) setGeminiConfigured(false) })
    return () => { active = false }
  }, [requiresGemini])

  useEffect(() => {
    if (!requiresOllama) { setOllamaStatus(null); return }
    let active = true
    api<{ configured: boolean; reachable: boolean; base_url: string; models: string[] }>('/workflows/ollama/status')
      .then(status => { if (active) setOllamaStatus(status) })
      .catch(() => { if (active) setOllamaStatus({ configured: false, reachable: false, base_url: 'http://host.docker.internal:11434', models: [] }) })
    return () => { active = false }
  }, [requiresOllama])

  const changeProviderAction = (action: string) => {
    if (!selected) return
    const model = geminiNode ? defaultModelForGeminiAction(action) : ollamaNode ? String(selected.settings.model || ollamaStatus?.models[0] || 'gemma3') : defaultModelForOpenAIAction(action)
    updateNode(selected.id, { settings: { ...selected.settings, action, model, ...(openAINode && (action === 'message_model' || action === 'analyze_image') ? { reasoning_effort: 'none' } : {}) } })
  }

  const loadData = useCallback(async () => {
    if (!selectedId) return
    const request = ++dataRequestRef.current
    setLocalError('')
    setLoadingData(true)
    setInputValue(null)
    setOutputValue(null)
    try {
      let nextInput: unknown = null
      let nextOutput: unknown = null
      if (run) {
        const parentEntries = await Promise.all(dependencies.map(async id => {
          const info = run.results?.[id]
          if (!info) return [id, null] as const
          if (!info.artifact || info.state !== 'completed') return [id, info] as const
          try { return [id, await api<JsonObject>(`/workflows/${projectId}/runs/${run.id}/artifacts/${encodeURIComponent(id)}`)] as const }
          catch { return [id, info] as const }
        }))
        if (parentEntries.length) nextInput = Object.fromEntries(parentEntries)
        if (result) {
          nextOutput = result
          if (result.artifact && result.state === 'completed') {
            try { nextOutput = await api<JsonObject>(`/workflows/${projectId}/runs/${run.id}/artifacts/${encodeURIComponent(selectedId)}`) }
            catch (error) { if (dataRequestRef.current === request) setLocalError(error instanceof Error ? error.message : String(error)) }
          }
        }
      }
      if (dataRequestRef.current === request) {
        setInputValue(nextInput)
        setOutputValue(nextOutput)
      }
    } catch (error) {
      if (dataRequestRef.current === request) setLocalError(error instanceof Error ? error.message : String(error))
    } finally {
      if (dataRequestRef.current === request) setLoadingData(false)
    }
  }, [dependencies, projectId, result?.state, result?.artifact, run?.id, selectedId])

  useEffect(() => { void loadData(); return () => { dataRequestRef.current += 1 } }, [loadData])
  useEffect(() => { const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }; document.addEventListener('keydown', onKey); return () => document.removeEventListener('keydown', onKey) }, [onClose])

  const execute = async () => {
    if (!selected || !onExecuteStep) return
    setLocalError(''); setTesting(true)
    try { await onExecuteStep(selected.id); await loadData() }
    catch (error) { setLocalError(error instanceof Error ? error.message : String(error)) }
    finally { setTesting(false) }
  }

  const inputSources: InspectorSource[] = dependencies.map(id => {
    const node = studio.nodes.find(node => node.id === id)
    const sourceName = typeof node?.settings.__cliptora_ui_label === 'string' && node.settings.__cliptora_ui_label.trim()
      ? node.settings.__cliptora_ui_label
      : studio.catalog.find(item => item.type === node?.type)?.label ?? id
    return { id, label: sourceName, value: getObject(inputValue)[id] }
  })
  const activeInput = inputSources.find(source => source.id === selectedInputId) ?? inputSources[0]

  const copyData = async (side: 'input' | 'output', value: unknown) => {
    try {
      await navigator.clipboard.writeText(formatJSON(value))
      setCopyStatus(`${side.toUpperCase()} JSON copied`)
    } catch {
      setCopyStatus('Clipboard permission required')
    }
  }

  const infoTabs = (side: 'input' | 'output', view: DataView, setView: (view: DataView) => void) => <div role="tablist" aria-label={`${side} data view`} className="flex shrink-0 items-center rounded-lg bg-[#e9e9eb] p-[3px]">
    {(['schema','table','json'] as const).map(mode => <button key={mode} role="tab" aria-selected={view === mode} type="button" onClick={() => setView(mode)} className={`rounded-md px-2.5 py-1.5 text-[12px] capitalize transition-colors ${view === mode ? 'bg-white font-medium text-[#222] shadow-sm' : 'text-[#5b5b5f] hover:text-[#222]'}`}>{mode === 'json' ? 'JSON' : titleize(mode)}</button>)}
  </div>

  const dataPanel = (side: 'input'|'output') => {
    const left = side === 'input'
    const view = left ? inputView : outputView
    const setView = left ? setInputView : setOutputView
    const value = left ? activeInput?.value ?? null : outputValue
    const query = left ? inputQuery : outputQuery
    const setQuery = left ? setInputQuery : setOutputQuery
    const known = left ? inputSources.length > 0 && inputSources.some(source => source.value != null) : value != null
    return <section className={`min-h-0 min-w-0 w-full flex-col overflow-hidden bg-[#f7f7f7] ${mobilePanel === side ? 'flex' : 'hidden'} lg:flex`} aria-label={`${side.toUpperCase()} data`}>
      <div className="flex min-h-[54px] shrink-0 items-center justify-between gap-2 border-b border-[#e3e3e3] px-3">
        <span className="text-[12px] font-medium tracking-[0.13em] text-[#777]">{side.toUpperCase()}</span>
        <div className="flex min-w-0 items-center gap-2">
          <button type="button" aria-label={`Search ${side} data`} title="Search data" onClick={() => setDataSearchOpen(v => v === side ? null : side)} className="grid size-8 shrink-0 place-items-center rounded-md text-[#aaa] hover:bg-[#e9e9e9] hover:text-[#444]"><Search size={17}/></button>
          {(left || known) && infoTabs(side, view, setView)}
        </div>
      </div>
      {dataSearchOpen === side && <div className="flex h-[44px] shrink-0 gap-2 border-b border-[#e7e7e7] p-1.5"><input autoFocus type="search" aria-label={`Filter ${side} data`} value={query} onChange={event => setQuery(event.target.value)} placeholder="Search fields or values..." className="min-w-0 flex-1 rounded-md border border-[#d4d4d4] bg-white px-2.5 text-[12px] outline-none focus:border-[#9461fc]"/><button type="button" title="Close search" onClick={() => { setDataSearchOpen(null); setQuery('') }} className="rounded-md px-2 text-[#777] hover:bg-[#e9e9e9]"><X size={15}/></button></div>}
      {left && inputSources.length > 0 && <div className="flex min-h-[49px] shrink-0 items-center gap-2 border-b border-[#ededed] px-3">
        <span className="grid size-6 shrink-0 place-items-center"><BrandIcon type={studio.nodes.find(node => node.id === activeInput?.id)?.type ?? ''} text={activeInput?.label ?? 'Input'} size={21}/></span>
        <select aria-label="Select upstream node input" className="min-w-0 flex-1 truncate rounded-md border border-[#dedede] bg-white px-2 py-1.5 text-[12px] text-[#333] outline-none focus:border-[#9461fc]" value={activeInput?.id ?? ''} onChange={e => setSelectedInputId(e.target.value)}>
          {inputSources.map(source => <option key={source.id} value={source.id}>{source.label}</option>)}
        </select>
        <span className="shrink-0 whitespace-nowrap text-[11px] text-[#888]">{countItems(value)} items</span>
        <button type="button" onClick={() => void loadData()} title="Refresh data" aria-label="Refresh input data" className="grid size-7 shrink-0 place-items-center rounded-md text-[#888] hover:bg-[#e8e8e8]"><RefreshCw size={14} className={loadingData ? 'animate-spin' : ''}/></button>
      </div>}
      {!left && known && <div className="flex h-[34px] shrink-0 items-center justify-between border-b border-[#ededed] px-3 text-[11px] text-[#999]"><span>{countItems(value)} items</span><button type="button" onClick={() => void loadData()} aria-label="Refresh output data" title="Refresh" className="hover:text-[#555]"><RefreshCw size={14} className={loadingData ? 'animate-spin' : ''}/></button></div>}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {loadingData && !known ? <div className="flex h-full items-center justify-center gap-2 text-xs text-[#888]"><LoaderCircle size={16} className="animate-spin"/> Loading data…</div>
          : value != null ? <DataInspector value={value} view={view} label={side} query={query} onCopy={() => void copyData(side, value)}/>
          : <EmptyData
              title={!left && isEntryTrigger ? 'No trigger output' : left ? 'No input data' : 'No output data'}
              icon={!left && isEntryTrigger ? <Zap size={23} fill="currentColor" strokeWidth={1.3} /> : undefined}
              message={!left && isEntryTrigger ? 'Run the trigger to inspect its real output.' : left ? 'Run the workflow to load actual upstream data.' : 'Run this node or workflow to inspect execution results.'}
              action={<button type="button" disabled={working || testing || (requiresOpenAI && openAIConfigured === false) || (requiresGemini && geminiConfigured === false) || (requiresOllama && ollamaStatus?.reachable === false)} onClick={() => void (left ? start() : onExecuteStep && selected ? execute() : start())} className={lightButton}><Play size={13}/>{!left && isEntryTrigger ? 'Test this trigger' : left ? 'Run workflow' : onExecuteStep ? 'Execute step' : 'Run workflow'}</button>}
            /> }
        {left && <details className="mx-3 mt-4 border-t border-[#e3e3e3] py-3 text-xs text-[#555]"><summary className="cursor-pointer font-medium text-[#555]">Variables and context</summary><div className="mt-2 space-y-1 font-mono text-[11px] text-[#777]"><p>projectId: {projectId}</p><p>workflowRunId: {run?.id ?? 'Not executed'}</p><p>nodeId: {selectedId}</p></div></details>}
      </div>
    </section>
  }

  if (!selected) return null
  const view = <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 p-1 sm:p-5" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
    <div role="dialog" aria-modal="true" aria-label={`${title} node configuration`} className="flex h-[min(92dvh,960px)] w-full max-w-[1780px] flex-col overflow-hidden rounded-2xl border border-[#d5d5d5] bg-white text-[#292929] shadow-[0_35px_110px_#0005]">
      <header className="relative flex min-h-[48px] shrink-0 items-center justify-between gap-3 border-b border-[#e6e6e6] bg-white px-4 py-0.5">
        <div className="flex min-w-0 max-w-[44%] items-center gap-2 sm:max-w-[36%]"><BrandIcon text={title} type={selected.type}/><span className="truncate text-[14px] font-medium text-[#212121]">{title}</span></div>
        <div className="flex shrink-0 items-center gap-3">{providerNode && <a href={geminiNode ? 'https://ai.google.dev/gemini-api/docs' : ollamaNode ? 'https://docs.ollama.com/api/chat' : 'https://platform.openai.com/docs'} target="_blank" rel="noreferrer" className="hidden text-[12px] font-medium text-[#555] underline underline-offset-2 hover:text-[#111] lg:block">Docs ↗</a>}<span className="hidden text-[11px] text-[#888] 2xl:block">Node: {selected.id}</span><button type="button" onClick={onClose} aria-label="Close node editor" title="Close" className="rounded-md p-1.5 text-[#444] hover:bg-[#f4f4f4]"><X size={22}/></button></div>
      </header>
      <nav aria-label="Node editor sections" className="flex shrink-0 items-center justify-around border-b border-[#e5e5e5] bg-white px-1 py-1 lg:hidden">{(isEntryTrigger ? ['parameters','output'] as const : ['input','parameters','output'] as const).map(panel => <button key={panel} type="button" onClick={() => setMobilePanel(panel)} className={`rounded-lg px-3 py-2 text-xs font-semibold capitalize ${mobilePanel === panel ? 'bg-violet-100 text-violet-800' : 'text-[#888]'}`}>{panel}</button>)}</nav>
      <div ref={layoutRef} className="flex min-h-0 flex-1 overflow-hidden lg:grid" style={{ gridTemplateColumns: isEntryTrigger
        ? `${triggerParametersWidth}fr 9px ${100 - triggerParametersWidth}fr`
        : `${panelSizes[0]}fr 9px ${panelSizes[1]}fr 9px ${panelSizes[2]}fr` }}>
        {!isEntryTrigger && dataPanel('input')}
        {!isEntryTrigger && <PanelDivider side="input" onPointerDown={onResizePointerDown} onKeyDown={onResizeKeyDown} />}
        <section className={`${mobilePanel === 'parameters' ? 'flex' : 'hidden'} min-h-0 min-w-0 w-full flex-col bg-white lg:flex`}>
          <div className="flex h-[54px] shrink-0 items-center justify-between gap-2 border-b border-[#e5e5e5] px-4">
            <div className="flex h-full gap-5">{(['parameters','settings'] as const).map(t => <button type="button" key={t} onClick={() => setTab(t)} className={`relative text-[13px] font-medium capitalize ${tab === t ? 'text-[#202020] after:absolute after:bottom-0 after:left-0 after:h-[2px] after:w-full after:bg-[#202020]' : 'text-[#666]'}`}>{t}</button>)}</div>
            <button type="button" disabled={!onExecuteStep || testing || working || !hasAgentModel || (requiresOpenAI && openAIConfigured === false) || (requiresGemini && geminiConfigured === false) || (requiresOllama && ollamaStatus?.reachable === false)} onClick={() => void execute()} title={!hasAgentModel ? 'Connect an OpenAI Chat Model to the required Chat Model port first.' : requiresOpenAI && openAIConfigured === false ? 'Configure OPENAI_API_KEY in the backend environment first.' : requiresGemini && geminiConfigured === false ? 'Configure GEMINI_API_KEY in the backend environment first.' : requiresOllama && ollamaStatus?.reachable === false ? 'Start Ollama and make it reachable from the backend first.' : !onExecuteStep ? 'Single-node execution requires a backend executor; Run workflow is available.' : 'Execute this node only'} className="inline-flex  shrink-0 items-center gap-1.5 rounded-full bg-[#242424] px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-[#404040] disabled:cursor-not-allowed disabled:opacity-45">{testing ? <LoaderCircle size={15} className="animate-spin"/> : <Play size={14}/>} Execute step</button>
          </div>
          <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-5 [scrollbar-width:thin]">
            {localError && <div role="alert" className="flex gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-[12px] text-red-700"><CircleAlert size={16} className="shrink-0"/>{localError}</div>}
            {requiresOpenAI && openAIConfigured === false && <div role="alert" className="flex gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-[12px] leading-5 text-amber-900"><CircleAlert size={16} className="mt-0.5 shrink-0"/><span><strong className="block">OpenAI API key is not configured</strong>Add <code>OPENAI_API_KEY</code> to the backend environment, then recreate the backend container. Model execution stays disabled until the secret is available.</span></div>}
            {requiresGemini && geminiConfigured === false && <div role="alert" className="flex gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-[12px] leading-5 text-amber-900"><CircleAlert size={16} className="mt-0.5 shrink-0"/><span><strong className="block">Gemini API key is not configured</strong>Add <code>GEMINI_API_KEY</code> to the backend environment, then recreate the backend container. Gemini execution stays disabled until the secret is available.</span></div>}
            {requiresOllama && ollamaStatus?.reachable === false && <div role="alert" className="flex gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-[12px] leading-5 text-amber-900"><CircleAlert size={16} className="mt-0.5 shrink-0"/><span><strong className="block">Ollama is not running</strong>Start Ollama on the host and keep <code>OLLAMA_BASE_URL</code> reachable from the backend. Execution stays disabled until <code>/api/tags</code> responds.</span></div>}
            {tab === 'parameters' ? <>
              {isManualTrigger ? <>
                <div className="rounded-[9px] border border-[#eab308] bg-[#fffbeb] p-3 text-[12px] leading-[1.5] text-[#66461c]">
                  This node starts the workflow when you manually execute it. Other trigger types can start workflows from schedules or incoming events.
                </div>
                <p className="text-[13px] text-[#454545]">This node does not have any parameters.</p>
              </> : agentNode ? <>
                {!hasAgentModel && <div role="alert" className="flex gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-[12px] leading-5 text-red-700"><CircleAlert size={17} className="mt-0.5 shrink-0"/><span><strong className="block">Chat Model is required</strong>Connect an OpenAI Chat Model using the bottom port on the canvas.</span></div>}
                <label className="block"><SectionLabel>Source for Prompt (User Message)</SectionLabel><select className={inputClass} value={String(settings.prompt_source ?? 'connected_chat_trigger')} onChange={event => updateSelectedSetting('prompt_source', event.target.value)}><option value="connected_chat_trigger">Connected Chat Trigger Node</option><option value="define_below">Define below</option></select></label>
                <label className="block"><SectionLabel>Prompt (User Message)</SectionLabel><textarea rows={3} className={`${inputClass} resize-y font-mono`} value={String(settings.prompt ?? '')} onChange={event => updateSelectedSetting('prompt', event.target.value)} placeholder="{{ $json.chatInput }}"/><span className="mt-1 block text-[11px] text-[#888]">Connected mode reads <code>chatInput</code> from upstream data. Define below uses this text directly.</span></label>
                <DynamicField name="require_specific_output" schema={fields.require_specific_output} value={settings.require_specific_output ?? false} onChange={value => updateSelectedSetting('require_specific_output', value)}/>
                <DynamicField name="enable_fallback_model" schema={fields.enable_fallback_model} value={settings.enable_fallback_model ?? false} onChange={value => updateSelectedSetting('enable_fallback_model', value)}/>
                <div><div className="flex items-center justify-between border-b border-[#e7e7e7] pb-2"><SectionLabel>Options</SectionLabel><button type="button" onClick={() => setFiltersOpen(value => !value)} title="Add options" aria-expanded={filtersOpen} className="grid size-7 place-items-center rounded-md text-[#555] hover:bg-[#f3f3f3]"><Plus size={21}/></button></div>{filtersOpen && <div className="space-y-4 pt-4"><DynamicField name="system_message" schema={fields.system_message} value={settings.system_message} onChange={value => updateSelectedSetting('system_message', value)}/>{Boolean(settings.enable_fallback_model) && <DynamicField name="fallback_model" schema={fields.fallback_model} value={settings.fallback_model} onChange={value => updateSelectedSetting('fallback_model', value)}/>}</div>}</div>
                <div className="rounded-lg border border-[#e7e7e7] bg-[#fafafa] p-3 text-[11px] leading-5 text-[#777]">Connected Memory and Tool nodes are supplied as bounded JSON context. The agent never evaluates arbitrary code or stores secrets in workflow JSON.</div>
              </> : <>
              {sourceNode && <div className="space-y-5 rounded-xl border border-[#e5e5e5] bg-[#fafafa] p-4">
                <div className="flex items-center gap-2"><Film size={18} className="text-[#7950bd]"/><div><strong className="block text-[13px] font-semibold text-[#292929]">Source Video</strong><span className="text-[11px] text-[#858585]">Choose the video this workflow will process.</span></div></div>
                <label className="block"><SectionLabel>Workflow source</SectionLabel><select aria-label="Workflow source video" className={inputClass} value={sourceId ?? ''} onChange={event => setSourceId(event.target.value ? Number(event.target.value) : null)}><option value="">Select a video...</option>{sources.map(source => <option key={source.id} value={source.id}>{source.filename}</option>)}</select></label>
                <label className="block"><SectionLabel>Use from Media Library</SectionLabel><select aria-label="Link video from Media Library" className={inputClass} value="" disabled={working} onChange={event => { const id = Number(event.target.value); if (id > 0) void useMediaSource(id) }}><option value="">Choose a video...</option>{editorMedia.filter(item => item.kind === 'video').map(item => <option key={item.id} value={item.id}>{mediaName(item)}</option>)}</select></label>
                <input ref={fileInput} type="file" accept=".mp4,.mov,.mkv,.webm,.m4v" className="hidden" onChange={event => void upload(event)} />
                <button type="button" disabled={working} onClick={() => fileInput.current?.click()} className="flex h-10 w-full items-center justify-center gap-2 rounded-lg border border-[#dedede] bg-white text-xs font-semibold text-[#333] hover:bg-[#f4f4f4] disabled:cursor-not-allowed disabled:opacity-50"><Upload size={15}/> Upload video</button>
                <p className="flex gap-2 text-[11px] leading-5 text-[#777]"><FolderOpen size={14} className="mt-0.5 shrink-0"/>Originals stay unchanged. The selected source is saved with this node.</p>
              </div>}
              {credentialNeeded && <div className="space-y-2"><SectionLabel>Credential</SectionLabel><button type="button" disabled={!onManageCredentials} onClick={onManageCredentials} title={onManageCredentials ? 'Manage credentials' : providerNode ? `${geminiNode ? 'Gemini' : 'OpenAI'} uses the backend environment credential` : 'Credential management is not yet connected to the backend'} className={`${lightButton} rounded-lg px-3` }><BrandIcon text={title} type={selected.type} size={18}/>{settings.credential_id ? `Credential ${String(settings.credential_id)}` : `Connect to ${geminiNode ? 'Google Gemini' : openAINode ? 'OpenAI' : isExcel(`${title} ${selected.type}`) ? 'Microsoft Excel' : title}`}</button>{!onManageCredentials && <p className="text-[11px] leading-5 text-[#888]">{providerNode ? `Uses ${geminiNode ? 'GEMINI_API_KEY' : 'OPENAI_API_KEY'} configured securely in the backend environment.` : 'Configure OAuth credentials through a dedicated backend credential manager. Secrets must never be stored in workflow JSON.'}</p>}</div>}
              {ollamaNode && <div className="space-y-2 rounded-lg border border-[#e5e5e5] bg-[#fafafa] p-3"><SectionLabel>Local Ollama connection</SectionLabel><p className="break-all font-mono text-[11px] text-[#555]">{ollamaStatus?.base_url ?? 'Checking local server…'}</p><p className="text-[11px] leading-5 text-[#777]">{ollamaStatus?.reachable ? `${ollamaStatus.models.length} installed model${ollamaStatus.models.length === 1 ? '' : 's'} detected.` : 'No API key is required. Start Ollama on the host to enable execution.'}</p></div>}
              {excelNode && <div className="rounded-lg border border-amber-400 bg-[#fffae6] p-3 text-[12px] leading-[1.45] text-[#68471c]">Microsoft Excel 365 works with workbooks in OneDrive or SharePoint. Local .xlsx files need a different file-processing tool.</div>}
              {providerNode
                ? <label className="block"><SectionLabel>Resource</SectionLabel><select className={inputClass} value={providerResource} disabled><option>{providerResource}</option></select></label>
                : (isApp || Object.prototype.hasOwnProperty.call(settings,'resource')) && <DynamicField name="resource" value={resourceValue} onChange={value => updateSelectedSetting('resource',value)} schema={fields.resource}/>
              }
              {!sourceNode && (actions.length > 0 || excelNode || settings.operation != null) && <label className="block"><SectionLabel>Operation</SectionLabel>{actions.length > 0 ? <select className={inputClass} value={operationValue} onChange={e => providerNode ? changeProviderAction(e.target.value) : updateSelectedSetting(operationKey,e.target.value)}>{actions.map(action => <option key={action} value={action} disabled={selectedCatalog?.action_capabilities?.[action]?.status === 'unavailable'}>{selectedCatalog?.action_capabilities?.[action]?.label ?? titleize(action)}</option>)}</select> : <input className={`${inputClass} bg-[#f8f8f8]`} readOnly value={operationValue || (excelNode ? 'Get Many' : title)} title="This tool does not advertise selectable actions in the catalog" />}</label>}
              {providerNode && !ollamaNode && (!geminiNode || ['message_model','generate_image'].includes(providerAction)) && <ProviderModelField provider={geminiNode ? 'Gemini' : 'OpenAI'} action={providerAction} value={String(settings.model ?? (geminiNode ? defaultModelForGeminiAction(providerAction) : defaultModelForOpenAIAction(providerAction)))} onChange={value => updateSelectedSetting('model', value)}/>}
              {ollamaNode && <label className="block"><SectionLabel>Model</SectionLabel>{ollamaStatus?.models.length ? <select className={inputClass} value={String(settings.model ?? ollamaStatus.models[0])} onChange={event => updateSelectedSetting('model', event.target.value)}>{!ollamaStatus.models.includes(String(settings.model ?? '')) && <option value={String(settings.model ?? '')}>{String(settings.model ?? '')}</option>}{ollamaStatus.models.map(model => <option key={model} value={model}>{model}</option>)}</select> : <input className={inputClass} value={String(settings.model ?? 'gemma3')} placeholder="gemma3" onChange={event => updateSelectedSetting('model', event.target.value)} />}</label>}
              {keys.map(key => <DynamicField key={`${selectedId}:${key}`} name={key} schema={fields[key]} value={settings[key]} onChange={value => updateSelectedSetting(key,value)}/>)}
              {(excelNode || Object.prototype.hasOwnProperty.call(settings,'filters')) && <div><div className="flex items-center justify-between border-b border-[#e7e7e7] pb-2"><SectionLabel>Filters</SectionLabel><button type="button" onClick={() => setFiltersOpen(v => !v)} title="Edit filters" aria-expanded={filtersOpen} className="grid size-7 place-items-center rounded-md text-[#777] hover:bg-[#f3f3f3]"><Plus size={20}/></button></div>{filtersOpen && <div className="pt-3"><JsonField label="Filter rules (JSON)" value={settings.filters ?? []} onChange={value => updateSelectedSetting('filters',value)}/></div>}</div>}
              {!sourceNode && !keys.length && actions.length === 0 && !isApp && <div className="rounded-lg border border-[#e5e5e5] bg-[#fafafa] p-3 text-xs text-[#777]">This node has no registered parameter fields. Use the Settings tab for execution options, or register <code>parameters_schema</code> in the Tool Catalog.</div>}
              </>}
              {!isManualTrigger && <div className="flex flex-wrap items-center gap-2 border-t border-[#ededed] pt-4"><button type="button" className={lightButton} disabled={working} onClick={() => void save()}><Check size={14}/> Save workflow</button><button type="button" className={lightButton} disabled={working} onClick={() => void start()}><Play size={14}/> Run workflow</button></div>}
            </> : <>
              <div className="space-y-4 border-b border-[#ededed] pb-5">
                <label className="flex items-center gap-3 text-[13px] text-[#333]" title="This option requires FastAPI execution support, which is not registered.">
                  <input type="checkbox" disabled className="size-4 accent-violet-600" /> Always Output Data <span className="ml-auto text-[10px] text-[#aaa]">Not supported</span>
                </label>
                <label className="flex items-center gap-3 text-[13px] text-[#333]" title="This option requires backend execution semantics, which are not registered.">
                  <input type="checkbox" disabled className="size-4 accent-violet-600" /> Execute Once <span className="ml-auto text-[10px] text-[#aaa]">Not supported</span>
                </label>
                <label className="flex items-center gap-3 text-[13px] text-[#333]">
                  <input type="checkbox" className="size-4 accent-violet-600" checked={(selected.retry_limit ?? 1) > 0} onChange={event => updateNode(selected.id, { retry_limit: event.target.checked ? 1 : 0 })} /> Retry On Fail
                </label>
                {(selected.retry_limit ?? 1) > 0 && <label className="block"><SectionLabel>Maximum retries</SectionLabel><input type="number" min="1" max="5" className={inputClass} value={selected.retry_limit ?? 1} onChange={e => updateNode(selected.id,{retry_limit:Math.max(1,Math.min(5,Number(e.target.value)||1))})}/></label>}
                <label className="block"><SectionLabel>On Error</SectionLabel><select aria-label="On error behavior" value="stop" disabled title="The current executor stops the run when an unhandled error occurs" className={inputClass}><option value="stop">Stop Workflow</option></select></label>
                <label className="block"><SectionLabel>Notes</SectionLabel><textarea rows={4} className={`${inputClass} min-h-[100px] resize-y`} placeholder="Add a note about this node..." value={String(settings.__cliptora_ui_notes ?? '')} onChange={event => updateSelectedSetting('__cliptora_ui_notes', event.target.value)} /></label>
                <label className="flex items-center gap-3 text-[13px] text-[#333]"><input type="checkbox" className="size-4 accent-violet-600" checked={settings.__cliptora_ui_note_visible === true} onChange={event => updateSelectedSetting('__cliptora_ui_note_visible', event.target.checked)} /> Display Note in Flow</label>
                <p className="border-t border-[#ededed] pt-3 text-[11px] text-[#999]">CLIPTORA native workflow node</p>
              </div>
              <label className="block"><SectionLabel>Node ID</SectionLabel><input value={selected.id} readOnly className={`${inputClass} bg-[#f7f7f7] font-mono text-[#777]`} /></label>
              <label className="block"><SectionLabel>Execution condition</SectionLabel><select className={inputClass} value={selected.when} onChange={e => updateNode(selected.id,{when:e.target.value as WorkflowNode['when']})}>{(['always','has_video','has_transcript','ai_enabled','condition_true','condition_false','route_0','route_1','route_2','route_3','route_4','route_fallback'] as const).map(value => <option key={value} value={value}>{titleize(value)}</option>)}</select></label>
              <label className="flex cursor-pointer items-center gap-2 text-[13px] text-[#444]"><input type="checkbox" className="size-4 accent-violet-600" checked={selected.cache ?? true} onChange={e=>updateNode(selected.id,{cache:e.target.checked})}/> Cache result for retries</label>
              <div className="space-y-2"><SectionLabel>Previous nodes</SectionLabel>{dependencies.length ? dependencies.map(id => <div key={id} className="flex items-center gap-2 rounded-lg border border-[#eee] p-2 text-xs text-[#555]"><ArrowLeft size={13}/>{id}</div>) : <p className="text-xs text-[#999]">No previous nodes connected.</p>}</div>
              <JsonField label="All node parameters (JSON)" value={settings} onChange={value=>updateNode(selected.id,{settings:getObject(value)})}/>
            </>}
          </div>
          {agentNode ? <footer className="grid h-[66px] shrink-0 grid-cols-3 border-t border-[#e7e7e7] px-3 text-center text-[11px] text-[#555]">{[['chat_model','Chat Model *'],['memory','Memory'],['tool','Tool']].map(([handle,label]) => <div key={handle} className="flex flex-col items-center justify-center gap-1"><span className={`size-3 rotate-45 rounded-[2px] border ${agentInputs.includes(handle) ? 'border-violet-600 bg-violet-100' : 'border-[#aaa] bg-white'}`}/><span>{label}</span></div>)}</footer> : <footer className="flex h-[49px] shrink-0 items-center justify-between border-t border-[#e7e7e7] px-5 text-[11px] text-[#888]"><span className="flex items-center gap-1.5"><Settings2 size={13}/> {selectedCatalog?.group ?? 'Workflow node'}</span><span className="truncate">{result?.state ?? 'Not executed'}</span></footer>}
        </section>
        <PanelDivider side="output"
          onPointerDown={isEntryTrigger ? event => onTriggerResizePointerDown(event) : onResizePointerDown}
          onKeyDown={isEntryTrigger ? event => onTriggerResizeKeyDown(event) : onResizeKeyDown} />
        {dataPanel('output')}
      </div>
      <div className="flex h-9 shrink-0 items-center justify-between border-t border-[#e4e4e4] bg-white px-4 text-[11px] text-[#888]"><span className="flex items-center gap-1.5"><Database size={13}/> CLIPTORA · Node editor</span><span>{copyStatus || (run ? `Execution #${run.id} · ${run.state}` : 'No execution selected')}</span></div>
    </div>
  </div>
  return createPortal(view, document.body)
}

export default WorkflowNodeEditor
