import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type WheelEvent as ReactWheelEvent } from 'react'
import {
  AlertCircle,
  AudioLines,
  BrainCircuit,
  Check,
  CheckCircle2,
  CircleHelp,
  Clock3,
  Code2,
  Download,
  FileJson2,
  FileVideo2,
  Filter,
  FlaskConical,
  GitBranch,
  Globe2,
  HardDriveDownload,
  LoaderCircle,
  Maximize,
  Play,
  RotateCcw,
  Scissors,
  Trash2,
  Type,
  X,
  XCircle,
  ZoomIn,
  ZoomOut,
} from 'lucide-react'
import NodeProgress from './editor/NodeProgress'
import type { WorkflowStudioState } from './useWorkflowStudio'

type Dict = Record<string, unknown>
type FilterName = 'all' | 'completed' | 'failed' | 'running' | 'cancelled'
type Point = { x: number; y: number }
type CanvasNode = { id: string; label: string; type: string; subtitle: string; position: Point }
type CanvasEdge = { id: string; source: string; target: string; sourceHandle: string }
type Graph = { nodes: CanvasNode[]; edges: CanvasEdge[] }

type ExtraActions = {
  refreshRuns?: () => unknown
  reloadRuns?: () => unknown
  loadRuns?: () => unknown
  fetchRuns?: () => unknown
  getRunDetails?: (id: number) => unknown
  fetchRunDetails?: (id: number) => unknown
  fetchExecution?: (id: number) => unknown
  deleteRun?: (id: number) => unknown
  removeRun?: (id: number) => unknown
  deleteExecution?: (id: number) => unknown
  debugInEditor?: (id: number) => unknown
  openRunInEditor?: (id: number) => unknown
  openInEditor?: () => unknown
  setActiveTab?: (tab: string) => unknown
  setTab?: (tab: string) => unknown
  setView?: (view: string) => unknown
}

const NODE_W = 128
const NODE_H = 128
const NODE_STEP = 280
const DEFAULT_MAX_FIT_ZOOM = 0.62
const MIN_ZOOM = 0.15
const MAX_ZOOM = 1.6
const filters: { value: FilterName; label: string }[] = [
  { value: 'all', label: 'All executions' },
  { value: 'completed', label: 'Succeeded' },
  { value: 'failed', label: 'Error' },
  { value: 'running', label: 'Running / queued' },
  { value: 'cancelled', label: 'Cancelled' },
]

const asDict = (value: unknown): Dict | null => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Dict : null
const getString = (obj: Dict | null, ...keys: string[]): string => {
  if (!obj) return ''
  for (const key of keys) {
    const value = obj[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
    if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  }
  return ''
}
const getNumber = (obj: Dict | null, ...keys: string[]): number | null => {
  if (!obj) return null
  for (const key of keys) {
    const value = obj[key]
    if (typeof value === 'number' && Number.isFinite(value)) return value
    if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value)
  }
  return null
}
const asArray = (value: unknown): unknown[] | null => Array.isArray(value) ? value : null

function getDate(obj: Dict | null, keys: string[]): Date | null {
  for (const key of keys) {
    const raw = obj?.[key]
    if (typeof raw !== 'string' && typeof raw !== 'number') continue
    const date = typeof raw === 'number' ? new Date(raw < 1e12 ? raw * 1000 : raw) : new Date(raw)
    if (!Number.isNaN(date.getTime())) return date
  }
  return null
}

function formatDate(item: unknown): string {
  const obj = asDict(item)
  const date = getDate(obj, ['started_at', 'startedAt', 'created_at', 'createdAt', 'start_time', 'timestamp', 'updated_at'])
  if (!date) return 'Date unavailable'
  return new Intl.DateTimeFormat('en-US', {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).format(date)
}

function getDuration(item: unknown): string {
  const obj = asDict(item)
  let ms = getNumber(obj, 'duration_ms', 'durationMs', 'elapsed_ms', 'elapsedMs', 'execution_time_ms')
  if (ms === null) {
    const start = getDate(obj, ['started_at', 'startedAt', 'created_at', 'createdAt'])
    const end = getDate(obj, ['finished_at', 'finishedAt', 'completed_at', 'completedAt', 'ended_at'])
    if (start && end) ms = Math.max(0, end.getTime() - start.getTime())
  }
  if (ms === null) return ''
  if (ms < 1000) return `${Math.round(ms)}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(ms < 10_000 ? 2 : 1).replace(/\.?0+$/, '')}s`
  return `${Math.floor(ms / 60_000)}m ${Math.floor((ms % 60_000) / 1000)}s`
}

function getOutputSize(item: unknown): string {
  const bytes = getNumber(asDict(item), 'total_bytes', 'output_bytes', 'size_bytes', 'data_size', 'data_size_bytes')
  if (bytes === null) return ''
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`
}

function stateLabel(state: string): string {
  if (state === 'completed' || state === 'succeeded' || state === 'success') return 'Succeeded'
  if (state === 'failed' || state === 'error') return 'Error'
  if (state === 'running' || state === 'queued' || state === 'cancelling') return state === 'queued' ? 'Queued' : 'Running'
  if (state === 'cancelled') return 'Cancelled'
  return state || 'Unknown'
}

function stateColor(state: string): string {
  if (['completed', 'succeeded', 'success'].includes(state)) return '#28d987'
  if (['failed', 'error'].includes(state)) return '#ff7680'
  if (['queued', 'running', 'cancelling'].includes(state)) return '#eab308'
  return '#9ca3af'
}

function readGraph(studio: WorkflowStudioState, run: unknown, explicitNodes?: unknown, explicitEdges?: unknown): Graph {
  const queue: unknown[] = [
    run, { nodes: explicitNodes, edges: explicitEdges }, studio,
  ]
  const seen = new Set<unknown>()
  let rawNodes: unknown[] | null = null
  let rawEdges: unknown[] = []

  // Supports graphs exposed on studio, a workflow definition or a run snapshot.
  // Can also receive nodes/edges directly as optional props from the parent.
  for (let index = 0; index < queue.length && index < 35; index++) {
    let current = queue[index]
    if (typeof current === 'string') {
      const candidate = current.trim()
      if (!candidate.startsWith('{')) continue
      try { current = JSON.parse(candidate) as unknown } catch { continue }
    }
    if (seen.has(current)) continue
    seen.add(current)
    const object = asDict(current)
    if (!object) continue

    const nodes = asArray(object.nodes) ?? asArray(object.flowNodes) ?? asArray(object.workflowNodes) ?? asArray(object.canvasNodes)
    if (nodes && nodes.length) {
      rawNodes = nodes
      rawEdges = asArray(object.edges) ?? asArray(object.flowEdges) ?? asArray(object.workflowEdges) ?? asArray(object.connections) ?? []
      break
    }
    for (const name of [
      'workflow', 'workflowData', 'workflowDefinition', 'definition', 'definition_json',
      'graph', 'graph_json', 'flow', 'canvas', 'editor', 'data', 'snapshot',
      'workflow_snapshot', 'workflow_json', 'definition_snapshot',
    ]) {
      if (object[name] !== undefined && object[name] !== null) queue.push(object[name])
    }
  }

  // Historical results can still be shown when a saved workflow graph isn't exposed.
  if (!rawNodes) {
    const resultObjects = asDict(asDict(run)?.results)
    if (resultObjects) rawNodes = Object.keys(resultObjects).map((id) => ({ id, type: 'unknown', data: { label: id } }))
  }

  const nodes: CanvasNode[] = (rawNodes ?? []).map((entry, index) => {
    const value = asDict(entry)
    const data = asDict(value?.data)
    const metadata = asDict(data?.metadata)
    const position = asDict(value?.position) ?? asDict(value?.positionAbsolute)
    const id = getString(value, 'id', 'node_id', 'key') || `node-${index}`
    const type = getString(data, 'nodeType', 'type', 'kind') || getString(value, 'type', 'kind') || 'unknown'
    const label = getString(data, 'label', 'name', 'title', 'displayName') || getString(metadata, 'label', 'name') || getString(value, 'label', 'name') || type.replace(/[_-]+/g, ' ')
    const params = asDict(data?.parameters) ?? asDict(data?.config)
    const subtitle = getString(data, 'subtitle', 'description', 'operation', 'method') || getString(params, 'operation', 'method', 'action')
    const x = getNumber(position, 'x') ?? index * NODE_STEP
    const y = getNumber(position, 'y') ?? (index % 3 === 1 ? -110 : 50)
    return { id, type, label, subtitle, position: { x, y } }
  })

  const edges: CanvasEdge[] = rawEdges.map((entry, index) => {
    const value = asDict(entry)
    return {
      id: getString(value, 'id') || `edge-${index}`,
      source: getString(value, 'source', 'from', 'source_id'),
      target: getString(value, 'target', 'to', 'target_id'),
      sourceHandle: getString(value, 'sourceHandle', 'source_handle', 'output'),
    }
  }).filter(edge => !!edge.source && !!edge.target)

  return { nodes, edges }
}

function iconDetails(node: CanvasNode) {
  const type = `${node.type} ${node.label}`.toLowerCase()
  if (/schedule|cron|interval|timer|clock/.test(type)) return { Icon: Clock3, color: '#333333' }
  if (/condition|^if |^if$|branch|switch|filter/.test(type)) return { Icon: GitBranch, color: '#008879' }
  if (/http|request|api|webhook|url|fetch/.test(type)) return { Icon: Globe2, color: '#4b4af4' }
  if (/file|disk|read|write|storage|folder|upload|download/.test(type)) return { Icon: HardDriveDownload, color: '#39a948' }
  if (/video|movie|clip|media|inspect/.test(type)) return { Icon: FileVideo2, color: '#7c3aed' }
  if (/audio|sound|music|extract/.test(type)) return { Icon: AudioLines, color: '#0d9488' }
  if (/ai|gemini|openai|llm|chat|generate|summar/.test(type)) return { Icon: BrainCircuit, color: '#7c3aed' }
  if (/transcrib|subtitle|text|caption/.test(type)) return { Icon: Type, color: '#2563eb' }
  if (/javascript|python|code|script/.test(type)) return { Icon: Code2, color: '#e68b14' }
  if (/json|transform|parse/.test(type)) return { Icon: FileJson2, color: '#64748b' }
  if (/trigger|start|input/.test(type)) return { Icon: Play, color: '#333333' }
  return { Icon: CircleHelp, color: '#64748b' }
}

function getEdgePath(edge: CanvasEdge, nodesById: Map<string, CanvasNode>): string {
  const source = nodesById.get(edge.source)
  const target = nodesById.get(edge.target)
  if (!source || !target) return ''
  const isBranch = /condition|^if |^if$|branch|switch/i.test(`${source.type} ${source.label}`)
  const lowerHandle = /false|bottom|right-1|output-1|output_1|1$/i.test(edge.sourceHandle)
  const x1 = source.position.x + NODE_W
  const y1 = source.position.y + (isBranch ? lowerHandle ? 85 : 43 : NODE_H / 2)
  const x2 = target.position.x
  const y2 = target.position.y + NODE_H / 2
  const bend = Math.max(60, Math.abs(x2 - x1) * 0.45)
  return `M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`
}

export function WorkflowRuns({
  studio,
  nodes,
  edges,
}: {
  studio: WorkflowStudioState
  nodes?: unknown
  edges?: unknown
}) {
  const { run, runs, chooseRun, cancel, retry, working, applyCutPlan, downloadVideo, fetchArtifact } = studio
  const extra = studio as unknown as ExtraActions
  const refreshRuns = extra.refreshRuns ?? extra.reloadRuns ?? extra.loadRuns ?? extra.fetchRuns
  const removeRun = extra.deleteRun ?? extra.removeRun ?? extra.deleteExecution
  const getRunDetails = extra.getRunDetails ?? extra.fetchRunDetails ?? extra.fetchExecution
  const canDebug = Boolean(extra.debugInEditor || extra.openRunInEditor || extra.openInEditor || extra.setActiveTab || extra.setTab || extra.setView)

  const [filter, setFilter] = useState<FilterName>('all')
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [autoRefresh, setAutoRefresh] = useState(true)
  const [zoom, setZoom] = useState(DEFAULT_MAX_FIT_ZOOM)
  const [pan, setPan] = useState<Point>({ x: 0, y: 0 })
  const [viewport, setViewport] = useState({ width: 1000, height: 650 })
  const [selectedNode, setSelectedNode] = useState<string | null>(null)
  const [previewRunId, setPreviewRunId] = useState<number | null>(null)
  const [previewDetails, setPreviewDetails] = useState<unknown>(null)
  const viewportRef = useRef<HTMLDivElement>(null)
  const dragging = useRef<{ x: number; y: number; previous: Point } | null>(null)
  const getRunDetailsRef = useRef(getRunDetails)
  getRunDetailsRef.current = getRunDetails

  useEffect(() => {
    if (!autoRefresh || !refreshRuns) return
    const timer = window.setInterval(() => { void Promise.resolve(refreshRuns()).catch(() => undefined) }, 7_000)
    return () => window.clearInterval(timer)
  }, [autoRefresh, refreshRuns])

  useEffect(() => {
    const element = viewportRef.current
    if (!element) return
    const updateSize = () => setViewport({ width: element.clientWidth, height: element.clientHeight })
    updateSize()
    const observer = new ResizeObserver(updateSize)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    setPreviewDetails(null)
    const loadDetails = getRunDetailsRef.current
    if (previewRunId === null || !loadDetails) return
    let active = true
    void Promise.resolve()
      .then(() => loadDetails(previewRunId))
      .then(response => {
        if (!active) return
        const candidate = asDict(response)
        const detail = asDict(candidate?.data) ?? candidate
        if (detail && getNumber(detail, 'id') === previewRunId) setPreviewDetails(detail)
      })
      .catch(() => undefined)
    return () => { active = false }
  }, [previewRunId])

  useEffect(() => {
    setPreviewRunId(null)
    setSelectedNode(null)
  }, [studio.activeId])

  // Browsing history is always read-only. chooseRun() is only called from
  // the explicit "Use this execution" button, never from a list click.
  const scopedRuns = studio.activeId === null
    ? []
    : runs.filter(item => getNumber(asDict(item), 'workflow_id') === studio.activeId)
  const previewSummary = previewRunId === null
    ? scopedRuns[0]
    : scopedRuns.find(item => item.id === previewRunId)
  const previewRun = run && (previewRunId === null || run.id === previewRunId)
    ? run
    : (previewDetails && getNumber(asDict(previewDetails), 'id') === previewRunId
      ? previewDetails as (typeof runs)[number]
      : previewSummary ?? null)
  const isActivePreview = Boolean(run && previewRun && run.id === previewRun.id)
  const previewResults = asDict(asDict(previewRun)?.results)

  const graph = readGraph(studio, previewRun, nodes, edges)
  const graphSignature = graph.nodes.map(node => `${node.id}:${node.type}:${node.label}:${node.position.x}:${node.position.y}`).join('|') + '::' + graph.edges.map(edge => `${edge.source}:${edge.target}:${edge.sourceHandle}`).join('|')
  const bounds = useMemo(() => {
    if (!graph.nodes.length) return { centerX: 0, centerY: 0, width: 600, height: 300 }
    const minX = Math.min(...graph.nodes.map(node => node.position.x))
    const maxX = Math.max(...graph.nodes.map(node => node.position.x + NODE_W))
    const minY = Math.min(...graph.nodes.map(node => node.position.y))
    const maxY = Math.max(...graph.nodes.map(node => node.position.y + NODE_H + 65))
    return { centerX: (minX + maxX) / 2, centerY: (minY + maxY) / 2, width: maxX - minX, height: maxY - minY }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graphSignature])

  useEffect(() => {
    const scaleX = (viewport.width - 90) / Math.max(1, bounds.width)
    const scaleY = (viewport.height - 105) / Math.max(1, bounds.height)
    setZoom(Math.min(DEFAULT_MAX_FIT_ZOOM, Math.max(MIN_ZOOM, Math.min(scaleX, scaleY))))
    setPan({ x: 0, y: 0 })
  }, [bounds, viewport.width, viewport.height])

  const graphNodes = useMemo(() => new Map(graph.nodes.map(node => [node.id, node])), [graphSignature])
  const selectedInfo = selectedNode ? previewResults?.[selectedNode] : null
  const selectedDetails = asDict(selectedInfo)

  const visibleRuns = scopedRuns.filter(item => {
    const state = item.state.toLowerCase()
    if (filter === 'all') return true
    if (filter === 'completed') return ['completed', 'success', 'succeeded'].includes(state)
    if (filter === 'failed') return ['failed', 'error'].includes(state)
    if (filter === 'running') return ['running', 'queued', 'cancelling'].includes(state)
    return state === 'cancelled'
  })

  const adjustZoom = (factor: number) => setZoom(current => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, current * factor)))
  const fitGraph = () => {
    const scaleX = (viewport.width - 90) / Math.max(1, bounds.width)
    const scaleY = (viewport.height - 105) / Math.max(1, bounds.height)
    setZoom(Math.min(DEFAULT_MAX_FIT_ZOOM, Math.max(MIN_ZOOM, Math.min(scaleX, scaleY))))
    setPan({ x: 0, y: 0 })
  }
  const startPan = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || (event.target as HTMLElement).closest('[data-flow-node]')) return
    dragging.current = { x: event.clientX, y: event.clientY, previous: pan }
    event.currentTarget.setPointerCapture(event.pointerId)
  }
  const movePan = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragging.current
    if (!drag) return
    setPan({ x: drag.previous.x + event.clientX - drag.x, y: drag.previous.y + event.clientY - drag.y })
  }
  const stopPan = () => { dragging.current = null }
  const handleWheel = (event: ReactWheelEvent<HTMLDivElement>) => {
    if (event.ctrlKey || event.metaKey) {
      event.preventDefault()
      adjustZoom(event.deltaY > 0 ? 0.91 : 1.09)
    } else {
      setPan(previous => ({ x: previous.x - event.deltaX, y: previous.y - event.deltaY }))
    }
  }

  const openEditor = () => {
    if (!previewRun) return
    if (extra.debugInEditor) void extra.debugInEditor(previewRun.id)
    else if (extra.openRunInEditor) void extra.openRunInEditor(previewRun.id)
    else if (extra.openInEditor) void extra.openInEditor()
    else if (extra.setActiveTab) void extra.setActiveTab('editor')
    else if (extra.setTab) void extra.setTab('editor')
    else if (extra.setView) void extra.setView('editor')
  }
  const deleteSelected = () => {
    if (!previewRun || !removeRun || !window.confirm(`Delete execution #${previewRun.id}? This cannot be undone.`)) return
    void removeRun(previewRun.id)
    if (previewRunId === previewRun.id) setPreviewRunId(null)
  }
  const activatePreview = () => {
    if (!previewRun || isActivePreview) return
    void chooseRun(previewRun)
  }

  const translateX = viewport.width / 2 - bounds.centerX * zoom + pan.x
  const translateY = viewport.height / 2 - bounds.centerY * zoom + pan.y + 25

  return (
    <section className="flex h-full min-h-0 min-w-0 w-full flex-1 overflow-hidden bg-white text-[#242424] dark:bg-[#191919] dark:text-[#ededed]">
      {/* Left: executions list */}
      <aside className="flex h-full min-h-0 w-[255px] shrink-0 flex-col border-r border-[#e5e5e5] bg-white dark:border-[#393939] dark:bg-[#202020] sm:w-[300px] lg:w-[335px] 2xl:w-[390px]">
        <div className="shrink-0 px-4 pb-3 pt-5 sm:px-5">
          <h2 className="text-[21px] font-medium leading-7 tracking-[-0.5px]">Executions</h2>
          <div className="relative mt-7 flex items-center justify-between gap-3">
            <label className="inline-flex cursor-pointer items-center gap-3 text-[16px]">
              <input type="checkbox" checked={autoRefresh} onChange={event => setAutoRefresh(event.target.checked)} className="h-[21px] w-[21px] cursor-pointer accent-[#303030]" />
              <span>Auto refresh</span>
            </label>
            <button type="button" aria-label="Filter executions" title="Filter executions" onClick={() => setFiltersOpen(value => !value)} className={`flex h-11 w-11 items-center justify-center rounded-full border bg-white transition-colors hover:bg-[#f4f4f4] dark:bg-[#242424] dark:hover:bg-[#303030] ${filtersOpen || filter !== 'all' ? 'border-[#909090]' : 'border-[#dedede] dark:border-[#424242]'}`}>
              <Filter size={20} strokeWidth={1.9} />
            </button>
            {filtersOpen && (
              <div className="absolute right-0 top-[49px] z-30 w-52 overflow-hidden rounded-xl border border-[#e5e5e5] bg-white p-1.5 shadow-xl dark:border-[#444] dark:bg-[#292929]">
                {filters.map(option => (
                  <button key={option.value} type="button" onClick={() => { setFilter(option.value); setFiltersOpen(false) }} className="flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm hover:bg-[#f3f3f3] dark:hover:bg-[#393939]">
                    {option.label} {filter === option.value && <Check size={15} />}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-6 sm:px-5">
          {visibleRuns.length === 0 ? (
            <div className="py-12 text-center text-sm text-[#929292]">No executions found.</div>
          ) : visibleRuns.map(item => {
            const active = previewRun?.id === item.id
            const duration = getDuration(item)
            const currentState = item.state.toLowerCase()
            const failure = ['failed', 'error'].includes(currentState)
            return (
              <button
                type="button"
                key={item.id}
                title="Preview execution (no changes applied)"
                onClick={() => { setSelectedNode(null); setPreviewRunId(item.id) }}
                className={`group relative flex min-h-[79px] w-full items-center gap-3 border-l-[4px] px-4 py-3 text-left transition-colors ${active ? 'bg-[#efefef] dark:bg-[#333]' : 'bg-white hover:bg-[#f7f7f7] dark:bg-[#202020] dark:hover:bg-[#292929]'}`}
                style={{ borderLeftColor: stateColor(currentState) }}
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[16px] font-normal leading-6">{formatDate(item)}</span>
                  <span className="mt-[1px] block truncate text-[14px] leading-5">
                    <span className={failure ? 'text-[#f32323]' : ['completed', 'success', 'succeeded'].includes(currentState) ? 'text-[#525252] dark:text-[#bcbcbc]' : 'text-[#a47b00]'}>{stateLabel(currentState)}</span>
                    {duration ? <span className="text-[#555] dark:text-[#aaa]"> in {duration}</span> : null}
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-3 text-[#353535] dark:text-[#ddd]">
                  {failure && <RotateCcw size={18} strokeWidth={1.9} />}
                  <FlaskConical size={19} strokeWidth={1.9} />
                </span>
              </button>
            )
          })}
        </div>
      </aside>

      {/* Right: selected execution + read-only workflow graph */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <header className="flex min-h-[86px] shrink-0 flex-wrap items-center justify-between gap-4 border-b border-[#ebebeb] bg-white px-4 py-3 sm:px-6 dark:border-[#393939] dark:bg-[#202020]">
          
<div className="min-w-0">
  <h3 className="truncate text-[21px] font-normal leading-7 tracking-[-0.3px]">
    {previewRun ? formatDate(previewRun) : 'Select an execution'}
  </h3>

  {previewRun && (
    <>
      <p className="mt-[3px] text-[16px] leading-6 text-[#555] dark:text-[#c5c5c5]">
        <span
          title={getString(asDict(previewRun), 'error') || undefined}
          className={
            ['failed', 'error'].includes(previewRun.state)
              ? 'text-[#f01414]'
              : ['completed', 'success', 'succeeded'].includes(previewRun.state)
                ? 'text-[#24975d]'
                : 'text-[#b08300]'
          }
        >
          {stateLabel(previewRun.state)}
        </span>

        {getDuration(previewRun) && (
          <> in {getDuration(previewRun)}</>
        )}

        {getOutputSize(previewRun) && (
          <> | {getOutputSize(previewRun)}</>
        )}

        {' | '}ID#{previewRun.id}
      </p>

      {['queued', 'running', 'cancelling'].includes(previewRun.state) && (
        <div className="mt-2 max-w-[420px]">
          <div className="mb-1 flex items-center justify-between text-[11px] text-[#777] dark:text-[#b8bec7]">
            <span>Workflow progress</span>

            <span className="font-semibold tabular-nums">
              {Math.round(
                Math.max(
                  0,
                  Math.min(100, previewRun.progress ?? 0)
                )
              )}%
            </span>
          </div>

          <div className="h-1.5 overflow-hidden rounded-full bg-[#ececec] dark:bg-[#303030]">
            <div
              className="h-full rounded-full bg-violet-600 transition-[width] duration-300"
              style={{
                width: `${Math.max(
                  0,
                  Math.min(100, previewRun.progress ?? 0)
                )}%`,
              }}
            />
          </div>

          {previewRun.current_node && (
            <p className="mt-1 truncate text-[11px] text-[#777] dark:text-[#b8bec7]">
              Current node: {previewRun.current_node}
            </p>
          )}
        </div>
      )}
    </>
  )}
</div>
          <div className="flex flex-wrap items-center gap-2.5">
            {previewRun && !isActivePreview && <button type="button" onClick={activatePreview} className="rounded-full border border-violet-200 bg-violet-50 px-3 py-2 text-xs font-medium text-violet-700 hover:bg-violet-100" title="Only activate this execution for existing run actions; nothing is applied to the timeline">Use this execution</button>}
            <button type="button" disabled={!previewRun || !canDebug || (!isActivePreview && !extra.debugInEditor && !extra.openRunInEditor)} title={!canDebug ? 'Connect an editor-navigation action in useWorkflowStudio' : 'Debug in editor'} onClick={openEditor} className="h-11 rounded-full border border-[#dfdfdf] bg-white px-4 text-[16px] shadow-sm transition-colors hover:bg-[#f7f7f7] disabled:cursor-not-allowed disabled:opacity-50 dark:border-[#484848] dark:bg-[#262626] dark:hover:bg-[#303030]">Debug in editor</button>
            <button type="button" aria-label="Retry execution" title="Retry execution" onClick={() => void retry()} disabled={!isActivePreview || !['failed', 'cancelled'].includes(previewRun?.state ?? '') || working} className="flex h-11 w-11 items-center justify-center rounded-full border border-[#dfdfdf] bg-white shadow-sm hover:bg-[#f7f7f7] disabled:cursor-not-allowed disabled:opacity-40 dark:border-[#484848] dark:bg-[#262626] dark:hover:bg-[#303030]"><RotateCcw size={20} /></button>
            <button type="button" aria-label="Delete execution" title={!removeRun ? 'Delete action not available' : 'Delete execution'} onClick={deleteSelected} disabled={!previewRun || !removeRun} className="flex h-11 w-11 items-center justify-center rounded-full border border-[#dfdfdf] bg-white shadow-sm hover:bg-[#f7f7f7] disabled:cursor-not-allowed disabled:opacity-40 dark:border-[#484848] dark:bg-[#262626] dark:hover:bg-[#303030]"><Trash2 size={20} /></button>
          </div>
        </header>

        <div
          ref={viewportRef}
          className="relative min-h-0 flex-1 touch-none overflow-hidden"
          style={{ background: 'repeating-linear-gradient(135deg, #f7f7f7 0px, #f7f7f7 12px, #efefef 12px, #efefef 24px)', cursor: dragging.current ? 'grabbing' : 'grab' }}
          onPointerDown={startPan}
          onPointerMove={movePan}
          onPointerUp={stopPan}
          onPointerCancel={stopPan}
          onWheel={handleWheel}
          onClick={() => { if (filtersOpen) setFiltersOpen(false) }}
        >
          {graph.nodes.length ? (
            <div className="absolute left-0 top-0" style={{ transform: `translate(${translateX}px, ${translateY}px) scale(${zoom})`, transformOrigin: '0 0' }}>
              <svg className="pointer-events-none absolute left-0 top-0 overflow-visible" width="1" height="1" aria-hidden="true">
                {graph.edges.map(edge => {
                  const d = getEdgePath(edge, graphNodes)
                  return d ? <path key={edge.id} d={d} fill="none" stroke="#c7c7c7" strokeWidth="3" strokeLinecap="round" /> : null
                })}
              </svg>
              {graph.nodes.map(node => {
                const { Icon, color } = iconDetails(node)
                const nodeResult = previewResults?.[node.id]
                const result = asDict(nodeResult)
                const nodeState = getString(result, 'state', 'status')
                const branch = /condition|^if |^if$|branch|switch/i.test(`${node.type} ${node.label}`)
                return (
                  <div key={node.id} data-flow-node className="absolute select-none" style={{ left: node.position.x, top: node.position.y, width: NODE_W }}>
                    <button
                      type="button"
                      aria-label={`Inspect ${node.label}`}
                      title={`${node.label}${nodeState ? ` · ${nodeState}` : ''}${node.subtitle ? ` · ${node.subtitle}` : ''}`}
                      onClick={() => setSelectedNode(previous => previous === node.id ? null : node.id)}
                      className={`relative flex h-[128px] w-[128px] items-center justify-center rounded-[22px] border-[2px] bg-white shadow-[0_1px_2px_rgba(0,0,0,0.035)] transition-colors ${selectedNode === node.id ? 'border-[#777] ring-4 ring-[#dedede]' : 'border-[#d9d9d9] hover:border-[#969696]'}`}
                    >
                      <Icon size={56} strokeWidth={1.8} style={{ color }} />
                      <span className="absolute -left-[13px] top-[54px] h-[21px] w-[21px] rounded-full border-[1.5px] border-[#a4a4a4] bg-white" />
                      <span className={`absolute -right-[13px] h-[21px] w-[21px] rounded-full border-[1.5px] border-[#a4a4a4] bg-white ${branch ? 'top-[32px]' : 'top-[54px]'}`} />
                      {branch && <span className="absolute -right-[13px] top-[74px] h-[21px] w-[21px] rounded-full border-[1.5px] border-[#a4a4a4] bg-white" />}
                      {nodeState && ['failed', 'error'].includes(nodeState) && <span className="absolute -right-[11px] -top-[11px] rounded-full bg-white"><XCircle size={22} className="text-red-500" /></span>}
                      {nodeState && ['completed', 'success', 'succeeded', 'done'].includes(nodeState) && <span className="absolute -right-[11px] -top-[11px] rounded-full bg-white"><CheckCircle2 size={22} className="text-emerald-500" /></span>}
                      {nodeState && ['running', 'queued'].includes(nodeState) && <span className="absolute -right-[11px] -top-[11px] rounded-full bg-white"><LoaderCircle size={22} className="animate-spin text-amber-500" /></span>}
                    </button>
                    <div className="pointer-events-none absolute left-1/2 top-[137px] w-[230px] -translate-x-1/2 text-center">
                      <p className="text-[20px] font-medium leading-[27px] text-[#181818]">{node.label}</p>
                      {node.subtitle && <p className="mt-1 truncate text-[16px] leading-5 text-[#777]">{node.subtitle}</p>}
                    </div>
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="absolute inset-0 flex items-center justify-center px-8 text-center">
              <div className="max-w-md rounded-xl border border-[#dedede] bg-white/95 p-6 shadow-sm">
                <AlertCircle size={24} className="mx-auto mb-3 text-[#888]" />
                <p className="text-sm font-medium">Workflow graph not available</p>
                <p className="mt-2 text-xs leading-5 text-[#777]">Expose nodes and edges on the studio workflow definition, or pass them to WorkflowRuns as props.</p>
              </div>
            </div>
          )}

          {/* Node information is hidden until a node is clicked. */}
          {selectedNode && (
            <div data-flow-node className="absolute right-5 top-5 z-10 w-[280px] rounded-xl border border-[#ddd] bg-white p-4 shadow-xl">
              <div className="flex items-center justify-between gap-2">
                <strong className="truncate text-sm">{graphNodes.get(selectedNode)?.label ?? selectedNode}</strong>
                <button type="button" aria-label="Close node details" className="rounded p-1 hover:bg-[#f2f2f2]" onClick={() => setSelectedNode(null)}><X size={16} /></button>
              </div>
              <p className="mt-2 text-xs text-[#777]">{getString(selectedDetails, 'state', 'status') || 'No detailed result available for this execution'}</p>

              {previewRun && (
                <NodeProgress
                  run={previewRun}
                  nodeId={selectedNode}
                  label={graphNodes.get(selectedNode)?.label ?? selectedNode}
                  variant="compact"
                  className="mt-3"
                />
              )}

              {getString(selectedDetails, 'error') && <p className="mt-2 break-words text-xs text-red-600">{getString(selectedDetails, 'error')}</p>}
              {selectedDetails && <pre className="mt-3 max-h-[min(45vh,350px)] overflow-auto rounded-lg bg-[#f5f5f5] p-3 text-[11px] leading-5 text-[#333]">{JSON.stringify(selectedDetails, null, 2)}</pre>}
              {!selectedDetails && <p className="mt-3 text-xs leading-5 text-[#777]">You can inspect the workflow without activating it. Detailed node results require a saved execution payload.</p>}
              {Boolean(selectedDetails?.artifact) && <button type="button" disabled={!isActivePreview || working} title={!isActivePreview ? 'Click Use this execution first' : 'Download JSON artifact'} onClick={() => void fetchArtifact(selectedNode)} className="mt-3 inline-flex items-center gap-2 rounded-lg border border-[#ddd] px-3 py-2 text-xs font-medium hover:bg-[#f6f6f6] disabled:cursor-not-allowed disabled:opacity-50"><Download size={14} /> Download JSON</button>}
            </div>
          )}

          <div data-flow-node className="absolute bottom-5 left-5 flex items-center gap-1 rounded-full border border-[#e4e4e4] bg-white px-2 py-2 shadow-sm">
            <button type="button" aria-label="Fit workflow to screen" title="Fit to screen" onClick={fitGraph} className="flex h-8 w-9 items-center justify-center rounded-full hover:bg-[#f2f2f2]"><Maximize size={21} strokeWidth={1.9} /></button>
            <button type="button" aria-label="Zoom in" title="Zoom in" onClick={() => adjustZoom(1.2)} className="flex h-8 w-9 items-center justify-center rounded-full hover:bg-[#f2f2f2]"><ZoomIn size={22} strokeWidth={1.9} /></button>
            <button type="button" aria-label="Zoom out" title="Zoom out" onClick={() => adjustZoom(1 / 1.2)} className="flex h-8 w-9 items-center justify-center rounded-full hover:bg-[#f2f2f2]"><ZoomOut size={22} strokeWidth={1.9} /></button>
            <span className="min-w-[42px] text-center text-xs tabular-nums text-[#666]">{Math.round(zoom * 100)}%</span>
          </div>

        </div>

        {/* Keep existing run actions accessible without changing the screenshot's default layout. */}
        {previewRun && (['queued', 'running'].includes(previewRun.state) || previewRun.state === 'completed') && (
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-[#e7e7e7] bg-white px-5 py-2 dark:border-[#393939] dark:bg-[#202020]">
            {['queued', 'running'].includes(previewRun.state) && <button type="button" disabled={!isActivePreview} onClick={() => void cancel()} className="rounded-lg border px-3 py-1.5 text-xs hover:bg-[#f7f7f7]">Cancel execution</button>}
            {previewRun.state === 'completed' && <>
              <button type="button" disabled={working || !isActivePreview} title={!isActivePreview ? 'Click Use this execution first' : 'Apply Cut Plan to Timeline'} onClick={() => void applyCutPlan()} className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs hover:bg-[#f7f7f7]"><Scissors size={14} /> Apply Cut Plan</button>
              <button type="button" disabled={working || !isActivePreview} title={!isActivePreview ? 'Click Use this execution first' : 'Download rendered video'} onClick={() => void downloadVideo()} className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs hover:bg-[#f7f7f7]"><Download size={14} /> Rendered video</button>
            </>}
          </div>
        )}
      </div>
    </section>
  )
}
