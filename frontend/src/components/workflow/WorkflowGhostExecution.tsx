/** Visual-only, bounded per-item execution view. Never persists nodes or edges. */
import { useEffect, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from 'react'
import type { Edge, Node as FlowNode, NodeProps } from '@xyflow/react'
import { CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, Clock3, Eye, LoaderCircle, X, XCircle, MinusCircle, AlertTriangle, ListFilter, FileJson2 } from 'lucide-react'
import { api } from '../../lib/api'
import type { WorkflowNode } from './workflowTypes'
import { WorkflowQuickAddContext, flowNodeTypes, type StudioFlowNode } from './WorkflowNodeCard'

export const GHOST_PREFIX = '__cliptora-ghost:'

export type GhostState = 'waiting' | 'running' | 'completed' | 'failed' | 'skipped' | 'cancelled' | 'recorded'
export type LiveTask = {
  id: string
  label: string
  index: number
  state: GhostState
  started_at?: string
  finished_at?: string
  error?: string
  /** Only output collections use this path; it never claims independent execution. */
  collection_path?: string
}
export type LiveTaskSnapshot = {
  mode: string
  total: number
  waiting: number
  running: number
  completed: number
  failed: number
  skipped: number
  items: LiveTask[]
  truncated?: boolean
  /** For historical output collections, items are generated per page, not materialized. */
  collection_path?: string
  collection_label?: string
  collection_options?: GhostCollection[]
}
export type GhostCollection = { path: string; label: string; elements: number }
export type GhostFilter = 'all' | GhostState
export type GhostPreferences = {
  collapsed?: boolean
  filter?: GhostFilter
  page?: number
  collection?: string
}
export type GhostSize = { width: number; height: number }
export type GhostActions = {
  toggle: (originId: string) => void
  filter: (originId: string, value: GhostFilter) => void
  page: (originId: string, page: number) => void
  collection: (originId: string, path: string) => void
}
export type GhostSummary = {
  waiting: number
  running: number
  completed: number
  failed: number
  skipped: number
  truncated: boolean
  available: number
  recorded: boolean
}
export type GhostFlowNode = FlowNode<{
  originId: string
  originLabel: string
  nodeType: string
  mode: string
  total: number
  task?: LiveTask
  hidden: number
  more: boolean
  panel?: boolean
  collapsed?: boolean
  filter?: GhostFilter
  page?: number
  pageCount?: number
  matches?: number
  summary?: GhostSummary
  actions?: GhostActions
  shifted?: boolean
  collectionOptions?: GhostCollection[]
  activeCollection?: string
}, 'cliptora-ghost'>

export type GhostSelection = {
  originId: string
  originLabel: string
  mode: string
  total: number
  task: LiveTask
}

export const GHOST_PAGE_SIZE = 5

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

export function parseLiveTaskSnapshot(value: unknown): LiveTaskSnapshot | null {
  if (!isObject(value) || !Array.isArray(value.items)) return null
  const total = value.total
  if (typeof total !== 'number' || !Number.isSafeInteger(total) || total <= 0) return null
  const valid: GhostState[] = ['waiting', 'running', 'completed', 'failed', 'skipped', 'cancelled', 'recorded']
  const items: LiveTask[] = value.items.flatMap(entry => {
    if (!isObject(entry) || typeof entry.id !== 'string' ||
        typeof entry.index !== 'number' || !Number.isSafeInteger(entry.index) ||
        entry.index < 0 || entry.index >= total || !valid.includes(entry.state as GhostState)) return []
    return [{
      id: entry.id,
      label: typeof entry.label === 'string' ? entry.label : entry.id,
      index: entry.index,
      state: entry.state as GhostState,
      ...(typeof entry.error === 'string' ? { error: entry.error } : {}),
      ...(typeof entry.started_at === 'string' ? { started_at: entry.started_at } : {}),
      ...(typeof entry.finished_at === 'string' ? { finished_at: entry.finished_at } : {}),
      ...(typeof entry.collection_path === 'string' ? { collection_path: entry.collection_path } : {}),
    }]
  })
  const count = (key: GhostState) =>
    typeof value[key] === 'number' && Number.isFinite(value[key])
      ? Math.max(0, Math.min(total, value[key] as number)) : 0
  return {
    mode: typeof value.mode === 'string' ? value.mode : 'items',
    total,
    waiting: count('waiting'), running: count('running'),
    completed: count('completed'), failed: count('failed'), skipped: count('skipped'),
    items,
    truncated: value.truncated === true,
  }
}

/**
 * Output collection metadata is distinct from a true per-item execution trace.
 * It is intentionally generic: any node reporting a meaningful array under
 * results[nodeId].collections can have Ghost output cards. Nothing is marked
 * completed/running from the parent node state.
 */
const ignoredCollection = /(?:^|\.)(?:warnings?|errors?|failed_items|failed_voiceovers|skipped_voiceovers|logs?|messages?|memory|entries|metadata|raw|headers?|tags?|trace|debug|token_usage|usage|diagnostics?)$/i
const preferredCollectionPaths: Record<string, string[]> = {
  'audio.transcribe': ['segments', 'words'],
  'context.smart': ['chunks'],
  'ai.batch': ['chunk_diagnostics', 'compact_highlights', 'merged.items', 'merged.summaries'],
  'video.remix_validate': ['highlights', 'rejected'],
  'video.remix_cut': ['clip_manifest.groups', 'cut_plan'],
  'video.remix_split': ['clip_manifest.groups'],
  'video.remix_duplicate': ['clip_manifest.groups'],
  'video.remix_shuffle': ['clip_manifest.groups'],
  'video.remix_zoom': ['clip_manifest.groups'],
  'video.remix_merge': ['clip_manifest.groups', 'cut_plan'],
  'audio.edge_tts_groups': ['voiceovers', 'clip_manifest.groups', 'audio_files'],
  'ai.gemini': ['narrations', 'highlights', 'json.narrations', 'json.highlights'],
}
function collectionName(path: string): string {
  const last = path.split('.').pop() ?? path
  const labels: Record<string, string> = {
    chunk_diagnostics: 'Chunk', chunks: 'Chunk', segments: 'Segment', words: 'Word',
    groups: 'Group', voiceovers: 'Voiceover', narrations: 'Narration',
    highlights: 'Highlight', clips: 'Clip', items: 'Item',
    audio_files: 'Audio file', videos: 'Video', subtitles: 'Subtitle',
    cut_plan: 'Cut', rejected: 'Rejected item',
  }
  return labels[last] ?? last.replace(/_/g, ' ').replace(/^./, c => c.toUpperCase())
}
function outputCollections(row: Record<string, unknown>): GhostCollection[] {
  if (!Array.isArray(row.collections)) return []
  const preferred = preferredCollectionPaths[String(row.type ?? '')] ?? []
  const paths = new Map<string, GhostCollection>()
  for (const entry of row.collections) {
    if (!isObject(entry) || typeof entry.path !== 'string' ||
        typeof entry.elements !== 'number' || !Number.isSafeInteger(entry.elements) ||
        entry.elements < 2 || ignoredCollection.test(entry.path) ||
        entry.path.length > 160) continue
    const path = entry.path
    paths.set(path, { path, label: collectionName(path), elements: entry.elements })
  }
  return [...paths.values()].sort((a, b) => {
    const ai = preferred.indexOf(a.path), bi = preferred.indexOf(b.path)
    if (ai >= 0 && bi >= 0) return ai - bi
    if (ai >= 0) return -1
    if (bi >= 0) return 1
    return b.elements - a.elements || a.path.localeCompare(b.path)
  })
}

function liveFromRun(results: unknown, originId: string, requestedCollection?: string): LiveTaskSnapshot | null {
  if (!isObject(results)) return null
  const row = results[originId]
  if (!isObject(row)) return null
  // Real per-item transitions always take precedence over output counts.
  // Output collections are a read-only fallback for older runs or executors
  // without per-item telemetry; the parent node being completed tells us
  // nothing about each individual collection entry's execution status.
  let snapshot = parseLiveTaskSnapshot(row.item_execution_live)
  if (!snapshot) {
    const options = outputCollections(row)
    const selected = options.find(item => item.path === requestedCollection) ?? options[0]
    if (selected) snapshot = {
      mode: 'recorded_collection',
      total: selected.elements,
      waiting: 0, running: 0, completed: 0, failed: 0, skipped: 0,
      items: [],
      collection_path: selected.path,
      collection_label: selected.label,
      collection_options: options,
      truncated: false,
    }
  }
  if (!snapshot) return null
  // A terminated parent cannot still have genuinely running children.
  if (row.state === 'failed' || row.state === 'cancelled') {
    const terminal = row.state
    const interrupted = snapshot.items.filter(task => task.state === 'running').length
    return { ...snapshot,
      running: Math.max(0, snapshot.running - interrupted),
      failed: snapshot.failed + (terminal === 'failed' ? interrupted : 0),
      items: snapshot.items.map(task => task.state === 'running'
        ? { ...task, state: terminal,
            ...(terminal === 'failed' && typeof row.error === 'string' ? { error: row.error } : {}) }
        : task),
    }
  }
  return snapshot
}

/**
 * Build parallel, visually connected execution clones.
 *
 * One original studio node stays in place and keeps its persisted edges.
 * Display-only siblings share its x-coordinate and branch from the same
 * upstream nodes to the same downstream nodes (see buildGhostEdges).
 * No clone, panel or connection ever enters the workflow definition.
 *
 * Pagination/filtering operate on real telemetry or saved collection metadata.
 */
type Rect = { x: number; y: number; width: number; height: number }
function collides(a: Rect, b: Rect, margin = 18): boolean {
  return a.x < b.x + b.width + margin && a.x + a.width + margin > b.x &&
    a.y < b.y + b.height + margin && a.y + a.height + margin > b.y
}
const taskHeight = (type: string) => type === 'ai.agent' ? 320 : 270
function taskCounts(snapshot: LiveTaskSnapshot): GhostSummary {
  const known = snapshot.items.reduce((result, task) => {
    if (task.state in result) result[task.state as keyof typeof result]++
    return result
  }, { waiting: 0, running: 0, completed: 0, failed: 0, skipped: 0 })
  const pick = (key: keyof typeof known) => Math.max(snapshot[key], known[key])
  return {
    waiting: pick('waiting'), running: pick('running'),
    completed: pick('completed'), failed: pick('failed'),
    skipped: pick('skipped'),
    truncated: Boolean(snapshot.truncated || (!snapshot.collection_path && snapshot.items.length < snapshot.total)),
    available: snapshot.collection_path ? snapshot.total : snapshot.items.length,
    recorded: Boolean(snapshot.collection_path),
  }
}

export function buildGhostNodes(
  nodes: WorkflowNode[],
  results: unknown,
  labelFor: (node: WorkflowNode) => string,
  preferences: Readonly<Record<string, GhostPreferences>> = {},
  actions?: GhostActions,
  measured: Readonly<Record<string, GhostSize>> = {},
): GhostFlowNode[] {
  const ghosts: GhostFlowNode[] = []
  const reserved: Rect[] = nodes.map(node => ({
    x: node.position?.x ?? 80,
    y: node.position?.y ?? 80,
    width: Math.max(190, measured[node.id]?.width ?? (node.type === 'ai.agent' ? 300 : 190)),
    height: Math.max(160, measured[node.id]?.height ?? (node.type === 'ai.agent' ? 222 : 190)),
  }))

  for (const node of nodes) {
    const view = preferences[node.id] ?? {}
    const live = liveFromRun(results, node.id, view.collection)
    if (!live) continue

    const collapsed = view.collapsed === true
    const filter = view.filter ?? 'all'
    const recordedCollection = Boolean(live.collection_path)
    const matches = recordedCollection
      ? (filter === 'all' || filter === 'recorded' ? live.total : 0)
      : 0
    const filtered = recordedCollection ? [] : filter === 'all'
      ? live.items : live.items.filter(item => item.state === filter)
    const resultCount = recordedCollection ? matches : filtered.length
    const pageCount = Math.max(1, Math.ceil(resultCount / GHOST_PAGE_SIZE))
    const page = Math.max(0, Math.min(pageCount - 1, Math.floor(view.page ?? 0)))
    const first = page * GHOST_PAGE_SIZE
    const visible: LiveTask[] = collapsed ? [] : recordedCollection
      ? Array.from({ length: Math.max(0, Math.min(GHOST_PAGE_SIZE, matches - first)) }, (_, i) => {
          const index = first + i
          return {
            id: `collection:${live.collection_path}:${index}`,
            label: `${live.collection_label ?? 'Item'} ${index + 1}`,
            index, state: 'recorded' as const,
            collection_path: live.collection_path,
          }
        })
      : filtered.slice(first, first + GHOST_PAGE_SIZE)

    const origin = node.position ?? { x: 80, y: 80 }
    const x = origin.x // parallel siblings, never reflow the original main row
    const width = Math.max(190, measured[node.id]?.width ?? (node.type === 'ai.agent' ? 300 : 190))
    const rowStep = taskHeight(node.type)
    const panelHeight = collapsed ? 105 : 235
    const cloneTopGap = 64
    const panelGap = 46
    const blockHeight = visible.length * rowStep + panelHeight + panelGap
    const baseY = origin.y + Math.max(160, measured[node.id]?.height ?? 190) + cloneTopGap

    // Avoid physical overlap with existing real nodes or other ghost stacks;
    // search vertically to keep sibling x aligned with the original.
    let y = baseY
    for (let tries = 0; tries < 200; tries++) {
      const candidate = { x, y, width: Math.max(width, 242), height: blockHeight }
      const obstruction = reserved.find(other => collides(candidate, other))
      if (!obstruction) break
      y = Math.max(y + 28, obstruction.y + obstruction.height + 26)
    }
    reserved.push({ x, y, width: Math.max(width, 242), height: blockHeight })

    const common = {
      originId: node.id,
      originLabel: labelFor(node),
      nodeType: node.type,
      mode: live.mode,
      total: live.total,
      hidden: Math.max(0, live.total - visible.length),
    }

    visible.forEach((task, i) => ghosts.push({
      id: `${GHOST_PREFIX}${node.id}:${task.index}`,
      type: 'cliptora-ghost',
      position: { x, y: y + i * rowStep },
      zIndex: 8, draggable: false, selectable: false, connectable: false,
      deletable: false, focusable: false,
      data: { ...common, more: false, task },
    }))

    ghosts.push({
      id: `${GHOST_PREFIX}${node.id}:panel`,
      type: 'cliptora-ghost',
      position: { x, y: y + visible.length * rowStep + (visible.length ? panelGap : 0) },
      zIndex: 7, draggable: false, selectable: false, connectable: false,
      deletable: false, focusable: false,
      data: {
        ...common, more: true, panel: true, collapsed, filter, page,
        pageCount, matches: resultCount, summary: taskCounts(live),
        collectionOptions: live.collection_options, activeCollection: live.collection_path,
        actions, shifted: false,
      },
    })
  }
  return ghosts
}

/** Only presentation edges: the engine never receives these IDs. */
export const GHOST_EDGE_PREFIX = '__cliptora-ghost-edge:'
export function buildGhostEdges(
  realEdges: readonly Edge[],
  ghosts: readonly GhostFlowNode[],
): Edge[] {
  const visual: Edge[] = []
  // Cap decorative fan-in/out to avoid spaghetti when a node has many real
  // dependants. Every persisted connection remains visible in the main graph.
  const maxVisualPerSide = 2
  for (const ghost of ghosts) {
    if (!ghost.data.task) continue
    const originId = ghost.data.originId
    const incoming = realEdges.filter(edge => edge.target === originId)
    const outgoing = realEdges.filter(edge => edge.source === originId)

    const edgeFor = (edge: Pick<Edge, 'source' | 'target' | 'sourceHandle' | 'targetHandle'>, key: string): Edge => ({
      id: `${GHOST_EDGE_PREFIX}${ghost.id}:${key}`,
      type: 'cliptora-ghost-connection',
      source: edge.source, target: edge.target,
      sourceHandle: edge.sourceHandle ?? undefined,
      targetHandle: edge.targetHandle ?? undefined,
      selectable: false, deletable: false, reconnectable: false, focusable: false,
      animated: false,
      style: { stroke: '#a78bfa', strokeWidth: 1.8, strokeDasharray: '7 6', opacity: .55 },
    })

    // Duplicate *display* connections along the actual graph's parallel path.
    for (const inbound of incoming.slice(0, maxVisualPerSide)) {
      visual.push(edgeFor({
        source: inbound.source, sourceHandle: inbound.sourceHandle,
        target: ghost.id, targetHandle: inbound.targetHandle ?? 'input',
      }, `in:${inbound.id}`))
    }
    // Root nodes may have no target/input handle; do not fabricate one.
    for (const outbound of outgoing.slice(0, maxVisualPerSide)) {
      visual.push(edgeFor({
        source: ghost.id, sourceHandle: outbound.sourceHandle ?? 'main',
        target: outbound.target, targetHandle: outbound.targetHandle ?? 'input',
      }, `out:${outbound.id}`))
    }
  }
  return visual
}

const studioStatus = (state: GhostState): StudioFlowNode['data']['status'] =>
  state === 'completed' ? 'done' : state === 'running' ? 'running' :
    state === 'failed' ? 'failed' : 'waiting'

function elapsedSeconds(task: LiveTask): number | null {
  if (!task.started_at || !task.finished_at) return null
  const start = Date.parse(task.started_at)
  const finish = Date.parse(task.finished_at)
  if (!Number.isFinite(start) || !Number.isFinite(finish) || finish < start) return null
  return (finish - start) / 1000
}

const ghostStateColors: Record<GhostState, string> = {
  waiting: 'text-slate-500 dark:text-slate-400',
  running: 'text-violet-700 dark:text-violet-300',
  completed: 'text-emerald-700 dark:text-emerald-300',
  failed: 'text-rose-700 dark:text-rose-300',
  skipped: 'text-slate-500 dark:text-slate-400',
  cancelled: 'text-amber-700 dark:text-amber-300',
  recorded: 'text-violet-700 dark:text-violet-300',
}

const taskOpacity: Record<GhostState, number> = {
  waiting: .48, running: .76, completed: .43, failed: .7,
  skipped: .42, cancelled: .45, recorded: .53,
}

function TaskControlPanel({ data }: { data: GhostFlowNode['data'] }) {
  const summary = data.summary
  const known = summary && !summary.recorded
  const processed = summary ? summary.completed + summary.failed + summary.skipped : 0
  const percentage = known && data.total > 0 ? Math.min(100, Math.round(processed / data.total * 100)) : null
  const onClick = (event: ReactMouseEvent) => event.stopPropagation()
  const stopPointer = (event: ReactPointerEvent) => event.stopPropagation()
  return (
    <section className="nodrag nopan nowheel relative w-[242px] cursor-default rounded-xl border border-violet-200 bg-white/95 p-2.5 text-left shadow-[0_4px_18px_#0000000e] dark:border-violet-800 dark:bg-[#262b37]"
      aria-label={`${data.originLabel} live task controls`} onClick={onClick} onPointerDown={stopPointer}>

      <div className="flex items-center gap-1.5">
        <span className="grid size-6 shrink-0 place-items-center rounded-lg bg-violet-100 text-violet-600 dark:bg-violet-950/50 dark:text-violet-300"><ListFilter size={14}/></span>
        <span className="min-w-0 flex-1 truncate text-[11px] font-semibold text-slate-800 dark:text-slate-100" title={data.originLabel}>{summary?.recorded ? 'Output records' : 'Task executions'}</span>
        <span className="shrink-0 rounded-md bg-violet-50 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-violet-700 dark:bg-violet-950/40 dark:text-violet-300">{summary?.available ?? 0}/{data.total}</span>
        <button type="button" className="grid size-6 shrink-0 place-items-center rounded-md hover:bg-violet-100 dark:hover:bg-violet-900/40" onClick={() => data.actions?.toggle(data.originId)}
          title={data.collapsed ? 'Show ghost nodes' : 'Collapse ghost nodes'} aria-label={data.collapsed ? 'Expand ghost nodes' : 'Collapse ghost nodes'} aria-expanded={!data.collapsed}>
          <ChevronDown size={15} className={`transition-transform ${data.collapsed ? '-rotate-90' : ''}`} />
        </button>
      </div>
      {summary?.recorded ? (
        <p className="mt-1.5 text-[10px] text-violet-600 dark:text-violet-300">Collection entries · per-item execution status unavailable</p>
      ) : (
        <>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-700">
            <div className="h-full rounded-full bg-violet-500 transition-[width] duration-300" style={{ width: `${percentage ?? 0}%` }} />
          </div>
          <p className="mt-1 text-[10px] tabular-nums text-slate-500 dark:text-slate-400">
            {percentage ?? 0}% · {summary?.completed ?? 0} done · {summary?.running ?? 0} running · {summary?.failed ?? 0} failed
          </p>
        </>
      )}
      {!data.collapsed && <>
        {data.collectionOptions && data.collectionOptions.length > 1 && (
          <label className="mt-2 flex items-center gap-1.5 text-[10px] text-slate-500 dark:text-slate-400">
            <span className="shrink-0">Collection</span>
            <select aria-label="Choose output collection" value={data.activeCollection ?? ''}
              onChange={event => data.actions?.collection(data.originId, event.target.value)}
              className="nodrag nopan min-w-0 flex-1 rounded-md border border-violet-200 bg-white px-1.5 py-1 text-[10px] text-slate-700 outline-none dark:border-violet-800 dark:bg-slate-800 dark:text-slate-200">
              {data.collectionOptions.map(option => (
                <option key={option.path} value={option.path}>{option.path} ({option.elements})</option>
              ))}
            </select>
          </label>
        )}
        <div className="mt-2 flex items-center gap-1">
          <label className="sr-only" htmlFor={`ghost-filter-${data.originId}`}>Filter task state</label>
          <select id={`ghost-filter-${data.originId}`} value={data.filter ?? 'all'}
            onChange={event => data.actions?.filter(data.originId, event.target.value as GhostFilter)}
            className="nodrag nopan min-w-0 flex-1 rounded-md border border-slate-200 bg-white px-1.5 py-1 text-[10px] text-slate-700 outline-none focus:border-violet-400 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200">
            <option value="all">All states</option>
            <option value="running">Running</option>
            <option value="failed">Failed</option>
            <option value="completed">Completed</option>
            <option value="waiting">Waiting</option>
            <option value="recorded">Recorded</option>
            <option value="skipped">Skipped</option>
            <option value="cancelled">Cancelled</option>
          </select>
          <span className="shrink-0 text-[10px] tabular-nums text-slate-500 dark:text-slate-400">{data.matches ?? 0} found</span>
        </div>
        <div className="mt-2 flex items-center justify-between gap-2">
          <span className="text-[10px] text-slate-500 dark:text-slate-400">Page {(data.page ?? 0) + 1} / {data.pageCount ?? 1}</span>
          <div className="flex items-center gap-1">
            <button type="button" disabled={!data.page} className="grid size-6 place-items-center rounded-md border border-slate-200 hover:bg-slate-50 disabled:opacity-30 dark:border-slate-600 dark:hover:bg-slate-700"
              title="Previous task page" aria-label="Previous task page" onClick={() => data.actions?.page(data.originId, (data.page ?? 0) - 1)}><ChevronLeft size={14}/></button>
            <button type="button" disabled={(data.page ?? 0) >= (data.pageCount ?? 1) - 1} className="grid size-6 place-items-center rounded-md border border-slate-200 hover:bg-slate-50 disabled:opacity-30 dark:border-slate-600 dark:hover:bg-slate-700"
              title="Next task page" aria-label="Next task page" onClick={() => data.actions?.page(data.originId, (data.page ?? 0) + 1)}><ChevronRight size={14}/></button>
          </div>
        </div>
        {summary?.truncated && <p className="mt-1 text-[9px] leading-3 text-amber-700 dark:text-amber-300">Only reported tasks are pageable; additional backend trace is unavailable.</p>}
        {!data.matches && <p className="mt-1 text-[10px] text-slate-500 dark:text-slate-400">No reported tasks match this filter.</p>}
      </>}
    </section>
  )
}

export function GhostExecutionCard(props: NodeProps<GhostFlowNode>) {
  const { data } = props
  if (data.panel) return <TaskControlPanel data={data} />
  const task = data.task
  if (!task) return null
  const elapsed = elapsedSeconds(task)
  const previewData: StudioFlowNode['data'] = {
    label: data.originLabel,
    nodeType: data.nodeType,
    subtitle: `${task.label} · ${task.state}`,
    meta: `${task.label} · ${task.state}`,
    status: studioStatus(task.state), ghost: true,
    ghostState: task.state === 'recorded' ? 'recorded' : undefined,
  }
  const previewProps = {
    ...props, type: 'studio', selected: false, dragging: false,
    isConnectable: false, data: previewData,
  } as unknown as NodeProps<StudioFlowNode>
  const OriginalNodeCard = flowNodeTypes.studio
  const StateIcon = task.state === 'completed' ? CheckCircle2
    : task.state === 'failed' ? XCircle
      : task.state === 'running' ? LoaderCircle
        : task.state === 'skipped' || task.state === 'cancelled' ? MinusCircle
          : task.state === 'recorded' ? Eye : Clock3
  return (
    <div className="nodrag nopan relative w-[190px] cursor-pointer" title={`${data.originLabel} · ${task.label} · ${task.state}`}>

      <div className="pointer-events-none absolute -top-[25px] left-[114px] rounded-md border border-violet-200 bg-white/95 px-1.5 py-0.5 text-[9px] font-semibold text-violet-600 shadow-sm dark:border-violet-900 dark:bg-slate-900/95 dark:text-violet-300">#{task.index + 1}</div>
      <div style={{ opacity: taskOpacity[task.state] }} className="transition-opacity duration-150 hover:!opacity-[.85] [&_.react-flow__handle]:!pointer-events-none [&_button]:!hidden [&_.group\/node]:!cursor-pointer">
        <WorkflowQuickAddContext.Provider value={null}>
          <OriginalNodeCard {...previewProps} />
        </WorkflowQuickAddContext.Provider>
      </div>
      {task.state === 'recorded' && <span className="pointer-events-none absolute right-0 top-2 rounded-md border border-violet-200 bg-white/95 px-1.5 py-0.5 text-[9px] font-bold uppercase text-violet-700 dark:border-violet-900 dark:bg-slate-900/95 dark:text-violet-300">Output</span>}
      <div className="pointer-events-none mt-1.5 flex w-full flex-col gap-1 rounded-lg border border-dashed border-violet-200/75 bg-white/85 px-2.5 py-1.5 text-[10px] dark:border-violet-900 dark:bg-slate-900/80">
        <div className="flex min-w-0 items-center gap-1.5">
          <StateIcon size={12} className={`shrink-0 ${ghostStateColors[task.state]} ${task.state === 'running' ? 'animate-spin' : ''}`} />
          <span className={`truncate font-semibold capitalize ${ghostStateColors[task.state]}`}>{task.state}</span>
          <span className="ml-auto shrink-0 tabular-nums text-slate-500 dark:text-slate-400">{elapsed !== null ? `${elapsed.toFixed(1)}s` : `#${task.index + 1}/${data.total}`}</span>
        </div>
        {task.state === 'completed' ? (
          <div className="flex items-center gap-2"><span className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-700"><span className="block h-full w-full rounded-full bg-emerald-400" /></span><span className="shrink-0 text-emerald-700 dark:text-emerald-300">100%</span></div>
        ) : task.state === 'running' ? (
          <div className="h-1.5 overflow-hidden rounded-full bg-violet-100 dark:bg-violet-950/60" aria-label="Running, individual percentage not reported"><span className="block h-full w-1/3 animate-pulse rounded-full bg-violet-400" /></div>
        ) : task.state === 'recorded' ? (
          <span className="text-[9px] text-slate-500 dark:text-slate-400">Saved output item · not an execution trace</span>
        ) : null}
      </div>
    </div>
  )
}

function locateItem(artifact: Record<string, unknown>, task: LiveTask): unknown {
  // Collection entries may be deeply nested, e.g. clip_manifest.groups.
  // Use the exact path advertised by the node's run metadata.
  if (task.collection_path) {
    let value: unknown = artifact
    for (const part of task.collection_path.split('.')) {
      if (!isObject(value)) return null
      value = value[part]
    }
    return Array.isArray(value) ? (value[task.index] ?? null) : null
  }
  for (const key of ['items', 'failed_items', 'chunk_diagnostics', 'voiceovers', 'failed_voiceovers', 'skipped_voiceovers', 'audio_files']) {
    const values = artifact[key]
    if (!Array.isArray(values)) continue
    const found = values.find(value => isObject(value) &&
      [value.id, value.instance_id, value.group_id].some(id => String(id ?? '') === task.id))
    if (found !== undefined) return found
    if (key === 'chunk_diagnostics' && values[task.index] !== undefined) return values[task.index]
    if (key === 'items' && values[task.index] !== undefined &&
        isObject(values[task.index]) && !values[task.index].id) return values[task.index]
  }
  return null
}

type DetailsTab = 'overview' | 'input' | 'output' | 'json'
function showJson(value: unknown): string {
  try { return JSON.stringify(value, null, 2)?.slice(0, 30000) ?? '' }
  catch { return String(value) }
}
function readField(obj: unknown, keys: string[]): unknown {
  if (!isObject(obj)) return undefined
  for (const key of keys) if (obj[key] !== undefined) return obj[key]
  return undefined
}
export function GhostExecutionDetails({ selection, projectId, runId, onClose }: {
  selection: GhostSelection
  projectId: number
  runId: number | null
  onClose: () => void
}) {
  const [record, setRecord] = useState<unknown>(null)
  const [tab, setTab] = useState<DetailsTab>('overview')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const originId = selection.originId
  const taskId = selection.task.id
  const taskIndex = selection.task.index
  const taskState = selection.task.state
  const collectionPath = selection.task.collection_path
  const duration = elapsedSeconds(selection.task)
  useEffect(() => {
    let active = true
    setRecord(null)
    setError('')
    setTab('overview')
    setLoading(false)
    if (!runId || !['completed', 'failed', 'skipped', 'recorded', 'cancelled'].includes(taskState)) return
    setLoading(true)
    void api<Record<string, unknown>>(`/workflows/${projectId}/runs/${runId}/artifacts/${originId}`)
      .then(artifact => {
        if (!active) return
        setRecord(locateItem(artifact, { id: taskId, index: taskIndex, label: taskId, state: taskState, collection_path: collectionPath }))
      })
      .catch(reason => { if (active) setError(reason instanceof Error ? reason.message : 'Saved task artifact unavailable') })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [originId, taskId, taskIndex, taskState, collectionPath, runId, projectId])
  const savedInput = readField(record, ['input', 'input_data', 'inputs', 'request'])
  const savedOutput = readField(record, ['output', 'output_data', 'result', 'response']) ?? record
  const savedError = selection.task.error ?? readField(record, ['error', 'error_message'])
  const tabs: { id: DetailsTab; title: string }[] = [
    { id: 'overview', title: 'Overview' },
    { id: 'input', title: 'Input' },
    { id: 'output', title: 'Output' },
    { id: 'json', title: 'JSON' },
  ]
  const displayed = tab === 'input' ? savedInput : tab === 'output' ? savedOutput : record
  return (
    <aside className="nodrag nopan absolute bottom-4 left-4 z-[120] flex w-[min(440px,calc(100%-2rem))] max-h-[75%] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white/95 text-slate-800 shadow-2xl backdrop-blur-md dark:border-slate-700 dark:bg-slate-900/95 dark:text-slate-100" aria-label="Ghost execution details">
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-100 px-4 py-3 dark:border-slate-700">
        <div className="min-w-0 flex-1"><p className="truncate text-[13px] font-bold">{selection.originLabel} · {selection.task.label}</p><p className="mt-0.5 truncate text-[10px] text-slate-500 dark:text-slate-400">{selection.mode} · Task #{selection.task.index + 1} of {selection.total}</p></div>
        <button type="button" title="Close task details" aria-label="Close task details" onClick={onClose} className="grid size-7 shrink-0 place-items-center rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700"><X size={17}/></button>
      </div>
      <div role="tablist" aria-label="Ghost task details tabs" className="flex shrink-0 gap-1 border-b border-slate-100 px-3 py-2 dark:border-slate-700">
        {tabs.map(item => <button type="button" key={item.id} role="tab" aria-selected={tab === item.id} onClick={() => setTab(item.id)}
          className={`rounded-md px-2.5 py-1.5 text-[11px] font-semibold ${tab === item.id ? 'bg-violet-100 text-violet-700 dark:bg-violet-900/60 dark:text-violet-200' : 'text-slate-500 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-800'}`}>
          {item.id === 'json' && <FileJson2 size={12} className="mr-1 inline"/>}{item.title}
        </button>)}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-4 text-[11px] leading-5">
        {tab === 'overview' ? <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-800"><p className="text-[10px] text-slate-500 dark:text-slate-400">State</p><p className={`mt-1 font-semibold capitalize ${ghostStateColors[taskState]}`}>{taskState}</p></div>
            <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-800"><p className="text-[10px] text-slate-500 dark:text-slate-400">Duration</p><p className="mt-1 font-semibold tabular-nums">{duration !== null ? `${duration.toFixed(2)} seconds` : 'Not reported'}</p></div>
          </div>
          <div className="break-all rounded-xl border border-slate-100 p-3 dark:border-slate-700"><p><strong>Task ID:</strong> {selection.task.id}</p>
            <p className="mt-1"><strong>Started:</strong> {selection.task.started_at ?? 'Not reported'}</p>
            <p className="mt-1"><strong>Finished:</strong> {selection.task.finished_at ?? 'Not reported'}</p>
          </div>
          {savedError != null && <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-rose-700 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-300"><AlertTriangle size={14} className="mr-1 inline"/>{String(savedError)}</div>}
          {taskState === 'recorded' && <div className="rounded-lg bg-violet-50 p-2 text-violet-700 dark:bg-violet-950/30 dark:text-violet-300">This is an output collection entry, not a separate execution. No independent completion or running state was saved.{collectionPath ? ` Source: ${collectionPath}` : ''}</div>}
          <p className="text-[10px] text-slate-500 dark:text-slate-400">Input/Output tabs show only fields actually saved by the executor. No missing payload is reconstructed.</p>
        </div> : <>
          {loading && <p className="text-slate-500 dark:text-slate-400">Loading saved artifact…</p>}
          {error && <p className="rounded-lg bg-amber-50 p-2 text-amber-700 dark:bg-amber-950/30 dark:text-amber-300">{error}</p>}
          {!loading && (displayed === undefined || displayed === null)
            ? <p className="text-slate-500 dark:text-slate-400">{tab === 'input' ? 'No individual input was saved for this task.' : 'No individual saved artifact is available for this task.'}</p>
            : !loading && <pre className="overflow-auto whitespace-pre-wrap break-all rounded-lg bg-slate-50 p-3 font-mono text-[10px] leading-[16px] text-slate-800 dark:bg-slate-800 dark:text-slate-100">{showJson(displayed)}</pre>}
        </>}
      </div>
    </aside>
  )
}
