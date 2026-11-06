import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ChevronDown, ChevronRight, CheckCircle2, CircleAlert, LoaderCircle,
  Play, RefreshCw, Variable, Zap,
} from 'lucide-react'
import { api } from '../../../lib/api'
import type { WorkflowStudioState } from '../useWorkflowStudio'
import type { WorkflowNode } from '../workflowTypes'
import { WorkflowToolIcon } from '../WorkflowToolIcon'
import { getObject } from './WorkflowNodeFields'

export function upstreamOf(selected: WorkflowNode | null, nodes: WorkflowNode[]): WorkflowNode[] {
  if (!selected) return []
  const byId = new Map(nodes.map(node => [node.id, node]))
  const visited = new Set<string>([selected.id])
  const result: WorkflowNode[] = []
  const visit = (id: string) => {
    if (visited.has(id)) return
    visited.add(id)
    const node = byId.get(id)
    if (!node) return
    result.push(node)
    for (const parent of node.depends_on) visit(parent)
  }
  for (const parent of selected.depends_on) visit(parent)
  return result
}

function display(value: unknown): string {
  if (value === undefined) return '—'
  if (value === null) return 'null'
  if (typeof value === 'string') return value
  if (typeof value === 'object') {
    try { return JSON.stringify(value) } catch { return '[Object]' }
  }
  return String(value)
}

function DataField({ name, value, depth = 0 }: { name: string; value: unknown; depth?: number }) {
  const nested = value !== null && typeof value === 'object'
  const array = Array.isArray(value)
  const entries: [string, unknown][] = array
    ? value.slice(0, 30).map((item, index) => [String(index), item])
    : nested ? Object.entries(getObject(value)).slice(0, 60) : []
  const type = array ? '[]' : nested ? '{}' : typeof value === 'string' ? 'Aa'
    : typeof value === 'number' ? '#' : typeof value === 'boolean' ? '◉' : '•'
  const line = <span className="flex min-w-0 items-center gap-2 py-[5px] text-[12px] leading-5">
    <span className="inline-flex min-w-6 shrink-0 justify-center rounded-md border border-[#e9e9eb] dark:border-[#374151] bg-white dark:bg-cl-dark-panel px-1 text-[10px] font-medium text-[#8b8b8b] dark:text-[#b8bec7]">{type}</span>
    <span className="shrink-0 font-medium text-[#333] dark:text-[#f3f4f6]">{name}</span>
    {!nested && <span className="min-w-0 truncate text-[#606060] dark:text-[#b8bec7]" title={display(value)}>{display(value)}</span>}
    {nested && <span className="text-[11px] text-[#4b5563] dark:text-[#999]">{array ? `${value.length} items` : `${entries.length} fields`}</span>}
  </span>
  if (!nested || depth >= 5) return <div className="min-w-0">{line}</div>
  return <details className="group/field min-w-0" open={depth < 1}>
    <summary className="flex cursor-pointer list-none items-start gap-1 rounded-md hover:bg-[#ececec] dark:hover:bg-[#1f2937] [&::-webkit-details-marker]:hidden">
      <ChevronRight size={13} className="mt-2.5 shrink-0 text-[#818181] dark:text-[#b8bec7] transition-transform group-open/field:rotate-90" />
      <span className="min-w-0 flex-1">{line}</span>
    </summary>
    <div className="ml-2 border-l border-dashed border-[#d7d7d9] dark:border-[#374151] pl-3">
      {entries.map(([key, item]) => <DataField key={key} name={key} value={item} depth={depth + 1} />)}
      {array && value.length > 30 && <p className="text-[11px] text-[#4b5563] dark:text-[#999]">Showing the first 30 items</p>}
    </div>
  </details>
}

function RunData({ value }: { value: unknown }) {
  if (value == null) return null
  if (Array.isArray(value)) return <div className="space-y-1">
    {value.slice(0, 30).map((item, index) => <DataField key={index} name={`Item ${index + 1}`} value={item} />)}
    {value.length > 30 && <p className="text-[11px] text-[#888] dark:text-[#b8bec7]">Showing 30 of {value.length} items</p>}
  </div>
  const object = getObject(value)
  if (Object.keys(object).length) return <div className="space-y-0.5">{Object.entries(object).map(([name, item]) => <DataField key={name} name={name} value={item} />)}</div>
  return <DataField name="value" value={value} />
}

function ContextRow({ name, value, type = 'Aa' }: { name: string; value: unknown; type?: string }) {
  return <div className="flex min-w-0 flex-wrap items-start gap-x-2 gap-y-1 py-1 text-[12px]">
    <span className="inline-flex shrink-0 overflow-hidden rounded-lg border border-[#eaeaea] dark:border-[#374151] bg-white dark:bg-cl-dark-panel text-[#333] dark:text-[#f3f4f6]">
      <span className="border-r border-[#eee] dark:border-[#374151] px-2 py-1 text-[10px] font-medium text-[#888] dark:text-[#b8bec7]">{type}</span>
      <span className="px-2 py-1 font-medium">{name}</span>
    </span>
    <span className="min-w-0 flex-1 break-words py-1 text-[#585858] dark:text-[#b8bec7]">{display(value)}</span>
  </div>
}

export function WorkflowVariablesContext({ studio }: { studio: WorkflowStudioState }) {
  const [date, setDate] = useState(() => new Date())
  const [open, setOpen] = useState(true)
  const today = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  return <div className="mt-4 border-t border-[#e4e4e6] dark:border-[#374151] pt-3">
    <div className="flex items-center justify-between gap-2">
      <button type="button" onClick={() => setOpen(value => !value)} aria-expanded={open}
        className="flex min-w-0 cursor-pointer items-center gap-2 rounded-md py-1 text-left text-[13px] font-medium text-[#333] dark:text-[#f3f4f6] hover:text-[#111] dark:hover:text-[#f3f4f6]">
        {open ? <ChevronDown size={17} /> : <ChevronRight size={17} />}
        <Variable size={17} className="text-[#777] dark:text-[#b8bec7]" />
        <span>Variables and context</span>
      </button>
      <button type="button" onClick={() => setDate(new Date())} title="Refresh date variables" aria-label="Refresh context date" className="cursor-pointer rounded-md p-1 text-[#4b5563] dark:text-[#999] hover:bg-[#e9e9e9] dark:hover:bg-[#1f2937] hover:text-[#555] dark:hover:text-[#f3f4f6]"><RefreshCw size={14} /></button>
    </div>
    {open && <div className="space-y-2 pb-4 pl-7 pt-2">
      <ContextRow name="$now" value={date.toISOString()} />
      <ContextRow name="$today" value={today.toISOString()} />
      <details className="group/context">
        <summary className="flex cursor-pointer list-none items-center gap-1 py-1 text-[12px] [&::-webkit-details-marker]:hidden">
          <ChevronRight size={14} className="text-[#888] dark:text-[#b8bec7] transition-transform group-open/context:rotate-90" />
          <span className="rounded-lg border border-[#eaeaea] dark:border-[#374151] bg-white dark:bg-cl-dark-panel px-2 py-1 font-medium">$vars</span>
          <span className="text-[#4b5563] dark:text-[#999]">No project variables available</span>
        </summary>
      </details>
      <details className="group/context" open>
        <summary className="flex cursor-pointer list-none items-center gap-1 py-1 text-[12px] [&::-webkit-details-marker]:hidden">
          <ChevronRight size={14} className="text-[#888] dark:text-[#b8bec7] transition-transform group-open/context:rotate-90" />
          <span className="rounded-lg border border-[#eaeaea] dark:border-[#374151] bg-white dark:bg-cl-dark-panel px-2 py-1 font-medium">$execution</span>
        </summary>
        <div className="pl-5">
          <ContextRow name="id" value={studio.run?.id ?? 'Available after execution'} />
          <ContextRow name="status" value={studio.run?.state ?? 'Not executed'} />
        </div>
      </details>
      <details className="group/context" open>
        <summary className="flex cursor-pointer list-none items-center gap-1 py-1 text-[12px] [&::-webkit-details-marker]:hidden">
          <ChevronRight size={14} className="text-[#888] dark:text-[#b8bec7] transition-transform group-open/context:rotate-90" />
          <span className="rounded-lg border border-[#eaeaea] dark:border-[#374151] bg-white dark:bg-cl-dark-panel px-2 py-1 font-medium">$workflow</span>
        </summary>
        <div className="pl-5">
          <ContextRow name="id" value={studio.activeId ?? 'Unsaved workflow'} />
          <ContextRow name="name" value={studio.name} />
        </div>
      </details>
    </div>}
  </div>
}

export function WorkflowNodeInputTree({ studio, inputValue, query }: {
  studio: WorkflowStudioState
  inputValue: unknown
  query: string
}) {
  const { selected, nodes, catalog, run, projectId, working, testStep, setSelectedId } = studio
  const ancestors = useMemo(() => upstreamOf(selected, nodes), [selected, nodes])
  const [artifacts, setArtifacts] = useState<Record<string, unknown>>({})
  const [pendingId, setPendingId] = useState<string | null>(null)
  const requested = useRef(new Set<string>())
  const [openNodes, setOpenNodes] = useState<Record<string, boolean>>({})
  const filtered = ancestors.filter(node => {
    if (!query.trim()) return true
    const name = typeof node.settings.__cliptora_ui_label === 'string' && node.settings.__cliptora_ui_label.trim()
      ? node.settings.__cliptora_ui_label.trim() : catalog.find(item => item.type === node.type)?.label ?? 'Node'
    return name.toLowerCase().includes(query.trim().toLowerCase())
  })

  useEffect(() => {
    if (!run?.id) return
    for (const node of ancestors) {
      const state = run.results?.[node.id]
      if (!state || state.state !== 'completed' || !state.artifact) continue
      const key = `${run.id}:${node.id}`
      if (requested.current.has(key)) continue
      requested.current.add(key)
      void api<unknown>(`/workflows/${projectId}/runs/${run.id}/artifacts/${encodeURIComponent(node.id)}`)
        .then(data => setArtifacts(previous => ({ ...previous, [key]: data })))
        .catch(() => { requested.current.delete(key) })
    }
  }, [ancestors, projectId, run?.id, run?.results])

  return <div className="space-y-2 px-3 py-4">
    {filtered.map(node => {
      const label = typeof node.settings.__cliptora_ui_label === 'string' && node.settings.__cliptora_ui_label.trim()
        ? node.settings.__cliptora_ui_label.trim() : catalog.find(item => item.type === node.type)?.label ?? 'Workflow node'
      const status = run?.results?.[node.id]
      const key = `${run?.id ?? ''}:${node.id}`
      const inputMap = getObject(inputValue)
      const data = Object.prototype.hasOwnProperty.call(artifacts, key) ? artifacts[key]
        : Object.prototype.hasOwnProperty.call(inputMap, node.id) ? inputMap[node.id]
          : status?.state === 'completed' ? status : null
      const expanded = openNodes[node.id] !== false
      const isRunning = pendingId === node.id || status?.state === 'running' || status?.state === 'queued'
      return <section key={node.id} className="min-w-0" aria-label={`Previous node ${label}`}>
        <div className="flex min-w-0 items-center gap-1.5">
          <button type="button" title={expanded ? 'Collapse node data' : 'Expand node data'} aria-expanded={expanded}
            onClick={() => setOpenNodes(previous => ({ ...previous, [node.id]: !expanded }))}
            className="grid size-6 shrink-0 cursor-pointer place-items-center rounded text-[#777] dark:text-[#b8bec7] hover:bg-[#e9e9e9] dark:hover:bg-[#1f2937]">
            {expanded ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
          </button>
          <button type="button" title={`Open ${label} editor`} onClick={() => setSelectedId(node.id)}
            className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-md py-1 text-left hover:bg-[#ececec] dark:hover:bg-[#1f2937]">
            <span className="grid size-9 shrink-0 place-items-center rounded-xl border border-[#e8e8e8] dark:border-[#374151] bg-white dark:bg-cl-dark-panel"><WorkflowToolIcon label={label} type={node.type} size={20} /></span>
            <span className="min-w-0 truncate text-[13px] font-medium text-[#2f2f2f] dark:text-[#f3f4f6]">{label}</span>
          </button>
          {status?.state === 'completed' && <CheckCircle2 size={16} className="shrink-0 text-emerald-600 dark:text-emerald-300" />}
          {status?.state === 'failed' && <CircleAlert size={16} className="shrink-0 text-red-600 dark:text-red-300" />}
          {isRunning && <LoaderCircle size={16} className="shrink-0 animate-spin text-[#777] dark:text-[#b8bec7]" />}
          {(/trigger|schedule|cron|webhook/.test(node.type)) && <Zap size={14} className="shrink-0 text-[#555] dark:text-[#b8bec7]" />}
        </div>
        {expanded && <div className="min-w-0 pl-10 pt-2 pb-3">
          {data != null && !(!status || status.state !== 'completed') ? <RunData value={data} />
            : status?.state === 'failed' ? <p className="text-[12px] leading-5 text-red-600 dark:text-red-300">The previous node failed. Check its settings or execution logs.</p>
              : <div className="text-[12px] text-[#5a5a5a] dark:text-[#b8bec7]">
                <button type="button" disabled={working || pendingId !== null} onClick={() => {
                  setPendingId(node.id)
                  void Promise.resolve(testStep(node.id)).finally(() => setPendingId(null))
                }} className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-[#dedede] dark:border-[#374151] bg-white dark:bg-cl-dark-panel px-3 py-2 font-medium text-[#444] dark:text-[#b8bec7] shadow-sm transition-colors hover:bg-[#f5f5f5] dark:hover:bg-[#1f2937] disabled:cursor-not-allowed disabled:opacity-40">
                  {isRunning ? <LoaderCircle size={14} className="animate-spin" /> : <Play size={13} />}
                  Execute previous nodes
                </button>
                <p className="mt-1.5 text-[#666] dark:text-[#b8bec7]">to view input data</p>
              </div>}
        </div>}
      </section>
    })}
    {!filtered.length && ancestors.length > 0 && <p className="px-2 py-4 text-[12px] text-[#888] dark:text-[#b8bec7]">No matching previous nodes.</p>}
    <WorkflowVariablesContext studio={studio} />
  </div>
}
