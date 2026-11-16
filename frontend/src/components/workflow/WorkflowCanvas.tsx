import {
  createContext,
  useContext,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type FormEvent,
  type MouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import { createPortal } from 'react-dom'
import { tidyWorkflowNodes } from './workflowTidyLayout'
import {
  Background,
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  MarkerType,
  MiniMap,
  ReactFlow,
  NodeToolbar,
  Position as ToolbarPosition,
  type NodeProps,
  type Node as FlowNode,
  type ReactFlowInstance,
  useNodesState,
  type Connection,
  type ConnectionLineComponentProps,
  type Edge,
  type EdgeChange,
  type EdgeProps,
  type NodeChange,
  type Viewport,
} from '@xyflow/react'

import {
  Ban,
  ChevronRight,
  ClipboardPaste,
  Braces,
  Maximize2,
  Minimize2,
  Download,
  Check,
  MoreHorizontal,
  Paintbrush,
  Scan,
  Sparkles,
  StickyNote,
  Power,
  PowerOff,
  Copy,
  ExternalLink,
  LayoutGrid,
  Hand,
  LassoSelect,
  GitBranch,
  Frame,
  Magnet,
  AlignCenterHorizontal,
  AlignLeft,
  AlignRight,
  AlignCenterVertical,
  AlignStartVertical,
  AlignEndVertical,
  AlignHorizontalDistributeCenter,
  AlignVerticalDistributeCenter,
  Ungroup,
  LockKeyhole,
  LockKeyholeOpen,
  MousePointer2,
  PanelBottom,
  PanelBottomClose,
  PanelRight,
  Pencil,
  Play,
  Plus,
  Replace,
  Search,
  Settings2,
  Trash2,
  Workflow as WorkflowIcon,
  X,
  XCircle,
  ZoomIn,
  ZoomOut,
} from 'lucide-react'

import type { WorkflowStudioState } from './useWorkflowStudio'
import type { WorkflowNode } from './workflowTypes'
import { btn } from './workflowUI'
import { WorkflowToolIcon } from './WorkflowToolIcon'
import {
  flowNodeTypes,
  WorkflowQuickAddContext,
  WorkflowManualTriggerExecuteContext,
  type StudioFlowNode,
} from './WorkflowNodeCard'
import { WorkflowBottomDeck } from './WorkflowBottomDeck'
import {
  WorkflowContextMenu,
  type ContextMenuAction,
} from './WorkflowContextMenu'
import { clone, uid } from './workflowUtils'
import { CanvasStickyNotes, type CanvasStickyNotesHandle } from './CanvasStickyNotes'
import {
  GHOST_PREFIX,
  GhostExecutionCard,
  GhostExecutionDetails,
  buildGhostNodes,
  buildGhostEdges,
  GHOST_EDGE_PREFIX,
  type GhostFlowNode,
  type GhostSelection,
  type GhostPreferences,
  type GhostFilter,
  type GhostSize,
} from './WorkflowGhostExecution'

type Position = { x: number; y: number }
type CanvasInteractionMode = 'mouse' | 'hand' | 'lasso' | 'connect' | 'frame'
type AlignAction = 'left' | 'centerX' | 'right' | 'top' | 'centerY' | 'bottom' | 'distributeX' | 'distributeY'

type CanvasSearchTab = 'all' | 'nodes' | 'workflows' | 'actions'

type CanvasSearchEntry = {
  key: string
  kind: 'node' | 'action' | 'workflow'
  label: string
  detail: string
  nodeType?: string
  actionId?: string
  workflowId?: number
}

type QuickAddPosition = {
  sourceId: string
  sourceHandle: string
  left: number
  top: number
  dropPosition?: Position
  mode?: 'add' | 'replace' | 'insert'
  insertEdge?: {
    edgeId: string
    targetId: string
  }
}

type ContextState = {
  kind: 'node' | 'pane' | 'edge'
  id?: string
  clientX: number
  clientY: number
  flowPosition?: Position
}

type NodeConfigClipboard = {
  schema: 'cliptora.workflow.node-config.v1'
  nodeType: string
  settings: Record<string, unknown>
  when: WorkflowNode['when']
  retryLimit?: number
  cache?: boolean
}

type FlowClipboard = {
  schema: 'cliptora.workflow.v1'
  name: string
  nodes: WorkflowNode[]
}

type ActionEdgeData = {
  label?: string
  state?: 'waiting' | 'running' | 'done' | 'failed'
  moving?: boolean
  onInsert?: (event: MouseEvent<HTMLButtonElement>) => void
  onDelete?: () => void
  onRename?: () => void
}

const FRAME_KEY = '__cliptora_ui_frame_id'
const FRAME_PREFIX = '__cliptora-frame:'
const SNAP_STEP = 24
const FRAME_PAD_X = 48
const FRAME_PAD_TOP = 70
const FRAME_PAD_BOTTOM = 46
const NODE_FALLBACK_WIDTH = 190
const NODE_FALLBACK_HEIGHT = 196

const connectionKey = '__cliptora_ui_source_handles'
const typedConnectionKey = '__cliptora_ui_target_handles'
const agentPortTypes = new Set(['chat_model', 'memory', 'tool'])

const pinKey = '__cliptora_ui_pinned'
const labelKey = '__cliptora_ui_label'
const edgeLabelKey = '__cliptora_ui_edge_labels'

const START_VIEWPORT: Viewport = {
  x: 90,
  y: 70,
  zoom: 0.7,
}

type FrameFlowNode = FlowNode<{
  title: string
  count: number
  frameId: string
  onUngroup: (frameId: string) => void
}, 'cliptora-frame'>

type CanvasFlowNode = StudioFlowNode | FrameFlowNode | GhostFlowNode

type FrameBounds = { x: number; y: number; width: number; height: number; ids: string[] }

const frameIdOf = (node: WorkflowNode): string | null =>
  typeof node.settings[FRAME_KEY] === 'string' && node.settings[FRAME_KEY]
    ? String(node.settings[FRAME_KEY]) : null

const snap = (value: number, enabled: boolean) => enabled
  ? Math.round(value / SNAP_STEP) * SNAP_STEP : value

function inferredAgentHandle(type: string): string {
  const name = type.toLowerCase()
  if (name === 'ai.chat_model') return 'chat_model'
  if (/memory/.test(name)) return 'memory'
  if (/^(browser[._-]|playwright[._-]|selenium[._-]|computer[._-]|ai[._-]tool|tools?[._-])/.test(name) ||
    /(?:^|[._-])(?:mouse|keyboard|click|scroll|handle|selector|screenshot)(?:$|[._-])/.test(name)) return 'tool'
  return 'input'
}

function insidePolygon(point: Position, vertices: Position[]): boolean {
  let result = false
  for (let i = 0, j = vertices.length - 1; i < vertices.length; j = i++) {
    const a = vertices[i], b = vertices[j]
    if ((a.y > point.y) !== (b.y > point.y) &&
      point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) result = !result
  }
  return result
}

/** Pointer drawing runs outside React state: no canvas rerender on pointermove. */
function CanvasGestureOverlay({
  mode, onDone,
}: {
  mode: 'lasso' | 'frame'
  onDone: (points: Position[], mode: 'lasso' | 'frame') => void
}) {
  const points = useRef<Position[]>([])
  const active = useRef<number | null>(null)
  const shape = useRef<SVGPathElement>(null)
  const setPath = (value: string) => shape.current?.setAttribute('d', value)
  const local = (event: ReactPointerEvent<HTMLDivElement>): Position => {
    const rect = event.currentTarget.getBoundingClientRect()
    return { x: event.clientX - rect.left, y: event.clientY - rect.top }
  }
  return (
    <div className="absolute inset-0 z-[40] touch-none cursor-crosshair"
      aria-label={mode === 'lasso' ? 'Draw a freehand selection' : 'Draw a frame around nodes'}
      onPointerDown={event => {
        if (event.button !== 0) return
        event.preventDefault()
        event.currentTarget.setPointerCapture(event.pointerId)
        active.current = event.pointerId
        points.current = [local(event)]
        setPath('')
      }}
      onPointerMove={event => {
        if (active.current !== event.pointerId) return
        const next = local(event)
        const first = points.current[0]
        if (mode === 'frame') {
          points.current = [first, next]
          setPath(`M ${first.x} ${first.y} H ${next.x} V ${next.y} H ${first.x} Z`)
        } else {
          const last = points.current[points.current.length - 1]
          if (Math.hypot(next.x - last.x, next.y - last.y) < 4) return
          points.current.push(next)
          setPath(points.current.map((point, index) =>
            `${index ? 'L' : 'M'} ${point.x} ${point.y}`).join(' ') + ' Z')
        }
      }}
      onPointerUp={event => {
        if (active.current !== event.pointerId) return
        active.current = null
        const drawn = points.current
        points.current = []
        setPath('')
        if (drawn.length < 2) return
        const bounds = {
          w: Math.max(...drawn.map(point => point.x)) - Math.min(...drawn.map(point => point.x)),
          h: Math.max(...drawn.map(point => point.y)) - Math.min(...drawn.map(point => point.y)),
        }
        if (Math.max(bounds.w, bounds.h) > 12) onDone(drawn, mode)
      }}
      onPointerCancel={() => { active.current = null; points.current = []; setPath('') }}
    >
      <svg className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden="true">
        <path ref={shape} fill="rgba(124, 58, 237, .10)" stroke="#7c3aed"
          strokeWidth={1.6} strokeDasharray={mode === 'frame' ? '6 5' : 'none'} />
      </svg>
    </div>
  )
}

function GroupFrame(props: NodeProps<FrameFlowNode>) {
  return (
    <div className="relative h-full w-full rounded-[18px] border-2 border-dashed border-violet-300/80 bg-violet-100/20 dark:border-violet-500/50 dark:bg-violet-500/5"
      style={{ pointerEvents: 'none' }}>
      <div className="cliptora-frame-handle absolute left-3 top-2 flex items-center gap-2 rounded-lg border border-violet-200 bg-white/95 px-2.5 py-1 text-xs font-semibold text-violet-700 shadow-sm dark:border-violet-800 dark:bg-[#242433] dark:text-violet-300"
        style={{ pointerEvents: 'auto', cursor: 'grab' }} title="Drag to move all nodes in this frame">
        <Frame size={13} />
        <span>{props.data.title}</span>
        <span className="text-[10px] font-normal opacity-60">{props.data.count}</span>
        <button type="button" className="nodrag nopan ml-1 rounded p-0.5 hover:bg-violet-100 dark:hover:bg-violet-950/40"
          title="Ungroup frame" aria-label="Ungroup frame"
          onPointerDown={event => event.stopPropagation()}
          onClick={event => { event.stopPropagation(); props.data.onUngroup(props.data.frameId) }}>
          <Ungroup size={13} />
        </button>
      </div>
    </div>
  )
}

function handlesFor(node: WorkflowNode): Record<string, string> {
  const value = node.settings[connectionKey]
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {}
  }

  return Object.fromEntries(
    Object.entries(value).filter(([, handle]) => typeof handle === 'string'),
  ) as Record<string, string>
}

function edgeLabelsFor(node: WorkflowNode): Record<string, string> {
  const value = node.settings[edgeLabelKey]
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {}
  }

  return Object.fromEntries(
    Object.entries(value).filter(([, label]) => typeof label === 'string'),
  ) as Record<string, string>
}

function createsCycle(
  nodes: WorkflowNode[],
  sourceId: string,
  targetId: string,
): boolean {
  if (sourceId === targetId) return true

  const byId = new Map(nodes.map(node => [node.id, node]))
  const seen = new Set<string>()

  const visit = (id: string): boolean => {
    if (id === targetId) return true
    if (seen.has(id)) return false

    seen.add(id)
    return (byId.get(id)?.depends_on ?? []).some(visit)
  }

  return visit(sourceId)
}

function isWorkflowNode(value: unknown): value is WorkflowNode {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false
  }

  const node = value as Partial<WorkflowNode>
  return (
    typeof node.id === 'string' &&
    typeof node.type === 'string' &&
    Array.isArray(node.depends_on) &&
    !!node.settings &&
    typeof node.settings === 'object' &&
    !Array.isArray(node.settings)
  )
}

function isFlowClipboard(value: unknown): value is FlowClipboard {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false
  }

  const payload = value as Partial<FlowClipboard>
  return (
    payload.schema === 'cliptora.workflow.v1' &&
    typeof payload.name === 'string' &&
    Array.isArray(payload.nodes) &&
    payload.nodes.every(isWorkflowNode)
  )
}

function isNodeConfigClipboard(
  value: unknown,
): value is NodeConfigClipboard {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false
  }

  const payload = value as Partial<NodeConfigClipboard>
  return (
    payload.schema === 'cliptora.workflow.node-config.v1' &&
    typeof payload.nodeType === 'string' &&
    !!payload.settings &&
    typeof payload.settings === 'object' &&
    !Array.isArray(payload.settings) &&
    typeof payload.when === 'string'
  )
}

function AnimatedConnectionLine({
  fromX,
  fromY,
  toX,
  toY,
  fromPosition,
  toPosition,
  connectionStatus,
}: ConnectionLineComponentProps) {
  const [path] = getBezierPath({
    sourceX: fromX,
    sourceY: fromY,
    sourcePosition: fromPosition,
    targetX: toX,
    targetY: toY,
    targetPosition: toPosition,
    curvature: 0.34,
  })

  const color =
    connectionStatus === 'invalid'
      ? '#ef4444'
      : connectionStatus === 'valid'
        ? '#16a34a'
        : '#8b5cf6'

  return (
    <g pointerEvents="none" aria-hidden="true">
      <path
        d={path}
        fill="none"
        stroke={color}
        strokeWidth={11}
        strokeOpacity={0.12}
        strokeLinecap="round"
      />
      <path
        d={path}
        fill="none"
        stroke={color}
        strokeWidth={2.8}
        strokeLinecap="round"
        strokeDasharray="9 9"
      >
        <animate
          attributeName="stroke-dashoffset"
          values="0;-36"
          dur="0.7s"
          repeatCount="indefinite"
        />
      </path>

      <circle cx={toX} cy={toY} r={9} fill={color} fillOpacity={0.15}>
        <animate
          attributeName="r"
          values="6;13;6"
          dur="1.1s"
          repeatCount="indefinite"
        />
      </circle>

      <circle
        cx={toX}
        cy={toY}
        r={4.6}
        fill="#fff"
        stroke={color}
        strokeWidth={2.5}
      />

      <circle cx={fromX} cy={fromY} r={5.5} fill={color} fillOpacity={0.25}>
        <animate
          attributeName="r"
          values="5;9;5"
          dur="1.1s"
          repeatCount="indefinite"
        />
      </circle>

      <circle r={3.4} fill={color}>
        <animateMotion
          path={path}
          dur="1s"
          repeatCount="indefinite"
        />
      </circle>
    </g>
  )
}

function ActionEdge({
  id,
  sourceX,
  sourceY,
  sourcePosition,
  targetX,
  targetY,
  targetPosition,
  markerEnd,
  selected,
  style,
  data,
}: EdgeProps) {
  const actions = data as ActionEdgeData | undefined
  const [hovered, setHovered] = useState(false)
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (hoverTimer.current) clearTimeout(hoverTimer.current)
    }
  }, [])

  const show = () => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current)
    hoverTimer.current = null
    setHovered(true)
  }

  const hideSoon = () => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current)
    hoverTimer.current = setTimeout(() => setHovered(false), 180)
  }

  const [path, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
    curvature: 0.34,
  })

  const visible = hovered || Boolean(selected)
  const moving = actions?.moving === true
  const running = actions?.state === 'running'
  const stroke = typeof style?.stroke === 'string'
    ? style.stroke
    : '#74777f'

  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        markerEnd={markerEnd}
        style={{
          ...style,
          stroke,
          strokeWidth: 2.7,
          strokeLinecap: 'round',
        }}
        interactionWidth={0}
      />

      {(running || moving) && (
        <path
          d={path}
          fill="none"
          stroke="#ffffff"
          strokeWidth={1.5}
          strokeDasharray="6 13"
          pointerEvents="none"
        >
          <animate
            attributeName="stroke-dashoffset"
            from="0"
            to="-38"
            dur="0.8s"
            repeatCount="indefinite"
          />
        </path>
      )}

      <path
        d={path}
        fill="none"
        stroke="transparent"
        strokeWidth={27}
        style={{
          pointerEvents: 'stroke',
          cursor: 'pointer',
        }}
        onMouseEnter={show}
        onMouseLeave={hideSoon}
      />

      <EdgeLabelRenderer>
        {actions?.label && (
          <button
            type="button"
            title="Double-click to rename label"
            className="nodrag nopan pointer-events-auto absolute z-20 max-w-40 truncate rounded-full border border-[#dedee3] dark:border-[#374151] bg-white dark:bg-cl-dark-panel px-2.5 py-1 text-[11px] font-semibold text-[#666b73] dark:text-[#b8bec7] shadow-sm"
            style={{
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY - 37}px)`,
            }}
            onMouseEnter={show}
            onMouseLeave={hideSoon}
            onClick={event => event.stopPropagation()}
            onDoubleClick={event => {
              event.stopPropagation()
              actions.onRename?.()
            }}
          >
            {actions.label}
          </button>
        )}

        <div
          className={`nodrag nopan absolute z-30 flex items-center gap-2 transition-all duration-150 ${visible
            ? 'pointer-events-auto scale-100 opacity-100'
            : 'pointer-events-none scale-90 opacity-0'
            }`}
          style={{
            transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
          }}
          onPointerDown={event => event.stopPropagation()}
          onMouseEnter={show}
          onMouseLeave={hideSoon}
        >
          <button
            type="button"
            aria-label="Insert node into connection"
            title="Insert node"
            className="grid size-10 place-items-center rounded-full border border-[#e4e4e6] dark:border-[#374151] bg-white dark:bg-cl-dark-panel text-[#222] dark:text-[#f3f4f6] shadow-md hover:border-violet-400 hover:bg-violet-50 dark:hover:bg-violet-950/40 hover:text-violet-700 dark:hover:text-violet-300"
            onClick={event => {
              event.stopPropagation()
              actions?.onInsert?.(event)
            }}
          >
            <Plus size={23} strokeWidth={2.3} />
          </button>

          <button
            type="button"
            aria-label="Delete connection"
            title="Delete connection"
            className="grid size-10 place-items-center rounded-full border border-[#e4e4e6] dark:border-[#374151] bg-white dark:bg-cl-dark-panel text-[#222] dark:text-[#f3f4f6] shadow-md hover:border-red-300 dark:hover:border-red-900/70 hover:bg-red-50 dark:hover:bg-red-950/40 hover:text-red-600 dark:hover:text-red-300"
            onClick={event => {
              event.stopPropagation()
              actions?.onDelete?.()
            }}
          >
            <Trash2 size={20} />
          </button>
        </div>
      </EdgeLabelRenderer>
    </>
  )
}

/** Decorative branch/merge lines for execution ghosts. Never selectable or editable. */
function GhostConnectionEdge(props: EdgeProps) {
  const [path] = getBezierPath({
    sourceX: props.sourceX, sourceY: props.sourceY,
    sourcePosition: props.sourcePosition,
    targetX: props.targetX, targetY: props.targetY,
    targetPosition: props.targetPosition,
    curvature: 0.42,
  })
  return <BaseEdge id={props.id} path={path} style={{
    stroke: '#a78bfa', strokeWidth: 1.8, strokeDasharray: '7 6',
    strokeLinecap: 'round', opacity: .55, pointerEvents: 'none',
  }} />
}

const workflowEdgeTypes = {
  'cliptora-action': ActionEdge,
  'cliptora-ghost-connection': GhostConnectionEdge,
}

type WorkflowNodeToolbarActions = {
  working: boolean
  canInspect: boolean
  isDeactivated: (id: string) => boolean
  onDelete: (id: string) => void
  onToggleDeactivate: (id: string) => void
  onDuplicate: (id: string) => void
  onExecute: (id: string) => void
  onInspect: (id: string) => void
  onMore: (id: string, event: MouseEvent<HTMLButtonElement>) => void
}

const WorkflowNodeToolbarContext =
  createContext<WorkflowNodeToolbarActions | null>(null)

const actionButton =
  'nodrag nopan nowheel grid size-8 place-items-center rounded-md text-[#191919] dark:text-[#f3f4f6] transition-colors duration-150 hover:bg-white dark:hover:bg-cl-dark-panel/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet-500 disabled:cursor-not-allowed disabled:opacity-30'

function StudioNodeWithToolbar(props: NodeProps<StudioFlowNode>) {
  const actions = useContext(WorkflowNodeToolbarContext)
  const inactive = actions?.isDeactivated(props.id) ?? false
  const disabled = actions?.working ?? false
  const StudioCard = flowNodeTypes.studio

  return (
    <>
      <NodeToolbar
        isVisible={Boolean(props.selected) && Boolean(actions)}
        position={ToolbarPosition.Top}
        align="center"
        offset={18}
      >
        <div
          className="nodrag nopan nowheel flex items-center gap-1 rounded-lg bg-transparent"
          onPointerDown={event => event.stopPropagation()}
          onDoubleClick={event => event.stopPropagation()}
          aria-label="Selected node actions"
        >
          <button
            type="button"
            className={actionButton}
            title={inactive ? 'Reactivate node before executing' : 'Execute step'}
            aria-label="Execute step"
            disabled={disabled || inactive}
            onClick={event => {
              event.stopPropagation()
              actions?.onExecute(props.id)
            }}
          >
            <Play size={10} fill="currentColor" strokeWidth={2.1} />
          </button>

          <button
            type="button"
            className={`${actionButton} ${inactive ? 'text-amber-600 dark:text-amber-300' : ''}`}
            title={inactive ? 'Reactivate node (visual flag)' : 'Deactivate node (visual flag only)'}
            aria-label={inactive ? 'Reactivate node' : 'Deactivate node'}
            disabled={disabled}
            onClick={event => {
              event.stopPropagation()
              actions?.onToggleDeactivate(props.id)
            }}
          >
            {inactive
              ? <PowerOff size={10} strokeWidth={2.6} />
              : <Power size={10} strokeWidth={2.6} />}
          </button>

          <button
            type="button"
            className={`${actionButton} hover:text-rose-600 dark:hover:text-rose-300`}
            title="Delete node"
            aria-label="Delete node"
            disabled={disabled}
            onClick={event => {
              event.stopPropagation()
              actions?.onDelete(props.id)
            }}
          >
            <Trash2 size={10} strokeWidth={2.5} />
          </button>

          <button
            type="button"
            className={actionButton}
            title="Duplicate node"
            aria-label="Duplicate node"
            disabled={disabled || props.data.nodeType === 'core.video_source'}
            onClick={event => {
              event.stopPropagation()
              actions?.onDuplicate(props.id)
            }}
          >
            <Copy size={10} strokeWidth={2.4} />
          </button>

          <button
            type="button"
            className={actionButton}
            title="Open node editor"
            aria-label="Open node editor"
            disabled={!actions?.canInspect}
            onClick={event => {
              event.stopPropagation()
              actions?.onInspect(props.id)
            }}
          >
            <Sparkles size={10} strokeWidth={2.5} />
          </button>

          <button
            type="button"
            className={actionButton}
            title="More node actions"
            aria-label="More node actions"
            onClick={event => {
              event.stopPropagation()
              actions?.onMore(props.id, event)
            }}
          >
            <MoreHorizontal size={10} strokeWidth={2.6} />
          </button>
        </div>
      </NodeToolbar>
      <div
        className={`transition-opacity duration-150 ${inactive ? 'opacity-45 grayscale-[.65]' : ''
          }`}
      >
        <StudioCard {...props} />
      </div>
    </>
  )
}

const workflowNodeTypes = {
  studio: StudioNodeWithToolbar,
  'cliptora-frame': GroupFrame,
  'cliptora-ghost': GhostExecutionCard,
}

type WorkflowJsonView = 'definition' | 'snapshot'
type WorkflowInspectorSection = 'overview' | 'json'
type InspectorTab = 'node' | 'workflow'
type EditableWorkflowDefinition = { name: string; nodes: WorkflowNode[] }
type WorkflowJsonResult = {
  data: EditableWorkflowDefinition | null
  error: string
  source: 'definition' | 'snapshot' | 'nodes'
  warnings: string[]
}

const WORKFLOW_WHEN_VALUES = new Set<WorkflowNode['when']>([
  'always', 'has_video', 'has_transcript', 'ai_enabled', 'condition_true',
  'condition_false', 'route_0', 'route_1', 'route_2', 'route_3',
  'route_4', 'route_fallback',
])

/** Validate the editable save payload before updating live canvas state. */
function parseEditableWorkflowJson(
  raw: string,
  currentName: string,
  currentNodes: WorkflowNode[],
): WorkflowJsonResult {
  const fail = (error: string): WorkflowJsonResult => ({
    data: null, error, source: 'definition', warnings: [],
  })
  let decoded: unknown
  try { decoded = JSON.parse(raw) }
  catch (err) { return fail(`Invalid JSON: ${err instanceof Error ? err.message : String(err)}`) }

  const isObject = (v: unknown): v is Record<string, unknown> =>
    typeof v === 'object' && v !== null && !Array.isArray(v)
  const root = isObject(decoded) ? decoded : null
  const snapshot = root?.workflow
  const source: WorkflowJsonResult['source'] = Array.isArray(decoded)
    ? 'nodes' : isObject(snapshot) && Array.isArray(snapshot.nodes)
      ? 'snapshot' : 'definition'
  const payload = source === 'snapshot' ? snapshot as Record<string, unknown> : root
  const rawNodes = source === 'nodes' ? decoded : payload?.nodes
  if (!Array.isArray(rawNodes)) return fail('Expected { "name": "...", "nodes": [...] }, a Full Snapshot, or an array of nodes.')
  if (rawNodes.length > 100) return fail('This workflow exceeds the current 100-node limit.')
  const rawName = payload?.name
  if (rawName !== undefined && typeof rawName !== 'string') return fail('Workflow name must be a string.')
  const name = typeof rawName === 'string' ? rawName.trim() : currentName.trim()
  if (!name) return fail('Workflow name cannot be empty.')
  if (name.length > 160) return fail('Workflow name exceeds 160 characters.')

  const previousById = new Map(currentNodes.map(node => [node.id, node]))
  const nodeIds = new Set<string>()
  const nodes: WorkflowNode[] = []
  const warnings: string[] = []
  for (const [index, item] of rawNodes.entries()) {
    const n = index + 1
    if (!isObject(item)) return fail(`Node #${n} must be an object.`)
    if (typeof item.id !== 'string' || !item.id.trim()) return fail(`Node #${n} needs a nonempty string id.`)
    const id = item.id
    if (nodeIds.has(id)) return fail(`Duplicate node ID: ${id}`)
    nodeIds.add(id)
    if (typeof item.type !== 'string' || !item.type.trim()) return fail(`Node ${id}: type must be a nonempty string.`)
    if (!Array.isArray(item.depends_on) || !item.depends_on.every(dep => typeof dep === 'string')) {
      return fail(`Node ${id}: depends_on must be an array of node ID strings.`)
    }
    if (!isObject(item.settings)) return fail(`Node ${id}: settings must be a JSON object.`)
    if (item.when !== undefined &&
      (typeof item.when !== 'string' || !WORKFLOW_WHEN_VALUES.has(item.when as WorkflowNode['when']))) {
      return fail(`Node ${id}: invalid when value (${String(item.when)}).`)
    }
    if (item.retry_limit !== undefined && (!Number.isInteger(item.retry_limit) || (item.retry_limit as number) < 0)) {
      return fail(`Node ${id}: retry_limit must be a nonnegative integer.`)
    }
    if (item.cache !== undefined && typeof item.cache !== 'boolean') return fail(`Node ${id}: cache must be true or false.`)
    if (item.position !== undefined &&
      (!isObject(item.position) || typeof item.position.x !== 'number' ||
        !Number.isFinite(item.position.x) || typeof item.position.y !== 'number' || !Number.isFinite(item.position.y))) {
      return fail(`Node ${id}: position must have finite numeric x and y.`)
    }
    const previous = previousById.get(id)
    // Preserve previous locations/conditions when omitted; place new nodes separately.
    const position = isObject(item.position)
      ? item.position as WorkflowNode['position']
      : previous?.position ?? { x: 100 + index * 270, y: 100 }
    nodes.push({
      ...item,
      id,
      type: item.type,
      depends_on: [...item.depends_on] as string[],
      settings: item.settings,
      when: (item.when ?? previous?.when ?? 'always') as WorkflowNode['when'],
      position,
    } as WorkflowNode)
  }

  for (const node of nodes) {
    if (node.depends_on.includes(node.id)) return fail(`Node ${node.id} cannot depend on itself.`)
    for (const dep of node.depends_on) {
      if (!nodeIds.has(dep)) return fail(`Node ${node.id} references missing dependency: ${dep}`)
    }
    if (new Set(node.depends_on).size !== node.depends_on.length) {
      return fail(`Node ${node.id} contains duplicate dependency IDs.`)
    }
  }
  // Reject cycles, because React Flow may show them but the workflow executor cannot safely run them.
  const graph = new Map(nodes.map(node => [node.id, node.depends_on]))
  const visited = new Set<string>()
  const visiting = new Set<string>()
  const checkCycle = (id: string): boolean => {
    if (visiting.has(id)) return true
    if (visited.has(id)) return false
    visiting.add(id)
    for (const dep of graph.get(id) ?? []) {
      if (checkCycle(dep)) return true
    }
    visiting.delete(id)
    visited.add(id)
    return false
  }
  for (const node of nodes) if (checkCycle(node.id)) return fail(`Cyclic dependency detected near ${node.id}.`)

  if (source === 'snapshot') warnings.push('Full Snapshot detected: run history and derived edges will not be imported. Connections come from nodes.depends_on and settings.')
  if (source === 'nodes') warnings.push('Nodes array detected: keeping the current workflow name.')
  return { data: { name, nodes }, error: '', source, warnings }
}

function describeWorkflowDiff(previous: WorkflowNode[], next: WorkflowNode[]) {
  const old = new Map(previous.map(node => [node.id, node]))
  const newer = new Map(next.map(node => [node.id, node]))
  const added = next.filter(node => !old.has(node.id)).length
  const removed = previous.filter(node => !newer.has(node.id)).length
  const changed = next.filter(node => {
    const before = old.get(node.id)
    return before !== undefined && JSON.stringify(before) !== JSON.stringify(node)
  }).length
  return { added, removed, changed }
}

/** The JSON editor is kept mounted when switching Inspector tabs, preserving unsaved text. */
function WorkflowDetailsContent({
  studio,
  section,
  onSectionChange,
  onSelectNode,
  onApplyDefinition,
  onEditingChange,
}: {
  studio: WorkflowStudioState
  section: WorkflowInspectorSection
  onSectionChange: (next: WorkflowInspectorSection) => void
  onSelectNode: (id: string) => void
  onApplyDefinition: (definition: EditableWorkflowDefinition) => void
  onEditingChange: (editing: boolean) => void
}) {
  const [view, setView] = useState<WorkflowJsonView>('definition')
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [baseDefinition, setBaseDefinition] = useState('')
  const [query, setQuery] = useState('')
  const [feedback, setFeedback] = useState('')
  const [validation, setValidation] = useState<WorkflowJsonResult | null>(null)
  const [nodeSearch, setNodeSearch] = useState('')
  const [copied, setCopied] = useState(false)
  const editorRef = useRef<HTMLTextAreaElement>(null)
  const exportedAt = useRef(new Date().toISOString())
  const currentDefinition = studio.definitions.find(item => item.id === studio.activeId)
  const edgeCount = studio.nodes.reduce((count, node) => count + node.depends_on.length, 0)
  const agentCount = studio.nodes.filter(node => node.type === 'ai.agent').length
  const frameCount = new Set(studio.nodes.map(frameIdOf).filter(Boolean)).size

  const definitionText = useMemo(() => JSON.stringify({
    name: studio.name.trim(), nodes: studio.nodes,
  }, null, 2), [studio.name, studio.nodes])

  const snapshotText = useMemo(() => {
    if (section !== 'json' || view !== 'snapshot') return ''
    const byId = new Map(studio.nodes.map(node => [node.id, node]))
    const edges = studio.nodes.flatMap(target => {
      const typed = target.settings[typedConnectionKey]
      const agentHandles = typed && typeof typed === 'object' && !Array.isArray(typed)
        ? typed as Record<string, unknown> : {}
      const sourceHandles = handlesFor(target)
      const labels = edgeLabelsFor(target)
      return target.depends_on.map(sourceId => ({
        id: `${sourceId}:${target.id}`, source: sourceId, target: target.id,
        sourceHandle: byId.get(sourceId)?.type === 'flow.if'
          ? sourceHandles[sourceId] ?? 'true' : 'main',
        targetHandle: target.type === 'ai.agent' && typeof agentHandles[sourceId] === 'string'
          ? agentHandles[sourceId] : 'input',
        label: labels[sourceId] ?? null,
      }))
    })
    return JSON.stringify({
      schema: 'cliptora.workflow.snapshot.v1', exported_at: exportedAt.current,
      workflow: {
        id: studio.activeId, name: studio.name.trim(),
        version: currentDefinition?.version ?? null, nodes: studio.nodes, edges,
      },
      execution: { current_run: studio.run ?? null },
    }, null, 2)
  }, [section, view, studio.activeId, studio.name, studio.nodes, studio.run, currentDefinition?.version])

  const textValue = editing ? draft : view === 'definition' ? definitionText : snapshotText
  const isStale = editing && baseDefinition !== definitionText
  const matchCount = useMemo(() => {
    const search = query.trim().toLowerCase()
    if (!search) return 0
    let count = 0
    let at = 0
    const lower = textValue.toLowerCase()
    while ((at = lower.indexOf(search, at)) >= 0) { count++; at += search.length }
    return count
  }, [query, textValue])
  const visibleNodes = useMemo(() => {
    const needle = nodeSearch.trim().toLowerCase()
    return studio.nodes.filter(node => {
      const title = String(node.settings[labelKey] ??
        studio.catalog.find(item => item.type === node.type)?.label ?? node.type)
      return `${title} ${node.type} ${node.id}`.toLowerCase().includes(needle)
    })
  }, [studio.nodes, studio.catalog, nodeSearch])

  const startEditing = (source = definitionText) => {
    setDraft(source)
    setBaseDefinition(definitionText)
    setEditing(true)
    onEditingChange(true)
    setView('definition')
    setQuery('')
    setFeedback('')
    setValidation(null)
    setCopied(false)
  }
  const cancelEditing = () => {
    if (draft !== baseDefinition && !window.confirm('Discard your un-applied JSON changes?')) return
    setEditing(false)
    onEditingChange(false)
    setDraft('')
    setValidation(null)
    setFeedback('')
  }
  const pasteJson = async () => {
    try {
      const incoming = await navigator.clipboard.readText()
      if (!incoming.trim()) { setFeedback('Clipboard is empty.'); return }
      let formatted = incoming
      try { formatted = JSON.stringify(JSON.parse(incoming), null, 2) }
      catch { /* Keep malformed JSON for manual correction. */ }
      if (!editing) startEditing(formatted)
      else { setDraft(formatted); setValidation(null); setFeedback('Pasted. Validate before applying.'); setCopied(false) }
    } catch {
      setFeedback('Clipboard unavailable. Click Edit JSON then paste with Ctrl+V.')
    }
  }
  const copyJson = async () => {
    try {
      await navigator.clipboard.writeText(textValue)
      setCopied(true)
      setFeedback('Copied to clipboard.')
    } catch { setFeedback('Copy unavailable. Select the text and press Ctrl+C.') }
  }
  const downloadJson = () => {
    const filename = studio.name.trim().toLowerCase()
      .replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 70)
    const blob = new Blob([textValue], { type: 'application/json;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `${filename || 'workflow'}-${editing ? 'draft' : view}.json`
    document.body.appendChild(link)
    link.click()
    link.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  const formatDraft = () => {
    try {
      setDraft(JSON.stringify(JSON.parse(draft), null, 2))
      setValidation(null)
      setFeedback('JSON formatted with 2-space indentation.')
    } catch (err) {
      setValidation(null)
      setFeedback(`Cannot format invalid JSON: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
  const resetDraft = () => {
    if (draft !== definitionText && !window.confirm('Replace editor contents with the current workflow JSON?')) return
    setDraft(definitionText)
    setBaseDefinition(definitionText)
    setValidation(null)
    setFeedback('Reloaded current workflow JSON.')
  }
  const validateDraft = (): WorkflowJsonResult => {
    const result = parseEditableWorkflowJson(draft, studio.name, studio.nodes)
    setValidation(result)
    setFeedback(result.error || `Valid: ${result.data?.nodes.length ?? 0} nodes, ${result.data?.nodes.reduce((n, node) => n + node.depends_on.length, 0) ?? 0} connections.`)
    return result
  }
  const applyDraft = () => {
    if (studio.working) { setFeedback('A workflow operation is running. Retry when it finishes.'); return }
    if (isStale) { setFeedback('The live workflow changed while editing. Copy your draft, then cancel and reopen Edit JSON.'); return }
    const result = validateDraft()
    if (!result.data) return
    const diff = describeWorkflowDiff(studio.nodes, result.data.nodes)
    const renamed = result.data.name !== studio.name.trim()
    const changed = diff.added + diff.removed + diff.changed > 0 || renamed
    if (!changed) {
      setFeedback('No changes to apply.')
      return
    }
    if (!window.confirm(
      `Apply JSON to the current workflow?\n\n` +
      `Added: ${diff.added}  Removed: ${diff.removed}  Updated: ${diff.changed}` +
      `${renamed ? '\nWorkflow name will change.' : ''}\n\n` +
      `This updates the live canvas and may be automatically saved. You can undo node changes with Ctrl+Z.`,
    )) return
    onApplyDefinition(result.data)
    setEditing(false)
    onEditingChange(false)
    setDraft('')
    setValidation(null)
    setFeedback('JSON applied to canvas. The workflow autosave may persist these changes.')
  }
  const findNext = () => {
    const editor = editorRef.current
    const search = query.trim()
    if (!editor || !search) return
    const lower = textValue.toLowerCase()
    let index = lower.indexOf(search.toLowerCase(), editor.selectionEnd)
    if (index < 0) index = lower.indexOf(search.toLowerCase())
    if (index < 0) { setFeedback('No matches found.'); return }
    editor.focus()
    editor.setSelectionRange(index, index + search.length)
    const line = textValue.slice(0, index).split('\n').length - 1
    editor.scrollTop = Math.max(0, line * 19 - editor.clientHeight / 3)
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 gap-1 border-b border-[#ececf0] px-3 py-1.5 dark:border-[#374151]">
        {([
          ['overview', 'Overview', WorkflowIcon],
          ['json', 'JSON Editor', Braces],
        ] as const).map(([key, title, Icon]) => (
          <button key={key} type="button" onClick={() => onSectionChange(key)}
            aria-pressed={section === key}
            className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] font-semibold transition-colors ${section === key
              ? 'bg-violet-50 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300'
              : 'text-[#6b7280] hover:bg-[#f5f5f7] dark:text-[#b8bec7] dark:hover:bg-[#303744]'}`}>
            <Icon size={14}/>{title}{editing && key === 'json' && <span className="ml-1 size-1.5 rounded-full bg-amber-500"/>}
          </button>
        ))}
      </div>

      {section === 'overview' ? (
        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4 pt-3 [scrollbar-width:thin]">
          <div className="flex items-start gap-3 rounded-xl border border-[#e9e9ec] bg-[#fafafa] p-3 dark:border-[#374151] dark:bg-[#242832]">
            <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-violet-100 text-violet-700 dark:bg-violet-950/50 dark:text-violet-300"><WorkflowIcon size={20}/></span>
            <div className="min-w-0 flex-1">
              <p className="break-words text-[13px] font-semibold text-[#25252c] dark:text-white">{studio.name || 'Untitled workflow'}</p>
              <p className="mt-1 text-[11px] text-[#777e8d] dark:text-[#afb7c5]">ID: {studio.activeId ?? 'Unsaved'} · v{currentDefinition?.version ?? '—'}</p>
            </div>
          </div>
          <div className="mt-3 grid grid-cols-4 gap-1.5">
            {([
              ['Nodes', studio.nodes.length], ['Edges', edgeCount],
              ['Agents', agentCount], ['Frames', frameCount],
            ] as const).map(([label, value]) => (
              <div key={label} className="rounded-lg border border-[#ececf0] bg-white px-2 py-2 dark:border-[#374151] dark:bg-[#242832]">
                <p className="text-[15px] font-semibold tabular-nums text-[#282833] dark:text-white">{value}</p>
                <p className="text-[10px] text-[#818492] dark:text-[#b8bec7]">{label}</p>
              </div>
            ))}
          </div>
          <div className="mt-3 flex items-center justify-between rounded-lg border border-[#e9e9ee] px-3 py-2 dark:border-[#374151]">
            <span className="text-[11px] font-semibold text-[#33343b] dark:text-white">Execution</span>
            <span className="rounded-md bg-[#f4f4f6] px-2 py-1 text-[10px] text-[#666a76] dark:bg-[#303744] dark:text-[#c9cfda]">{studio.run?.state ?? 'No active run'}</span>
          </div>
          <div className="mt-3 flex items-center justify-between gap-2">
            <h3 className="text-[12px] font-semibold text-[#30313a] dark:text-white">Workflow nodes</h3>
            <span className="text-[10px] tabular-nums text-[#8b8e99]">{visibleNodes.length}/{studio.nodes.length}</span>
          </div>
          <label className="mt-2 flex items-center gap-2 rounded-lg border border-[#e7e7ec] bg-[#fafafa] px-2.5 py-1.5 text-[#828696] dark:border-[#374151] dark:bg-[#222b37]">
            <Search size={14}/>
            <input type="search" value={nodeSearch} onChange={event => setNodeSearch(event.target.value)} placeholder="Find node by name, type, ID..."
              className="min-w-0 flex-1 bg-transparent text-[11px] text-[#33333b] outline-none dark:text-white"/>
          </label>
          <div className="mt-2 overflow-hidden rounded-lg border border-[#e9e9ed] dark:border-[#374151]">
            {visibleNodes.length ? visibleNodes.map((node, index) => {
              const title = String(node.settings[labelKey] ??
                studio.catalog.find(item => item.type === node.type)?.label ?? node.type)
              const status = studio.flowNodes.find(item => item.id === node.id)?.data.status
              return (
                <button key={node.id} type="button" onClick={() => onSelectNode(node.id)}
                  className="flex w-full items-center gap-2 border-b border-[#eeeeef] px-2.5 py-2 text-left last:border-0 hover:bg-violet-50/70 dark:border-[#374151] dark:hover:bg-[#333143]">
                  <span className="w-4 shrink-0 text-[10px] tabular-nums text-[#9194a0]">{index + 1}</span>
                  <WorkflowToolIcon type={node.type} size={18}/>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[11px] font-semibold text-[#3a3b43] dark:text-white">{title}</span>
                    <span className="block truncate text-[10px] text-[#969aa5] dark:text-[#b8bec7]">{node.type}</span>
                  </span>
                  <span className="text-[10px] text-[#8b8e99]">{status ?? ''}</span>
                  <ChevronRight size={13} className="shrink-0 text-[#a0a4ac]"/>
                </button>
              )
            }) : <p className="p-4 text-center text-[11px] text-[#9296a3]">No matching nodes.</p>}
          </div>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-2 p-2.5">
          <div className="flex shrink-0 items-center justify-between gap-1.5">
            <div className="inline-flex min-w-0 shrink-0 rounded-lg bg-[#f4f4f6] p-0.5 dark:bg-[#252a35]">
              {([
                ['definition', 'Definition'], ['snapshot', 'Snapshot'],
              ] as const).map(([key, label]) => (
                <button key={key} type="button" disabled={editing && key !== 'definition'} aria-pressed={view === key}
                  onClick={() => { setView(key); setFeedback(''); setCopied(false); setQuery('') }}
                  className={`rounded-md px-2 py-1 text-[10px] font-semibold disabled:opacity-35 ${view === key
                    ? 'bg-white text-violet-700 shadow-sm dark:bg-[#424153] dark:text-violet-300'
                    : 'text-[#7e8290] dark:text-[#b8bec7]'}`}>{label}</button>
              ))}
            </div>
            <span className="min-w-0 shrink-0 truncate text-[10px] tabular-nums text-[#9a9da6]">{(textValue.length / 1024).toFixed(1)} KB</span>
            <button type="button" disabled={studio.working || editing} onClick={() => startEditing()}
              title="Edit the workflow definition JSON"
              className="ml-auto inline-flex shrink-0 items-center gap-1 rounded-lg bg-violet-50 px-2 py-1.5 text-[11px] font-semibold text-violet-700 hover:bg-violet-100 disabled:opacity-40 dark:bg-violet-950/50 dark:text-violet-300">
              <Pencil size={13}/> {editing ? 'Editing' : 'Edit JSON'}
            </button>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <button type="button" onClick={() => { void copyJson() }}
              className="inline-flex min-w-0 flex-1 items-center justify-center gap-1 rounded-lg border border-[#e3e4ea] px-1.5 py-1.5 text-[11px] font-medium text-[#424552] hover:bg-[#f7f7fa] dark:border-[#374151] dark:text-white dark:hover:bg-[#303744]">
              {copied ? <Check size={13}/> : <Copy size={13}/>} Copy
            </button>
            <button type="button" onClick={() => { void pasteJson() }}
              className="inline-flex min-w-0 flex-1 items-center justify-center gap-1 rounded-lg border border-[#e3e4ea] px-1.5 py-1.5 text-[11px] font-medium text-[#424552] hover:bg-[#f7f7fa] dark:border-[#374151] dark:text-white dark:hover:bg-[#303744]">
              <ClipboardPaste size={13}/> Paste
            </button>
            <button type="button" onClick={downloadJson}
              className="inline-flex min-w-0 flex-1 items-center justify-center gap-1 rounded-lg border border-[#e3e4ea] px-1.5 py-1.5 text-[11px] font-medium text-[#424552] hover:bg-[#f7f7fa] dark:border-[#374151] dark:text-white dark:hover:bg-[#303744]">
              <Download size={13}/> Export
            </button>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <label className="flex min-w-0 flex-1 items-center gap-2 rounded-lg border border-[#e3e4ea] bg-[#fbfbfd] px-2.5 py-1.5 text-[#828696] dark:border-[#374151] dark:bg-[#242832]">
              <Search size={13}/>
              <input type="search" value={query} onChange={event => setQuery(event.target.value)}
                onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); findNext() } }}
                placeholder="Find in JSON..." className="min-w-0 flex-1 bg-transparent text-[11px] text-[#343844] outline-none dark:text-white"/>
            </label>
            {query.trim() && <span className="shrink-0 text-[10px] text-[#8b8e99]">{matchCount}</span>}
            <button type="button" disabled={!query.trim() || !matchCount} onClick={findNext} title="Find next match"
              className="grid size-7 shrink-0 place-items-center rounded-lg border border-[#e3e4ea] text-[#525a68] hover:bg-[#f6f6fa] disabled:opacity-30 dark:border-[#374151] dark:text-white">
              <ChevronRight size={15}/>
            </button>
          </div>
          {editing && isStale && <p role="alert" className="rounded-md bg-amber-50 px-2 py-1.5 text-[10px] text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
            Live workflow changed while editing. Copy your draft before restarting; Apply is disabled to prevent overwriting it.
          </p>}
          <div className="relative min-h-0 flex-1 overflow-hidden rounded-lg border border-[#e5e7eb] bg-[#fafbfc] dark:border-[#374151] dark:bg-[#161d29]">
            <textarea ref={editorRef} readOnly={!editing} spellCheck={false} value={textValue}
              onChange={event => { if (editing) { setDraft(event.target.value); setValidation(null); setFeedback(''); setCopied(false) } }}
              aria-label={editing ? 'Edit complete workflow definition JSON' : 'Complete workflow JSON'}
              className={`block h-full min-h-0 w-full resize-none overflow-auto bg-transparent p-3 font-mono text-[11px] leading-[19px] text-[#303949] outline-none [scrollbar-width:thin] dark:text-[#dbe0eb] ${editing ? 'focus:ring-1 focus:ring-inset focus:ring-violet-400' : 'cursor-text'}`}/>
          </div>
          {editing && <div className="flex shrink-0 items-center justify-between gap-1.5">
            <div className="flex items-center gap-1">
              <button type="button" onClick={formatDraft}
                title="Format and indent pasted JSON" className="rounded-md px-1.5 py-1.5 text-[10px] text-[#7a7e8a] hover:bg-[#f5f5f7] dark:text-[#b8bec7]">Format</button>
              <button type="button" onClick={resetDraft}
                title="Reload current workflow data" className="rounded-md px-1.5 py-1.5 text-[10px] text-[#7a7e8a] hover:bg-[#f5f5f7] dark:text-[#b8bec7]">Reset</button>
            </div>
            <div className="ml-auto flex items-center gap-1.5">
              <button type="button" onClick={cancelEditing} className="rounded-lg border border-[#e0e1e6] px-2.5 py-1.5 text-[11px] font-semibold text-[#535966] dark:border-[#374151] dark:text-white">Cancel</button>
              <button type="button" onClick={validateDraft} className="rounded-lg border border-violet-200 px-2.5 py-1.5 text-[11px] font-semibold text-violet-700 hover:bg-violet-50 dark:border-violet-800 dark:text-violet-300">Validate</button>
              <button type="button" disabled={isStale || studio.working} onClick={applyDraft}
                className="rounded-lg bg-violet-600 px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-violet-700 disabled:opacity-40">Apply JSON</button>
            </div>
          </div>}
          {(feedback || validation?.warnings.length) ? <p role="status" className={`shrink-0 whitespace-pre-wrap break-words rounded-md px-2 py-1.5 text-[10px] leading-4 ${validation?.error
            ? 'bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300'
            : 'bg-violet-50 text-[#5f5771] dark:bg-[#252535] dark:text-[#d3cbe5]'}`}>
            {feedback}{validation?.warnings.length ? `\n${validation.warnings.join('\n')}` : ''}
          </p> : <p className="shrink-0 px-1 text-[10px] leading-4 text-[#8a8e99] dark:text-[#b8bec7]">
            {editing ? 'Paste JSON from ChatGPT. Validate before Apply. Live canvas is unchanged until Apply.'
              : view === 'definition' ? 'Editable save payload: name + nodes. Credentials may be present.'
                : 'Snapshot includes connections and current run; derived fields are read-only.'}
          </p>}
        </div>
      )}
    </div>
  )
}

export function WorkflowCanvas({
  studio,
  onOpenNode,
}: {
  studio: WorkflowStudioState
  onOpenNode?: (id: string) => void
}) {
  const {
    flow,
    name,
    setNodes,
    selectedId,
    setSelectedId,
    setMessage,
    working,
    nodes,
    catalog,
    addNode,
    definitions,
    openDefinition,
    flowNodes,
    flowEdges,
    setJsonEditor,
    removeNode,
    showToolLibrary,
    libraryOpen,
    setLibraryOpen,
    testStep,
    openTemplate,
    setCanvasDragging,
    undo,
    redo,
  } = studio

  const [bottomOpen, setBottomOpen] = useState(false)
  const [ghostPreferences, setGhostPreferences] = useState<Record<string, GhostPreferences>>({})
  const [ghostSizes, setGhostSizes] = useState<Record<string, GhostSize>>({})
  const [ghostSelection, setGhostSelection] = useState<GhostSelection | null>(null)
  const [commandOpen, setCommandOpen] = useState(false)
  const [commandQuery, setCommandQuery] = useState('')
  const [commandTab, setCommandTab] = useState<CanvasSearchTab>('all')
  const [commandIndex, setCommandIndex] = useState(0)
  const [sidePanelOpen, setSidePanelOpen] = useState(false)
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>('node')
  const [inspectorExpanded, setInspectorExpanded] = useState(false)
  const [inspectorEditing, setInspectorEditing] = useState(false)
  const [workflowSection, setWorkflowSection] = useState<WorkflowInspectorSection>('overview')
  const [fullNodeJsonOpen, setFullNodeJsonOpen] = useState(false)
  const [sideSettingsDraft, setSideSettingsDraft] = useState('')
  const [sideSettingsError, setSideSettingsError] = useState('')
  const noteScope = `cliptora.workflow.sticky-notes:${studio.activeId || `draft:${name}`}`
  const [contextMenu, setContextMenu] = useState<ContextState | null>(null)
  const [renameDraft, setRenameDraft] = useState<{
    id: string
    value: string
  } | null>(null)
  const [edgeRenameDraft, setEdgeRenameDraft] = useState<{
    sourceId: string
    targetId: string
    value: string
  } | null>(null)
  // Keep React Flow's viewport uncontrolled: panning must not rerender all nodes.
  const [zoom, setZoom] = useState(START_VIEWPORT.zoom)
  const zoomSliderRef = useRef<HTMLInputElement>(null)
  const zoomLabelRef = useRef<HTMLSpanElement>(null)
  const zoomSliderInteractingRef = useRef(false)

  // During a slider gesture, update React Flow directly and commit to React state only once.
  const commitZoomSlider = () => {
    if (!zoomSliderInteractingRef.current) return
    zoomSliderInteractingRef.current = false
    const current = flow.current?.getZoom() ?? START_VIEWPORT.zoom
    setZoom(previous => Math.abs(previous - current) < 0.0001 ? previous : current)
  }

  const updateZoomSlider = (value: number) => {
    const percentage = Math.round(Math.min(1.25, Math.max(0.25, value)) * 100)
    if (zoomSliderRef.current) zoomSliderRef.current.value = String(percentage)
    if (zoomLabelRef.current) zoomLabelRef.current.textContent = `${percentage}%`
  }
  const [interactionMode, setInteractionMode] = useState<CanvasInteractionMode>('mouse')
  const [connectSourceId, setConnectSourceId] = useState<string | null>(null)
  const [alignOpen, setAlignOpen] = useState(false)
  const [snapToGridEnabled, setSnapToGridEnabled] = useState(() => {
    try { return window.localStorage.getItem('cliptora.workflow.snapToGrid') === 'true' }
    catch { return false }
  })
  const [quickAdd, setQuickAdd] = useState<QuickAddPosition | null>(null)
  const [quickSearch, setQuickSearch] = useState('')
  const [selectedEdges, setSelectedEdges] = useState<string[]>([])
  const [selectedNodeIds, setSelectedNodeIds] = useState<string[]>([])
  const [draggingNodeId, setDraggingNodeId] = useState<string | null>(null)

  const clipboardRef = useRef<WorkflowNode[]>([])
  const configClipboardRef = useRef<NodeConfigClipboard | null>(null)
  const flowClipboardRef = useRef<FlowClipboard | null>(null)
  const canvasRef = useRef<HTMLDivElement>(null)
  const draggedAt = useRef(0)
  const nodeDragActive = useRef(false)
  const stickyNotesRef = useRef<CanvasStickyNotesHandle>(null)
  const canReadClipboard = Boolean(navigator.clipboard?.readText)

  const closeContextMenu = useCallback(
    () => setContextMenu(null),
    [],
  )

  const addStickyNote = useCallback(() => {
    const rect = canvasRef.current?.getBoundingClientRect()
    const center = rect ? flow.current?.screenToFlowPosition({
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
    }) : undefined

    stickyNotesRef.current?.addNote({
      x: (center?.x ?? 180) - 160,
      y: (center?.y ?? 140) - 100,
    })
    setCommandOpen(false)
  }, [flow])

  const selectedSideNode = nodes.find(node => node.id === selectedId) ?? null
  const selectedSideMeta = selectedSideNode
    ? catalog.find(item => item.type === selectedSideNode.type)
    : undefined
  const selectedSideStatus = selectedSideNode
    ? flowNodes.find(node => node.id === selectedSideNode.id)?.data.status
    : undefined

  useEffect(() => {
    setSideSettingsDraft(selectedSideNode
      ? JSON.stringify(selectedSideNode.settings, null, 2)
      : '')
    setSideSettingsError('')
  }, [selectedId, sidePanelOpen])

  const saveSideSettings = () => {
    if (!selectedSideNode || working) return
    try {
      const settings: unknown = JSON.parse(sideSettingsDraft)
      if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
        setSideSettingsError('Settings must be a JSON object.')
        return
      }
      setNodes(previous => previous.map(node =>
        node.id === selectedSideNode.id
          ? { ...node, settings: settings as Record<string, unknown> }
          : node,
      ))
      setJsonEditor(JSON.stringify(settings, null, 2))
      setSideSettingsError('')
      setMessage('Node settings updated. Save workflow to persist changes.')
    } catch {
      setSideSettingsError('Invalid JSON. Please correct the syntax.')
    }
  }

  const searchEntries = useMemo<CanvasSearchEntry[]>(() => {
    const entries: CanvasSearchEntry[] = []
    for (const item of catalog) {
      if (item.status !== 'implemented' || !item.backend_executor) continue
      entries.push({
        key: `node:${item.type}`,
        kind: 'node',
        label: item.label,
        detail: item.group,
        nodeType: item.type,
      })
      for (const action of item.actions ?? []) {
        if (!action) continue
        entries.push({
          key: `action:${item.type}:${action}`,
          kind: 'action',
          label: item.action_capabilities?.[typeof action === 'string' ? action : action.id]?.label || (typeof action === 'string' ? action.replace(/_/g, ' ') : action.label),
          detail: item.label,
          nodeType: item.type,
          actionId: typeof action === 'string' ? action : action.id,
        })
      }
    }
    for (const definition of definitions) {
      entries.push({
        key: `workflow:${definition.id}`,
        kind: 'workflow',
        label: definition.name,
        detail: `${definition.nodes.length} nodes`,
        workflowId: definition.id,
      })
    }

    const query = commandQuery.trim().toLowerCase()
    return entries.filter(entry =>
      (commandTab === 'all' ||
        (commandTab === 'nodes' && entry.kind === 'node') ||
        (commandTab === 'workflows' && entry.kind === 'workflow') ||
        (commandTab === 'actions' && entry.kind === 'action')) &&
      (!query || `${entry.label} ${entry.detail} ${entry.nodeType ?? ''}`
        .toLowerCase().includes(query)),
    ).slice(0, 60)
  }, [catalog, definitions, commandQuery, commandTab])

  const selectSearchEntry = (entry: CanvasSearchEntry) => {
    if (entry.kind === 'workflow') {
      const definition = definitions.find(item => item.id === entry.workflowId)
      if (!definition || working) return
      openDefinition(definition)
    } else {
      if (!entry.nodeType || working || nodes.length >= 100) return
      const existingIds = new Set(nodes.map(node => node.id))
      addNode(entry.nodeType)
      if (entry.actionId) {
        const template = catalog.find(item => item.type === entry.nodeType)
        const field = template && Object.prototype.hasOwnProperty.call(template.settings, 'action')
          ? 'action'
          : 'operation'
        setNodes(previous => previous.map(node =>
          node.type === entry.nodeType && !existingIds.has(node.id)
            ? { ...node, settings: { ...node.settings, [field]: entry.actionId } }
            : node,
        ))
      }
    }
    setCommandOpen(false)
    setCommandQuery('')
  }

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      const editing = Boolean(target?.closest('input, textarea, select, [contenteditable="true"]'))
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setCommandOpen(true)
        setCommandQuery('')
        setCommandTab('all')
        setCommandIndex(0)
      } else if (!editing && event.shiftKey && !event.ctrlKey && !event.metaKey &&
        event.key.toLowerCase() === 's' && !commandOpen) {
        event.preventDefault()
        addStickyNote()
      } else if (event.key === 'Escape' && commandOpen) {
        setCommandOpen(false)
      }
    }
    window.addEventListener('keydown', handleShortcut, true)
    return () => window.removeEventListener('keydown', handleShortcut, true)
  }, [commandOpen, addStickyNote])

  const openContextMenu = useCallback((
    kind: ContextState['kind'],
    id: string | undefined,
    clientX: number,
    clientY: number,
  ) => {
    const rect = canvasRef.current?.getBoundingClientRect()
    if (!rect) return

    setQuickAdd(null)
    setContextMenu({
      kind,
      id,
      clientX,
      clientY,
      flowPosition: flow.current?.screenToFlowPosition({
        x: clientX,
        y: clientY,
      }),
    })
  }, [flow])

  const deleteNodes = useCallback((ids: string[]) => {
    const removed = new Set(ids)
    if (!removed.size) return

    setNodes(previous =>
      previous
        .filter(node => !removed.has(node.id))
        .map(node => {
          const deps = node.depends_on.filter(id => !removed.has(id))
          const handles = Object.fromEntries(
            Object.entries(handlesFor(node)).filter(([id]) => !removed.has(id)),
          )
          const labels = Object.fromEntries(
            Object.entries(edgeLabelsFor(node)).filter(([id]) => !removed.has(id)),
          )
          const rawTyped = node.settings[typedConnectionKey]
          const typed = rawTyped && typeof rawTyped === 'object' && !Array.isArray(rawTyped)
            ? Object.fromEntries(Object.entries(rawTyped).filter(([id]) => !removed.has(id))) : {}

          return {
            ...node,
            depends_on: deps,
            settings: {
              ...node.settings,
              [connectionKey]: handles,
              [edgeLabelKey]: labels,
              [typedConnectionKey]: typed,
            },
          }
        }),
    )

    setSelectedId(null)
    setSelectedNodeIds([])
    setSelectedEdges([])
    setMessage(`${removed.size} node(s) deleted.`)
  }, [setNodes, setSelectedId, setMessage])

  const copySelection = useCallback((ids: string[]) => {
    const chosen = nodes.filter(node => ids.includes(node.id))
    if (!chosen.length) return

    clipboardRef.current = clone(chosen)

    if (navigator.clipboard?.writeText) {
      void navigator.clipboard.writeText(
        JSON.stringify({
          schema: 'cliptora.workflow.nodes.v1',
          nodes: chosen,
        }, null, 2),
      ).catch(() => { })
    }

    setMessage(`${chosen.length} node(s) copied.`)
  }, [nodes, setMessage])

  const copyNodeConfig = useCallback((node: WorkflowNode) => {
    const settings = structuredClone(node.settings)
    delete settings[connectionKey]
    delete settings[edgeLabelKey]
    delete settings[pinKey]
    delete settings[labelKey]

    const payload: NodeConfigClipboard = {
      schema: 'cliptora.workflow.node-config.v1',
      nodeType: node.type,
      settings,
      when: node.when,
      retryLimit: node.retry_limit,
      cache: node.cache,
    }

    configClipboardRef.current = payload

    if (navigator.clipboard?.writeText) {
      void navigator.clipboard.writeText(
        JSON.stringify(payload, null, 2),
      ).catch(() => { })
    }

    setMessage('Node settings copied.')
  }, [setMessage])

  const pasteNodeConfig = useCallback(async (node: WorkflowNode) => {
    let value: unknown = configClipboardRef.current

    if (navigator.clipboard?.readText) {
      try {
        value = JSON.parse(await navigator.clipboard.readText())
      } catch {
        // Use in-app clipboard.
      }
    }

    if (!isNodeConfigClipboard(value)) {
      setMessage('Clipboard does not contain CLIPTORA node settings.')
      return
    }

    if (value.nodeType !== node.type) {
      setMessage(`Cannot paste ${value.nodeType} settings into ${node.type}.`)
      return
    }

    setNodes(previous =>
      previous.map(item => {
        if (item.id !== node.id) return item

        const internalSettings = Object.fromEntries(
          Object.entries(item.settings).filter(([key]) =>
            [connectionKey, edgeLabelKey, pinKey, labelKey].includes(key),
          ),
        )

        return {
          ...item,
          when: value.when,
          retry_limit: value.retryLimit,
          cache: value.cache,
          settings: {
            ...structuredClone(value.settings),
            ...internalSettings,
          },
        }
      }),
    )

    setMessage('Node settings pasted.')
  }, [setNodes, setMessage])

  const copyWorkflow = useCallback(() => {
    if (!nodes.length) return

    const payload: FlowClipboard = {
      schema: 'cliptora.workflow.v1',
      name,
      nodes: clone(nodes),
    }

    flowClipboardRef.current = payload

    if (navigator.clipboard?.writeText) {
      void navigator.clipboard.writeText(
        JSON.stringify(payload, null, 2),
      ).catch(() => { })
    }

    setMessage('Workflow copied.')
  }, [name, nodes, setMessage])

  const pasteWorkflow = useCallback(async () => {
    let value: unknown = flowClipboardRef.current

    if (navigator.clipboard?.readText) {
      try {
        value = JSON.parse(await navigator.clipboard.readText())
      } catch {
        // Use in-app clipboard.
      }
    }

    if (!isFlowClipboard(value)) {
      setMessage('Clipboard does not contain a CLIPTORA workflow.')
      return
    }

    if (value.nodes.length > 100) {
      setMessage('Workflow exceeds 100 nodes.')
      return
    }

    if (
      nodes.length &&
      !window.confirm('Replace current canvas with the copied workflow?')
    ) return

    const pasted = clone(value.nodes)

    openTemplate({
      key: 'clipboard-workflow',
      name: `${value.name} copy`.slice(0, 160),
      description: 'Pasted workflow',
      nodes: pasted,
    })

    setSelectedNodeIds(pasted[0] ? [pasted[0].id] : [])
    setSelectedId(pasted[0]?.id ?? null)
    setMessage('Workflow pasted as a new unsaved copy.')
  }, [nodes.length, openTemplate, setSelectedId, setMessage])

  const pasteSelection = useCallback((position?: Position) => {
    const originals = clipboardRef.current.filter(
      node => node.type !== 'core.video_source',
    )
    if (!originals.length || nodes.length + originals.length > 100) return

    const usedIds = nodes.map(node => node.id)
    const ids = new Map<string, string>()
    const existing = new Set(usedIds)

    originals.forEach(node => {
      const id = uid(node.type, usedIds)
      usedIds.push(id)
      ids.set(node.id, id)
    })

    const xMin = Math.min(...originals.map(node => node.position?.x ?? 0))
    const yMin = Math.min(...originals.map(node => node.position?.y ?? 0))

    const copies = originals.map(node => {
      const settings = structuredClone(node.settings)
      delete settings[pinKey]

      const handles = handlesFor(node)
      settings[connectionKey] = Object.fromEntries(
        Object.entries(handles).map(([id, handle]) => [
          ids.get(id) ?? id,
          handle,
        ]),
      )
      const oldTyped = settings[typedConnectionKey]
      if (oldTyped && typeof oldTyped === 'object' && !Array.isArray(oldTyped)) {
        settings[typedConnectionKey] = Object.fromEntries(
          Object.entries(oldTyped).filter(([id]) => ids.has(id) || existing.has(id))
            .map(([id, port]) => [ids.get(id) ?? id, port]),
        )
      }

      return {
        ...structuredClone(node),
        id: ids.get(node.id)!,
        settings,
        depends_on: node.depends_on
          .filter(id => ids.has(id) || existing.has(id))
          .map(id => ids.get(id) ?? id),
        position: {
          x: (position?.x ?? xMin + 45) + (node.position?.x ?? 0) - xMin,
          y: (position?.y ?? yMin + 45) + (node.position?.y ?? 0) - yMin,
        },
      }
    })

    setNodes(previous => [...previous, ...copies])
    setSelectedNodeIds(copies.map(node => node.id))
    setSelectedId(copies[0].id)
    setMessage(`${copies.length} nodes pasted.`)
  }, [nodes, setNodes, setSelectedId, setMessage])

  const tidyWorkflow = useCallback(() => {
    if (!nodes.length) return

    setNodes(previous => tidyWorkflowNodes(previous))

    setMessage(
      'Workflow arranged: AI Agent children are directly below their agent.'
    )

    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        void flow.current?.fitView({
          // Only saved workflow nodes; the ghost branches can be very tall.
          nodes: nodes.map(node => ({ id: node.id })),
          padding: 0.16,
          duration: 450,
          maxZoom: 1,
        })
      })
    })
  }, [nodes.length, setNodes, setMessage, flow])

  const renameNode = useCallback((event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!renameDraft) return

    const value = renameDraft.value.trim().slice(0, 100)
    if (!value) return

    setNodes(previous =>
      previous.map(node =>
        node.id === renameDraft.id
          ? {
            ...node,
            settings: { ...node.settings, [labelKey]: value },
          }
          : node,
      ),
    )
    setRenameDraft(null)
    setMessage('Node renamed.')
  }, [renameDraft, setNodes, setMessage])

  useEffect(() => {
    setSelectedNodeIds(previous => {
      if (!selectedId) return []
      return previous.includes(selectedId) ? previous : [selectedId]
    })
  }, [selectedId])

  const ungroupFrame = useCallback((frameId: string) => {
    setNodes(previous => previous.map(node => {
      if (frameIdOf(node) !== frameId) return node
      const settings = { ...node.settings }
      delete settings[FRAME_KEY]
      return { ...node, settings }
    }))
    setMessage('Frame ungrouped. Node connections are unchanged.')
  }, [setNodes, setMessage])

  const createFrame = useCallback((ids: string[]) => {
    const targets = nodes.filter(node => ids.includes(node.id) && node.settings[pinKey] !== true)
    if (!targets.length) {
      setMessage('Select at least one unpinned node to create a frame.')
      return
    }
    const frameId = `frame-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
    const memberIds = new Set(targets.map(node => node.id))
    setNodes(previous => previous.map(node => memberIds.has(node.id)
      ? { ...node, settings: { ...node.settings, [FRAME_KEY]: frameId } }
      : node))
    setSelectedNodeIds(targets.map(node => node.id))
    setSelectedId(targets[0].id)
    setInteractionMode('mouse')
    setMessage(`Frame created around ${targets.length} node(s). Drag its header to move the group.`)
  }, [nodes, setNodes, setSelectedId, setMessage])

  const frameRects = useMemo(() => {
    const members = new Map<string, WorkflowNode[]>()
    for (const node of nodes) {
      const id = frameIdOf(node)
      if (!id) continue
      members.set(id, [...(members.get(id) ?? []), node])
    }
    const result = new Map<string, FrameBounds>()
    for (const [id, items] of members) {
      const x = Math.min(...items.map(node => node.position?.x ?? 80)) - FRAME_PAD_X
      const y = Math.min(...items.map(node => node.position?.y ?? 80)) - FRAME_PAD_TOP
      const right = Math.max(...items.map(node => (node.position?.x ?? 80) + NODE_FALLBACK_WIDTH)) + FRAME_PAD_X
      const bottom = Math.max(...items.map(node => (node.position?.y ?? 80) + NODE_FALLBACK_HEIGHT)) + FRAME_PAD_BOTTOM
      result.set(id, { x, y, width: right - x, height: bottom - y, ids: items.map(node => node.id) })
    }
    return result
  }, [nodes])

  const ghostActions = useMemo(() => ({
    toggle: (originId: string) => setGhostPreferences(current => ({
      ...current, [originId]: { ...current[originId], collapsed: !current[originId]?.collapsed },
    })),
    filter: (originId: string, filter: GhostFilter) => setGhostPreferences(current => ({
      ...current, [originId]: { ...current[originId], filter, page: 0 },
    })),
    page: (originId: string, page: number) => setGhostPreferences(current => ({
      ...current, [originId]: { ...current[originId], page: Math.max(0, page) },
    })),
    collection: (originId: string, collection: string) => {
      setGhostSelection(null)
      setGhostPreferences(current => ({
        ...current, [originId]: { ...current[originId], collection, filter: 'all', page: 0 },
      }))
    },
  }), [])

  const ghostNodes = useMemo(() => studio.liveLoopView
    ? buildGhostNodes(nodes, studio.run?.results, node => {
        const custom = node.settings.__cliptora_ui_label
        return typeof custom === 'string' && custom.trim()
          ? custom.trim()
          : catalog.find(item => item.type === node.type)?.label ?? node.type
      }, ghostPreferences, ghostActions, ghostSizes)
    : [], [studio.liveLoopView, studio.run?.results, nodes, catalog, ghostPreferences, ghostActions, ghostSizes])

  // Select from the current live snapshot, so the details follow progress polling.
  const currentGhostSelection = ghostSelection
    ? (() => {
        const current = ghostNodes.find(node =>
          node.data.originId === ghostSelection.originId &&
          node.data.task?.index === ghostSelection.task.index &&
          node.data.task?.collection_path === ghostSelection.task.collection_path)
        return current?.data.task
          ? { ...ghostSelection, task: current.data.task }
          : ghostSelection
      })()
    : null

  useEffect(() => { setGhostSelection(null); setGhostPreferences({}) }, [studio.run?.id])
  useEffect(() => { if (!studio.liveLoopView) setGhostSelection(null) }, [studio.liveLoopView])

  const canvasNodes = useMemo<CanvasFlowNode[]>(() => {
    const frames: FrameFlowNode[] = [...frameRects].map(([id, frame], index) => ({
      id: `${FRAME_PREFIX}${id}`,
      type: 'cliptora-frame',
      position: { x: frame.x, y: frame.y },
      style: { width: frame.width, height: frame.height, pointerEvents: 'none' },
      zIndex: 0,
      dragHandle: '.cliptora-frame-handle',
      draggable: true,
      selectable: false,
      data: { title: `Frame ${index + 1}`, count: frame.ids.length, frameId: id, onUngroup: ungroupFrame },
    }))
    const nodeFrames = new Map(nodes.map(node => [node.id, frameIdOf(node)]))
    return [...frames, ...flowNodes.map(node => {
      const frameId = nodeFrames.get(node.id)
      const parent = frameId ? frameRects.get(frameId) : undefined
      return {
        ...node,
        ...(parent ? { parentId: `${FRAME_PREFIX}${frameId}`, zIndex: 1 } : {}),
        position: parent ? { x: node.position.x - parent.x, y: node.position.y - parent.y } : node.position,
        selected: selectedNodeIds.includes(node.id),
      }
    }), ...ghostNodes]
  }, [flowNodes, nodes, selectedNodeIds, frameRects, ungroupFrame, ghostNodes])

  const [
    visualNodes,
    setVisualNodes,
    onVisualNodesChange,
  ] = useNodesState<CanvasFlowNode>(canvasNodes)

  useEffect(() => {
    if (!nodeDragActive.current) {
      setVisualNodes(canvasNodes)
    }
  }, [canvasNodes, setVisualNodes])

  const onNodesChange = useCallback((
    changes: NodeChange<CanvasFlowNode>[],
  ) => {
    onVisualNodesChange(changes)

    const measured = changes.filter(change => change.type === 'dimensions' &&
      !change.id.startsWith(GHOST_PREFIX) && !change.id.startsWith(FRAME_PREFIX))
    if (measured.length) setGhostSizes(previous => {
      let next = previous
      for (const change of measured) {
        if (change.type !== 'dimensions' || !change.dimensions) continue
        const { width, height } = change.dimensions
        if (previous[change.id]?.width === width && previous[change.id]?.height === height) continue
        if (next === previous) next = { ...previous }
        next[change.id] = { width, height }
      }
      return next
    })

    const selections = changes.filter(
      change => change.type === 'select',
    )

    if (selections.length) {
      setSelectedNodeIds(previous => {
        const next = new Set(previous)

        selections.forEach(change => {
          if (change.type !== 'select' || change.id.startsWith(FRAME_PREFIX) || change.id.startsWith(GHOST_PREFIX)) return
          if (change.selected) next.add(change.id)
          else next.delete(change.id)
        })

        const result = [...next]

        return (
          result.length === previous.length &&
          result.every((id, i) => id === previous[i])
        ) ? previous : result
      })
    }

    const removed = changes
      .filter(change => change.type === 'remove' && !change.id.startsWith(GHOST_EDGE_PREFIX))
      .map(change => change.id)

    if (removed.length) {
      setSelectedNodeIds(previous =>
        previous.filter(id => !removed.includes(id)),
      )
    }
  }, [onVisualNodesChange])

  const onEdgesChange = useCallback((changes: EdgeChange<Edge>[]) => {
    const removed = changes
      .filter(change => change.type === 'remove')
      .map(change => change.id)

    if (removed.length) {
      const disconnect = flowEdges.filter(edge => removed.includes(edge.id))

      setNodes(previous =>
        previous.map(node => {
          const removedSources = disconnect
            .filter(edge => edge.target === node.id)
            .map(edge => edge.source)

          if (!removedSources.length) return node

          const handles = handlesFor(node)
          const labels = edgeLabelsFor(node)
          const rawTyped = node.settings[typedConnectionKey]
          const typed = rawTyped && typeof rawTyped === 'object' && !Array.isArray(rawTyped)
            ? { ...rawTyped as Record<string, string> } : {}
          const removedBranch = removedSources.some(source =>
            /^(true|false)$/.test(handles[source] ?? ''),
          )

          removedSources.forEach(source => {
            delete handles[source]
            delete labels[source]
            delete typed[source]
          })

          return {
            ...node,
            depends_on: node.depends_on.filter(
              source => !removedSources.includes(source),
            ),
            when:
              removedBranch &&
                /^condition_(true|false)$/.test(node.when)
                ? 'always'
                : node.when,
            settings: {
              ...node.settings,
              [connectionKey]: handles,
              [edgeLabelKey]: labels,
              [typedConnectionKey]: typed,
            },
          }
        }),
      )
    }

    const selections = changes.filter(
      change => change.type === 'select',
    )

    if (selections.length) {
      setSelectedEdges(previous => {
        const next = new Set(previous)

        selections.forEach(change => {
          if (change.type !== 'select' || change.id.startsWith(FRAME_PREFIX) || change.id.startsWith(GHOST_EDGE_PREFIX)) return
          if (change.selected) next.add(change.id)
          else next.delete(change.id)
        })

        removed.forEach(id => next.delete(id))
        return [...next]
      })
    } else if (removed.length) {
      setSelectedEdges(previous =>
        previous.filter(id => !removed.includes(id)),
      )
    }
  }, [flowEdges, setNodes])

  const deleteEdge = useCallback((id: string) => {
    if (working) return

    onEdgesChange([{ type: 'remove', id }])
    setSelectedEdges(previous => previous.filter(edge => edge !== id))
    setMessage('Connection deleted. Ctrl+Z to undo.')
  }, [working, onEdgesChange, setMessage])

  const renameEdge = useCallback((
    sourceId: string,
    targetId: string,
  ) => {
    const source = nodes.find(node => node.id === sourceId)
    const target = nodes.find(node => node.id === targetId)
    if (!source || !target) return

    const current =
      edgeLabelsFor(target)[sourceId] ??
      (source.type === 'flow.if'
        ? handlesFor(target)[sourceId] || 'true'
        : '')

    setEdgeRenameDraft({
      sourceId,
      targetId,
      value: current,
    })
    setContextMenu(null)
  }, [nodes])

  const submitEdgeRename = useCallback((
    event: FormEvent<HTMLFormElement>,
  ) => {
    event.preventDefault()
    if (!edgeRenameDraft) return

    const value = edgeRenameDraft.value.trim().slice(0, 50)

    setNodes(previous =>
      previous.map(node => {
        if (
          node.id !== edgeRenameDraft.targetId ||
          !node.depends_on.includes(edgeRenameDraft.sourceId)
        ) return node

        const labels = edgeLabelsFor(node)
        if (value) labels[edgeRenameDraft.sourceId] = value
        else delete labels[edgeRenameDraft.sourceId]

        return {
          ...node,
          settings: {
            ...node.settings,
            [edgeLabelKey]: labels,
          },
        }
      }),
    )

    setEdgeRenameDraft(null)
    setMessage('Connection label saved.')
  }, [edgeRenameDraft, setNodes, setMessage])

  const openInsertOnEdge = useCallback((
    edge: Edge,
    event: MouseEvent<HTMLButtonElement>,
  ) => {
    if (working || nodes.length >= 100) return

    const rect = canvasRef.current?.getBoundingClientRect()
    if (!rect) return

    const source = nodes.find(node => node.id === edge.source)
    const target = nodes.find(node => node.id === edge.target)
    if (!source || !target) return

    const sourceHandle = source.type === 'flow.if'
      ? handlesFor(target)[source.id] || 'true'
      : edge.sourceHandle || 'main'

    const point = flow.current?.screenToFlowPosition({
      x: event.clientX,
      y: event.clientY,
    })

    setQuickSearch('')
    setQuickAdd({
      mode: 'insert',
      sourceId: source.id,
      sourceHandle,
      insertEdge: {
        edgeId: edge.id,
        targetId: target.id,
      },
      left: Math.max(
        12,
        Math.min(event.clientX - rect.left + 12, rect.width - 302),
      ),
      top: Math.max(
        12,
        Math.min(event.clientY - rect.top - 30, rect.height - 330),
      ),
      dropPosition: point
        ? { x: point.x - 100, y: point.y - 60 }
        : undefined,
    })
  }, [flow, nodes, working])

  const graphEdges = useMemo<Edge[]>(() =>
    flowEdges.map(edge => {
      const source = nodes.find(node => node.id === edge.source)
      const target = nodes.find(node => node.id === edge.target)
      const sourceHandle = source?.type === 'flow.if'
        ? (target ? handlesFor(target)[edge.source] : undefined) || 'true'
        : edge.sourceHandle || 'main'

      const sourceUI = flowNodes.find(node => node.id === edge.source)
      const targetUI = flowNodes.find(node => node.id === edge.target)

      const state =
        targetUI?.data.status === 'failed'
          ? 'failed'
          : targetUI?.data.status === 'running'
            ? 'running'
            : sourceUI?.data.status === 'done' &&
              targetUI?.data.status === 'done'
              ? 'done'
              : 'waiting'

      const selected = selectedEdges.includes(edge.id)
      const moving =
        draggingNodeId === edge.source ||
        draggingNodeId === edge.target

      const color =
        selected ? '#7c3aed'
          : moving ? '#8b5cf6'
            : state === 'failed' ? '#e05252'
              : state === 'running' ? '#3b82f6'
                : state === 'done' ? '#13a565'
                  : '#646970'

      const itemText = sourceUI?.data.meta ?? ''
      const count = /^\d+ items?$/.test(itemText)
        ? itemText.replace(/^1 items$/, '1 item')
        : ''

      const routeLabel = source?.type === 'flow.if'
        ? sourceHandle
        : target?.when && /^route_(\d+|fallback)$/.test(target.when)
          ? target.when.replace('route_', 'route ')
          : undefined

      const label =
        (target ? edgeLabelsFor(target)[edge.source] : undefined) ||
        routeLabel ||
        (state === 'done' ? count : '')

      const typedEdge = target?.type === 'ai.agent' && agentPortTypes.has(String((target.settings[typedConnectionKey] as Record<string, unknown> | undefined)?.[edge.source] ?? ''))
      return {
        ...edge,
        type: 'cliptora-action',
        sourceHandle,
        targetHandle: target?.type === 'ai.agent' &&
          typeof (target.settings[typedConnectionKey] as Record<string, unknown> | undefined)?.[edge.source] === 'string'
          ? String((target.settings[typedConnectionKey] as Record<string, unknown>)[edge.source])
          : 'input',
        selected,
        animated: false,
        style: {
          stroke: typedEdge ? '#a9a9b4' : color,
          strokeWidth: typedEdge ? 2 : 2.7,
          ...(typedEdge ? { strokeDasharray: '5 5' } : {}),
        },
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color,
          width: 20,
          height: 20,
        },
        label: undefined,
        data: {
          label,
          state,
          moving,
          onInsert: (event: MouseEvent<HTMLButtonElement>) =>
            openInsertOnEdge(edge, event),
          onDelete: () => deleteEdge(edge.id),
          onRename: () => renameEdge(edge.source, edge.target),
        } satisfies ActionEdgeData,
      }
    }),
    [
      flowEdges,
      flowNodes,
      nodes,
      selectedEdges,
      draggingNodeId,
      openInsertOnEdge,
      deleteEdge,
      renameEdge,
    ])

  const ghostEdges = useMemo(() => buildGhostEdges(graphEdges, ghostNodes), [graphEdges, ghostNodes])
  // Keep the saved workflow edges separate: presentation branches are render-only.
  const visibleGraphEdges = useMemo<Edge[]>(() => [...graphEdges, ...ghostEdges], [graphEdges, ghostEdges])

  const onConnect = useCallback((connection: Connection) => {
    const { source, target, sourceHandle, targetHandle } = connection
    if (!source || !target || createsCycle(nodes, source, target)) return
    const sourceNode = nodes.find(node => node.id === source)
    const targetNode = nodes.find(node => node.id === target)
    if (!sourceNode || !targetNode) return

    const isAgentPort = targetNode.type === 'ai.agent' && agentPortTypes.has(targetHandle ?? '')
    if (isAgentPort) {
      if (targetHandle === 'chat_model' && sourceNode.type !== 'ai.chat_model') {
        setMessage('Chat Model port only accepts a Chat Model node.')
        return
      }
      if (targetHandle === 'memory' && !/memory/i.test(sourceNode.type)) {
        setMessage('Memory port only accepts Memory nodes.')
        return
      }
      if (targetHandle === 'tool' && (
        sourceNode.type === 'ai.chat_model' ||
        sourceNode.type === 'ai.agent' ||
        /trigger/i.test(sourceNode.type)
      )) {
        setMessage('Tool port requires an executable Tool node.')
        return
      }
    } else if (targetHandle && targetHandle !== 'input') {
      return
    }

    // React Flow onConnect is synchronous; verify the proposed data link
    // asynchronously before committing it to the graph.
    void (async () => {
      let notice = 'Nodes connected. Save the workflow to persist changes.'
      if (!isAgentPort) {
        const decision = await studio.checkTypeConnection(
          sourceNode.type, targetNode.type, targetNode.settings, sourceNode.settings,
        )
        if (!decision.allowed) {
          setMessage(decision.message)
          setSelectedId(targetNode.id)
          return
        }
        if (decision.status !== 'compatible') notice += ` ${decision.message}`
      }
      setNodes(previous => previous.map(node => {
      if (node.id !== target) return node
      const isBranch = sourceNode.type === 'flow.if'
      const sourceHandles = isBranch
        ? { ...handlesFor(node), [source]: sourceHandle === 'false' ? 'false' : 'true' }
        : handlesFor(node)
      const previousTyped = node.settings[typedConnectionKey]
      const typed = previousTyped && typeof previousTyped === 'object' && !Array.isArray(previousTyped)
        ? { ...previousTyped as Record<string, string> } : {}
      if (isAgentPort && targetHandle) typed[source] = targetHandle
      else delete typed[source]
      // Chat Model is a single provider, not an arbitrary list of models.
      const existingModels = isAgentPort && targetHandle === 'chat_model'
        ? Object.keys(typed).filter(id => id !== source && typed[id] === 'chat_model') : []
      for (const oldId of existingModels) delete typed[oldId]
      return {
        ...node,
        depends_on: [...new Set([...node.depends_on.filter(id => !existingModels.includes(id)), source])],
        when: isBranch ? sourceHandle === 'false' ? 'condition_false' : 'condition_true' : node.when,
        settings: {
          ...node.settings,
          ...(isBranch ? { [connectionKey]: sourceHandles } : {}),
          [typedConnectionKey]: typed,
        },
      }
      }))
      setMessage(notice)
    })()
  }, [nodes, setNodes, setMessage, setSelectedId, studio.checkTypeConnection])

  const openQuickAdd = useCallback((
    sourceId: string,
    sourceHandle: string,
    event: MouseEvent<HTMLButtonElement>,
  ) => {
    const rect = canvasRef.current?.getBoundingClientRect()
    if (!rect) return

    setQuickSearch('')
    setQuickAdd({
      sourceId,
      sourceHandle,
      left: Math.max(
        12,
        Math.min(event.clientX - rect.left + 12, rect.width - 302),
      ),
      top: Math.max(
        12,
        Math.min(event.clientY - rect.top - 30, rect.height - 330),
      ),
    })
  }, [])

  const addAfter = useCallback(async (type: string) => {
    if (!quickAdd || nodes.length >= 100) return

    const template = catalog.find(
      item => item.type === type && item.status === 'implemented',
    )
    const source = nodes.find(node => node.id === quickAdd.sourceId)
    if (!template || !source) return

    if (source.type === 'ai.agent' && agentPortTypes.has(quickAdd.sourceHandle)) {
      const port = quickAdd.sourceHandle
      const compatible = port === 'chat_model' ? template.type === 'ai.chat_model'
        : port === 'memory' ? /memory/i.test(template.type)
          : template.type !== 'ai.agent' && template.type !== 'ai.chat_model' && !/trigger/i.test(template.type)
      if (!compatible) { setMessage(`This node is not compatible with the ${port} port.`); return }
      const id = uid(type, nodes.map(node => node.id))
      const anchor = source.position ?? { x: 100, y: 100 }
      const offset = port === 'chat_model' ? -280 : port === 'memory' ? 0 : 280
      const nodeToAdd: WorkflowNode = {
        id, type, depends_on: [], when: 'always', retry_limit: 1, cache: true,
        settings: structuredClone(template.settings),
        position: { x: anchor.x + offset, y: anchor.y + 300 },
      }
      setNodes(previous => [...previous.map(node => {
        if (node.id !== source.id) return node
        const previousTyped = node.settings[typedConnectionKey]
        const handles = previousTyped && typeof previousTyped === 'object' && !Array.isArray(previousTyped)
          ? { ...previousTyped as Record<string, string> } : {}
        const oldModels = port === 'chat_model' ? Object.keys(handles).filter(key => handles[key] === 'chat_model') : []
        oldModels.forEach(key => delete handles[key])
        handles[id] = port
        return { ...node, depends_on: [...node.depends_on.filter(dep => !oldModels.includes(dep)), id], settings: { ...node.settings, [typedConnectionKey]: handles } }
      }), nodeToAdd])
      setSelectedId(id)
      setJsonEditor(JSON.stringify(nodeToAdd.settings, null, 2))
      setMessage(`${template.label} connected to AI Agent ${port} port. Save workflow to persist.`)
      setQuickAdd(null)
      return
    }

    if (quickAdd.mode === 'insert' && quickAdd.insertEdge) {
      const target = nodes.find(
        node => node.id === quickAdd.insertEdge?.targetId,
      )

      if (
        !target ||
        !target.depends_on.includes(source.id) ||
        type === 'core.video_source'
      ) {
        setMessage('Cannot insert this node into that connection.')
        setQuickAdd(null)
        return
      }

      const incoming = await studio.checkTypeConnection(source.type, type, template.settings, source.settings)
      if (!incoming.allowed) { setMessage(incoming.message); return }
      const outgoing = await studio.checkTypeConnection(type, target.type, target.settings, template.settings)
      if (!outgoing.allowed) { setMessage(outgoing.message); return }

      const id = uid(type, nodes.map(node => node.id))
      const branch =
        source.type === 'flow.if' &&
        /^(true|false)$/.test(quickAdd.sourceHandle)

      const conditionalWhen: WorkflowNode['when'] = branch
        ? quickAdd.sourceHandle === 'false'
          ? 'condition_false'
          : 'condition_true'
        : /^route_(\d+|fallback)$/.test(target.when)
          ? target.when
          : 'always'

      const inheritedLabel = edgeLabelsFor(target)[source.id]

      const inserted: WorkflowNode = {
        id,
        type,
        depends_on: [source.id],
        when: conditionalWhen,
        retry_limit: 1,
        cache: true,
        settings: {
          ...structuredClone(template.settings),
          ...(branch
            ? {
              [connectionKey]: {
                [source.id]: quickAdd.sourceHandle,
              },
            }
            : {}),
          ...(inheritedLabel
            ? {
              [edgeLabelKey]: {
                [source.id]: inheritedLabel,
              },
            }
            : {}),
        },
        position: quickAdd.dropPosition ?? {
          x: (
            (source.position?.x ?? 100) +
            (target.position?.x ?? 550)
          ) / 2,
          y: (
            (source.position?.y ?? 100) +
            (target.position?.y ?? 100)
          ) / 2,
        },
      }

      setNodes(previous => [
        ...previous.map(node => {
          if (node.id !== target.id) return node

          const handles = handlesFor(node)
          const labels = edgeLabelsFor(node)

          delete handles[source.id]
          delete labels[source.id]

          return {
            ...node,
            depends_on: [
              ...new Set(
                node.depends_on.map(dep =>
                  dep === source.id ? id : dep,
                ),
              ),
            ],
            when:
              type === 'flow.if'
                ? 'condition_true'
                : conditionalWhen !== 'always' &&
                  node.when === conditionalWhen
                  ? 'always'
                  : node.when,
            settings: {
              ...node.settings,
              [connectionKey]: type === 'flow.if'
                ? { ...handles, [id]: 'true' }
                : handles,
              [edgeLabelKey]: labels,
            },
          }
        }),
        inserted,
      ])

      setSelectedEdges([])
      setSelectedId(id)
      setJsonEditor(JSON.stringify(inserted.settings, null, 2))
      setMessage('Node inserted into connection. Ctrl+Z to undo.')
      setQuickAdd(null)
      return
    }

    if (quickAdd.mode === 'replace') {
      if (
        source.type === 'core.video_source' ||
        type === 'core.video_source'
      ) return

      const inbound = nodes.filter(node => source.depends_on.includes(node.id))
      const outbound = nodes.filter(node => node.depends_on.includes(source.id))
      for (const parent of inbound) {
        const result = await studio.checkTypeConnection(parent.type, type, template.settings, parent.settings)
        if (!result.allowed) { setMessage(result.message); return }
      }
      for (const child of outbound) {
        if (child.type === 'ai.agent') continue
        const result = await studio.checkTypeConnection(type, child.type, child.settings, template.settings)
        if (!result.allowed) { setMessage(result.message); return }
      }

      setNodes(previous =>
        previous.map(node => {
          if (node.id === source.id) {
            return {
              ...node,
              type,
              settings: {
                ...structuredClone(template.settings),
                ...(node.settings[pinKey] === true
                  ? { [pinKey]: true }
                  : {}),
              },
            }
          }

          if (
            source.type !== 'flow.if' ||
            type === 'flow.if' ||
            !node.depends_on.includes(source.id)
          ) return node

          const handles = handlesFor(node)
          delete handles[source.id]

          return {
            ...node,
            when: /^condition_(true|false)$/.test(node.when)
              ? 'always'
              : node.when,
            settings: {
              ...node.settings,
              [connectionKey]: handles,
            },
          }
        }),
      )

      setMessage('Node replaced. Check settings and connections.')
      setQuickAdd(null)
      return
    }

    const decision = await studio.checkTypeConnection(source.type, type, template.settings, source.settings)
    if (!decision.allowed) { setMessage(decision.message); return }
    const id = uid(type, nodes.map(node => node.id))
    const siblingOffset =
      quickAdd.sourceHandle === 'false' ? 140
        : quickAdd.sourceHandle === 'true' ? -50
          : 0

    const next: WorkflowNode = {
      id,
      type,
      depends_on: [source.id],
      when:
        quickAdd.sourceHandle === 'false'
          ? 'condition_false'
          : quickAdd.sourceHandle === 'true'
            ? 'condition_true'
            : 'always',
      retry_limit: 1,
      cache: true,
      settings: {
        ...structuredClone(template.settings),
        ...(
          quickAdd.sourceHandle === 'true' ||
            quickAdd.sourceHandle === 'false'
            ? {
              [connectionKey]: {
                [source.id]: quickAdd.sourceHandle,
              },
            }
            : {}
        ),
      },
      position: quickAdd.dropPosition ?? {
        x: (source.position?.x ?? 100) + 280,
        y: (source.position?.y ?? 100) + siblingOffset,
      },
    }

    setNodes(previous => [...previous, next])
    setSelectedId(id)
    setJsonEditor(JSON.stringify(next.settings, null, 2))
    setMessage(decision.status === 'compatible' ? 'Node added and connected.' : `Node added and connected. ${decision.message}`)
    setQuickAdd(null)
  }, [catalog, nodes, quickAdd, setJsonEditor, setMessage, setNodes, setSelectedId, studio.checkTypeConnection])

  const quickItems = useMemo(
    () => catalog.filter(item =>
      (quickAdd?.sourceHandle === 'chat_model' ? item.type === 'ai.chat_model' :
        quickAdd?.sourceHandle === 'memory' ? /memory/i.test(item.type) :
          quickAdd?.sourceHandle === 'tool' ? item.type !== 'ai.agent' && item.type !== 'ai.chat_model' && !/trigger/i.test(item.type) : true) &&
      item.status === 'implemented' &&
      !!item.backend_executor &&
      (
        !['replace', 'insert'].includes(quickAdd?.mode ?? '') ||
        item.type !== 'core.video_source'
      ) &&
      `${item.label} ${item.type} ${item.group}`
        .toLowerCase()
        .includes(quickSearch.trim().toLowerCase()),
    ).slice(0, 35),
    [catalog, quickSearch, quickAdd?.mode, quickAdd?.sourceHandle],
  )

  const duplicateSelectedNodes = useCallback(() => {
    const selected = nodes.filter(node =>
      selectedNodeIds.includes(node.id) &&
      node.type !== 'core.video_source',
    )
    if (!selected.length || nodes.length + selected.length > 100) return

    const usedIds = nodes.map(node => node.id)
    const idMap = new Map<string, string>()

    selected.forEach(node => {
      const nextId = uid(node.type, usedIds)
      usedIds.push(nextId)
      idMap.set(node.id, nextId)
    })

    const copies = selected.map(node => {
      const copy = structuredClone(node)
      const sourceHandles = Object.fromEntries(
        Object.entries(handlesFor(copy)).map(([sourceId, handle]) => [
          idMap.get(sourceId) ?? sourceId,
          handle,
        ]),
      )

      return {
        ...copy,
        id: idMap.get(node.id)!,
        depends_on: node.depends_on.map(id => idMap.get(id) ?? id),
        settings: Object.keys(sourceHandles).length
          ? {
            ...copy.settings,
            [connectionKey]: sourceHandles,
          }
          : copy.settings,
        position: {
          x: (node.position?.x ?? 0) + 42,
          y: (node.position?.y ?? 0) + 42,
        },
      }
    })

    copies.forEach(node => {
      delete node.settings[pinKey]
    })

    setNodes(previous => [...previous, ...copies])
    setSelectedNodeIds(copies.map(node => node.id))
    setSelectedId(copies[0].id)
    setJsonEditor(JSON.stringify(copies[0].settings, null, 2))
    setMessage(`${copies.length} node(s) duplicated.`)
  }, [nodes, selectedNodeIds, setNodes, setSelectedId, setJsonEditor, setMessage])

  const duplicateOneNode = useCallback((nodeId: string) => {
    if (working) return
    const original = nodes.find(node => node.id === nodeId)
    if (!original || original.type === 'core.video_source' || nodes.length >= 100) return

    const id = uid(original.type, nodes.map(node => node.id))
    const duplicate: WorkflowNode = structuredClone(original)
    duplicate.id = id
    duplicate.position = {
      x: (original.position?.x ?? 0) + 55,
      y: (original.position?.y ?? 0) + 55,
    }
    duplicate.settings = { ...duplicate.settings }
    delete duplicate.settings[pinKey]
    delete duplicate.settings.__cliptora_ui_deactivated

    setNodes(previous => [...previous, duplicate])
    setSelectedNodeIds([id])
    setSelectedId(id)
    setJsonEditor(JSON.stringify(duplicate.settings, null, 2))
    setMessage('Node duplicated. Ctrl+Z to undo.')
  }, [nodes, working, setNodes, setSelectedId, setJsonEditor, setMessage])

  const toggleNodeDeactivated = useCallback((nodeId: string) => {
    if (working) return
    const current = nodes.find(node => node.id === nodeId)
    if (!current) return
    const next = current.settings.__cliptora_ui_deactivated !== true
    setNodes(previous => previous.map(node => node.id !== nodeId ? node : {
      ...node,
      settings: {
        ...node.settings,
        __cliptora_ui_deactivated: next,
      },
    }))
    setMessage(next
      ? 'Node marked inactive in editor. The backend executor must support this flag to skip execution.'
      : 'Node reactivated in editor.')
  }, [nodes, working, setNodes, setMessage])

  const toggleNodePin = useCallback((id: string) => {
    setNodes(previous =>
      previous.map(node => {
        if (node.id !== id) return node

        const settings = { ...node.settings }
        if (settings[pinKey] === true) delete settings[pinKey]
        else settings[pinKey] = true

        return { ...node, settings }
      }),
    )
  }, [setNodes])

  const deleteSelection = useCallback(() => {
    if (selectedEdges.length) {
      onEdgesChange(
        selectedEdges.map(id => ({ type: 'remove', id })),
      )
    }

    if (selectedNodeIds.length) {
      deleteNodes(selectedNodeIds)
    } else if (selectedEdges.length) {
      setSelectedEdges([])
      setMessage(`${selectedEdges.length} connection(s) deleted.`)
    }
  }, [deleteNodes, onEdgesChange, selectedEdges, selectedNodeIds, setMessage])

  const onCanvasGestureComplete = useCallback((points: Position[], mode: 'lasso' | 'frame') => {
    const rect = canvasRef.current?.getBoundingClientRect()
    if (!rect || !flow.current) return
    const factor = flow.current.getZoom()
    const first = points[0]
    const last = points[points.length - 1]
    const box = {
      x1: Math.min(first.x, last.x), x2: Math.max(first.x, last.x),
      y1: Math.min(first.y, last.y), y2: Math.max(first.y, last.y),
    }
    const found = nodes.filter(node => {
      const pos = flow.current!.flowToScreenPosition(node.position ?? { x: 80, y: 80 })
      const x = pos.x - rect.left
      const y = pos.y - rect.top
      const w = NODE_FALLBACK_WIDTH * factor
      const h = NODE_FALLBACK_HEIGHT * factor
      const center = { x: x + w / 2, y: y + h / 2 }
      if (mode === 'frame') return center.x >= box.x1 && center.x <= box.x2 &&
        center.y >= box.y1 && center.y <= box.y2
      if (insidePolygon(center, points)) return true
      return [{ x, y }, { x: x + w, y }, { x, y: y + h }, { x: x + w, y: y + h }]
        .some(corner => insidePolygon(corner, points))
    }).map(node => node.id)

    if (mode === 'frame') {
      createFrame(found)
    } else {
      setSelectedNodeIds(found)
      setSelectedId(found[0] ?? null)
      setSelectedEdges([])
      setMessage(found.length ? `${found.length} node(s) selected with Lasso.` : 'No nodes inside the Lasso.')
    }
  }, [nodes, createFrame, flow, setSelectedId, setMessage])

  const alignSelected = useCallback((action: AlignAction) => {
    const active = nodes.filter(node => selectedNodeIds.includes(node.id) && node.settings[pinKey] !== true)
    const minimum = action.startsWith('distribute') ? 3 : 2
    if (active.length < minimum) {
      setMessage(`Select at least ${minimum} unpinned nodes to ${action.startsWith('distribute') ? 'distribute' : 'align'}.`)
      return
    }
    const info = active.map(node => {
      const ui = flow.current?.getNode(node.id)
      return {
        id: node.id, pos: node.position ?? { x: 80, y: 80 },
        width: ui?.measured?.width ?? NODE_FALLBACK_WIDTH,
        height: ui?.measured?.height ?? NODE_FALLBACK_HEIGHT,
      }
    })
    const X = info.map(item => item.pos.x)
    const Y = info.map(item => item.pos.y)
    const left = Math.min(...X), top = Math.min(...Y)
    const right = Math.max(...info.map(item => item.pos.x + item.width))
    const bottom = Math.max(...info.map(item => item.pos.y + item.height))
    const coords = new Map<string, Position>()
    if (action === 'distributeX' || action === 'distributeY') {
      const horizontal = action === 'distributeX'
      const sorted = [...info].sort((a, b) => horizontal ? a.pos.x - b.pos.x : a.pos.y - b.pos.y)
      const axisStart = horizontal ? sorted[0].pos.x : sorted[0].pos.y
      const axisEnd = horizontal
        ? sorted[sorted.length - 1].pos.x + sorted[sorted.length - 1].width
        : sorted[sorted.length - 1].pos.y + sorted[sorted.length - 1].height
      const sizes = sorted.map(item => horizontal ? item.width : item.height)
      const spacing = (axisEnd - axisStart - sizes.reduce((sum, size) => sum + size, 0)) / (sorted.length - 1)
      let cursor = axisStart
      for (const [i, item] of sorted.entries()) {
        coords.set(item.id, horizontal ? { ...item.pos, x: cursor } : { ...item.pos, y: cursor })
        cursor += sizes[i] + spacing
      }
    } else {
      for (const item of info) {
        const pos = { ...item.pos }
        if (action === 'left') pos.x = left
        if (action === 'centerX') pos.x = (left + right - item.width) / 2
        if (action === 'right') pos.x = right - item.width
        if (action === 'top') pos.y = top
        if (action === 'centerY') pos.y = (top + bottom - item.height) / 2
        if (action === 'bottom') pos.y = bottom - item.height
        coords.set(item.id, pos)
      }
    }
    setNodes(previous => previous.map(node => {
      const pos = coords.get(node.id)
      return pos ? { ...node, position: { x: snap(pos.x, snapToGridEnabled), y: snap(pos.y, snapToGridEnabled) } } : node
    }))
    setAlignOpen(false)
    setMessage('Nodes aligned. Ctrl+Z to undo.')
  }, [nodes, selectedNodeIds, snapToGridEnabled, setNodes, setMessage, flow])

  useEffect(() => {
    try { window.localStorage.setItem('cliptora.workflow.snapToGrid', String(snapToGridEnabled)) }
    catch { /* Restricted browser storage. */ }
  }, [snapToGridEnabled])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (
        target?.closest('input, textarea, select, [contenteditable="true"]')
      ) return

      if (contextMenu || renameDraft || edgeRenameDraft) return

      const key = event.key.toLowerCase()
      const keyboardScope =
        canvasRef.current?.contains(event.target as Node) ||
        document.activeElement === document.body

      if (!keyboardScope) return
      if (commandOpen || quickAdd || renameDraft || edgeRenameDraft) return

      // Canvas tool shortcuts: ignore modified keys and active editors.
      if (!event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
        const mode = { v: 'mouse', h: 'hand', l: 'lasso', c: 'connect', f: 'frame' } as const
        if (key in mode) {
          event.preventDefault()
          setInteractionMode(mode[key as keyof typeof mode])
          setConnectSourceId(null)
          setAlignOpen(false)
          return
        }
        if (key === 'g') {
          event.preventDefault()
          setSnapToGridEnabled(previous => !previous)
          return
        }
      }

      if (event.key === 'Escape') {
        if (connectSourceId || interactionMode !== 'mouse' || alignOpen) {
          setConnectSourceId(null)
          setInteractionMode('mouse')
          setAlignOpen(false)
          return
        }
        setSelectedNodeIds([])
        setSelectedEdges([])
        setSelectedId(null)
        return
      }

      if (
        (event.key === 'Delete' || event.key === 'Backspace') &&
        (selectedNodeIds.length || selectedEdges.length)
      ) {
        event.preventDefault()
        deleteSelection()
        return
      }

      if (
        event.key === 'Enter' &&
        !event.ctrlKey &&
        !event.metaKey &&
        selectedId
      ) {
        event.preventDefault()
        onOpenNode?.(selectedId)
        return
      }

      if (
        event.key === 'Enter' &&
        (event.ctrlKey || event.metaKey) &&
        selectedId &&
        !working
      ) {
        event.preventDefault()
        void testStep(selectedId)
        return
      }

      if (event.altKey && key === 't') {
        event.preventDefault()
        tidyWorkflow()
        return
      }

      if (
        !event.altKey &&
        !event.ctrlKey &&
        !event.metaKey &&
        key === 'p' &&
        selectedId
      ) {
        event.preventDefault()
        toggleNodePin(selectedId)
        return
      }

      if (
        !event.altKey &&
        !event.ctrlKey &&
        !event.metaKey &&
        key === 'r' &&
        selectedId
      ) {
        const rect = canvasRef.current?.getBoundingClientRect()
        const node = nodes.find(item => item.id === selectedId)

        if (node && node.type !== 'core.video_source' && rect) {
          event.preventDefault()

          const position = flow.current?.flowToScreenPosition({
            x: node.position?.x ?? 0,
            y: node.position?.y ?? 0,
          })

          setQuickSearch('')
          setQuickAdd({
            mode: 'replace',
            sourceId: selectedId,
            sourceHandle: 'main',
            left: Math.max(
              12,
              Math.min(
                (position?.x ?? rect.left + 50) - rect.left,
                rect.width - 302,
              ),
            ),
            top: Math.max(
              12,
              Math.min(
                (position?.y ?? rect.top + 40) - rect.top,
                rect.height - 330,
              ),
            ),
          })
        }
        return
      }

      if (key === 'f2' && selectedId) {
        event.preventDefault()
        const node = nodes.find(item => item.id === selectedId)

        if (node) {
          setRenameDraft({
            id: selectedId,
            value: String(
              node.settings[labelKey] ??
              catalog.find(item => item.type === node.type)?.label ??
              node.type,
            ),
          })
        }
        return
      }

      if (!(event.ctrlKey || event.metaKey)) return

      if (key === 'c' && selectedNodeIds.length) {
        event.preventDefault()
        copySelection(selectedNodeIds)
      } else if (key === 'v' && clipboardRef.current.length) {
        event.preventDefault()
        pasteSelection()
      } else if (key === 'a' && nodes.length) {
        event.preventDefault()
        setSelectedNodeIds(nodes.map(node => node.id))
        setSelectedId(nodes[0].id)
      } else if (key === 'd') {
        event.preventDefault()
        duplicateSelectedNodes()
      } else if (key === 'z' && event.shiftKey) {
        event.preventDefault()
        redo()
      } else if (key === 'z') {
        event.preventDefault()
        undo()
      } else if (key === 'y') {
        event.preventDefault()
        redo()
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [
    duplicateSelectedNodes, redo, undo, selectedId, nodes,
    selectedNodeIds, selectedEdges, catalog, copySelection,
    pasteSelection, setSelectedId, tidyWorkflow, toggleNodePin,
    contextMenu, commandOpen, quickAdd, renameDraft, edgeRenameDraft, flow,
    deleteSelection, onOpenNode, testStep, working,
    connectSourceId, interactionMode, alignOpen,
  ])

  const onLibraryDrop = useCallback((event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    event.stopPropagation()

    const type = event.dataTransfer.getData('text/cliptora-node')
    if (
      !type ||
      !catalog.some(item =>
        item.type === type && item.status === 'implemented',
      )
    ) return

    const point = flow.current?.screenToFlowPosition({
      x: event.clientX,
      y: event.clientY,
    })

    if (!point) return

    addNode(type, {
      x: point.x - 95,
      y: point.y - 55,
    })
    setQuickAdd(null)
  }, [addNode, catalog, flow])

  const contextActions: ContextMenuAction[] = (() => {
    if (!contextMenu) return []

    const activeNode = contextMenu.kind === 'node'
      ? nodes.find(node => node.id === contextMenu.id)
      : undefined

    const activeEdge = contextMenu.kind === 'edge'
      ? graphEdges.find(edge => edge.id === contextMenu.id)
      : undefined

    if (activeEdge) {
      return [
        {
          id: 'insert',
          label: 'Insert node between',
          icon: Plus,
          disabled: working || nodes.length >= 100,
          run: () => {
            const rect = canvasRef.current?.getBoundingClientRect()
            if (!rect) return

            const source = nodes.find(node => node.id === activeEdge.source)
            const target = nodes.find(node => node.id === activeEdge.target)
            if (!source || !target) return

            const sourceHandle = source.type === 'flow.if'
              ? handlesFor(target)[source.id] || 'true'
              : 'main'

            const point = flow.current?.screenToFlowPosition({
              x: contextMenu.clientX,
              y: contextMenu.clientY,
            })

            setQuickSearch('')
            setQuickAdd({
              mode: 'insert',
              sourceId: source.id,
              sourceHandle,
              insertEdge: {
                edgeId: activeEdge.id,
                targetId: target.id,
              },
              left: Math.max(
                12,
                Math.min(
                  contextMenu.clientX - rect.left,
                  rect.width - 302,
                ),
              ),
              top: Math.max(
                12,
                Math.min(
                  contextMenu.clientY - rect.top,
                  rect.height - 330,
                ),
              ),
              dropPosition: point
                ? { x: point.x - 100, y: point.y - 60 }
                : undefined,
            })
          },
        },
        {
          id: 'rename-edge',
          label: 'Rename label',
          icon: Pencil,
          run: () => renameEdge(activeEdge.source, activeEdge.target),
        },
        {
          id: 'disconnect',
          label: 'Delete connection',
          icon: Trash2,
          shortcut: ['Del'],
          destructive: true,
          run: () => deleteEdge(activeEdge.id),
        },
        {
          id: 'tidy',
          label: 'Tidy Up',
          icon: LayoutGrid,
          dividerBefore: true,
          run: tidyWorkflow,
        },
      ]
    }

    const selection = activeNode
      ? selectedNodeIds.includes(activeNode.id)
        ? selectedNodeIds
        : [activeNode.id]
      : selectedNodeIds

    const nodeActions: ContextMenuAction[] = activeNode
      ? [
        {
          id: 'open',
          label: 'Open...',
          icon: ExternalLink,
          shortcut: ['Enter'],
          disabled: !onOpenNode,
          run: () => onOpenNode?.(activeNode.id),
        },
        {
          id: 'execute',
          label: 'Execute step',
          icon: Play,
          disabled: working,
          shortcut: ['Ctrl', 'Enter'],
          run: () => void testStep(activeNode.id),
        },
        {
          id: 'rename',
          label: 'Rename',
          icon: Pencil,
          shortcut: ['F2'],
          run: () => setRenameDraft({
            id: activeNode.id,
            value: String(
              activeNode.settings[labelKey] ??
              catalog.find(item => item.type === activeNode.type)?.label ??
              activeNode.type,
            ),
          }),
        },
        {
          id: 'replace',
          label: 'Replace',
          icon: Replace,
          disabled: activeNode.type === 'core.video_source',
          run: () => {
            const rect = canvasRef.current?.getBoundingClientRect()
            if (!rect) return

            setQuickSearch('')
            setQuickAdd({
              mode: 'replace',
              sourceId: activeNode.id,
              sourceHandle: 'main',
              left: Math.max(
                12,
                Math.min(contextMenu.clientX - rect.left, rect.width - 302),
              ),
              top: Math.max(
                12,
                Math.min(contextMenu.clientY - rect.top, rect.height - 330),
              ),
            })
          },
        },
        {
          id: 'deactivate',
          label: activeNode.settings.__cliptora_ui_deactivated === true ? 'Reactivate node' : 'Deactivate node',
          icon: Ban,
          disabled: working,
          run: () => toggleNodeDeactivated(activeNode.id),
        },
        {
          id: 'pin',
          label: activeNode.settings[pinKey] === true ? 'Unpin' : 'Pin',
          icon: activeNode.settings[pinKey] === true
            ? LockKeyholeOpen
            : LockKeyhole,
          shortcut: ['P'],
          run: () => toggleNodePin(activeNode.id),
        },
        {
          id: 'copy',
          label: 'Copy Node(s)',
          icon: Copy,
          shortcut: ['Ctrl', 'C'],
          run: () => copySelection(selection),
        },
        {
          id: 'paste',
          label: 'Paste Node(s)',
          icon: ClipboardPaste,
          shortcut: ['Ctrl', 'V'],
          disabled: !clipboardRef.current.length,
          run: () => pasteSelection(contextMenu.flowPosition),
        },
        {
          id: 'copy-config',
          label: 'Copy Node Settings',
          icon: Settings2,
          dividerBefore: true,
          run: () => copyNodeConfig(activeNode),
        },
        {
          id: 'paste-config',
          label: 'Paste Node Settings',
          icon: ClipboardPaste,
          disabled: !configClipboardRef.current && !canReadClipboard,
          run: () => void pasteNodeConfig(activeNode),
        },
        {
          id: 'duplicate',
          label: 'Duplicate',
          icon: Copy,
          shortcut: ['Ctrl', 'D'],
          disabled:
            !selection.some(id =>
              nodes.some(node =>
                node.id === id && node.type !== 'core.video_source',
              ),
            ) ||
            nodes.length + selection.length > 100,
          run: () => {
            const chosen = nodes.filter(node =>
              selection.includes(node.id) &&
              node.type !== 'core.video_source',
            )
            if (!chosen.length) return
            clipboardRef.current = clone(chosen)
            pasteSelection()
          },
        },
        {
          id: 'tidy',
          label: 'Tidy Up',
          icon: LayoutGrid,
          dividerBefore: true,
          run: tidyWorkflow,
        },
        {
          id: 'delete',
          label: 'Delete Node(s)',
          icon: Trash2,
          shortcut: ['Del'],
          destructive: true,
          dividerBefore: true,
          run: () => deleteNodes(selection),
        },
      ]
      : [
        {
          id: 'add',
          label: 'Add node',
          icon: Plus,
          run: showToolLibrary,
        },
        {
          id: 'paste',
          label: 'Paste Node(s)',
          icon: ClipboardPaste,
          shortcut: ['Ctrl', 'V'],
          disabled: !clipboardRef.current.length,
          run: () => pasteSelection(contextMenu.flowPosition),
        },
        {
          id: 'copy-workflow',
          label: 'Copy Workflow',
          icon: WorkflowIcon,
          dividerBefore: true,
          disabled: !nodes.length,
          run: copyWorkflow,
        },
        {
          id: 'paste-workflow',
          label: 'Paste Workflow',
          icon: ClipboardPaste,
          disabled: !flowClipboardRef.current && !canReadClipboard,
          run: () => void pasteWorkflow(),
        },
        {
          id: 'tidy',
          label: 'Tidy Up',
          icon: LayoutGrid,
          shortcut: ['Alt', 'T'],
          disabled: !nodes.length,
          run: tidyWorkflow,
        },
      ]

    return [
      ...nodeActions,
      {
        id: 'selectall',
        label: 'Select All',
        icon: MousePointer2,
        shortcut: ['Ctrl', 'A'],
        dividerBefore: true,
        disabled: !nodes.length,
        run: () => {
          setSelectedEdges([])
          setSelectedNodeIds(nodes.map(node => node.id))
          setSelectedId(nodes[0].id)
        },
      },
      {
        id: 'clear',
        label: 'Clear Selection',
        icon: XCircle,
        disabled: !selectedNodeIds.length && !selectedEdges.length,
        run: () => {
          setSelectedEdges([])
          setSelectedNodeIds([])
          setSelectedId(null)
        },
      },
    ]
  })()

  const nodeToolbarActions = useMemo<WorkflowNodeToolbarActions>(() => ({
    working,
    canInspect: Boolean(onOpenNode),
    isDeactivated: (id: string) => nodes.some(node =>
      node.id === id && node.settings.__cliptora_ui_deactivated === true),
    onDelete: (id: string) => deleteNodes([id]),
    onToggleDeactivate: toggleNodeDeactivated,
    onDuplicate: duplicateOneNode,
    onExecute: (id: string) => { void testStep(id) },
    onInspect: (id: string) => { onOpenNode?.(id) },
    onMore: (id, event) => {
      setSelectedId(id)
      setSelectedNodeIds([id])
      openContextMenu('node', id, event.clientX, event.clientY)
    },
  }), [
    working,
    nodes,
    deleteNodes,
    toggleNodeDeactivated,
    duplicateOneNode,
    testStep,
    setSelectedId,
    openContextMenu,
    onOpenNode,
  ])

  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-[#fbfbfa] dark:bg-[#1f2937]">
      <div
        ref={canvasRef}
        className={`relative min-h-0 min-w-0 flex-1 overflow-hidden bg-[#fbfbfa] dark:bg-[#1f2937] ${interactionMode === 'hand'
          ? '[&_.react-flow__pane]:!cursor-grab [&_.react-flow__pane.dragging]:!cursor-grabbing [&_.react-flow__nodes]:!pointer-events-none [&_.react-flow__node]:!pointer-events-none [&_.react-flow__edges]:!pointer-events-none [&_.react-flow__edge]:!pointer-events-none [&_.react-flow__edgelabel-renderer]:!pointer-events-none'
          : interactionMode === 'connect'
            ? '[&_.react-flow__pane]:!cursor-crosshair [&_.react-flow__node]:!cursor-crosshair'
            : '[&_.react-flow__pane]:!cursor-default'
        } [&_.react-flow__attribution]:!hidden [&_.react-flow__node]:!border-0 [&_.react-flow__node]:!bg-transparent [&_.react-flow__node]:!shadow-none [&_.react-flow__node]:!overflow-visible [&_.react-flow__handle]:!transition-all [&_.react-flow__handle:hover]:!scale-125 [&_.react-flow__handle-connecting]:!ring-4 [&_.react-flow__handle-connecting]:!ring-violet-200 dark:ring-violet-900/70`}
        onDragOver={event => {
          event.preventDefault()
          event.dataTransfer.dropEffect = 'copy'
        }}
        onDrop={onLibraryDrop}
      >
        <WorkflowManualTriggerExecuteContext.Provider
          value={{
            execute: () => {
              void studio.start()
            },
            disabled: working,
          }}
        >
          <WorkflowQuickAddContext.Provider value={openQuickAdd}>
            <WorkflowNodeToolbarContext.Provider value={nodeToolbarActions}>
              <ReactFlow<CanvasFlowNode, Edge>
                nodes={visualNodes}
                edges={visibleGraphEdges}
                defaultViewport={START_VIEWPORT}
                onMoveEnd={(_, next) => {
                  updateZoomSlider(next.zoom)
                  if (!zoomSliderInteractingRef.current) {
                    setZoom(current => Math.abs(current - next.zoom) < 0.0001 ? current : next.zoom)
                  }
                }}
                minZoom={0.25}
                maxZoom={1.25}
                fitView={false}
                nodeTypes={workflowNodeTypes}
                edgeTypes={workflowEdgeTypes}
                onInit={instance => {
                  flow.current = instance as unknown as ReactFlowInstance<StudioFlowNode, Edge>
                }}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                onConnect={onConnect}
                isValidConnection={connection =>
                  Boolean(
                    connection.source &&
                    connection.target &&
                    !createsCycle(
                      nodes,
                      connection.source,
                      connection.target,
                    ) &&
                    !flowEdges.some(edge =>
                      edge.source === connection.source &&
                      edge.target === connection.target,
                    ) &&
                    (() => {
                      const sourceNode = nodes.find(item => item.id === connection.source)
                      const targetNode = nodes.find(item => item.id === connection.target)
                      if (!sourceNode || !targetNode) return false
                      if (targetNode.type === 'ai.agent' && agentPortTypes.has(connection.targetHandle ?? '')) return true
                      return studio.localTypeDecision(
                        sourceNode.type, targetNode.type, targetNode.settings, sourceNode.settings,
                      ).allowed
                    })(),
                  )
                }
                connectionLineComponent={AnimatedConnectionLine}
                connectionRadius={32}
                onConnectEnd={(event, state) => {
                  if (
                    state.isValid ||
                    !state.fromNode ||
                    state.fromHandle?.type !== 'source'
                  ) return

                  const pointer = 'changedTouches' in event
                    ? event.changedTouches[0]
                    : event

                  const rect = canvasRef.current?.getBoundingClientRect()
                  if (!rect || !pointer) return

                  if (
                    pointer.clientX < rect.left ||
                    pointer.clientX > rect.right ||
                    pointer.clientY < rect.top ||
                    pointer.clientY > rect.bottom
                  ) return

                  const position = flow.current?.screenToFlowPosition({
                    x: pointer.clientX,
                    y: pointer.clientY,
                  })

                  setQuickSearch('')
                  setQuickAdd({
                    sourceId: state.fromNode.id,
                    sourceHandle: state.fromHandle.id ?? 'main',
                    left: Math.max(
                      12,
                      Math.min(
                        pointer.clientX - rect.left + 12,
                        rect.width - 302,
                      ),
                    ),
                    top: Math.max(
                      12,
                      Math.min(
                        pointer.clientY - rect.top - 30,
                        rect.height - 330,
                      ),
                    ),
                    dropPosition: position
                      ? {
                        x: position.x - 80,
                        y: position.y - 50,
                      }
                      : undefined,
                  })
                }}
                nodesDraggable={interactionMode === 'mouse' || interactionMode === 'connect'}
                autoPanOnNodeDrag={false}
                nodesConnectable={interactionMode === 'mouse' || interactionMode === 'connect'}
                elementsSelectable={interactionMode === 'mouse' || interactionMode === 'connect'}
                selectionOnDrag={interactionMode === 'mouse'}
                snapToGrid={snapToGridEnabled}
                snapGrid={[SNAP_STEP, SNAP_STEP]}
                panOnDrag={interactionMode === 'hand'}
                zoomOnScroll={false}
                panOnScroll
                zoomOnPinch
                zoomOnDoubleClick={false}
                deleteKeyCode={null}
                colorMode="light"
                onNodeContextMenu={(event, node) => {
                  event.preventDefault()
                  event.stopPropagation()
                  if (node.id.startsWith(GHOST_PREFIX)) return
                  if (node.id.startsWith(FRAME_PREFIX)) {
                    const frame = frameRects.get(node.id.slice(FRAME_PREFIX.length))
                    setSelectedNodeIds(frame?.ids ?? [])
                    setSelectedId(frame?.ids[0] ?? null)
                    return
                  }
                  setSelectedNodeIds(previous =>
                    previous.includes(node.id) ? previous : [node.id],
                  )
                  setSelectedId(node.id)
                  openContextMenu(
                    'node',
                    node.id,
                    event.clientX,
                    event.clientY,
                  )
                }}
                onPaneContextMenu={event => {
                  event.preventDefault()
                  openContextMenu(
                    'pane',
                    undefined,
                    event.clientX,
                    event.clientY,
                  )
                }}
                onEdgeClick={(_, edge) => {
                  if (edge.id.startsWith(GHOST_EDGE_PREFIX)) return
                  if (interactionMode === 'hand') return
                  closeContextMenu()
                  setSelectedNodeIds([])
                  setSelectedId(null)
                  setSelectedEdges([edge.id])
                }}
                onEdgeDoubleClick={(event, edge) => {
                  if (edge.id.startsWith(GHOST_EDGE_PREFIX)) return
                  if (interactionMode === 'hand') return
                  event.preventDefault()
                  renameEdge(edge.source, edge.target)
                }}
                onEdgeContextMenu={(event, edge) => {
                  if (edge.id.startsWith(GHOST_EDGE_PREFIX)) return
                  event.preventDefault()
                  event.stopPropagation()
                  setSelectedNodeIds([])
                  setSelectedId(null)
                  setSelectedEdges([edge.id])
                  openContextMenu(
                    'edge',
                    edge.id,
                    event.clientX,
                    event.clientY,
                  )
                }}

                onPaneClick={() => {
                  setAlignOpen(false)
                  if (interactionMode === 'connect') setConnectSourceId(null)
                  closeContextMenu()
                  stickyNotesRef.current?.clearSelection()
                  setQuickAdd(null)
                  setSelectedId(null)
                  setSelectedNodeIds([])
                  setSelectedEdges([])
                }}

                onNodeClick={(_, node) => {
                  if (node.id.startsWith(GHOST_PREFIX)) {
                    const ghost = node as GhostFlowNode
                    if (ghost.data.panel) return
                    if (ghost.data.task) {
                      setGhostSelection({
                        originId: ghost.data.originId, originLabel: ghost.data.originLabel,
                        mode: ghost.data.mode, total: ghost.data.total, task: ghost.data.task,
                      })
                    }
                    return
                  }
                  if (interactionMode === 'hand') return
                  if (node.id.startsWith(FRAME_PREFIX)) {
                    const frame = frameRects.get(node.id.slice(FRAME_PREFIX.length))
                    setSelectedNodeIds(frame?.ids ?? [])
                    setSelectedId(frame?.ids[0] ?? null)
                    return
                  }
                  if (interactionMode === 'connect') {
                    if (!connectSourceId) {
                      setConnectSourceId(node.id)
                      setMessage('Connect: click the target node, or drag from a connection handle.')
                      return
                    }
                    if (connectSourceId === node.id) {
                      setConnectSourceId(null)
                      return
                    }
                    const source = nodes.find(item => item.id === connectSourceId)
                    if (!source || createsCycle(nodes, connectSourceId, node.id) ||
                      nodes.find(item => item.id === node.id)?.depends_on.includes(connectSourceId)) {
                      setMessage('Invalid or duplicate connection.')
                      setConnectSourceId(null)
                      return
                    }
                    const targetNode = nodes.find(item => item.id === node.id)
                    onConnect({
                      source: connectSourceId,
                      target: node.id,
                      sourceHandle: source.type === 'flow.if' ? 'true' : 'main',
                      targetHandle: targetNode?.type === 'ai.agent' ? inferredAgentHandle(source.type) : 'input',
                    })
                    // The asynchronous type preflight decides whether this link is committed.
                    setConnectSourceId(null)
                    return
                  }
                  closeContextMenu()
                  if (sidePanelOpen) setInspectorTab('node')
                  stickyNotesRef.current?.clearSelection()
                  setSelectedEdges([])
                  setSelectedId(node.id)
                  setJsonEditor(JSON.stringify(nodes.find(item => item.id === node.id)?.settings ?? {}, null, 2))
                }}
                onNodeDoubleClick={(_, node) => {
                  if (interactionMode !== 'mouse' || node.id.startsWith(FRAME_PREFIX) || node.id.startsWith(GHOST_PREFIX) || Date.now() - draggedAt.current < 250) return

                  setSelectedId(node.id)
                  setJsonEditor(
                    JSON.stringify(
                      nodes.find(item => item.id === node.id)?.settings ?? {},
                      null,
                      2,
                    ),
                  )
                  onOpenNode?.(node.id)
                }}
                onNodeDragStart={(_, node) => {
                  nodeDragActive.current = true
                  setCanvasDragging(true)
                  setDraggingNodeId(node.id)
                  draggedAt.current = Date.now()
                }}
                onNodeDragStop={(_, node) => {
                  draggedAt.current = Date.now()

                  if (node.id.startsWith(GHOST_PREFIX)) return
                  if (node.id.startsWith(FRAME_PREFIX)) {
                    const id = node.id.slice(FRAME_PREFIX.length)
                    const original = frameRects.get(id)
                    if (original) {
                      const dx = node.position.x - original.x
                      const dy = node.position.y - original.y
                      if (dx || dy) setNodes(previous => previous.map(item =>
                        frameIdOf(item) === id && item.settings[pinKey] !== true
                          ? { ...item, position: {
                              x: snap((item.position?.x ?? 80) + dx, snapToGridEnabled),
                              y: snap((item.position?.y ?? 80) + dy, snapToGridEnabled),
                            } }
                          : item))
                    }
                  } else {
                    const positions = new Map<string, Position>()
                    for (const item of flow.current?.getNodes() ?? [node]) {
                      if (item.id.startsWith(FRAME_PREFIX) || item.id.startsWith(GHOST_PREFIX) || (item.id !== node.id && !item.selected)) continue
                      const parentId = item.parentId?.startsWith(FRAME_PREFIX)
                        ? item.parentId.slice(FRAME_PREFIX.length) : null
                      const parent = parentId ? frameRects.get(parentId) : undefined
                      const position = item.id === node.id ? node.position : item.position
                      positions.set(item.id, {
                        x: snap(position.x + (parent?.x ?? 0), snapToGridEnabled),
                        y: snap(position.y + (parent?.y ?? 0), snapToGridEnabled),
                      })
                    }
                    setNodes(previous => previous.map(item => {
                      const position = positions.get(item.id)
                      if (!position || item.settings[pinKey] === true ||
                        (position.x === item.position?.x && position.y === item.position?.y)) return item
                      return { ...item, position }
                    }))
                  }

                  nodeDragActive.current = false
                  setCanvasDragging(false)
                  setDraggingNodeId(null)
                }}
                onEdgesDelete={deleted => {
                  setNodes(previous =>
                    previous.map(node => {
                      const removed = deleted
                        .filter(edge => edge.target === node.id && !edge.id.startsWith(GHOST_EDGE_PREFIX))
                        .map(edge => edge.source)

                      if (!removed.length) return node

                      const handles = handlesFor(node)
                      const labels = edgeLabelsFor(node)
                      const removedBranch = removed.some(source =>
                        /^(true|false)$/.test(handles[source] ?? ''),
                      )

                      removed.forEach(source => {
                        delete handles[source]
                        delete labels[source]
                      })

                      return {
                        ...node,
                        depends_on: node.depends_on.filter(
                          id => !removed.includes(id),
                        ),
                        when:
                          removedBranch &&
                            /^condition_(true|false)$/.test(node.when)
                            ? 'always'
                            : node.when,
                        settings: {
                          ...node.settings,
                          [connectionKey]: handles,
                          [edgeLabelKey]: labels,
                        },
                      }
                    }),
                  )
                }}
                onNodesDelete={deleted => {
                  deleted.filter(node => !node.id.startsWith(GHOST_PREFIX)).forEach(node => removeNode(node.id))
                }}
                fitViewOptions={{
                  padding: 0.32,
                  maxZoom: 0.8,
                }}
              >
                <Background
                  color="#ced4dc"
                  gap={24}
                  size={1.3}
                />
                <CanvasStickyNotes
                  ref={stickyNotesRef}
                  scope={noteScope}
                  zoom={zoom}
                  searchOpen={commandOpen}
                />
                <MiniMap
                  zoomable
                  pannable
                  className="!hidden !rounded-xl !border !border-[#ddd] dark:border-[#374151] !bg-white dark:bg-cl-dark-panel 2xl:!block"
                  nodeColor="#ded8ed"
                />
              </ReactFlow>
              {(interactionMode === 'lasso' || interactionMode === 'frame') &&
                <CanvasGestureOverlay mode={interactionMode} onDone={onCanvasGestureComplete} />}
            </WorkflowNodeToolbarContext.Provider>
          </WorkflowQuickAddContext.Provider>
        </WorkflowManualTriggerExecuteContext.Provider>

        <div
          role="toolbar"
          aria-label="Canvas quick actions"
          className={`nodrag nopan absolute top-1/2 z-[80] -translate-y-1/2 rounded-full border border-[#e3e4e6] dark:border-[#374151] bg-white dark:bg-cl-dark-panel p-2 shadow-[0_5px_22px_#00000012] transition-[right] ${sidePanelOpen ? inspectorExpanded ? 'hidden' : inspectorTab === 'workflow' ? 'right-[528px]' : 'right-[412px]' : 'right-5'}`}
          onPointerDown={event => event.stopPropagation()}
          onDoubleClick={event => event.stopPropagation()}
        >

          <div className="flex flex-col items-center gap-0.5">
            <button
              type="button"
              title="Mouse: select and move nodes (V)"
              aria-label="Mouse: select and move nodes"
              aria-pressed={interactionMode === 'mouse'}
              onClick={() => setInteractionMode('mouse')}
              className={`grid size-9 place-items-center rounded-full transition-colors ${interactionMode === 'mouse'
                ? 'bg-violet-100 text-violet-700 dark:bg-violet-950/60 dark:text-violet-300'
                : 'text-[#202020] dark:text-[#f3f4f6] hover:bg-[#f4f4f5] dark:hover:bg-[#1f2937]'
              }`}
            >
              <MousePointer2 size={20} strokeWidth={2} />
            </button>
            <button
              type="button"
              title="Hand: drag to move canvas (H)"
              aria-label="Hand: move canvas"
              aria-pressed={interactionMode === 'hand'}
              onClick={() => setInteractionMode('hand')}
              className={`grid size-9 place-items-center rounded-full transition-colors ${interactionMode === 'hand'
                ? 'bg-violet-100 text-violet-700 dark:bg-violet-950/60 dark:text-violet-300'
                : 'text-[#202020] dark:text-[#f3f4f6] hover:bg-[#f4f4f5] dark:hover:bg-[#1f2937]'
              }`}
            >
              <Hand size={20} strokeWidth={2} />
            </button>
            <button type="button" title="Lasso: draw a freehand selection (L)" aria-label="Lasso select nodes"
              aria-pressed={interactionMode === 'lasso'} onClick={() => { setInteractionMode('lasso'); setConnectSourceId(null) }}
              className={`grid size-9 place-items-center rounded-full transition-colors ${interactionMode === 'lasso' ? 'bg-violet-100 text-violet-700 dark:bg-violet-950/60 dark:text-violet-300' : 'text-[#202020] dark:text-[#f3f4f6] hover:bg-[#f4f4f5] dark:hover:bg-[#1f2937]'}`}>
              <LassoSelect size={19} strokeWidth={2} />
            </button>
            <button type="button" title={connectSourceId ? 'Connect: choose target (Esc cancels)' : 'Connect: click a source then a target (C)'}
              aria-label="Connect nodes" aria-pressed={interactionMode === 'connect'}
              onClick={() => { setInteractionMode('connect'); setConnectSourceId(null) }}
              className={`relative grid size-9 place-items-center rounded-full transition-colors ${interactionMode === 'connect' ? 'bg-violet-100 text-violet-700 dark:bg-violet-950/60 dark:text-violet-300' : 'text-[#202020] dark:text-[#f3f4f6] hover:bg-[#f4f4f5] dark:hover:bg-[#1f2937]'}`}>
              <GitBranch size={19} strokeWidth={2} />
              {connectSourceId && <span className="absolute right-0 top-0 size-2 rounded-full bg-violet-500" />}
            </button>
            <button type="button" title={selectedNodeIds.length ? 'Group selected nodes in a frame (F)' : 'Frame: draw around nodes (F)'}
              aria-label="Create frame or group" aria-pressed={interactionMode === 'frame'}
              onClick={() => {
                setConnectSourceId(null)
                if (selectedNodeIds.length) createFrame(selectedNodeIds)
                else setInteractionMode('frame')
              }}
              className={`grid size-9 place-items-center rounded-full transition-colors ${interactionMode === 'frame' ? 'bg-violet-100 text-violet-700 dark:bg-violet-950/60 dark:text-violet-300' : 'text-[#202020] dark:text-[#f3f4f6] hover:bg-[#f4f4f5] dark:hover:bg-[#1f2937]'}`}>
              <Frame size={19} strokeWidth={2} />
            </button>
            <button type="button" title="Snap nodes to grid (G)" aria-label="Toggle snap to grid" aria-pressed={snapToGridEnabled}
              onClick={() => setSnapToGridEnabled(previous => !previous)}
              className={`grid size-9 place-items-center rounded-full transition-colors ${snapToGridEnabled ? 'bg-violet-100 text-violet-700 dark:bg-violet-950/60 dark:text-violet-300' : 'text-[#202020] dark:text-[#f3f4f6] hover:bg-[#f4f4f5] dark:hover:bg-[#1f2937]'}`}>
              <Magnet size={19} strokeWidth={2} />
            </button>
            <button type="button" title="Align and distribute selected nodes" aria-label="Align and distribute" aria-expanded={alignOpen}
              onClick={() => setAlignOpen(previous => !previous)}
              className={`grid size-9 place-items-center rounded-full transition-colors ${alignOpen ? 'bg-violet-100 text-violet-700 dark:bg-violet-950/60 dark:text-violet-300' : 'text-[#202020] dark:text-[#f3f4f6] hover:bg-[#f4f4f5] dark:hover:bg-[#1f2937]'}`}>
              <AlignCenterHorizontal size={19} strokeWidth={2} />
            </button>
            <span aria-hidden="true" className="my-1 h-px w-6 bg-[#ededee] dark:bg-[#374151]" />
            <button
              type="button"
              title={libraryOpen ? 'Close Add Node' : 'Add Node'}
              aria-label={libraryOpen ? 'Close Add Node' : 'Add Node'}
              aria-pressed={libraryOpen}
              onClick={() => {
                if (libraryOpen) setLibraryOpen(false)
                else showToolLibrary()
              }}
              className={`grid size-9 place-items-center rounded-full hover:bg-[#f4f4f5] dark:hover:bg-[#1f2937] ${libraryOpen ? 'text-violet-600 dark:text-violet-300' : 'text-[#202020] dark:text-[#f3f4f6]'
                }`}
            >
              <Plus size={22} strokeWidth={2} />
            </button>

            <button
              type="button"
              title="Search canvas (Ctrl+K)"
              aria-label="Search canvas"
              onClick={() => {
                setCommandOpen(true)
                setCommandQuery('')
                setCommandTab('all')
                setCommandIndex(0)
              }}
              className="grid size-9 place-items-center rounded-full text-[#202020] dark:text-[#f3f4f6] hover:bg-[#f4f4f5] dark:hover:bg-[#1f2937]"
            >
              <Search size={20} strokeWidth={2} />
            </button>

            <button
              type="button"
              title="View entire workflow JSON"
              aria-label="View workflow JSON"
              onClick={() => { setSidePanelOpen(true); setInspectorTab('workflow'); setWorkflowSection('json') }}
              className="grid size-9 place-items-center rounded-full text-[#202020] hover:bg-[#f4f4f5] dark:text-[#f3f4f6] dark:hover:bg-[#1f2937]"
            >
              <Braces size={20} strokeWidth={2} />
            </button>

            <button
              type="button"
              title="Add sticky note (Shift+S)"
              aria-label="Add sticky note"
              onClick={addStickyNote}
              className="grid size-9 place-items-center rounded-full text-[#202020] dark:text-[#f3f4f6] hover:bg-[#f4f4f5] dark:hover:bg-[#1f2937]"
            >
              <StickyNote size={20} strokeWidth={2} />
            </button>

            <button
              type="button"
              title={sidePanelOpen ? 'Close side panel' : 'Open side panel'}
              aria-label={sidePanelOpen ? 'Close side panel' : 'Open side panel'}
              aria-pressed={sidePanelOpen}
              onClick={() => {
                if (sidePanelOpen && inspectorEditing && !window.confirm('Close Inspector and discard the un-applied JSON draft?')) return
                if (!sidePanelOpen) setInspectorTab(selectedId ? 'node' : 'workflow')
                if (sidePanelOpen) setInspectorEditing(false)
                setSidePanelOpen(value => !value)
              }}
              className={`grid size-9 place-items-center rounded-full hover:bg-[#f4f4f5] dark:hover:bg-[#1f2937] ${sidePanelOpen ? 'text-violet-600 dark:text-violet-300' : 'text-[#202020] dark:text-[#f3f4f6]'
                }`}
            >
              <PanelRight size={20} strokeWidth={2} />
            </button>

            <button
              type="button"
              title="Tidy up workflow"
              aria-label="Tidy up workflow"
              disabled={!nodes.length || working}
              onClick={tidyWorkflow}
              className="grid size-9 place-items-center rounded-full text-[#202020] dark:text-[#f3f4f6] hover:bg-[#f4f4f5] dark:hover:bg-[#1f2937] disabled:opacity-35"
            >
              <Sparkles size={20} strokeWidth={2} />
            </button>
          </div>
          {alignOpen && <div role="menu" aria-label="Align and distribute nodes"
            className="absolute right-[calc(100%+12px)] top-1/2 z-[90] w-[205px] -translate-y-1/2 rounded-xl border border-[#e7e7ec] bg-white p-1.5 shadow-xl dark:border-[#374151] dark:bg-[#242832]">
            {([
              ['left', 'Align left', AlignLeft],
              ['centerX', 'Align center horizontally', AlignCenterHorizontal],
              ['right', 'Align right', AlignRight],
              ['top', 'Align top', AlignStartVertical],
              ['centerY', 'Align center vertically', AlignCenterVertical],
              ['bottom', 'Align bottom', AlignEndVertical],
              ['distributeX', 'Distribute horizontally', AlignHorizontalDistributeCenter],
              ['distributeY', 'Distribute vertically', AlignVerticalDistributeCenter],
            ] as const).map(([action, title, Icon]) => <button key={action}
              type="button" role="menuitem" onClick={() => alignSelected(action)}
              className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[11px] text-[#34343a] hover:bg-violet-50 dark:text-[#e8e8ec] dark:hover:bg-[#374151]">
              <Icon size={15} className="shrink-0 text-violet-600 dark:text-violet-300" />{title}
            </button>)}
          </div>}

        </div>

        {sidePanelOpen && (
          <aside
            aria-label="Workflow inspector side panel"
            className={`nodrag nopan absolute inset-y-0 right-0 z-[75] flex max-w-[calc(100%-90px)] flex-col border-l border-[#e5e5e7] bg-white shadow-[-8px_0_28px_rgba(0,0,0,0.06)] transition-[width] duration-150 dark:border-[#374151] dark:bg-cl-dark-panel ${inspectorExpanded ? 'w-[920px]' : inspectorTab === 'workflow' ? 'w-[508px]' : 'w-[392px]'}`}
            onPointerDown={event => event.stopPropagation()}
            style={{ maxWidth: 'calc(100% - 90px)' }}
          >
            <div className="flex h-14 shrink-0 items-center justify-between border-b border-[#eeeeef] px-4 dark:border-[#374151]">
              <h2 className="text-[16px] font-semibold text-[#252525] dark:text-white">Inspector</h2>
              <div className="flex items-center gap-1">
                <button type="button" title={inspectorExpanded ? 'Restore inspector width' : 'Expand inspector'}
                  aria-label={inspectorExpanded ? 'Restore inspector width' : 'Expand inspector'}
                  onClick={() => setInspectorExpanded(value => !value)}
                  className="grid size-8 place-items-center rounded-lg text-[#666] hover:bg-[#f5f5f5] dark:text-[#b8bec7] dark:hover:bg-[#303744]">
                  {inspectorExpanded ? <Minimize2 size={17}/> : <Maximize2 size={17}/>}
                </button>
                <button type="button" title="Close inspector" aria-label="Close inspector"
                  onClick={() => {
                    if (inspectorEditing && !window.confirm('Close Inspector and discard the un-applied JSON draft?')) return
                    setSidePanelOpen(false)
                    setInspectorEditing(false)
                  }}
                  className="grid size-8 place-items-center rounded-lg text-[#666] hover:bg-[#f5f5f5] dark:text-[#b8bec7] dark:hover:bg-[#303744]">
                  <X size={19}/>
                </button>
              </div>
            </div>
            <div role="tablist" aria-label="Inspector view" className="grid shrink-0 grid-cols-2 gap-1 border-b border-[#eeeef0] p-2 dark:border-[#374151]">
              <button role="tab" type="button" aria-selected={inspectorTab === 'node'}
                onClick={() => setInspectorTab('node')}
                className={`rounded-lg px-3 py-2 text-[12px] font-semibold transition-colors ${inspectorTab === 'node'
                  ? 'bg-violet-50 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300'
                  : 'text-[#737782] hover:bg-[#f5f5f6] dark:text-[#b8bec7] dark:hover:bg-[#303744]'}`}>
                Node Details
              </button>
              <button role="tab" type="button" aria-selected={inspectorTab === 'workflow'}
                onClick={() => setInspectorTab('workflow')}
                className={`rounded-lg px-3 py-2 text-[12px] font-semibold transition-colors ${inspectorTab === 'workflow'
                  ? 'bg-violet-50 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300'
                  : 'text-[#737782] hover:bg-[#f5f5f6] dark:text-[#b8bec7] dark:hover:bg-[#303744]'}`}>
                Workflow Details
              </button>
            </div>
            {inspectorTab === 'node' ? (
              <div className="flex min-h-0 flex-1 flex-col overflow-y-auto [scrollbar-width:thin]">
            {selectedSideNode ? (
              <>
                <div className="flex items-center gap-3 border-b border-[#efeff0] dark:border-[#374151] px-5 py-4">
                  <span className="grid size-10 shrink-0 place-items-center">
                    <WorkflowToolIcon type={selectedSideNode.type} size={32} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-[#252525] dark:text-[#f3f4f6]">
                      {selectedSideMeta?.label ?? selectedSideNode.type}
                    </p>
                    <p className="mt-1 truncate text-xs text-[#4b5563] dark:text-[#999]">
                      {selectedSideStatus || 'Not executed'} · {selectedSideNode.type}
                    </p>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2 border-b border-[#efeff0] px-4 py-3 text-[11px] dark:border-[#374151]">
                  <div className="min-w-0"><p className="text-[#8b8e99]">Node ID</p><p className="mt-1 truncate font-mono text-[#42444c] dark:text-white" title={selectedSideNode.id}>{selectedSideNode.id}</p></div>
                  <div className="min-w-0"><p className="text-[#8b8e99]">Depends on</p><p className="mt-1 font-semibold text-[#42444c] dark:text-white">{selectedSideNode.depends_on.length} node(s)</p></div>
                  <div className="min-w-0"><p className="text-[#8b8e99]">Downstream</p><p className="mt-1 font-semibold text-[#42444c] dark:text-white">{nodes.filter(node => node.depends_on.includes(selectedSideNode.id)).length} node(s)</p></div>
                  <div className="min-w-0"><p className="text-[#8b8e99]">Position</p><p className="mt-1 font-mono text-[#42444c] dark:text-white">{Math.round(selectedSideNode.position?.x ?? 0)}, {Math.round(selectedSideNode.position?.y ?? 0)}</p></div>
                </div>
                <div className="flex flex-wrap gap-2 border-b border-[#efeff0] dark:border-[#374151] px-5 py-3">
                  <button
                    type="button"
                    disabled={working}
                    onClick={() => void testStep(selectedSideNode.id)}
                    className="inline-flex items-center gap-2 rounded-lg bg-[#f8fafc] dark:bg-[#242424] px-3 py-2 text-xs font-semibold text-gray-900 dark:text-white disabled:opacity-40"
                  >
                    <Play size={14} /> Execute step
                  </button>
                  <button
                    type="button"
                    disabled={!onOpenNode}
                    onClick={() => onOpenNode?.(selectedSideNode.id)}
                    className="inline-flex items-center gap-2 rounded-lg border border-[#dedee2] dark:border-[#374151] px-3 py-2 text-xs font-semibold text-[#333] dark:text-[#f3f4f6] hover:bg-[#f7f7f7] dark:hover:bg-[#1f2937] disabled:opacity-40"
                  >
                    <ExternalLink size={14} /> Open editor
                  </button>
                </div>
                <div className="flex min-h-0 flex-1 flex-col gap-3 p-5">
                  <label htmlFor="ws-side-settings" className="text-sm font-semibold text-[#27272a] dark:text-[#f3f4f6]">
                    Settings (JSON)
                  </label>
                  <p className="text-xs leading-5 text-[#85858d] dark:text-[#b8bec7]">
                    Edit this node's saved settings. Credentials and other settings remain linked to the node.
                  </p>
                  <textarea
                    id="ws-side-settings"
                    spellCheck={false}
                    value={sideSettingsDraft}
                    onChange={event => {
                      setSideSettingsDraft(event.target.value)
                      setSideSettingsError('')
                    }}
                    className="min-h-40 flex-1 resize-none rounded-xl border border-[#dfdfe4] dark:border-[#374151] bg-[#fafafa] dark:bg-[#1f2937] p-3 font-mono text-[12px] leading-5 text-[#222] dark:text-[#f3f4f6] outline-none focus:border-violet-400"
                  />
                  {sideSettingsError && <p role="alert" className="text-xs text-red-600 dark:text-red-300">{sideSettingsError}</p>}
                  <button
                    type="button"
                    disabled={working}
                    onClick={saveSideSettings}
                    className="self-end rounded-lg bg-[#f8fafc] dark:bg-[#252525] px-4 py-2 text-xs font-semibold text-gray-900 dark:text-white disabled:opacity-40"
                  >
                    Apply settings
                  </button>
                  <button type="button" aria-expanded={fullNodeJsonOpen} onClick={() => setFullNodeJsonOpen(value => !value)}
                    className="flex items-center justify-between rounded-lg border border-[#e5e5ea] px-3 py-2 text-[12px] font-semibold text-[#444753] hover:bg-[#f7f7f9] dark:border-[#374151] dark:text-white dark:hover:bg-[#303744]">
                    <span className="inline-flex items-center gap-2"><Braces size={15}/> Full Node JSON (read only)</span>
                    <ChevronRight size={15} className={fullNodeJsonOpen ? 'rotate-90' : ''}/>
                  </button>
                  {fullNodeJsonOpen && <textarea readOnly spellCheck={false}
                    aria-label="Complete selected node JSON" value={JSON.stringify(selectedSideNode, null, 2)}
                    className="min-h-[180px] w-full resize-y rounded-lg border border-[#e5e5ea] bg-[#fafafa] p-3 font-mono text-[11px] leading-5 text-[#333743] outline-none dark:border-[#374151] dark:bg-[#1b2430] dark:text-white"/>}
                </div>
              </>
            ) : (
              <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center text-[#888] dark:text-[#b8bec7]">
                <PanelRight size={35} strokeWidth={1.5} />
                <p className="text-sm font-medium text-[#454545] dark:text-[#b8bec7]">Select a node to inspect it</p>
                <p className="text-xs leading-5">Click a node on the canvas to see its settings here.</p>
              </div>
            )}
              </div>
            ) : null}
            <div className={inspectorTab === 'workflow' ? 'flex min-h-0 flex-1 flex-col' : 'hidden'}>
              <WorkflowDetailsContent
                studio={studio}
                section={workflowSection}
                onSectionChange={setWorkflowSection}
                onEditingChange={setInspectorEditing}
                onApplyDefinition={definition => {
                  const available = new Set(definition.nodes.map(node => node.id))
                  studio.setName(definition.name)
                  setNodes(definition.nodes)
                  if (selectedId && !available.has(selectedId)) {
                    setSelectedId(null)
                    setSelectedNodeIds([])
                    setSelectedEdges([])
                  } else {
                    setSelectedNodeIds(previous => previous.filter(id => available.has(id)))
                  }
                  setMessage('Workflow JSON applied to canvas. Changes can be autosaved.')
                }}
                onSelectNode={id => {
                  setSelectedId(id)
                  setSelectedNodeIds([id])
                  setSelectedEdges([])
                  setInspectorTab('node')
                }}
              />
            </div>
          </aside>
        )}

        {commandOpen && createPortal(
          <div
            className="nodrag nopan fixed inset-0 z-[9999] flex items-center justify-center bg-[#f8fafc]/35 dark:bg-[#171717]/35 px-4 py-6 backdrop-blur-[3px]"
            onPointerDown={event => event.stopPropagation()}
            onClick={() => setCommandOpen(false)}
          >
            <div
              role="dialog"
              aria-modal="true"
              aria-label="Search CLIPTORA"
              className="flex max-h-[min(690px,calc(100dvh-36px))] w-full max-w-[850px] flex-col overflow-hidden rounded-[20px] border border-[#e8e8e8] dark:border-[#374151] bg-white dark:bg-cl-dark-panel shadow-[0_18px_65px_rgba(0,0,0,0.22)]"
              onClick={event => event.stopPropagation()}
              onPointerDown={event => event.stopPropagation()}
            >
              <div className="flex items-center gap-3 px-5 py-4">
                <Search size={22} className="shrink-0 text-[#4b5563] dark:text-[#999]" />
                <input
                  autoFocus
                  type="search"
                  value={commandQuery}
                  onChange={event => {
                    setCommandQuery(event.target.value)
                    setCommandIndex(0)
                  }}
                  placeholder="Type a command or search..."
                  className="min-w-0 flex-1 text-[17px] text-[#242424] dark:text-[#f3f4f6] outline-none placeholder:text-[#4b5563] dark:placeholder:text-[#999]"
                  onKeyDown={event => {
                    if (event.key === 'Escape') setCommandOpen(false)
                    if (event.key === 'ArrowDown') {
                      event.preventDefault()
                      setCommandIndex(value => Math.min(searchEntries.length - 1, value + 1))
                    }
                    if (event.key === 'ArrowUp') {
                      event.preventDefault()
                      setCommandIndex(value => Math.max(0, value - 1))
                    }
                    if (event.key === 'Enter' && searchEntries[commandIndex]) {
                      event.preventDefault()
                      selectSearchEntry(searchEntries[commandIndex])
                    }
                  }}
                />
                <button
                  type="button"
                  title="Close search"
                  aria-label="Close search"
                  className="rounded-lg p-1 text-[#777] dark:text-[#b8bec7] hover:bg-[#f5f5f5] dark:hover:bg-[#1f2937]"
                  onClick={() => setCommandOpen(false)}
                >
                  <X size={22} />
                </button>
              </div>
              <div className="flex shrink-0 gap-1 border-b border-[#ebebec] dark:border-[#374151] px-4 pb-2">
                {(['all', 'nodes', 'workflows', 'actions'] as const).map(tab => (
                  <button
                    key={tab}
                    type="button"
                    onClick={() => {
                      setCommandTab(tab)
                      setCommandIndex(0)
                    }}
                    className={`rounded-lg px-3 py-2 text-[13px] capitalize ${commandTab === tab
                      ? 'bg-[#ececed] dark:bg-[#1f2937] font-semibold text-[#222] dark:text-[#f3f4f6]'
                      : 'text-[#555] dark:text-[#b8bec7] hover:bg-[#f7f7f7] dark:hover:bg-[#1f2937]'}`}
                  >
                    {tab}
                  </button>
                ))}
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto p-3 [scrollbar-width:thin]">
                <p className="px-3 pb-2 pt-1 text-[12px] text-[#4b5563] dark:text-[#999]">
                  {commandQuery.trim() ? `${searchEntries.length} matching results` : 'Suggestions'}
                </p>
                {searchEntries.map((entry, index) => (
                  <button
                    key={entry.key}
                    type="button"
                    disabled={working || (entry.kind !== 'workflow' && nodes.length >= 100)}
                    onMouseEnter={() => setCommandIndex(index)}
                    onClick={() => selectSearchEntry(entry)}
                    className={`flex w-full items-center gap-3 rounded-xl px-4 py-3 text-left disabled:opacity-40 ${commandIndex === index ? 'bg-[#f2f2f2] dark:bg-[#1f2937]' : 'hover:bg-[#f7f7f7] dark:hover:bg-[#1f2937]'}`}
                  >
                    <span className="grid size-7 shrink-0 place-items-center text-[#777] dark:text-[#b8bec7]">
                      {entry.kind === 'workflow'
                        ? <WorkflowIcon size={20} />
                        : entry.nodeType
                          ? <WorkflowToolIcon type={entry.nodeType} actionId={entry.actionId} size={22} />
                          : <Search size={19} />}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[14px] font-medium text-[#282828] dark:text-[#f3f4f6]">
                      {entry.label}
                    </span>
                    <span className="max-w-[38%] truncate text-xs text-[#888] dark:text-[#b8bec7]">
                      {entry.detail}
                    </span>
                    <ChevronRight size={16} className="text-[#4b5563] dark:text-[#bbb]" />
                  </button>
                ))}
                {!searchEntries.length && (
                  <p className="px-4 py-10 text-center text-sm text-[#4b5563] dark:text-[#999]">No matching results.</p>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-4 border-t border-[#ededed] dark:border-[#374151] px-5 py-3 text-xs text-[#888] dark:text-[#b8bec7]">
                <span>Close <kbd className="rounded bg-[#f3f3f3] dark:bg-[#1f2937] px-1.5 py-1">Esc</kbd></span>
                <span>Navigate <kbd className="rounded bg-[#f3f3f3] dark:bg-[#1f2937] px-1.5 py-1">↑ ↓</kbd></span>
                <span>Open <kbd className="rounded bg-[#f3f3f3] dark:bg-[#1f2937] px-1.5 py-1">Enter</kbd></span>
              </div>
            </div>
          </div>,
          document.body,
        )}

        <div className="nodrag nopan absolute bottom-5 left-4 z-[70] flex items-center gap-2">
          <div
            role="toolbar"
            aria-label="Canvas controls"
            className="flex items-center gap-2 rounded-full border border-[#e3e4e6] dark:border-[#374151] bg-white dark:bg-cl-dark-panel px-3 py-2 shadow-[0_5px_22px_#00000012]"
            onPointerDown={event => event.stopPropagation()}
          >
            <button
              type="button"
              className="grid place-items-center rounded-full text-[#191919] dark:text-[#f3f4f6] transition-colors hover:bg-[#f4f4f5] dark:hover:bg-[#1f2937]"
              title="Fit workflow to view"
              aria-label="Fit workflow to view"
              onClick={() => {
                if (nodes.length) {
                  void flow.current?.fitView({
                    nodes: nodes.map(node => ({ id: node.id })),
                    padding: 0.25,
                    maxZoom: 1,
                    duration: 250,
                  })
                } else {
                  void flow.current?.setViewport(START_VIEWPORT, {
                    duration: 250,
                  })
                }
              }}
            >
              <Scan size={18} strokeWidth={2.5} />
            </button>

            <button
              type="button"
              className="grid place-items-center rounded-full text-[#191919] dark:text-[#f3f4f6] transition-colors hover:bg-[#f4f4f5] dark:hover:bg-[#1f2937] disabled:opacity-30"
              title="Zoom in"
              aria-label="Zoom in"
              disabled={zoom >= 1.25}
              onClick={() => {
                void flow.current?.zoomIn({ duration: 170 })
              }}
            >
              <ZoomIn size={18} strokeWidth={2.4} />
            </button>

            <button
              type="button"
              className="grid place-items-center rounded-full text-[#191919] dark:text-[#f3f4f6] transition-colors hover:bg-[#f4f4f5] dark:hover:bg-[#1f2937] disabled:opacity-30"
              title="Zoom out"
              aria-label="Zoom out"
              disabled={zoom <= 0.25}
              onClick={() => {
                void flow.current?.zoomOut({ duration: 170 })
              }}
            >
              <ZoomOut size={18} strokeWidth={2.4} />
            </button>

            <div className="flex items-center gap-2 border-l border-[#e5e7eb] pl-2 dark:border-[#374151]">
              <input
                ref={zoomSliderRef}
                type="range"
                min={25}
                max={125}
                step={1}
                defaultValue={Math.round(START_VIEWPORT.zoom * 100)}
                aria-label="Canvas zoom level"
                title="Drag to adjust zoom"
                className="nodrag nopan nowheel h-5 w-24 cursor-pointer accent-violet-600 sm:w-32"
                onPointerDown={() => { zoomSliderInteractingRef.current = true }}
                onPointerUp={commitZoomSlider}
                onPointerCancel={commitZoomSlider}
                onLostPointerCapture={commitZoomSlider}
                onKeyUp={commitZoomSlider}
                onBlur={commitZoomSlider}
                onChange={event => {
                  zoomSliderInteractingRef.current = true
                  const nextZoom = Number(event.currentTarget.value) / 100
                  updateZoomSlider(nextZoom)
                  void flow.current?.zoomTo(nextZoom, { duration: 0 })
                }}
              />
              <span
                ref={zoomLabelRef}
                className="w-10 select-none text-right text-[11px] font-semibold tabular-nums text-[#626771] dark:text-[#b8bec7]"
                aria-label="Current canvas zoom"
              >
                {Math.round(zoom * 100)}%
              </span>
            </div>

            <button
              type="button"
              className="grid place-items-center rounded-full text-[#191919] dark:text-[#f3f4f6] transition-colors hover:bg-[#f4f4f5] dark:hover:bg-[#1f2937] disabled:opacity-30"
              title="Tidy up workflow"
              aria-label="Tidy up workflow"
              disabled={!nodes.length || working}
              onClick={tidyWorkflow}
            >
              <Paintbrush size={18} strokeWidth={2.4} />
            </button>
          </div>

          <button
            type="button"
            className="grid place-items-center rounded-full border border-[#e3e4e6] dark:border-[#374151] bg-white dark:bg-cl-dark-panel text-[#27272a] dark:text-[#f3f4f6] shadow-[0_5px_22px_#00000012] transition-colors hover:bg-[#f4f4f5] dark:hover:bg-[#1f2937]"
            title={
              bottomOpen
                ? 'Hide execution preview'
                : 'Show execution preview'
            }
            aria-label={
              bottomOpen
                ? 'Hide execution preview'
                : 'Show execution preview'
            }
            aria-expanded={bottomOpen}
            onClick={() => setBottomOpen(value => !value)}
          >
            {bottomOpen
              ? <PanelBottomClose size={18} />
              : <PanelBottom size={18} />}
          </button>
        </div>

        {contextMenu && (
          <WorkflowContextMenu
            x={contextMenu.clientX}
            y={contextMenu.clientY}
            actions={contextActions}
            onClose={closeContextMenu}
          />
        )}

        {renameDraft && (
          <div className="absolute inset-0 z-[105] flex items-center justify-center bg-[#00000040] px-4">
            <form
              onSubmit={renameNode}
              className="w-full max-w-[370px] rounded-xl border border-[#e4e4e5] dark:border-[#374151] bg-white dark:bg-cl-dark-panel p-5 shadow-xl"
            >
              <h3 className="font-semibold text-[#202020] dark:text-[#f3f4f6]">
                Rename node
              </h3>

              <input
                autoFocus
                value={renameDraft.value}
                maxLength={100}
                onChange={event =>
                  setRenameDraft(previous =>
                    previous
                      ? { ...previous, value: event.target.value }
                      : null,
                  )
                }
                onKeyDown={event => {
                  if (event.key === 'Escape') {
                    event.stopPropagation()
                    setRenameDraft(null)
                  }
                }}
                className="mt-4 h-11 w-full rounded-lg border border-violet-300 dark:border-violet-900/70 px-3 text-sm text-[#222] dark:text-[#f3f4f6] outline-none"
              />

              <div className="mt-4 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setRenameDraft(null)}
                  className={btn}
                >
                  Cancel
                </button>

                <button
                  type="submit"
                  disabled={!renameDraft.value.trim()}
                  className="rounded-lg bg-[#f8fafc] dark:bg-[#252525] px-4 py-2 text-sm text-gray-900 dark:text-white disabled:opacity-50"
                >
                  Rename
                </button>
              </div>
            </form>
          </div>
        )}

        {edgeRenameDraft && (
          <div className="absolute inset-0 z-[106] flex items-center justify-center bg-[#00000040] px-4">
            <form
              onSubmit={submitEdgeRename}
              className="w-full max-w-[370px] rounded-xl border border-[#e4e4e5] dark:border-[#374151] bg-white dark:bg-cl-dark-panel p-5 shadow-xl"
            >
              <h3 className="font-semibold text-[#202020] dark:text-[#f3f4f6]">
                Connection label
              </h3>

              <p className="mt-1 text-xs text-[#858585] dark:text-[#b8bec7]">
                Visual label only. Routing conditions stay unchanged.
              </p>

              <input
                autoFocus
                value={edgeRenameDraft.value}
                maxLength={50}
                onChange={event =>
                  setEdgeRenameDraft(previous =>
                    previous
                      ? { ...previous, value: event.target.value }
                      : null,
                  )
                }
                onKeyDown={event => {
                  if (event.key === 'Escape') {
                    event.stopPropagation()
                    setEdgeRenameDraft(null)
                  }
                }}
                placeholder="true, false, success, error..."
                className="mt-4 h-11 w-full rounded-lg border border-violet-300 dark:border-violet-900/70 px-3 text-sm text-[#222] dark:text-[#f3f4f6] outline-none"
              />

              <div className="mt-4 flex justify-end gap-2">
                <button
                  type="button"
                  className={btn}
                  onClick={() => setEdgeRenameDraft(null)}
                >
                  Cancel
                </button>

                <button
                  type="submit"
                  className="rounded-lg bg-[#f8fafc] dark:bg-[#252525] px-4 py-2 text-sm text-gray-900 dark:text-white"
                >
                  Save label
                </button>
              </div>
            </form>
          </div>
        )}

        {quickAdd && (
          <div
            role="dialog"
            aria-label="Add next node"
            className="absolute z-[60] w-[560px] max-w-[calc(100vw-32px)] overflow-hidden rounded-[22px] border border-[#dddddf] dark:border-[#374151] bg-white dark:bg-cl-dark-panel shadow-[0_14px_44px_rgba(0,0,0,0.12)]"
            style={{
              left: quickAdd.left,
              top: quickAdd.top,
              maxHeight: 'min(calc(100vh - 32px), calc(100dvh - 32px))',
            }}
            onPointerDown={event => event.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-[#ededed] dark:border-[#374151] px-3 py-2.5">
              <strong className="text-sm font-semibold text-[#222] dark:text-[#f3f4f6]">
                {quickAdd.mode === 'replace'
                  ? 'Replace node'
                  : quickAdd.mode === 'insert'
                    ? 'Insert node on connection'
                    : agentPortTypes.has(quickAdd.sourceHandle) ? `Add ${quickAdd.sourceHandle.replace('_', ' ')}` : 'What happens next?'}
              </strong>

              <button
                type="button"
                className="rounded p-1 text-[#777] dark:text-[#b8bec7] hover:bg-[#eee] dark:hover:bg-[#1f2937]"
                onClick={() => setQuickAdd(null)}
                aria-label="Close"
              >
                <X size={17} />
              </button>
            </div>

            <label className="mx-3 mt-3 flex items-center gap-2 rounded-lg border border-violet-300 dark:border-violet-900/70 px-3 py-2 text-[#777] dark:text-[#b8bec7]">
              <Search size={17} />

              <input
                autoFocus
                value={quickSearch}
                onChange={event => setQuickSearch(event.target.value)}
                placeholder="Search executable nodes..."
                className="min-w-0 flex-1 bg-transparent text-[13px] text-[#222] dark:text-[#f3f4f6] outline-none"
              />
            </label>

            <div className="mt-2 overflow-y-auto pb-2">
              {quickItems.length ? (
                quickItems.map(item => (
                  <button
                    key={item.type}
                    type="button"
                    onClick={() => addAfter(item.type)}
                    className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-[#f7f5fa] dark:hover:bg-[#1f2937]"
                  >
                    <span className="grid size-7 shrink-0 place-items-center">
                      <WorkflowToolIcon
                        type={item.type}
                        label={item.label}
                        size={24}
                      />
                    </span>

                    <span className="min-w-0 flex-1">
                      <strong className="block truncate text-[13px] font-medium text-[#222] dark:text-[#f3f4f6]">
                        {item.label}
                      </strong>

                      <span className="block truncate text-[11px] text-[#858585] dark:text-[#b8bec7]">
                        {item.group}
                      </span>
                    </span>

                    <Plus size={15} className="text-[#4b5563] dark:text-[#aaa]" />
                  </button>
                ))
              ) : (
                <p className="px-4 py-4 text-[13px] text-[#777] dark:text-[#b8bec7]">
                  No available nodes found.
                </p>
              )}
            </div>
          </div>
        )}

        {studio.liveLoopView && (
          <div className="pointer-events-none absolute left-4 top-4 z-[60] max-w-[345px] rounded-xl border border-violet-200 bg-white/95 px-3 py-2 text-[11px] leading-4 text-slate-700 shadow-sm backdrop-blur-sm dark:border-violet-900 dark:bg-slate-900/95 dark:text-slate-200">
            <span className="font-semibold text-violet-700 dark:text-violet-300">Live loop enabled</span>
            <span className="ml-1.5 text-slate-500 dark:text-slate-400">
              {studio.run ? `Run #${studio.run.id} · ${studio.run.state}` : 'No run selected'}
            </span>
            <p className="mt-1 text-slate-600 dark:text-slate-300">
              {ghostNodes.length
                ? `${ghostNodes.filter(node => Boolean(node.data.task) && node.data.task.state !== 'recorded').length} traced tasks and ${ghostNodes.filter(node => node.data.task?.state === 'recorded').length} output records visible. Filters and pagination are below each parent.`
                : studio.run?.state === 'running' || studio.run?.state === 'queued'
                  ? 'Waiting for a node to report individual tasks. Normal progress is still available.'
                  : studio.run
                    ? 'This run has no individual task trace. Start a new execution to see live transitions.'
                    : 'Start a workflow run to see its real execution tasks.'}
            </p>
            {ghostNodes.some(node => node.data.task?.state === 'recorded') && (
              <p className="mt-1 text-[10px] text-violet-600 dark:text-violet-300">
                Dashed output shadows are collection entries, not separately executed tasks.
              </p>
            )}
          </div>
        )}

        {studio.liveLoopView && currentGhostSelection && (
          <GhostExecutionDetails
            selection={currentGhostSelection}
            projectId={studio.projectId}
            runId={studio.run?.id ?? null}
            onClose={() => setGhostSelection(null)}
          />
        )}

        {!nodes.length && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center px-6">
            <div className="pointer-events-auto max-w-[300px] rounded-2xl border border-[#e7e7e7] dark:border-[#374151] bg-white dark:bg-cl-dark-panel px-6 py-7 text-center shadow-sm">
              <div className="mx-auto mb-4 grid size-12 place-items-center rounded-xl border border-violet-200 dark:border-violet-900/70 bg-violet-50 dark:bg-violet-950/40 text-violet-700 dark:text-violet-300">
                <Plus size={22} />
              </div>

              <h2 className="text-sm font-semibold text-[#252525] dark:text-[#f3f4f6]">
                Start your workflow
              </h2>

              <p className="mt-2 text-xs leading-5 text-[#858585] dark:text-[#b8bec7]">
                Choose a tool from the sidebar or drag one onto the canvas.
              </p>

              <button
                type="button"
                onClick={showToolLibrary}
                className="mt-4 inline-flex items-center gap-2 rounded-lg bg-[#f8fafc] dark:bg-[#222] px-4 py-2 text-xs font-semibold text-gray-900 dark:text-white"
              >
                <Plus size={15} />
                Add first tool
              </button>
            </div>
          </div>
        )}
      </div>

      {bottomOpen && <WorkflowBottomDeck studio={studio} />}
    </section>
  )
}
