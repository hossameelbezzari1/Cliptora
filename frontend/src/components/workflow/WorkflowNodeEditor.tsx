import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import {
  ArrowLeft, ArrowRight, Check, CircleAlert, Database,
  Film, FolderOpen, LoaderCircle, Play, Plus, RefreshCw, Settings2, Upload, X,
} from 'lucide-react'
import { api } from '../../lib/api'
import type { WorkflowNode } from './workflowTypes'
import type { WorkflowStudioState } from './useWorkflowStudio'
import { WorkflowToolIcon } from './WorkflowToolIcon'
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

function EmptyData({ title, message, action }: { title: string; message: string; action?: ReactNode }) {
  return <div className="flex h-full min-h-[250px] flex-col items-center justify-center px-5 text-center">
    <div className="mb-3 flex size-9 items-center justify-center text-[#454545]"><ArrowRight size={30} strokeWidth={1.7}/></div>
    <p className="text-[15px] font-medium text-[#424242]">{title}</p>
    {action && <div className="mt-4">{action}</div>}
    <p className="mt-4 max-w-[280px] text-[13px] leading-relaxed text-[#646464]">{message}</p>
  </div>
}

function DataInspector({ value, view, label }: { value: unknown; view: DataView; label: string }) {
  if (value == null) return <EmptyData title={`No ${label.toLowerCase()} data`} message="Run the workflow to inspect actual execution data." />
  if (view === 'json') return <pre className="m-4 max-h-full overflow-auto whitespace-pre-wrap break-all rounded-lg border border-[#e4e4e4] bg-white p-4 font-mono text-[11px] leading-[1.65] text-[#333]">{formatJSON(value)}</pre>
  const rows = Array.isArray(value) ? value : Array.isArray(getObject(value).items) ? getObject(value).items as unknown[] : [value]
  if (view === 'table') {
    const records = rows.slice(0, 50).map(row => getObject(row))
    const columns = [...new Set(records.flatMap(record => Object.keys(record)))].slice(0, 15)
    if (!columns.length) return <pre className="p-4 text-xs text-[#555]">{formatJSON(value)}</pre>
    return <div className="min-h-0 overflow-auto p-4"><table className="w-full min-w-[300px] border-collapse text-left text-xs"><thead><tr>{columns.map(column => <th key={column} className="whitespace-nowrap border border-[#e5e5e5] bg-[#f7f7f7] p-2 font-semibold text-[#555]">{column}</th>)}</tr></thead><tbody>{records.map((record, i) => <tr key={i}>{columns.map(column => <td key={column} className="max-w-[220px] truncate border border-[#e5e5e5] p-2 text-[#444]" title={String(record[column] ?? '')}>{typeof record[column] === 'object' ? JSON.stringify(record[column]) : String(record[column] ?? '—')}</td>)}</tr>)}</tbody></table></div>
  }
  const records = getObject(value)
  return <div className="space-y-1 overflow-auto p-4 font-mono text-xs">{Object.keys(records).length ? Object.entries(records).map(([key, item]) => <div key={key} className="rounded-md px-2 py-2 hover:bg-[#f5f5f5]"><span className="font-semibold text-[#7840c6]">{key}</span><span className="ml-2 break-all text-[#686868]">{typeof item === 'object' ? JSON.stringify(item) : String(item)}</span></div>) : <pre className="whitespace-pre-wrap break-words">{formatJSON(value)}</pre>}</div>
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
  return <label className="block"><SectionLabel>{label}</SectionLabel><input type={type === 'number' || type === 'integer' ? 'number' : 'text'} min={schema?.minimum} max={schema?.maximum} className={inputClass} value={String(effective ?? '')} onChange={e => onChange(type === 'number' || type === 'integer' ? (e.target.value === '' ? null : Number(e.target.value)) : e.target.value)} />{schema?.description && <span className="mt-1 block text-[11px] leading-4 text-[#888]">{schema.description}</span>}</label>
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

  const title = selectedCatalog?.label ?? selected?.type ?? 'Node'
  const isApp = /excel|gmail|google|telegram|outlook|onedrive|openai|gemini|anthropic/i.test(`${title} ${selected?.type ?? ''}`)
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
  const keys = [...new Set([...Object.keys(fields), ...Object.keys(settings)])].filter(key => !['credential_id','credential','operation','action','resource','filters','source_id','__cliptora_ui_source_handles'].includes(key))
  const operationKey = Object.prototype.hasOwnProperty.call(settings, 'action') && !Object.prototype.hasOwnProperty.call(settings, 'operation') ? 'action' : 'operation'
  const resourceValue = String(settings.resource ?? (excelNode ? 'Workbook' : 'Message'))
  const operationValue = String(settings[operationKey] ?? (actions[0] ?? ''))
  const credentialNeeded = isApp || Boolean(selectedCatalog?.credentials?.length)

  const loadData = useCallback(async () => {
    if (!selectedId) return
    setLocalError('')
    setLoadingData(true)
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
            catch (error) { setLocalError(error instanceof Error ? error.message : String(error)) }
          }
        }
      }
      setInputValue(nextInput)
      setOutputValue(nextOutput)
    } finally { setLoadingData(false) }
  }, [dependencies, projectId, result?.state, result?.artifact, run?.id, selectedId])

  useEffect(() => { void loadData() }, [loadData])
  useEffect(() => { const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }; document.addEventListener('keydown', onKey); return () => document.removeEventListener('keydown', onKey) }, [onClose])

  const execute = async () => {
    if (!selected || !onExecuteStep) return
    setLocalError(''); setTesting(true)
    try { await onExecuteStep(selected.id); await loadData() }
    catch (error) { setLocalError(error instanceof Error ? error.message : String(error)) }
    finally { setTesting(false) }
  }

  const infoTabs = (side: 'input' | 'output', view: DataView, setView: (view: DataView) => void) => <div className="flex items-center gap-1 rounded-md border border-[#e5e5e5] bg-white p-0.5">{(['schema','table','json'] as const).map(mode => <button key={mode} type="button" aria-pressed={view === mode} onClick={() => setView(mode)} className={`rounded px-2 py-1 text-[11px] capitalize ${view === mode ? 'bg-[#ececf0] font-semibold text-[#2a2a2a]' : 'text-[#848484] hover:text-[#444]'}`}>{mode}</button>)}<button type="button" onClick={() => void loadData()} aria-label={`Refresh ${side} data`} title="Refresh data" className="ml-1 rounded p-1.5 text-[#777] hover:bg-[#f3f3f3]"><RefreshCw size={13} className={loadingData ? 'animate-spin' : ''}/></button></div>

  const dataPanel = (side: 'input'|'output') => {
    const left = side === 'input'
    const view = left ? inputView : outputView
    const setView = left ? setInputView : setOutputView
    const value = left ? inputValue : outputValue
    return <section className={`min-h-0 flex-1 flex-col overflow-hidden bg-[#f7f7f7] ${mobilePanel === side ? 'flex' : 'hidden'} lg:flex`} aria-label={`${side.toUpperCase()} data`}>
      <div className="flex h-[54px] shrink-0 items-center justify-between gap-2 border-b border-[#e3e3e3] px-4">
        <span className="text-[13px] font-medium tracking-[0.13em] text-[#777]">{side.toUpperCase()}</span>
        {value != null && infoTabs(side, view, setView)}
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {loadingData && value == null ? <div className="flex h-full items-center justify-center gap-2 text-xs text-[#888]"><LoaderCircle size={16} className="animate-spin"/> Loading data…</div>
          : value != null ? <DataInspector value={value} view={view} label={side}/>
          : <EmptyData title={left ? 'No input data' : 'No output data'} message={left ? 'Run the workflow to load data from preceding nodes.' : 'Execute the node or workflow to see the output.'} action={<button type="button" disabled={working} onClick={() => void start()} className={lightButton}><Play size={13}/>{left ? 'Run workflow' : 'Execute workflow'}</button>} />}
      </div>
      {left && dependencies.length > 0 && <p className="shrink-0 border-t border-[#e3e3e3] p-3 text-[11px] text-[#999]">Upstream: {dependencies.join(', ')}</p>}
    </section>
  }

  if (!selected) return null
  const view = <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 p-1 sm:p-5" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
    <div role="dialog" aria-modal="true" aria-label={`${title} node configuration`} className="flex h-[min(92dvh,960px)] w-full max-w-[1780px] flex-col overflow-hidden rounded-2xl border border-[#d5d5d5] bg-white text-[#292929] shadow-[0_35px_110px_#0005]">
      <header className="flex h-[54px] shrink-0 items-center justify-between gap-3 border-b border-[#e6e6e6] bg-white px-4">
        <div className="flex min-w-0 items-center gap-2"><BrandIcon text={title} type={selected.type}/><span className="truncate text-[14px] font-medium text-[#212121]">{title}</span></div>
        <div className="flex shrink-0 items-center gap-3"><span className="hidden text-[11px] text-[#888] sm:block">Node: {selected.id}</span><button type="button" onClick={onClose} aria-label="Close node editor" title="Close" className="rounded-md p-1.5 text-[#444] hover:bg-[#f4f4f4]"><X size={22}/></button></div>
      </header>
      <nav aria-label="Node editor sections" className="flex shrink-0 items-center justify-around border-b border-[#e5e5e5] bg-white px-1 py-1 lg:hidden">{(['input','parameters','output'] as const).map(panel => <button key={panel} type="button" onClick={() => setMobilePanel(panel)} className={`rounded-lg px-3 py-2 text-xs font-semibold capitalize ${mobilePanel === panel ? 'bg-violet-100 text-violet-800' : 'text-[#888]'}`}>{panel}</button>)}</nav>
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {dataPanel('input')}
        <section className={`${mobilePanel === 'parameters' ? 'flex' : 'hidden'} min-h-0 w-full flex-col border-x border-[#e3e3e3] bg-white lg:flex lg:w-[33%] lg:min-w-[350px] lg:max-w-[580px] lg:shrink-0`}>
          <div className="flex h-[54px] shrink-0 items-center justify-between gap-2 border-b border-[#e5e5e5] px-4">
            <div className="flex h-full gap-5">{(['parameters','settings'] as const).map(t => <button type="button" key={t} onClick={() => setTab(t)} className={`relative text-[13px] font-medium capitalize ${tab === t ? 'text-[#202020] after:absolute after:bottom-0 after:left-0 after:h-[2px] after:w-full after:bg-[#202020]' : 'text-[#666]'}`}>{t}</button>)}</div>
            <button type="button" disabled={!onExecuteStep || testing || working} onClick={() => void execute()} title={!onExecuteStep ? 'Single-node execution requires a backend executor; Run workflow is available.' : 'Execute this node only'} className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full bg-[#242424] px-3 text-[12px] font-semibold text-white hover:bg-[#404040] disabled:cursor-not-allowed disabled:opacity-45">{testing ? <LoaderCircle size={15} className="animate-spin"/> : <Play size={14}/>} Execute step</button>
          </div>
          <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-5 [scrollbar-width:thin]">
            {localError && <div role="alert" className="flex gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-[12px] text-red-700"><CircleAlert size={16} className="shrink-0"/>{localError}</div>}
            {tab === 'parameters' ? <>
              {sourceNode && <div className="space-y-5 rounded-xl border border-[#e5e5e5] bg-[#fafafa] p-4">
                <div className="flex items-center gap-2"><Film size={18} className="text-[#7950bd]"/><div><strong className="block text-[13px] font-semibold text-[#292929]">Source Video</strong><span className="text-[11px] text-[#858585]">Choose the video this workflow will process.</span></div></div>
                <label className="block"><SectionLabel>Workflow source</SectionLabel><select aria-label="Workflow source video" className={inputClass} value={sourceId ?? ''} onChange={event => setSourceId(event.target.value ? Number(event.target.value) : null)}><option value="">Select a video...</option>{sources.map(source => <option key={source.id} value={source.id}>{source.filename}</option>)}</select></label>
                <label className="block"><SectionLabel>Use from Media Library</SectionLabel><select aria-label="Link video from Media Library" className={inputClass} value="" disabled={working} onChange={event => { const id = Number(event.target.value); if (id > 0) void useMediaSource(id) }}><option value="">Choose a video...</option>{editorMedia.filter(item => item.kind === 'video').map(item => <option key={item.id} value={item.id}>{mediaName(item)}</option>)}</select></label>
                <input ref={fileInput} type="file" accept=".mp4,.mov,.mkv,.webm,.m4v" className="hidden" onChange={event => void upload(event)} />
                <button type="button" disabled={working} onClick={() => fileInput.current?.click()} className="flex h-10 w-full items-center justify-center gap-2 rounded-lg border border-[#dedede] bg-white text-xs font-semibold text-[#333] hover:bg-[#f4f4f4] disabled:cursor-not-allowed disabled:opacity-50"><Upload size={15}/> Upload video</button>
                <p className="flex gap-2 text-[11px] leading-5 text-[#777]"><FolderOpen size={14} className="mt-0.5 shrink-0"/>Originals stay unchanged. The selected source is saved with this node.</p>
              </div>}
              {credentialNeeded && <div className="space-y-2"><SectionLabel>Credential</SectionLabel><button type="button" disabled={!onManageCredentials} onClick={onManageCredentials} title={onManageCredentials ? 'Manage credentials' : 'Credential management is not yet connected to the backend'} className={`${lightButton} rounded-lg px-3` }><BrandIcon text={title} type={selected.type} size={18}/>{settings.credential_id ? `Credential ${String(settings.credential_id)}` : `Connect to ${isExcel(`${title} ${selected.type}`) ? 'Microsoft Excel' : title}`}</button>{!onManageCredentials && <p className="text-[11px] leading-5 text-[#888]">Configure OAuth credentials through a dedicated backend credential manager. Secrets must never be stored in workflow JSON.</p>}</div>}
              {excelNode && <div className="rounded-lg border border-amber-400 bg-[#fffae6] p-3 text-[12px] leading-[1.45] text-[#68471c]">Microsoft Excel 365 works with workbooks in OneDrive or SharePoint. Local .xlsx files need a different file-processing tool.</div>}
              {(isApp || Object.prototype.hasOwnProperty.call(settings,'resource')) && <DynamicField name="resource" value={resourceValue} onChange={value => updateSelectedSetting('resource',value)} schema={fields.resource}/>} 
              {!sourceNode && (actions.length > 0 || excelNode || settings.operation != null) && <label className="block"><SectionLabel>Operation</SectionLabel>{actions.length > 0 ? <select className={inputClass} value={operationValue} onChange={e => updateSelectedSetting(operationKey,e.target.value)}>{actions.map(action => <option key={action} value={action}>{titleize(action)}</option>)}</select> : <input className={`${inputClass} bg-[#f8f8f8]`} readOnly value={operationValue || (excelNode ? 'Get Many' : title)} title="This tool does not advertise selectable actions in the catalog" />}</label>}
              {keys.map(key => <DynamicField key={`${selectedId}:${key}`} name={key} schema={fields[key]} value={settings[key]} onChange={value => updateSelectedSetting(key,value)}/>)}
              {(excelNode || Object.prototype.hasOwnProperty.call(settings,'filters')) && <div><div className="flex items-center justify-between border-b border-[#e7e7e7] pb-2"><SectionLabel>Filters</SectionLabel><button type="button" onClick={() => setFiltersOpen(v => !v)} title="Edit filters" aria-expanded={filtersOpen} className="grid size-7 place-items-center rounded-md text-[#777] hover:bg-[#f3f3f3]"><Plus size={20}/></button></div>{filtersOpen && <div className="pt-3"><JsonField label="Filter rules (JSON)" value={settings.filters ?? []} onChange={value => updateSelectedSetting('filters',value)}/></div>}</div>}
              {!sourceNode && !keys.length && actions.length === 0 && !isApp && <div className="rounded-lg border border-[#e5e5e5] bg-[#fafafa] p-3 text-xs text-[#777]">This node has no registered parameter fields. Use the Settings tab for execution options, or register <code>parameters_schema</code> in the Tool Catalog.</div>}
              <div className="flex flex-wrap items-center gap-2 border-t border-[#ededed] pt-4"><button type="button" className={lightButton} disabled={working} onClick={() => void save()}><Check size={14}/> Save workflow</button><button type="button" className={lightButton} disabled={working} onClick={() => void start()}><Play size={14}/> Run workflow</button></div>
            </> : <>
              <label className="block"><SectionLabel>Node ID</SectionLabel><input value={selected.id} readOnly className={`${inputClass} bg-[#f7f7f7] font-mono text-[#777]`} /></label>
              <label className="block"><SectionLabel>Execution condition</SectionLabel><select className={inputClass} value={selected.when} onChange={e => updateNode(selected.id,{when:e.target.value as WorkflowNode['when']})}>{(['always','has_video','has_transcript','ai_enabled','condition_true','condition_false','route_0','route_1','route_2','route_3','route_4','route_fallback'] as const).map(value => <option key={value} value={value}>{titleize(value)}</option>)}</select></label>
              <label className="block"><SectionLabel>Retry limit</SectionLabel><input type="number" min="0" max="5" className={inputClass} value={selected.retry_limit ?? 1} onChange={e=>updateNode(selected.id,{retry_limit:Math.max(0,Math.min(5,Number(e.target.value)||0))})}/></label>
              <label className="flex cursor-pointer items-center gap-2 text-[13px] text-[#444]"><input type="checkbox" className="size-4 accent-violet-600" checked={selected.cache ?? true} onChange={e=>updateNode(selected.id,{cache:e.target.checked})}/> Cache result for retries</label>
              <div className="space-y-2"><SectionLabel>Previous nodes</SectionLabel>{dependencies.length ? dependencies.map(id => <div key={id} className="flex items-center gap-2 rounded-lg border border-[#eee] p-2 text-xs text-[#555]"><ArrowLeft size={13}/>{id}</div>) : <p className="text-xs text-[#999]">No previous nodes connected.</p>}</div>
              <JsonField label="All node parameters (JSON)" value={settings} onChange={value=>updateNode(selected.id,{settings:getObject(value)})}/>
            </>}
          </div>
          <footer className="flex h-[49px] shrink-0 items-center justify-between border-t border-[#e7e7e7] px-5 text-[11px] text-[#888]"><span className="flex items-center gap-1.5"><Settings2 size={13}/> {selectedCatalog?.group ?? 'Workflow node'}</span><span className="truncate">{result?.state ?? 'Not executed'}</span></footer>
        </section>
        {dataPanel('output')}
      </div>
      <div className="flex h-9 shrink-0 items-center justify-between border-t border-[#e4e4e4] bg-white px-4 text-[11px] text-[#888]"><span className="flex items-center gap-1.5"><Database size={13}/> CLIPTORA · Node editor</span><span>{run ? `Execution #${run.id} · ${run.state}` : 'No execution selected'}</span></div>
    </div>
  </div>
  return createPortal(view, document.body)
}

export default WorkflowNodeEditor
