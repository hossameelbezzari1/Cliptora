import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type MouseEvent, type FormEvent } from 'react'
import type { WorkflowStudioState } from './useWorkflowStudio'
import type { WorkflowNode } from './workflowTypes'
import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  type Connection,
  type Edge,
  type EdgeChange,
  type NodeChange,
  type Viewport,
} from '@xyflow/react'
import {
  Copy,
  ClipboardPaste,
  Maximize2,
  MessageCircle,
  Pencil,
  FolderSymlink,
  Group,
  Play,
  LockKeyhole,
  LockKeyholeOpen,
  Ban,
  ExternalLink,
  Replace,
  LayoutGrid,
  MousePointer2,
  XCircle,
  PanelBottom,
  PanelBottomClose,
  Plus,
  Search,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  Redo2,
  Trash2,
  Undo2,
  Settings2,
  Workflow as WorkflowIcon,
  X,
} from 'lucide-react'
import { btn } from './workflowUI'
import { WorkflowToolIcon } from './WorkflowToolIcon'
import { flowNodeTypes, WorkflowQuickAddContext, WorkflowManualTriggerExecuteContext, type StudioFlowNode } from './WorkflowNodeCard'
import { WorkflowBottomDeck } from './WorkflowBottomDeck'
import { WorkflowContextMenu, type ContextMenuAction } from './WorkflowContextMenu'
import { clone, uid } from './workflowUtils'

type QuickAddPosition = { sourceId: string; sourceHandle: string; left: number; top: number; dropPosition?: { x: number; y: number }; mode?: 'add' | 'replace' }
type ContextState = {
  kind: 'node' | 'pane' | 'edge'
  id?: string
  clientX: number
  clientY: number
  flowPosition?: { x: number; y: number }
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
const connectionKey = '__cliptora_ui_source_handles'
const pinKey = '__cliptora_ui_pinned'
const labelKey = '__cliptora_ui_label'
const START_VIEWPORT: Viewport = { x: 90, y: 70, zoom: 0.7 }

function handlesFor(node: WorkflowNode): Record<string, string> {
  const value = node.settings[connectionKey]
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return Object.fromEntries(Object.entries(value).filter(([, handle]) => typeof handle === 'string')) as Record<string, string>
}

function createsCycle(nodes: WorkflowNode[], sourceId: string, targetId: string) {
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
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const node = value as Partial<WorkflowNode>
  return typeof node.id === 'string' && typeof node.type === 'string' && Array.isArray(node.depends_on)
    && Boolean(node.settings && typeof node.settings === 'object' && !Array.isArray(node.settings))
}

function isFlowClipboard(value: unknown): value is FlowClipboard {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const payload = value as Partial<FlowClipboard>
  return payload.schema === 'cliptora.workflow.v1' && typeof payload.name === 'string'
    && Array.isArray(payload.nodes) && payload.nodes.every(isWorkflowNode)
}

function isNodeConfigClipboard(value: unknown): value is NodeConfigClipboard {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const payload = value as Partial<NodeConfigClipboard>
  return payload.schema === 'cliptora.workflow.node-config.v1' && typeof payload.nodeType === 'string'
    && Boolean(payload.settings && typeof payload.settings === 'object' && !Array.isArray(payload.settings))
    && typeof payload.when === 'string'
}

export function WorkflowCanvas({ studio, onOpenNode }: { studio: WorkflowStudioState; onOpenNode?: (id: string) => void }) {
  const {
    flow, name, setActiveId, setVersions, setName, setNodes,
    selectedId, setSelectedId, setMessage, working, nodes, catalog,
    activeId, duplicateDefinition, deleteDefinition, addNode, flowNodes, flowEdges,
    setJsonEditor, removeNode, showToolLibrary, testStep,
    setNodesTransient, replaceNodes, commitNodeHistory, undo, redo, canUndo, canRedo,
  } = studio
  const [bottomOpen, setBottomOpen] = useState(false)
  const [contextMenu, setContextMenu] = useState<ContextState | null>(null)
  const [renameDraft, setRenameDraft] = useState<{ id: string; value: string } | null>(null)
  const clipboardRef = useRef<WorkflowNode[]>([])
  const configClipboardRef = useRef<NodeConfigClipboard | null>(null)
  const flowClipboardRef = useRef<FlowClipboard | null>(null)
  const [viewport, setViewport] = useState<Viewport>(START_VIEWPORT)
  const [quickAdd, setQuickAdd] = useState<QuickAddPosition | null>(null)
  const [quickSearch, setQuickSearch] = useState('')
  const [selectedEdges, setSelectedEdges] = useState<string[]>([])
  const [selectedNodeIds, setSelectedNodeIds] = useState<string[]>([])
  const canvasRef = useRef<HTMLDivElement>(null)
  const draggedAt = useRef(0)
  const dragStartNodes = useRef<WorkflowNode[] | null>(null)
  const canReadClipboard = Boolean(navigator.clipboard?.readText)
  const closeContextMenu = useCallback(() => setContextMenu(null), [])

  const openContextMenu = useCallback((kind: ContextState['kind'], id: string | undefined, clientX: number, clientY: number) => {
    const rect = canvasRef.current?.getBoundingClientRect()
    if (!rect) return
    setQuickAdd(null)
    setContextMenu({
      kind,
      id,
      clientX,
      clientY,
      flowPosition: flow.current?.screenToFlowPosition({ x: clientX, y: clientY }),
    })
  }, [flow])

  const deleteNodes = useCallback((ids: string[]) => {
    const removed = new Set(ids)
    if (!removed.size) return
    setNodes(previous => previous.filter(node => !removed.has(node.id)).map(node => {
      const deps = node.depends_on.filter(id => !removed.has(id))
      const handles = Object.fromEntries(Object.entries(handlesFor(node)).filter(([id]) => !removed.has(id)))
      return { ...node, depends_on: deps, settings: { ...node.settings, [connectionKey]: handles } }
    }))
    setSelectedId(null)
    setSelectedNodeIds([])
    setSelectedEdges([])
    setMessage(`${removed.size} node${removed.size === 1 ? '' : 's'} deleted.`)
  }, [setNodes, setSelectedId, setMessage])

  const copySelection = useCallback((ids: string[]) => {
    const chosen = nodes.filter(node => ids.includes(node.id))
    if (!chosen.length) return
    clipboardRef.current = clone(chosen)
    const value = JSON.stringify({ schema: 'cliptora.workflow.nodes.v1', nodes: chosen }, null, 2)
    if (navigator.clipboard?.writeText) void navigator.clipboard.writeText(value).catch(() => {})
    setMessage(`${chosen.length} node${chosen.length === 1 ? '' : 's'} copied. Press Ctrl+V to paste.`)
  }, [nodes, setMessage])

  const copyNodeConfig = useCallback((node: WorkflowNode) => {
    const settings = structuredClone(node.settings)
    delete settings[connectionKey]
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
    if (navigator.clipboard?.writeText) void navigator.clipboard.writeText(JSON.stringify(payload, null, 2)).catch(() => {})
    setMessage('Node settings copied. Connections, label and pin state were excluded.')
  }, [setMessage])

  const pasteNodeConfig = useCallback(async (node: WorkflowNode) => {
    let value: unknown = configClipboardRef.current
    if (navigator.clipboard?.readText) {
      try { value = JSON.parse(await navigator.clipboard.readText()) }
      catch { /* Use the in-app clipboard when browser clipboard access is unavailable. */ }
    }
    if (!isNodeConfigClipboard(value)) {
      setMessage('Clipboard does not contain CLIPTORA node settings.')
      return
    }
    if (value.nodeType !== node.type) {
      setMessage(`Settings from ${value.nodeType} cannot be pasted into ${node.type}.`)
      return
    }
    setNodes(previous => previous.map(item => {
      if (item.id !== node.id) return item
      const internalSettings = Object.fromEntries(Object.entries(item.settings).filter(([key]) =>
        key === connectionKey || key === pinKey || key === labelKey))
      return {
        ...item,
        when: value.when,
        retry_limit: value.retryLimit,
        cache: value.cache,
        settings: { ...structuredClone(value.settings), ...internalSettings },
      }
    }))
    setMessage('Node settings pasted. Connections, label and pin state were preserved.')
  }, [setMessage, setNodes])

  const copyWorkflow = useCallback(() => {
    if (!nodes.length) return
    const payload: FlowClipboard = { schema: 'cliptora.workflow.v1', name, nodes: clone(nodes) }
    flowClipboardRef.current = payload
    if (navigator.clipboard?.writeText) void navigator.clipboard.writeText(JSON.stringify(payload, null, 2)).catch(() => {})
    setMessage(`Workflow copied with ${nodes.length} node${nodes.length === 1 ? '' : 's'}.`)
  }, [name, nodes, setMessage])

  const pasteWorkflow = useCallback(async () => {
    let value: unknown = flowClipboardRef.current
    if (navigator.clipboard?.readText) {
      try { value = JSON.parse(await navigator.clipboard.readText()) }
      catch { /* Use the in-app clipboard when browser clipboard access is unavailable. */ }
    }
    if (!isFlowClipboard(value)) {
      setMessage('Clipboard does not contain a CLIPTORA workflow.')
      return
    }
    if (value.nodes.length > 100) {
      setMessage('This workflow has more than the supported 100 nodes.')
      return
    }
    if (nodes.length && !window.confirm('Paste this workflow as a new local workflow and replace the current canvas?')) return
    const pastedNodes = clone(value.nodes)
    setActiveId(null)
    setVersions([])
    setName(`${value.name} copy`.slice(0, 160))
    replaceNodes(pastedNodes)
    setSelectedNodeIds(pastedNodes[0] ? [pastedNodes[0].id] : [])
    setSelectedId(pastedNodes[0]?.id ?? null)
    setMessage('Workflow pasted as a new local copy. Autosave will persist it to MySQL.')
  }, [nodes.length, replaceNodes, setActiveId, setMessage, setName, setSelectedId, setVersions])

  const pasteSelection = useCallback((position?: { x: number; y: number }) => {
    const originals = clipboardRef.current.filter(node => node.type !== 'core.video_source')
    if (!originals.length) {
      setMessage('No nodes available to paste. Source video nodes cannot be duplicated.')
      return
    }
    if (nodes.length + originals.length > 100) return
    const usedIds = [...nodes.map(node => node.id)]
    const ids = new Map<string, string>()
    const existingIds = new Set(nodes.map(node => node.id))
    originals.forEach(node => { const next = uid(node.type, usedIds); ids.set(node.id, next); usedIds.push(next) })
    const xMin = Math.min(...originals.map(node => node.position?.x ?? 0))
    const yMin = Math.min(...originals.map(node => node.position?.y ?? 0))
    const copies = originals.map(node => {
      const settings = structuredClone(node.settings)
      delete settings[pinKey]
      const oldHandles = handlesFor(node)
      settings[connectionKey] = Object.fromEntries(Object.entries(oldHandles).map(([id, h]) => [ids.get(id) ?? id, h]))
      return {
        ...structuredClone(node), id: ids.get(node.id)!, settings,
        depends_on: node.depends_on.filter(id => ids.has(id) || existingIds.has(id)).map(id => ids.get(id) ?? id),
        position: { x: (position?.x ?? xMin + 45) + (node.position?.x ?? 0) - xMin, y: (position?.y ?? yMin + 45) + (node.position?.y ?? 0) - yMin },
      }
    })
    setNodes(previous => [...previous, ...copies])
    setSelectedNodeIds(copies.map(node => node.id))
    setSelectedId(copies[0].id)
    setMessage(`${copies.length} node${copies.length === 1 ? '' : 's'} pasted.`)
  }, [nodes, setNodes, setSelectedId, setMessage])

  const tidyWorkflow = useCallback(() => {
    if (!nodes.length) return
    const byId = new Map(nodes.map(node => [node.id, node]))
    const cached = new Map<string, number>()
    const levelOf = (id: string, visiting = new Set<string>()): number => {
      if (cached.has(id)) return cached.get(id)!
      if (visiting.has(id)) return 0
      visiting.add(id)
      const deps = byId.get(id)?.depends_on.filter(dep => byId.has(dep)) ?? []
      const result = deps.length ? Math.max(...deps.map(dep => levelOf(dep, visiting))) + 1 : 0
      visiting.delete(id)
      cached.set(id, result)
      return result
    }
    const rows = new Map<number, number>()
    setNodes(previous => previous.map(node => {
      const depth = levelOf(node.id)
      const row = rows.get(depth) ?? 0
      rows.set(depth, row + 1)
      return node.settings[pinKey] === true ? node : { ...node, position: { x: 90 + depth * 300, y: 85 + row * 210 } }
    }))
    setMessage('Workflow nodes arranged by dependencies. Pinned nodes were left in place.')
  }, [nodes, setNodes, setMessage])

  const renameNode = useCallback((event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!renameDraft) return
    const value = renameDraft.value.trim().slice(0, 100)
    if (!value) return
    setNodes(previous => previous.map(node => node.id === renameDraft.id
      ? { ...node, settings: { ...node.settings, [labelKey]: value } } : node))
    setRenameDraft(null)
    setMessage('Node renamed.')
  }, [renameDraft, setNodes, setMessage])

  useEffect(() => {
    setSelectedNodeIds(previous => {
      if (!selectedId) return []
      return previous.includes(selectedId) ? previous : [selectedId]
    })
  }, [selectedId])

  const canvasNodes = useMemo(() => flowNodes.map(node => ({
    ...node,
    selected: selectedNodeIds.includes(node.id),
  })), [flowNodes, selectedNodeIds])

  const graphEdges = useMemo<Edge[]>(() => flowEdges.map(edge => {
    const source = nodes.find(node => node.id === edge.source)
    const target = nodes.find(node => node.id === edge.target)
    const isBranch = source?.type === 'flow.if'
    const sourceHandle = isBranch ? (target ? handlesFor(target)[edge.source] : undefined) : 'main'
    const active = flowNodes.some(node => node.id === edge.source && node.data.status === 'done')
    const itemText = flowNodes.find(node => node.id === edge.source)?.data.meta ?? ''
    const count = /^\d+ items?$/.test(itemText) ? itemText.replace(/^1 items$/, '1 item') : ''
    return {
      ...edge,
      type: 'default',
      selected: selectedEdges.includes(edge.id),
      sourceHandle: isBranch ? (sourceHandle || 'true') : 'main',
      targetHandle: 'input',
      style: { stroke: active ? '#08a844' : '#bfc3c8', strokeWidth: 2.2 },
      label: active && count ? count : undefined,
      labelStyle: { fontSize: 12, fill: '#808080' },
      labelBgStyle: { fill: '#fbfbfa', fillOpacity: 0.92 },
    }
  }), [flowEdges, flowNodes, nodes, selectedEdges])

  const onNodesChange = useCallback((changes: NodeChange<StudioFlowNode>[]) => {
    const nextPositions = new Map<string, { x: number; y: number }>()
    changes.forEach(change => {
      if (change.type === 'position' && change.position && !nodes.find(node => node.id === change.id)?.settings[pinKey]) nextPositions.set(change.id, change.position)
    })
    if (nextPositions.size) {
      setNodesTransient(previous => previous.map(node => {
        const position = nextPositions.get(node.id)
        return position ? { ...node, position } : node
      }))
    }
    const selections = changes.filter(change => change.type === 'select')
    if (selections.length) {
      setSelectedNodeIds(previous => {
        const next = new Set(previous)
        selections.forEach(change => {
          if (change.type !== 'select') return
          if (change.selected) next.add(change.id)
          else next.delete(change.id)
        })
        return [...next]
      })
    }
    const removed = changes.filter(change => change.type === 'remove').map(change => change.id)
    if (removed.length) setSelectedNodeIds(previous => previous.filter(id => !removed.includes(id)))
  }, [setNodesTransient, nodes])

  const onEdgesChange = useCallback((changes: EdgeChange<Edge>[]) => {
    const removed = changes.filter(change => change.type === 'remove').map(change => change.id)
    if (removed.length) {
      const disconnect = flowEdges.filter(edge => removed.includes(edge.id))
      setNodes(previous => previous.map(node => {
        const removedSources = disconnect.filter(edge => edge.target === node.id).map(edge => edge.source)
        if (!removedSources.length) return node
        const nextHandles = handlesFor(node)
        removedSources.forEach(source => { delete nextHandles[source] })
        const removedBranch = disconnect.some(edge => edge.target === node.id && /^(true|false)$/.test(handlesFor(node)[edge.source] ?? ''))
        return {
          ...node,
          depends_on: node.depends_on.filter(source => !removedSources.includes(source)),
          when: removedBranch && /^condition_(true|false)$/.test(node.when) ? 'always' : node.when,
          settings: { ...node.settings, [connectionKey]: nextHandles },
        }
      }))
    }
    const selections = changes.filter(change => change.type === 'select')
    if (selections.length) {
      setSelectedEdges(previous => {
        const next = new Set(previous)
        selections.forEach(change => {
          if (change.type === 'select') {
            if (change.selected) next.add(change.id)
            else next.delete(change.id)
          }
        })
        removed.forEach(id => next.delete(id))
        return [...next]
      })
    } else if (removed.length) {
      setSelectedEdges(previous => previous.filter(id => !removed.includes(id)))
    }
  }, [flowEdges, setNodes])

  const onConnect = useCallback((connection: Connection) => {
    const { source, target, sourceHandle } = connection
    if (!source || !target || createsCycle(nodes, source, target)) return
    setNodes(previous => previous.map(node => {
      if (node.id !== target) return node
      const isBranch = previous.find(candidate => candidate.id === source)?.type === 'flow.if'
      const sourceHandles = isBranch ? { ...handlesFor(node), [source]: sourceHandle === 'false' ? 'false' : 'true' } : handlesFor(node)
      return {
        ...node,
        depends_on: [...new Set([...node.depends_on, source])],
        when: isBranch ? (sourceHandle === 'false' ? 'condition_false' : 'condition_true') : node.when,
        settings: isBranch ? { ...node.settings, [connectionKey]: sourceHandles } : node.settings,
      }
    }))
  }, [nodes, setNodes])

  const openQuickAdd = useCallback((sourceId: string, sourceHandle: string, event: MouseEvent<HTMLButtonElement>) => {
    const rect = canvasRef.current?.getBoundingClientRect()
    if (!rect) return
    setQuickSearch('')
    setQuickAdd({
      sourceId,
      sourceHandle,
      left: Math.max(12, Math.min(event.clientX - rect.left + 12, rect.width - 302)),
      top: Math.max(12, Math.min(event.clientY - rect.top - 30, rect.height - 330)),
    })
  }, [])

  const addAfter = useCallback((type: string) => {
    if (!quickAdd || nodes.length >= 100) return
    const template = catalog.find(item => item.type === type && item.status === 'implemented')
    const source = nodes.find(node => node.id === quickAdd.sourceId)
    if (!template || !source) return
    if (quickAdd.mode === 'replace') {
      if (source.type === 'core.video_source' || type === 'core.video_source') return
      setNodes(previous => previous.map(node => {
        if (node.id === source.id) return {
          ...node, type, settings: {
            ...structuredClone(template.settings),
            ...(node.settings[pinKey] === true ? { [pinKey]: true } : {}),
          },
        }
        if (source.type !== 'flow.if' || type === 'flow.if' || !node.depends_on.includes(source.id)) return node
        const handles = handlesFor(node)
        delete handles[source.id]
        return { ...node, when: /^condition_(true|false)$/.test(node.when) ? 'always' : node.when,
          settings: { ...node.settings, [connectionKey]: handles } }
      }))
      setMessage('Node replaced. Check its settings and connections before running.')
      setQuickAdd(null)
      return
    }
    const id = uid(type, nodes.map(node => node.id))
    const siblingOffset = quickAdd.sourceHandle === 'false' ? 140 : quickAdd.sourceHandle === 'true' ? -50 : 0
    const next: WorkflowNode = {
      id,
      type,
      depends_on: [source.id],
      when: 'always',
      retry_limit: 1,
      cache: true,
      settings: {
        ...structuredClone(template.settings),
        ...(quickAdd.sourceHandle === 'true' || quickAdd.sourceHandle === 'false'
          ? { [connectionKey]: { [source.id]: quickAdd.sourceHandle } }
          : {}),
      },
      position: quickAdd.dropPosition ?? { x: (source.position?.x ?? 100) + 280, y: (source.position?.y ?? 100) + siblingOffset },
    }
    if (quickAdd.sourceHandle === 'true' || quickAdd.sourceHandle === 'false') {
      next.when = quickAdd.sourceHandle === 'true' ? 'condition_true' : 'condition_false'
    }
    setNodes(previous => [...previous, next])
    setSelectedId(id)
    setJsonEditor(JSON.stringify(next.settings, null, 2))
    setMessage('Node added and connected. Save the workflow to keep changes.')
    setQuickAdd(null)
  }, [catalog, nodes, quickAdd, setJsonEditor, setMessage, setNodes, setSelectedId])

  const quickItems = useMemo(() => catalog.filter(item => item.status === 'implemented' && (quickAdd?.mode !== 'replace' || item.type !== 'core.video_source') &&
    `${item.label} ${item.type} ${item.group}`.toLowerCase().includes(quickSearch.toLowerCase().trim())).slice(0, 35), [catalog, quickSearch, quickAdd?.mode])

  const duplicateSelectedNodes = useCallback(() => {
    const selected = nodes.filter(node => selectedNodeIds.includes(node.id) && node.type !== 'core.video_source')
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
      const sourceHandles = Object.fromEntries(Object.entries(handlesFor(copy)).map(([sourceId, handle]) => [idMap.get(sourceId) ?? sourceId, handle]))
      return {
        ...copy,
        id: idMap.get(node.id)!,
        depends_on: node.depends_on.map(id => idMap.get(id) ?? id),
        settings: Object.keys(sourceHandles).length ? { ...copy.settings, [connectionKey]: sourceHandles } : copy.settings,
        position: { x: (node.position?.x ?? 0) + 42, y: (node.position?.y ?? 0) + 42 },
      }
    })
    copies.forEach(node => { delete node.settings[pinKey] })
    const copiedIds = copies.map(node => node.id)
    setNodes(previous => [...previous, ...copies])
    setSelectedNodeIds(copiedIds)
    setSelectedId(copiedIds[0])
    setJsonEditor(JSON.stringify(copies[0].settings, null, 2))
    setMessage(`${copies.length} node${copies.length === 1 ? '' : 's'} duplicated. Save the workflow to keep changes.`)
  }, [nodes, selectedNodeIds, setJsonEditor, setMessage, setNodes, setSelectedId])

  const toggleNodePin = useCallback((nodeId: string) => {
    setNodes(previous => previous.map(node => {
      if (node.id !== nodeId) return node
      const settings = { ...node.settings }
      if (settings[pinKey] === true) delete settings[pinKey]
      else settings[pinKey] = true
      return { ...node, settings }
    }))
  }, [setNodes])

  const deleteSelection = useCallback(() => {
    if (selectedEdges.length) {
      onEdgesChange(selectedEdges.map(id => ({ type: 'remove', id })))
    }
    if (selectedNodeIds.length) deleteNodes(selectedNodeIds)
    else if (selectedEdges.length) {
      setSelectedEdges([])
      setMessage(`${selectedEdges.length} connection${selectedEdges.length === 1 ? '' : 's'} deleted.`)
    }
  }, [deleteNodes, onEdgesChange, selectedEdges, selectedNodeIds, setMessage])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (target?.closest('input, textarea, select, [contenteditable="true"]')) return
      const key = event.key.toLowerCase()
      if (contextMenu || renameDraft) return
      const keyboardScope = canvasRef.current?.contains(event.target as Node) || document.activeElement === document.body
      if (!keyboardScope) return
      if (event.key === 'Escape' && (selectedNodeIds.length || selectedEdges.length)) {
        event.preventDefault()
        setSelectedNodeIds([])
        setSelectedEdges([])
        setSelectedId(null)
        return
      }
      if ((event.key === 'Delete' || event.key === 'Backspace') && (selectedNodeIds.length || selectedEdges.length)) {
        event.preventDefault()
        deleteSelection()
        return
      }
      if (event.key === 'Enter' && !event.ctrlKey && !event.metaKey && selectedId) {
        event.preventDefault()
        onOpenNode?.(selectedId)
        return
      }
      if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && selectedId && !working) {
        event.preventDefault()
        void testStep(selectedId)
        return
      }
      if (keyboardScope && event.altKey && key === 't') {
        event.preventDefault()
        tidyWorkflow()
        return
      }
      if (keyboardScope && !event.altKey && !event.ctrlKey && !event.metaKey && key === 'p' && selectedId) {
        event.preventDefault()
        toggleNodePin(selectedId)
        return
      }
      if (keyboardScope && !event.altKey && !event.ctrlKey && !event.metaKey && key === 'r' && selectedId) {
        const selectedNode = nodes.find(node => node.id === selectedId)
        const rect = canvasRef.current?.getBoundingClientRect()
        if (selectedNode && selectedNode.type !== 'core.video_source' && rect) {
          event.preventDefault()
          const position = flow.current?.flowToScreenPosition({ x: selectedNode.position?.x ?? 0, y: selectedNode.position?.y ?? 0 })
          setQuickSearch('')
          setQuickAdd({ mode: 'replace', sourceId: selectedId, sourceHandle: 'main',
            left: Math.max(12, Math.min((position?.x ?? rect.left + 50) - rect.left, rect.width - 302)),
            top: Math.max(12, Math.min((position?.y ?? rect.top + 40) - rect.top, rect.height - 330)) })
        }
        return
      }
      if (key === 'f2' && selectedId && keyboardScope) {
        event.preventDefault()
        const selectedNode = nodes.find(node => node.id === selectedId)
        if (selectedNode) setRenameDraft({ id: selectedId, value: String(selectedNode.settings[labelKey] ?? catalog.find(item => item.type === selectedNode.type)?.label ?? selectedNode.type) })
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
        const targetInside = canvasRef.current?.contains(event.target as Node) || document.activeElement === document.body
        if (!targetInside) return
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
  }, [duplicateSelectedNodes, redo, undo, selectedId, nodes, selectedNodeIds, selectedEdges, catalog, copySelection, pasteSelection, setSelectedId, setNodes, tidyWorkflow, toggleNodePin, contextMenu, renameDraft, flow, deleteSelection, onOpenNode, testStep, working])

  const onLibraryDrop = useCallback((event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    event.stopPropagation()
    const type = event.dataTransfer.getData('text/cliptora-node')
    if (!type || !catalog.some(item => item.type === type && item.status === 'implemented')) return
    const point = flow.current?.screenToFlowPosition({ x: event.clientX, y: event.clientY })
    if (!point) return
    addNode(type, { x: point.x - 95, y: point.y - 55 })
    setQuickAdd(null)
  }, [addNode, catalog, flow])

  const contextActions: ContextMenuAction[] = (() => {
    if (!contextMenu) return []
    const activeNode = contextMenu.kind === 'node' ? nodes.find(node => node.id === contextMenu.id) : undefined
    const activeEdge = contextMenu.kind === 'edge' ? graphEdges.find(edge => edge.id === contextMenu.id) : undefined
    if (activeEdge) return [
      { id: 'disconnect', label: 'Delete connection', icon: Trash2, shortcut: ['Del'], destructive: true,
        run: () => onEdgesChange([{ type: 'remove', id: activeEdge.id }]) },
      { id: 'tidy', label: 'Tidy Up', icon: LayoutGrid, shortcut: ['Alt', 'T'], dividerBefore: true,
        disabled: !nodes.length, run: tidyWorkflow },
      { id: 'selectall', label: 'Select All', icon: MousePointer2, shortcut: ['Ctrl', 'A'], dividerBefore: true,
        disabled: !nodes.length, run: () => { setSelectedEdges([]); setSelectedNodeIds(nodes.map(node => node.id)); setSelectedId(nodes[0].id) } },
      { id: 'clear', label: 'Clear Selection', icon: XCircle,
        disabled: !selectedNodeIds.length && !selectedEdges.length,
        run: () => { setSelectedEdges([]); setSelectedNodeIds([]); setSelectedId(null) } },
    ]
    const selection = activeNode && selectedNodeIds.includes(activeNode.id) ? selectedNodeIds : activeNode ? [activeNode.id] : selectedNodeIds
    const nodeActions: ContextMenuAction[] = activeNode ? [
      { id: 'chat', label: 'Add node to chat', icon: MessageCircle, disabled: true, disabledReason: 'Requires a connected chat assistant; not installed.', run: () => {} },
      { id: 'open', label: 'Open...', icon: ExternalLink, shortcut: ['Enter'], disabled: !onOpenNode,
        disabledReason: 'Node editor is unavailable.', run: () => onOpenNode?.(activeNode.id) },
      { id: 'execute', label: 'Execute step', icon: Play, disabled: working,
        shortcut: ['Ctrl', 'Enter'],
        run: () => void testStep(activeNode.id) },
      { id: 'rename', label: 'Rename', icon: Pencil, shortcut: ['F2'],
        run: () => setRenameDraft({ id: activeNode.id, value: String(activeNode.settings[labelKey] ?? catalog.find(item => item.type === activeNode.type)?.label ?? activeNode.type) }) },
      { id: 'replace', label: 'Replace', icon: Replace, shortcut: ['R'], disabled: activeNode.type === 'core.video_source',
        disabledReason: activeNode.type === 'core.video_source' ? 'Source video cannot be replaced here.' : undefined,
        run: () => {
          const position = canvasRef.current?.getBoundingClientRect()
          if (!position) return
          setQuickSearch('')
          setQuickAdd({ mode: 'replace', sourceId: activeNode.id, sourceHandle: 'main',
            left: Math.max(12, Math.min(contextMenu.clientX - position.left, position.width - 302)),
            top: Math.max(12, Math.min(contextMenu.clientY - position.top, position.height - 330)) })
        } },
      { id: 'deactivate', label: 'Deactivate', icon: Ban, disabled: true,
        disabledReason: 'FastAPI executor has no verified disabled-node support. Not safe to skip execution in UI only.', run: () => {} },
      { id: 'pin', label: activeNode.settings[pinKey] === true ? 'Unpin' : 'Pin',
        icon: activeNode.settings[pinKey] === true ? LockKeyholeOpen : LockKeyhole, shortcut: ['P'],
        run: () => toggleNodePin(activeNode.id) },
      { id: 'copy', label: selection.length > 1 ? `Copy ${selection.length} Nodes` : 'Copy Node', icon: Copy, shortcut: ['Ctrl', 'C'], run: () => copySelection(selection) },
      { id: 'paste', label: 'Paste Node(s)', icon: ClipboardPaste, shortcut: ['Ctrl', 'V'], disabled: !clipboardRef.current.length,
        disabledReason: !clipboardRef.current.length ? 'Copy one or more workflow nodes first.' : undefined,
        run: () => pasteSelection(contextMenu.flowPosition) },
      { id: 'copy-config', label: 'Copy Node Settings', icon: Settings2, dividerBefore: true,
        run: () => copyNodeConfig(activeNode) },
      { id: 'paste-config', label: 'Paste Node Settings', icon: ClipboardPaste,
        disabled: !configClipboardRef.current && !canReadClipboard,
        disabledReason: !configClipboardRef.current && !canReadClipboard ? 'Copy settings from a node first.' : undefined,
        run: () => void pasteNodeConfig(activeNode) },
      { id: 'duplicate', label: 'Duplicate', icon: Copy, shortcut: ['Ctrl', 'D'],
        disabled: !selection.some(id => nodes.some(node => node.id === id && node.type !== 'core.video_source')) || nodes.length + selection.length > 100,
        run: () => {
          setSelectedNodeIds(selection)
          const chosen = nodes.filter(node => selection.includes(node.id) && node.type !== 'core.video_source')
          if (!chosen.length) return
          clipboardRef.current = clone(chosen)
          pasteSelection()
        } },
      { id: 'tidy', label: 'Tidy Up', icon: LayoutGrid, shortcut: ['Alt', 'T'], dividerBefore: true,
        run: tidyWorkflow },
      { id: 'subworkflow', label: 'Convert node to sub-workflow', icon: FolderSymlink, shortcut: ['Alt', 'X'], disabled: true,
        disabledReason: 'Sub-workflow conversion needs an actual backend sub-workflow executor.', run: () => {} },
      { id: 'group', label: 'Group node', icon: Group, shortcut: ['Ctrl', 'G'], disabled: true,
        disabledReason: 'Persistent workflow groups are not implemented in the backend schema.', run: () => {} },
    ] : [
      { id: 'add', label: 'Add node', icon: Plus, run: showToolLibrary },
      { id: 'paste', label: 'Paste Node(s)', icon: ClipboardPaste, shortcut: ['Ctrl', 'V'], disabled: !clipboardRef.current.length,
        disabledReason: !clipboardRef.current.length ? 'Copy one or more workflow nodes first.' : undefined,
        run: () => pasteSelection(contextMenu.flowPosition) },
      { id: 'copy-workflow', label: 'Copy Workflow', icon: WorkflowIcon, dividerBefore: true,
        disabled: !nodes.length, run: copyWorkflow },
      { id: 'paste-workflow', label: 'Paste Workflow', icon: ClipboardPaste,
        disabled: !flowClipboardRef.current && !canReadClipboard,
        disabledReason: !flowClipboardRef.current && !canReadClipboard ? 'Copy a CLIPTORA workflow first.' : undefined,
        run: () => void pasteWorkflow() },
      { id: 'tidy', label: 'Tidy Up', icon: LayoutGrid, shortcut: ['Alt', 'T'], disabled: !nodes.length, run: tidyWorkflow },
    ]
    return [
      ...nodeActions,
      { id: 'selectall', label: 'Select All', icon: MousePointer2, shortcut: ['Ctrl', 'A'], dividerBefore: true,
        disabled: !nodes.length, run: () => { setSelectedEdges([]); setSelectedNodeIds(nodes.map(node => node.id)); setSelectedId(nodes[0].id) } },
      { id: 'clear', label: 'Clear Selection', icon: XCircle, disabled: !selectedNodeIds.length && !selectedEdges.length,
        run: () => { setSelectedEdges([]); setSelectedNodeIds([]); setSelectedId(null) } },
      ...(activeNode ? [{ id: 'delete', label: selection.length > 1 ? `Delete ${selection.length} nodes` : 'Delete',
        icon: Trash2, shortcut: ['Del'], dividerBefore: true, destructive: true,
        run: () => deleteNodes(selection) } satisfies ContextMenuAction] : selectedNodeIds.length || selectedEdges.length ? [{
          id: 'delete-selection',
          label: 'Delete Selection',
          icon: Trash2,
          shortcut: ['Del'],
          dividerBefore: true,
          destructive: true,
          run: deleteSelection,
        } satisfies ContextMenuAction] : []),
    ]
  })()

  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-[#fbfbfa]">
      <div className="flex h-[54px] shrink-0 items-center gap-2 overflow-x-auto border-b border-[#e9e9e9] bg-white px-3 [scrollbar-width:none] sm:px-4">
        <button type="button" className={btn} onClick={() => { setActiveId(null); setVersions([]); setName('Untitled Workflow'); replaceNodes([]); setSelectedId(null); setSelectedNodeIds([]); setQuickAdd(null); setViewport(START_VIEWPORT); void flow.current?.setViewport(START_VIEWPORT, { duration: 150 }) }} title="Create an empty workflow"><Plus size={14} /> New</button>
        <button type="button" className={`${btn} hidden sm:inline-flex`} disabled={working || !activeId} onClick={() => void duplicateDefinition()} title="Duplicate workflow"><Copy size={14} /></button>
        <button type="button" className={`${btn} hidden sm:inline-flex`} disabled={working || !activeId} onClick={() => void deleteDefinition()} title="Delete saved workflow"><Trash2 size={14} /></button>
        <button type="button" className={btn} disabled={!canUndo} onClick={undo} title="Undo (Ctrl+Z)" aria-label="Undo"><Undo2 size={15} /></button>
        <button type="button" className={btn} disabled={!canRedo} onClick={redo} title="Redo (Ctrl+Y or Ctrl+Shift+Z)" aria-label="Redo"><Redo2 size={15} /></button>
        <button type="button" className={`${btn} hidden sm:inline-flex`} disabled={!selectedNodeIds.length || nodes.length + selectedNodeIds.length > 100} onClick={duplicateSelectedNodes} title="Duplicate selected nodes (Ctrl+D)"><Copy size={14} /> Nodes</button>
        <div className="min-w-3 flex-1" />
        <div className="inline-flex shrink-0 items-center gap-1" aria-label="Canvas zoom">
          <button type="button" className={btn} title="Zoom out" onClick={() => void flow.current?.zoomOut({ duration: 150 })}><ZoomOut size={15} /></button>
          <span className="min-w-[48px] text-center text-[12px] tabular-nums text-[#545454]">{Math.round(viewport.zoom * 100)}%</span>
          <button type="button" className={btn} title="Zoom in" onClick={() => void flow.current?.zoomIn({ duration: 150 })}><ZoomIn size={15} /></button>
          <button type="button" className={btn} title="Reset zoom to 70%" onClick={() => { setViewport(START_VIEWPORT); void flow.current?.setViewport(START_VIEWPORT, { duration: 150 }) }}><RotateCcw size={15} /></button>
        </div>
        <button type="button" className={btn} onClick={() => setBottomOpen(open => !open)} title={bottomOpen ? 'Hide execution preview' : 'Show execution preview'}>
          {bottomOpen ? <PanelBottomClose size={16} /> : <PanelBottom size={16} />}
          <span className="hidden 2xl:inline">Execution</span>
        </button>
        <button type="button" className={btn} onClick={() => flow.current?.fitView({ padding: 0.32, maxZoom: 0.8, duration: 250 })} title="Fit nodes"><Maximize2 size={15} /></button>
      </div>

      <div
        ref={canvasRef}
        className="relative min-h-0 min-w-0 flex-1 overflow-hidden bg-[#fbfbfa] [&_.react-flow__attribution]:!hidden [&_.react-flow__controls]:!overflow-hidden [&_.react-flow__controls]:!rounded-xl [&_.react-flow__controls]:!border [&_.react-flow__controls]:!border-[#dedede] [&_.react-flow__controls]:!bg-white [&_.react-flow__controls]:!shadow-sm [&_.react-flow__controls-button]:!size-9 [&_.react-flow__controls-button]:!border-[#efefef] [&_.react-flow__controls-button]:!bg-white [&_.react-flow__controls-button]:!fill-[#222] [&_.react-flow__node]:!border-0 [&_.react-flow__node]:!bg-transparent [&_.react-flow__node]:!shadow-none [&_.react-flow__node]:!overflow-visible"
        onDragOver={event => { event.preventDefault(); event.dataTransfer.dropEffect = 'copy' }}
        onDrop={onLibraryDrop}
      >
        <WorkflowManualTriggerExecuteContext.Provider value={{ execute: () => { void studio.start() }, disabled: working }}>
        <WorkflowQuickAddContext.Provider value={openQuickAdd}>
          <ReactFlow<StudioFlowNode, Edge>
            nodes={canvasNodes}
            edges={graphEdges}
            viewport={viewport}
            onViewportChange={setViewport}
            minZoom={0.25}
            maxZoom={1.25}
            fitView={false}
            nodeTypes={flowNodeTypes}
            onInit={instance => { flow.current = instance }}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            isValidConnection={connection => Boolean(connection.source && connection.target && !createsCycle(nodes, connection.source, connection.target) && !flowEdges.some(edge => edge.source === connection.source && edge.target === connection.target))}
            connectionLineStyle={{ stroke: '#8c57ff', strokeWidth: 2.2 }}
            onConnectEnd={(event, state) => {
              if (state.isValid || !state.fromNode || state.fromHandle?.type !== 'source') return
              const pointer = 'changedTouches' in event ? event.changedTouches[0] : event
              const rect = canvasRef.current?.getBoundingClientRect()
              if (!rect || !pointer) return
              if (pointer.clientX < rect.left || pointer.clientX > rect.right || pointer.clientY < rect.top || pointer.clientY > rect.bottom) return
              const position = flow.current?.screenToFlowPosition({ x: pointer.clientX, y: pointer.clientY })
              setQuickSearch('')
              setQuickAdd({
                sourceId: state.fromNode.id,
                sourceHandle: state.fromHandle.id ?? 'main',
                left: Math.max(12, Math.min(pointer.clientX - rect.left + 12, rect.width - 302)),
                top: Math.max(12, Math.min(pointer.clientY - rect.top - 30, rect.height - 330)),
                dropPosition: position ? { x: position.x - 80, y: position.y - 50 } : undefined,
              })
            }}
            nodesDraggable
            nodesConnectable
            elementsSelectable
            panOnDrag
            zoomOnScroll={false}
            panOnScroll
            zoomOnPinch
            zoomOnDoubleClick={false}
            onNodeContextMenu={(event, node) => {
              event.preventDefault()
              event.stopPropagation()
              setSelectedNodeIds(previous => previous.includes(node.id) ? previous : [node.id])
              setSelectedId(node.id)
              openContextMenu('node', node.id, event.clientX, event.clientY)
            }}
            onPaneContextMenu={event => { event.preventDefault(); openContextMenu('pane', undefined, event.clientX, event.clientY) }}
            onEdgeContextMenu={(event, edge) => {
              event.preventDefault()
              event.stopPropagation()
              setSelectedNodeIds([])
              setSelectedId(null)
              setSelectedEdges([edge.id])
              openContextMenu('edge', edge.id, event.clientX, event.clientY)
            }}
            onPaneClick={() => { closeContextMenu(); setQuickAdd(null); setSelectedId(null); setSelectedNodeIds([]); setSelectedEdges([]) }}
            onNodeClick={(_, node) => {
              closeContextMenu()
              setSelectedEdges([])
              setSelectedId(node.id)
              setJsonEditor(JSON.stringify(nodes.find(item => item.id === node.id)?.settings ?? {}, null, 2))
            }}
            onNodeDoubleClick={(_, node) => {
              if (Date.now() - draggedAt.current < 250) return
              setSelectedId(node.id)
              setJsonEditor(JSON.stringify(nodes.find(item => item.id === node.id)?.settings ?? {}, null, 2))
              onOpenNode?.(node.id)
            }}
            onNodeDragStart={() => { draggedAt.current = Date.now(); dragStartNodes.current = clone(nodes) }}
            onNodeDragStop={(_, node) => {
              draggedAt.current = Date.now()
              setNodesTransient(previous => previous.map(item => item.id === node.id ? { ...item, position: node.position } : item))
              if (dragStartNodes.current) commitNodeHistory(dragStartNodes.current)
              dragStartNodes.current = null
            }}
            onEdgesDelete={deleted => setNodes(previous => previous.map(node => {
              const removed = deleted.filter(edge => edge.target === node.id).map(edge => edge.source)
              if (!removed.length) return node
              const sourceHandles = handlesFor(node)
              const removedBranch = removed.some(source => /^(true|false)$/.test(sourceHandles[source] ?? ''))
              removed.forEach(source => { delete sourceHandles[source] })
              return {
                ...node,
                depends_on: node.depends_on.filter(id => !removed.includes(id)),
                when: removedBranch && /^condition_(true|false)$/.test(node.when) ? 'always' : node.when,
                settings: { ...node.settings, [connectionKey]: sourceHandles },
              }
            }))}
            onNodesDelete={deleted => deleted.forEach(node => removeNode(node.id))}
            fitViewOptions={{ padding: 0.32, maxZoom: 0.8 }}
            deleteKeyCode={null}
            colorMode="light"
          >
            <Background color="#ced4dc" gap={24} size={1.3} />
            <Controls showInteractive={false} fitViewOptions={{ padding: 0.32, maxZoom: 0.8, duration: 250 }} />
            <MiniMap zoomable pannable className="!hidden !rounded-xl !border !border-[#ddd] !bg-white !shadow-sm 2xl:!block" nodeColor="#ded8ed" />
          </ReactFlow>
        </WorkflowQuickAddContext.Provider>
        </WorkflowManualTriggerExecuteContext.Provider>

        {contextMenu && <WorkflowContextMenu
          x={contextMenu.clientX}
          y={contextMenu.clientY}
          actions={contextActions}
          onClose={closeContextMenu}
        />}

        {renameDraft && <div className="absolute inset-0 z-[105] flex items-center justify-center bg-[#00000040] px-4" onPointerDown={event => event.stopPropagation()}>
          <form onSubmit={renameNode} className="w-full max-w-[370px] rounded-xl border border-[#e4e4e5] bg-white p-5 shadow-[0_24px_70px_#00000035]">
            <h3 className="text-[16px] font-semibold text-[#202020]">Rename node</h3>
            <input autoFocus value={renameDraft.value} maxLength={100}
              onChange={event => setRenameDraft(value => value ? { ...value, value: event.target.value } : null)}
              onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); setRenameDraft(null) } }}
              className="mt-4 h-11 w-full rounded-md border border-[#b8a6ee] px-3 text-[14px] text-[#222] outline-none focus:ring-2 focus:ring-violet-200" />
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={() => setRenameDraft(null)} className={btn}>Cancel</button>
              <button type="submit" disabled={!renameDraft.value.trim()} className="rounded-md bg-[#252525] px-4 py-2 text-[13px] font-medium text-white disabled:opacity-50">Rename</button>
            </div>
          </form>
        </div>}

        {quickAdd && (
          <div
            role="dialog"
            aria-label="Add next node"
            className="absolute z-[60] flex w-[290px] flex-col overflow-hidden rounded-[12px] border border-[#dddddf] bg-white shadow-[0_14px_42px_#00000025]"
            style={{ left: quickAdd.left, top: quickAdd.top, maxHeight: 'min(420px, 78%)' }}
            onPointerDown={event => event.stopPropagation()}
          >
            <div className="flex shrink-0 items-center justify-between border-b border-[#ededed] px-3 py-2.5">
              <strong className="text-[14px] font-semibold text-[#222]">{quickAdd.mode === 'replace' ? 'Replace node' : 'What happens next?'}</strong>
              <button type="button" className="rounded p-1 text-[#777] hover:bg-[#eee]" onClick={() => setQuickAdd(null)} aria-label="Close"><X size={17} /></button>
            </div>
            <label className="mx-3 mt-3 flex shrink-0 items-center gap-2 rounded-md border border-[#b28dff] px-3 py-2 text-[#777]">
              <Search size={17} />
              <input autoFocus value={quickSearch} onChange={event => setQuickSearch(event.target.value)} placeholder="Search nodes...bbbb" className="w-full min-w-0 border-0 bg-transparent text-[13px] text-[#222] outline-none" />
            </label>
            <div className="mt-2 min-h-0 flex-1 overflow-y-auto pb-2">
              {quickItems.length ? quickItems.map(item => (
                <button key={item.type} type="button" onClick={() => addAfter(item.type)} className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-[#f7f5fa]">
                  <span className="grid size-7 shrink-0 place-items-center"><WorkflowToolIcon type={item.type} label={item.label} size={24} /></span>
                  <span className="min-w-0 flex-1"><strong className="block truncate text-[13px] font-medium text-[#222]">{item.label}</strong><span className="block truncate text-[11px] text-[#858585]">{item.group}</span></span>
                  <Plus size={15} className="text-[#aaa]" />
                </button>
              )) : <p className="px-4 py-4 text-[13px] text-[#777]">No available nodes found.</p>}
            </div>
          </div>
        )}

        {!nodes.length && (
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center px-6 text-center">
            <div className="pointer-events-auto max-w-[300px] rounded-2xl border border-[#e7e7e7] bg-white px-6 py-7 shadow-sm">
              <div className="mx-auto mb-4 grid size-12 place-items-center rounded-xl border border-violet-200 bg-violet-50 text-violet-700"><Plus size={22} /></div>
              <h2 className="text-sm font-semibold text-[#252525]">Start your workflow</h2>
              <p className="mt-2 text-xs leading-5 text-[#858585]">Choose a tool from the left sidebar, or drag one onto the canvas.</p>
              <button type="button" onClick={showToolLibrary} className="mt-4 inline-flex items-center gap-2 rounded-lg bg-[#222] px-4 py-2 text-xs font-semibold text-white hover:bg-[#444]"><Plus size={15} /> Add first tool</button>
            </div>
          </div>
        )}
      </div>
      {bottomOpen && <WorkflowBottomDeck studio={studio} />}
    </section>
  )
}
