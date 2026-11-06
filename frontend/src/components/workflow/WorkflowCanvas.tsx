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
} from 'react'

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
  ClipboardPaste,
  MoreHorizontal,
  Paintbrush,
  Scan,
  Sparkles,
  Power,
  PowerOff,
  Copy,
  ExternalLink,
  LayoutGrid,
  LockKeyhole,
  LockKeyholeOpen,
  MousePointer2,
  PanelBottom,
  PanelBottomClose,
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

type Position = { x: number; y: number }

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

const connectionKey = '__cliptora_ui_source_handles'
const pinKey = '__cliptora_ui_pinned'
const labelKey = '__cliptora_ui_label'
const edgeLabelKey = '__cliptora_ui_edge_labels'

const START_VIEWPORT: Viewport = {
  x: 90,
  y: 70,
  zoom: 0.7,
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
            className="nodrag nopan pointer-events-auto absolute z-20 max-w-40 truncate rounded-full border border-[#dedee3] bg-white px-2.5 py-1 text-[11px] font-semibold text-[#666b73] shadow-sm"
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
          className={`nodrag nopan absolute z-30 flex items-center gap-2 transition-all duration-150 ${
            visible
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
            className="grid size-10 place-items-center rounded-full border border-[#e4e4e6] bg-white text-[#222] shadow-md hover:border-violet-400 hover:bg-violet-50 hover:text-violet-700"
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
            className="grid size-10 place-items-center rounded-full border border-[#e4e4e6] bg-white text-[#222] shadow-md hover:border-red-300 hover:bg-red-50 hover:text-red-600"
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

const workflowEdgeTypes = {
  'cliptora-action': ActionEdge,
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
  'nodrag nopan nowheel grid size-8 place-items-center rounded-md text-[#191919] transition-colors duration-150 hover:bg-white/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet-500 disabled:cursor-not-allowed disabled:opacity-30'

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
            className={`${actionButton} ${inactive ? 'text-amber-600' : ''}`}
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
            className={`${actionButton} hover:text-rose-600`}
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
  className={`transition-opacity duration-150 ${
    inactive ? 'opacity-45 grayscale-[.65]' : ''
  }`}
>
  <StudioCard {...props} />
</div>
    </>
  )
}

const workflowNodeTypes = {
  studio: StudioNodeWithToolbar,
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
    flowNodes,
    flowEdges,
    setJsonEditor,
    removeNode,
    showToolLibrary,
    testStep,
    openTemplate,
    setCanvasDragging,
    undo,
    redo,
  } = studio

  const [bottomOpen, setBottomOpen] = useState(false)
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
  const [viewport, setViewport] = useState<Viewport>(START_VIEWPORT)
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
  const canReadClipboard = Boolean(navigator.clipboard?.readText)

  const closeContextMenu = useCallback(
    () => setContextMenu(null),
    [],
  )

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

          return {
            ...node,
            depends_on: deps,
            settings: {
              ...node.settings,
              [connectionKey]: handles,
              [edgeLabelKey]: labels,
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
      ).catch(() => {})
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
      ).catch(() => {})
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
      ).catch(() => {})
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

    const byId = new Map(nodes.map(node => [node.id, node]))
    const cache = new Map<string, number>()

    const levelOf = (
      id: string,
      visiting = new Set<string>(),
    ): number => {
      if (cache.has(id)) return cache.get(id)!
      if (visiting.has(id)) return 0

      visiting.add(id)
      const deps = byId.get(id)?.depends_on.filter(dep => byId.has(dep)) ?? []
      const level = deps.length
        ? Math.max(...deps.map(dep => levelOf(dep, visiting))) + 1
        : 0

      visiting.delete(id)
      cache.set(id, level)
      return level
    }

    const rows = new Map<number, number>()

    setNodes(previous => previous.map(node => {
      if (node.settings[pinKey] === true) return node

      const depth = levelOf(node.id)
      const row = rows.get(depth) ?? 0
      rows.set(depth, row + 1)

      return {
        ...node,
        position: {
          x: 90 + depth * 300,
          y: 85 + row * 210,
        },
      }
    }))

    setMessage('Nodes arranged by dependencies.')
  }, [nodes, setNodes, setMessage])

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

  const canvasNodes = useMemo(
    () => flowNodes.map(node => ({
      ...node,
      selected: selectedNodeIds.includes(node.id),
    })),
    [flowNodes, selectedNodeIds],
  )

  const [
    visualNodes,
    setVisualNodes,
    onVisualNodesChange,
  ] = useNodesState<StudioFlowNode>(canvasNodes)

  useEffect(() => {
    if (!nodeDragActive.current) {
      setVisualNodes(canvasNodes)
    }
  }, [canvasNodes, setVisualNodes])

  const onNodesChange = useCallback((
    changes: NodeChange<StudioFlowNode>[],
  ) => {
    onVisualNodesChange(changes)

    const selections = changes.filter(
      change => change.type === 'select',
    )

    if (selections.length) {
      setSelectedNodeIds(previous => {
        const next = new Set(previous)

        selections.forEach(change => {
          if (change.type !== 'select') return
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
      .filter(change => change.type === 'remove')
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
          const removedBranch = removedSources.some(source =>
            /^(true|false)$/.test(handles[source] ?? ''),
          )

          removedSources.forEach(source => {
            delete handles[source]
            delete labels[source]
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
          if (change.type !== 'select') return
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

      return {
        ...edge,
        type: 'cliptora-action',
        sourceHandle,
        targetHandle: 'input',
        selected,
        animated: false,
        style: {
          stroke: color,
          strokeWidth: 2.7,
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

  const onConnect = useCallback((connection: Connection) => {
    const { source, target, sourceHandle } = connection
    if (!source || !target || createsCycle(nodes, source, target)) return

    setNodes(previous =>
      previous.map(node => {
        if (node.id !== target) return node

        const isBranch = previous.find(
          candidate => candidate.id === source,
        )?.type === 'flow.if'

        const sourceHandles = isBranch
          ? {
              ...handlesFor(node),
              [source]: sourceHandle === 'false' ? 'false' : 'true',
            }
          : handlesFor(node)

        return {
          ...node,
          depends_on: [...new Set([...node.depends_on, source])],
          when: isBranch
            ? sourceHandle === 'false'
              ? 'condition_false'
              : 'condition_true'
            : node.when,
          settings: isBranch
            ? { ...node.settings, [connectionKey]: sourceHandles }
            : node.settings,
        }
      }),
    )
  }, [nodes, setNodes])

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

  const addAfter = useCallback((type: string) => {
    if (!quickAdd || nodes.length >= 100) return

    const template = catalog.find(
      item => item.type === type && item.status === 'implemented',
    )
    const source = nodes.find(node => node.id === quickAdd.sourceId)
    if (!template || !source) return

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
    setMessage('Node added and connected.')
    setQuickAdd(null)
  }, [catalog, nodes, quickAdd, setJsonEditor, setMessage, setNodes, setSelectedId])

  const quickItems = useMemo(
    () => catalog.filter(item =>
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
    [catalog, quickSearch, quickAdd?.mode],
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

      if (event.key === 'Escape') {
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
    contextMenu, renameDraft, edgeRenameDraft, flow,
    deleteSelection, onOpenNode, testStep, working,
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
    <section className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-[#fbfbfa]">
      <div
        ref={canvasRef}
        className="relative min-h-0 min-w-0 flex-1 overflow-hidden bg-[#fbfbfa] [&_.react-flow__attribution]:!hidden [&_.react-flow__node]:!border-0 [&_.react-flow__node]:!bg-transparent [&_.react-flow__node]:!shadow-none [&_.react-flow__node]:!overflow-visible [&_.react-flow__handle]:!transition-all [&_.react-flow__handle:hover]:!scale-125 [&_.react-flow__handle-connecting]:!ring-4 [&_.react-flow__handle-connecting]:!ring-violet-200"
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
              <ReactFlow<StudioFlowNode, Edge>
                nodes={visualNodes}
                edges={graphEdges}
                viewport={viewport}
                onViewportChange={setViewport}
                minZoom={0.25}
                maxZoom={1.25}
                fitView={false}
                nodeTypes={workflowNodeTypes}
                edgeTypes={workflowEdgeTypes}
                onInit={instance => {
                  flow.current = instance
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
                    ),
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
                nodesDraggable
                autoPanOnNodeDrag={false}
                nodesConnectable
                elementsSelectable
                panOnDrag
                zoomOnScroll={false}
                panOnScroll
                zoomOnPinch
                zoomOnDoubleClick={false}
                deleteKeyCode={null}
                colorMode="light"
                onNodeContextMenu={(event, node) => {
                  event.preventDefault()
                  event.stopPropagation()
                  setSelectedNodeIds(previous =>
                    previous.includes(node.id)
                      ? previous
                      : [node.id],
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
                  closeContextMenu()
                  setSelectedNodeIds([])
                  setSelectedId(null)
                  setSelectedEdges([edge.id])
                }}
                onEdgeDoubleClick={(event, edge) => {
                  event.preventDefault()
                  renameEdge(edge.source, edge.target)
                }}
                onEdgeContextMenu={(event, edge) => {
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
                  closeContextMenu()
                  setQuickAdd(null)
                  setSelectedId(null)
                  setSelectedNodeIds([])
                  setSelectedEdges([])
                }}
                onNodeClick={(_, node) => {
                  closeContextMenu()
                  setSelectedEdges([])
                  setSelectedId(node.id)
                  setJsonEditor(
                    JSON.stringify(
                      nodes.find(item => item.id === node.id)?.settings ?? {},
                      null,
                      2,
                    ),
                  )
                }}
                onNodeDoubleClick={(_, node) => {
                  if (Date.now() - draggedAt.current < 250) return

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

                  const positions = new Map<string, Position>(
                    (flow.current?.getNodes() ?? [node])
                      .filter(item =>
                        item.id === node.id || item.selected,
                      )
                      .map(item => [
                        item.id,
                        item.position,
                      ]),
                  )

                  positions.set(node.id, node.position)

                  setNodes(previous =>
                    previous.map(item => {
                      if (item.settings[pinKey] === true) return item

                      const position = positions.get(item.id)
                      if (!position) return item

                      if (
                        item.position?.x === position.x &&
                        item.position?.y === position.y
                      ) return item

                      return {
                        ...item,
                        position: {
                          x: position.x,
                          y: position.y,
                        },
                      }
                    }),
                  )

                  nodeDragActive.current = false
                  setCanvasDragging(false)
                  setDraggingNodeId(null)
                }}
                onEdgesDelete={deleted => {
                  setNodes(previous =>
                    previous.map(node => {
                      const removed = deleted
                        .filter(edge => edge.target === node.id)
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
                  deleted.forEach(node => removeNode(node.id))
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
                <MiniMap
                  zoomable
                  pannable
                  className="!hidden !rounded-xl !border !border-[#ddd] !bg-white 2xl:!block"
                  nodeColor="#ded8ed"
                />
              </ReactFlow>
            </WorkflowNodeToolbarContext.Provider>
          </WorkflowQuickAddContext.Provider>
        </WorkflowManualTriggerExecuteContext.Provider>

        <div className="nodrag nopan absolute bottom-5 left-4 z-[70] flex items-center gap-2">
          <div
            role="toolbar"
            aria-label="Canvas controls"
            className="flex items-center gap-2 rounded-full border border-[#e3e4e6] bg-white px-3 py-2 shadow-[0_5px_22px_#00000012]"
            onPointerDown={event => event.stopPropagation()}
          >
            <button
              type="button"
              className="grid place-items-center rounded-full text-[#191919] transition-colors hover:bg-[#f4f4f5]"
              title="Fit workflow to view"
              aria-label="Fit workflow to view"
              onClick={() => {
                if (nodes.length) {
                  void flow.current?.fitView({
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
              className="grid place-items-center rounded-full text-[#191919] transition-colors hover:bg-[#f4f4f5] disabled:opacity-30"
              title="Zoom in"
              aria-label="Zoom in"
              disabled={viewport.zoom >= 1.25}
              onClick={() => {
                void flow.current?.zoomIn({ duration: 170 })
              }}
            >
              <ZoomIn size={18} strokeWidth={2.4} />
            </button>

            <button
              type="button"
              className="grid place-items-center rounded-full text-[#191919] transition-colors hover:bg-[#f4f4f5] disabled:opacity-30"
              title="Zoom out"
              aria-label="Zoom out"
              disabled={viewport.zoom <= 0.25}
              onClick={() => {
                void flow.current?.zoomOut({ duration: 170 })
              }}
            >
              <ZoomOut size={18} strokeWidth={2.4} />
            </button>

            <button
              type="button"
              className="grid place-items-center rounded-full text-[#191919] transition-colors hover:bg-[#f4f4f5] disabled:opacity-30"
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
            className="grid place-items-center rounded-full border border-[#e3e4e6] bg-white text-[#27272a] shadow-[0_5px_22px_#00000012] transition-colors hover:bg-[#f4f4f5]"
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
              className="w-full max-w-[370px] rounded-xl border border-[#e4e4e5] bg-white p-5 shadow-xl"
            >
              <h3 className="font-semibold text-[#202020]">
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
                className="mt-4 h-11 w-full rounded-lg border border-violet-300 px-3 text-sm text-[#222] outline-none"
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
                  className="rounded-lg bg-[#252525] px-4 py-2 text-sm text-white disabled:opacity-50"
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
              className="w-full max-w-[370px] rounded-xl border border-[#e4e4e5] bg-white p-5 shadow-xl"
            >
              <h3 className="font-semibold text-[#202020]">
                Connection label
              </h3>

              <p className="mt-1 text-xs text-[#858585]">
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
                className="mt-4 h-11 w-full rounded-lg border border-violet-300 px-3 text-sm text-[#222] outline-none"
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
                  className="rounded-lg bg-[#252525] px-4 py-2 text-sm text-white"
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
            className="absolute z-[60] flex w-[290px] flex-col overflow-hidden rounded-xl border border-[#dddddf] bg-white shadow-xl"
            style={{
              left: quickAdd.left,
              top: quickAdd.top,
              maxHeight: 'min(420px, 78%)',
            }}
            onPointerDown={event => event.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-[#ededed] px-3 py-2.5">
              <strong className="text-sm font-semibold text-[#222]">
                {quickAdd.mode === 'replace'
                  ? 'Replace node'
                  : quickAdd.mode === 'insert'
                    ? 'Insert node on connection'
                    : 'What happens next?'}
              </strong>

              <button
                type="button"
                className="rounded p-1 text-[#777] hover:bg-[#eee]"
                onClick={() => setQuickAdd(null)}
                aria-label="Close"
              >
                <X size={17} />
              </button>
            </div>

            <label className="mx-3 mt-3 flex items-center gap-2 rounded-lg border border-violet-300 px-3 py-2 text-[#777]">
              <Search size={17} />

              <input
                autoFocus
                value={quickSearch}
                onChange={event => setQuickSearch(event.target.value)}
                placeholder="Search executable nodes..."
                className="min-w-0 flex-1 bg-transparent text-[13px] text-[#222] outline-none"
              />
            </label>

            <div className="mt-2 min-h-0 flex-1 overflow-y-auto pb-2">
              {quickItems.length ? (
                quickItems.map(item => (
                  <button
                    key={item.type}
                    type="button"
                    onClick={() => addAfter(item.type)}
                    className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-[#f7f5fa]"
                  >
                    <span className="grid size-7 shrink-0 place-items-center">
                      <WorkflowToolIcon
                        type={item.type}
                        label={item.label}
                        size={24}
                      />
                    </span>

                    <span className="min-w-0 flex-1">
                      <strong className="block truncate text-[13px] font-medium text-[#222]">
                        {item.label}
                      </strong>

                      <span className="block truncate text-[11px] text-[#858585]">
                        {item.group}
                      </span>
                    </span>

                    <Plus size={15} className="text-[#aaa]" />
                  </button>
                ))
              ) : (
                <p className="px-4 py-4 text-[13px] text-[#777]">
                  No available nodes found.
                </p>
              )}
            </div>
          </div>
        )}

        {!nodes.length && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center px-6">
            <div className="pointer-events-auto max-w-[300px] rounded-2xl border border-[#e7e7e7] bg-white px-6 py-7 text-center shadow-sm">
              <div className="mx-auto mb-4 grid size-12 place-items-center rounded-xl border border-violet-200 bg-violet-50 text-violet-700">
                <Plus size={22} />
              </div>

              <h2 className="text-sm font-semibold text-[#252525]">
                Start your workflow
              </h2>

              <p className="mt-2 text-xs leading-5 text-[#858585]">
                Choose a tool from the sidebar or drag one onto the canvas.
              </p>

              <button
                type="button"
                onClick={showToolLibrary}
                className="mt-4 inline-flex items-center gap-2 rounded-lg bg-[#222] px-4 py-2 text-xs font-semibold text-white"
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
