import { useState, type ReactNode, type PointerEvent as ReactPointerEvent, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { ArrowRight, ChevronDown, ChevronRight, Copy, GripVertical, LoaderCircle, Play, RefreshCw, Search, X, Zap } from 'lucide-react'
import { WorkflowToolIcon } from '../WorkflowToolIcon'
import { WorkflowNodeInputTree, WorkflowVariablesContext } from './WorkflowNodeInputTree'
import type { WorkflowStudioState } from '../useWorkflowStudio'
import { getNodeUI } from '../nodeRegistry'
import { formatJSON, getObject, lightButton, titleize } from './WorkflowNodeFields'
import NodeProgress from './NodeProgress'

type JsonObject = Record<string, unknown>
type DataView = 'schema' | 'table' | 'json'
type InspectorSource = { id: string; label: string; value: unknown }
function BrandIcon({ text, type, size = 23 }: { text: string; type: string; size?: number }) {
  return <WorkflowToolIcon type={type} label={text} size={size} />
}

function EmptyData({ title, message, action, icon }: { title: string; message: string; action?: ReactNode; icon?: ReactNode }) {
  return <div className="flex h-full min-h-[250px] flex-col items-center justify-center px-5 text-center">
    <div className="mb-3 flex size-9 items-center justify-center text-[#454545] dark:text-[#b8bec7]">{icon ?? <ArrowRight size={30} strokeWidth={1.7}/>}</div>
    <p className="text-[15px] font-medium text-[#424242] dark:text-[#f3f4f6]">{title}</p>
    {action && <div className="mt-4">{action}</div>}
    <p className="mt-4 max-w-[280px] text-[13px] leading-relaxed text-[#646464] dark:text-[#b8bec7]">{message}</p>
  </div>
}

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
function itemCountLabel(value: unknown) {
  const count = countItems(value)
  return `${count} ${count === 1 ? 'item' : 'items'}`
}

function JsonSyntax({ value }: { value: unknown }) {
  const source = formatJSON(value)
  const tokens = source.split(/("(?:\\.|[^"\\])*"\s*:|"(?:\\.|[^"\\])*"|\b(?:true|false|null)\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g)
  return <pre className="whitespace-pre-wrap break-words font-mono text-[12px] leading-[1.8] text-[#454545] dark:text-[#b8bec7]">{tokens.map((token, index) => {
    const trimmed = token.trim()
    const color = trimmed.startsWith('"') && trimmed.endsWith(':') ? 'text-[#586575] dark:text-[#b8bec7]'
      : trimmed.startsWith('"') ? 'text-[#8a36e7] dark:text-[#ceabf5]'
        : /^(?:true|false|null)$/.test(trimmed) ? 'text-[#c55c1c] dark:text-[#e7bba0]'
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
      <summary className="flex cursor-pointer list-none items-center gap-2 rounded-md py-1 text-[12px] hover:bg-[#ededed] dark:hover:bg-[#1f2937] [&::-webkit-details-marker]:hidden">
        <ChevronRight size={14} className="shrink-0 text-[#777] dark:text-[#b8bec7] transition-transform group-open/branch:rotate-90" />
        <span className="rounded border border-[#e7e7e7] dark:border-[#374151] bg-white dark:bg-cl-dark-panel px-1.5 py-0.5 font-mono text-[11px] text-[#777] dark:text-[#b8bec7]">{kind}</span>
        <span className="truncate font-medium text-[#333] dark:text-[#f3f4f6]">{name}</span>
        <span className="text-[11px] text-[#4b5563] dark:text-[#999]">{isArray ? `${value.length} items` : `${entries.length} fields`}</span>
      </summary>
      <div className="ml-[7px] border-l border-dashed border-[#d3d8e0] dark:border-[#374151] pl-2">
        {entries.map(([key, item]) => <SchemaBranch key={key} name={isArray ? `item ${Number(key) + 1} (example)` : key} value={item} level={level + 1} />)}
      </div>
    </details> : <div className="flex min-w-0 items-center gap-2 rounded-md py-[5px] text-[12px] hover:bg-[#ededed] dark:hover:bg-[#1f2937]">
      <span className="w-[14px] shrink-0" />
      <span className="rounded border border-[#e7e7e7] dark:border-[#374151] bg-white dark:bg-cl-dark-panel px-1.5 py-0.5 font-mono text-[11px] text-[#777] dark:text-[#b8bec7]">{kind}</span>
      <span className="shrink-0 font-medium text-[#333] dark:text-[#f3f4f6]">{name}</span>
      <span className="min-w-0 truncate text-[#555] dark:text-[#b8bec7]" title={displayValue(value)}>{displayValue(value)}</span>
    </div>}
  </div>
}

function DataInspector({ value, view, label, query, onCopy }: { value: unknown; view: DataView; label: string; query: string; onCopy: () => void }) {
  if (value == null) return <EmptyData title={`No ${label.toLowerCase()} data`} message="Run the workflow to inspect actual execution data." />
  const rows = dataRows(value)
  const q = query.toLowerCase().trim()
  const matchingRows = q ? rows.filter(row => JSON.stringify(row).toLowerCase().includes(q)) : rows
  if (view === 'json') return <div className="relative min-h-0 p-4">
    <button type="button" onClick={onCopy} title="Copy JSON" aria-label={`Copy ${label} JSON`} className="absolute right-5 top-5 grid size-8 place-items-center rounded-full border border-[#e3e3e3] dark:border-[#374151] bg-white dark:bg-cl-dark-panel text-[#555] dark:text-[#b8bec7] shadow-sm hover:bg-[#efefef] dark:hover:bg-[#1f2937]"><Copy size={15} /></button>
    <div className="overflow-auto pr-10"><JsonSyntax value={q ? matchingRows : value}/></div>
  </div>
  if (view === 'table') {
    const visibleRows = matchingRows.slice(0, 500)
    const columns = [...new Set(visibleRows.flatMap(row => Object.keys(row)))].slice(0, 50)
    if (!columns.length) return <p className="p-4 text-[12px] text-[#888] dark:text-[#b8bec7]">No matching data.</p>
    return <div className="min-h-0 overflow-auto p-3"><table className="w-full min-w-[300px] border-collapse text-left text-[12px]">
      <thead><tr>{columns.map(column => <th key={column} className="sticky top-0 whitespace-nowrap border border-[#d9d9de] dark:border-[#374151] bg-[#f2f2f2] dark:bg-[#1f2937] p-2 font-semibold text-[#333] dark:text-[#f3f4f6]">{column}</th>)}</tr></thead>
      <tbody>{visibleRows.map((row, index) => <tr key={index} className="hover:bg-white dark:hover:bg-cl-dark-panel">{columns.map(column => <td key={column} className="max-w-[260px] truncate border border-[#dedee3] dark:border-[#374151] px-2 py-2 text-[#454545] dark:text-[#b8bec7]" title={displayValue(row[column])}>{displayValue(row[column])}</td>)}</tr>)}</tbody>
    </table>{matchingRows.length > 500 && <p className="p-2 text-xs text-[#888] dark:text-[#b8bec7]">Showing the first 500 of {matchingRows.length} items.</p>}</div>
  }
  if (!matchingRows.length) return <p className="p-4 text-[12px] text-[#888] dark:text-[#b8bec7]">No matching data.</p>
  return <div className="min-h-0 space-y-2 overflow-auto p-3">
    {matchingRows.slice(0, 50).map((record, index) => <details key={index} open={index === 0} className="rounded-md">
      <summary className="cursor-pointer rounded-md px-2 py-2 text-[12px] font-medium text-[#444] dark:text-[#b8bec7] hover:bg-[#ededed] dark:hover:bg-[#1f2937]">{matchingRows.length > 1 ? `Item ${index + 1}` : 'Fields'}</summary>
      <div className="pl-1">{Object.entries(record).map(([key, item]) => <SchemaBranch key={key} name={key} value={item} />)}</div>
    </details>)}
    {matchingRows.length > 50 && <p className="p-2 text-xs text-[#888] dark:text-[#b8bec7]">Showing 50 of {matchingRows.length} items.</p>}
  </div>
}

export function WorkflowNodePanelDivider({ side, onPointerDown, onKeyDown }: {
  side: 'input' | 'output'
  onPointerDown: (event: ReactPointerEvent<HTMLDivElement>, side: 'input' | 'output') => void
  onKeyDown: (event: ReactKeyboardEvent<HTMLDivElement>, side: 'input' | 'output') => void
}) {
  return <div role="separator" aria-label={`Resize ${side} and parameters panels`} aria-orientation="vertical"
    aria-valuemin={15} aria-valuemax={85} tabIndex={0}
    onPointerDown={event => onPointerDown(event, side)} onKeyDown={event => onKeyDown(event, side)}
    className="group relative z-20 hidden w-[9px] cursor-col-resize touch-none items-stretch justify-center bg-white dark:bg-cl-dark-panel outline-none hover:bg-[#ede5ff] dark:hover:bg-[#1f2937] focus-visible:bg-[#ede5ff] dark:focus-visible:bg-[#1f2937] lg:flex">
    <span className="pointer-events-none absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-[#dddde2] dark:bg-[#1f2937] group-hover:bg-[#8659e8]" />
    <span className="pointer-events-none absolute top-[0px] left-1/2 z-30 grid h-6 w-[36px] -translate-x-1/2 place-items-center rounded-b-lg border border-t-0 border-[#dddde2] dark:border-[#374151] bg-white dark:bg-cl-dark-panel text-[#909090] dark:text-[#b8bec7] shadow-sm group-hover:text-[#8450e6] dark:group-hover:text-[#cbb6f5]"><GripVertical size={17} className="rotate-90" /></span>
  </div>
}

type Props = {
  side: 'input' | 'output'
  studio: WorkflowStudioState
  mobilePanel: 'input' | 'parameters' | 'output'
  inputValue: unknown
  outputValue: unknown
  loadingData: boolean
  isEntryTrigger: boolean
  disableExecute: boolean
  hasExecuteStep: boolean
  onRun: () => void | Promise<unknown>
  onExecute: () => void | Promise<unknown>
  onRefresh: () => void | Promise<unknown>
  onCopyStatus: (text: string) => void
}

export function WorkflowNodeDataPanel({ side, studio, mobilePanel, inputValue, outputValue, loadingData, isEntryTrigger,
  disableExecute, hasExecuteStep, onRun, onExecute, onRefresh: loadData, onCopyStatus }: Props) {
  const { selected, catalog, nodes, sources, sourceId } = studio
  const [view, setView] = useState<DataView>('schema')
  const [query, setQuery] = useState('')
  const [dataSearchOpen, setDataSearchOpen] = useState(false)
  const [selectedInputId, setSelectedInputId] = useState('')
  const [showNextNodes, setShowNextNodes] = useState(true)
  const left = side === 'input'
  const inputSources: InspectorSource[] = (selected?.depends_on ?? []).map(id => {
    const node = nodes.find(node => node.id === id)
    const label = typeof node?.settings.__cliptora_ui_label === 'string' && node.settings.__cliptora_ui_label.trim()
      ? node.settings.__cliptora_ui_label.trim() : catalog.find(item => item.type === node?.type)?.label ?? 'Previous node'
    return { id, label, value: getObject(inputValue)[id] }
  })
  const activeInput = inputSources.find(source => source.id === selectedInputId) ?? inputSources[0]
  const activeVideoSource = sources.find(source => source.id === sourceId) ?? null
  const CustomInput = selected ? getNodeUI(selected.type)?.Input : undefined
  const CustomOutput = selected ? getNodeUI(selected.type)?.Output : undefined
  const downstream = selected ? nodes.filter(node => node.depends_on.includes(selected.id)) : []

  // A source-only node can preview selected metadata before any execution.
  // Never present source preview as completed upstream execution data.
  const sourcePreview = left && inputSources.length === 0 && activeVideoSource &&
    (selected?.type === 'core.video_source' || Boolean(CustomInput))
    ? {
        filename: activeVideoSource.filename,
        size_bytes: activeVideoSource.size_bytes,
        ...(activeVideoSource.created_at ? { created_at: activeVideoSource.created_at } : {}),
      }
    : null
  const rawValue = left ? (activeInput?.value ?? sourcePreview) : outputValue
  const formatter = !left && selected ? getNodeUI(selected.type)?.formatOutput : undefined
  const value = rawValue != null && formatter ? formatter(rawValue) : rawValue
  const known = value != null
  const isSourcePreview = Boolean(left && sourcePreview && !activeInput)

  // A generic progress presenter works for ANY node emitting live backend progress.
  const nodeStatus = selected ? studio.run?.results?.[selected.id] : undefined
  const nodeRunning = !left && studio.run?.state === 'running' && Boolean(selected) &&
    (nodeStatus?.state === 'running' || (studio.run.current_node === selected?.id && nodeStatus?.state !== 'completed'))
  const nodeQueued = !left && studio.run?.state === 'queued' && Boolean(selected)
  const waitingForOutput = nodeRunning || nodeQueued
  const progressLabel = selected
    ? typeof selected.settings.__cliptora_ui_label === 'string' && selected.settings.__cliptora_ui_label.trim()
      ? selected.settings.__cliptora_ui_label.trim()
      : catalog.find(item => item.type === selected.type)?.label ?? selected.type
    : 'Node execution'

  const copyData = async (copySide: 'input' | 'output', data: unknown) => {
    try { await navigator.clipboard.writeText(formatJSON(data)); onCopyStatus(`${copySide.toUpperCase()} JSON copied`) }
    catch { onCopyStatus('Clipboard permission required') }
  }

  const infoTabs = () => <div role="tablist" aria-label={`${side} data view`} className="flex shrink-0 items-center rounded-lg bg-[#e9e9eb] dark:bg-[#1f2937] p-[3px]">
    {(['schema','table','json'] as const).map(mode => <button
      key={mode} role="tab" aria-selected={view === mode} aria-controls={`cliptora-node-${side}-viewer`}
      type="button" onClick={() => setView(mode)}
      className={`cursor-pointer rounded-md px-2.5 py-1.5 text-[12px] capitalize transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet-500 ${view === mode ? 'bg-white dark:bg-cl-dark-panel font-medium text-[#222] dark:text-[#f3f4f6] shadow-sm' : 'text-[#5b5b5f] dark:text-[#b8bec7] hover:text-[#222] dark:hover:text-[#f3f4f6]'}`}
    >{mode === 'json' ? 'JSON' : titleize(mode)}</button>)}
  </div>

  return <section className={`min-h-0 min-w-0 w-full flex-col overflow-hidden bg-[#f7f7f7] dark:bg-[#1f2937] ${mobilePanel === side ? 'flex' : 'hidden'} lg:flex`} aria-label={`${side.toUpperCase()} data`}>
    <div className="flex min-h-[54px] shrink-0 items-center justify-between gap-2 border-b border-[#e3e3e3] dark:border-[#374151] px-3">
      <span className="text-[12px] font-medium tracking-[0.13em] text-[#777] dark:text-[#b8bec7]">{side.toUpperCase()}</span>
      <div className="flex min-w-0 items-center gap-2">
        <button type="button" aria-label={`Search ${side} data`} title="Search data" onClick={() => setDataSearchOpen(open => !open)}
          className="grid size-8 shrink-0 cursor-pointer place-items-center rounded-md text-[#4b5563] dark:text-[#aaa] hover:bg-[#e9e9e9] dark:hover:bg-[#1f2937] hover:text-[#444] dark:hover:text-[#f3f4f6]"><Search size={17} /></button>
        {infoTabs()}
      </div>
    </div>

    {dataSearchOpen && <div className="flex h-[44px] shrink-0 gap-2 border-b border-[#e7e7e7] dark:border-[#374151] p-1.5">
      <input autoFocus type="search" aria-label={`Filter ${side} data`} value={query} onChange={event => setQuery(event.target.value)}
        placeholder="Search node names, fields or values..." className="min-w-0 flex-1 rounded-md border border-[#d4d4d4] dark:border-[#374151] bg-white dark:bg-cl-dark-panel px-2.5 text-[12px] outline-none focus:border-[#9461fc]" />
      <button type="button" title="Close search" onClick={() => { setDataSearchOpen(false); setQuery('') }}
        className="cursor-pointer rounded-md px-2 text-[#777] dark:text-[#b8bec7] hover:bg-[#e9e9e9] dark:hover:bg-[#1f2937]"><X size={15} /></button>
    </div>}

    {!left && selected && <NodeProgress
      run={studio.run}
      nodeId={selected.id}
      label={progressLabel}
      className="mx-3 mt-3"
    />}

    {left && inputSources.length > 1 && view !== 'schema' && <div className="flex shrink-0 items-center gap-2 border-b border-[#e8e8e8] dark:border-[#374151] px-3 py-2">
      <span className="text-[11px] text-[#777] dark:text-[#b8bec7]">Data from</span>
      <select aria-label="Select previous node data" value={activeInput?.id ?? ''} onChange={event => setSelectedInputId(event.target.value)}
        className="min-w-0 flex-1 cursor-pointer rounded-md border border-[#dedede] dark:border-[#374151] bg-white dark:bg-cl-dark-panel px-2 py-1.5 text-[12px] text-[#333] dark:text-[#f3f4f6] outline-none focus:border-[#9461fc]">
        {inputSources.map(source => <option key={source.id} value={source.id}>{source.label}</option>)}
      </select>
    </div>}

    {!left && known && <div className="flex h-[34px] shrink-0 items-center justify-between border-b border-[#ededed] dark:border-[#374151] px-3 text-[11px] text-[#4b5563] dark:text-[#999]">
      <span>{itemCountLabel(value)}</span>
      <button type="button" onClick={() => void loadData()} aria-label="Refresh output data" title="Refresh" className="cursor-pointer hover:text-[#555] dark:hover:text-[#f3f4f6]"><RefreshCw size={14} className={loadingData ? 'animate-spin' : ''} /></button>
    </div>}

    <div id={`cliptora-node-${side}-viewer`} role="tabpanel" aria-label={`${side.toUpperCase()} ${titleize(view)} view`}
      data-view={view} className="min-h-0 flex-1 overflow-y-auto [scrollbar-width:thin]">

      {left && view === 'schema' && inputSources.length > 0 &&
        <WorkflowNodeInputTree studio={studio} inputValue={inputValue} query={query} />}

      {left && view === 'schema' && inputSources.length === 0 && <>
        {CustomInput && !query.trim() && <CustomInput source={activeVideoSource} hasUpstream={false} />}
        {!CustomInput && <div className="px-4 py-4 text-[12px] text-[#777] dark:text-[#b8bec7]">No previous nodes connected.</div>}
        <div className="px-3"><WorkflowVariablesContext studio={studio} /></div>
      </>}

      {left && view !== 'schema' && <>
        {isSourcePreview && <p className="border-b border-[#e9e9e9] dark:border-[#374151] px-4 py-2 text-[11px] leading-5 text-[#777] dark:text-[#b8bec7]">Selected video source · preview metadata, not execution output</p>}
        {loadingData && !known ? <div className="flex min-h-[250px] items-center justify-center gap-2 text-xs text-[#888] dark:text-[#b8bec7]"><LoaderCircle size={16} className="animate-spin" /> Loading data…</div>
          : known ? <DataInspector value={value} view={view} label={side} query={query} onCopy={() => void copyData(side, value)} />
            : <EmptyData title={`No input ${view === 'json' ? 'JSON' : 'table'} data`} message="Execute previous nodes to load real input data." />}
      </>}

      {!left && <>
        {view === 'schema' && downstream.length > 0 && <div className="border-b border-[#e4e4e6] dark:border-[#374151] px-3 py-3">
          <button type="button" onClick={() => setShowNextNodes(open => !open)} aria-expanded={showNextNodes}
            className="flex cursor-pointer items-center gap-2 py-1 text-[13px] font-medium text-[#333] dark:text-[#f3f4f6] hover:text-[#111] dark:hover:text-[#f3f4f6]">
            {showNextNodes ? <ChevronDown size={17} /> : <ChevronRight size={17} />}
            <span>Next nodes</span>
            <span className="rounded-md bg-[#eaeaec] dark:bg-[#1f2937] px-1.5 py-0.5 text-[10px] text-[#777] dark:text-[#b8bec7]">{downstream.length}</span>
          </button>
          {showNextNodes && <div className="space-y-0.5 pt-1 pl-6">
            {downstream.map(node => {
              const custom = node.settings.__cliptora_ui_label
              const label = typeof custom === 'string' && custom.trim() ? custom.trim()
                : catalog.find(item => item.type === node.type)?.label ?? 'Workflow node'
              return <button key={node.id} type="button" onClick={() => studio.setSelectedId(node.id)} title={`Open ${label}`}
                className="flex w-full cursor-pointer items-center gap-2 rounded-md px-1 py-1.5 text-left hover:bg-[#ededed] dark:hover:bg-[#1f2937]">
                <span className="grid size-8 shrink-0 place-items-center rounded-xl border border-[#e8e8e8] dark:border-[#374151] bg-white dark:bg-cl-dark-panel"><BrandIcon text={label} type={node.type} size={19} /></span>
                <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-[#383838] dark:text-[#f3f4f6]">{label}</span>
                <span className="shrink-0 text-[10px] text-[#888] dark:text-[#b8bec7]">{studio.run?.results?.[node.id]?.state ?? 'Not executed'}</span>
              </button>
            })}
          </div>}
        </div>}
        {loadingData && !known ? <div className="flex min-h-[180px] items-center justify-center gap-2 text-xs text-[#888] dark:text-[#b8bec7]"><LoaderCircle size={16} className="animate-spin" /> Loading data…</div>
          : known ? (CustomOutput && view === 'schema' && !query.trim()
            ? <CustomOutput value={value} />
            : <DataInspector value={value} view={view} label={side} query={query} onCopy={() => void copyData(side, value)} />)
            : waitingForOutput ? <div className="px-5 py-8 text-center text-[12px] leading-6 text-[#777] dark:text-[#b8bec7]">The output JSON will appear automatically when this node finishes.</div>
            : <EmptyData
                title={isEntryTrigger ? 'No trigger output' : 'No output data'}
                icon={isEntryTrigger ? <Zap size={23} fill="currentColor" strokeWidth={1.3} /> : undefined}
                message={isEntryTrigger ? 'Run the trigger to inspect its real output.' : 'Execute this node or workflow to inspect output data.'}
                action={<button type="button" disabled={disableExecute} onClick={() => { if (!hasExecuteStep) void onRun(); else void onExecute() }}
                  className={lightButton}><Play size={13} />{isEntryTrigger ? 'Test this trigger' : hasExecuteStep ? 'Execute step' : 'Run workflow'}</button>}
              />}
      </>}
    </div>
  </section>
}
