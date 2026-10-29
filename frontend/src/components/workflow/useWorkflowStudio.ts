
import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type Dispatch, type DragEvent, type SetStateAction } from 'react'
import type { Connection, Edge, ReactFlowInstance } from '@xyflow/react'
import { api } from '../../lib/api'
import { probeMediaDuration } from '../../lib/media'
import { useEditor } from '../../stores/editorStore'
import { mediaName } from '../editor/library/mediaLibraryUtils'
import type { WorkflowCatalogItem, WorkflowDefinition, WorkflowNode, WorkflowRun, WorkflowSource, WorkflowTemplate, WorkflowVersion } from './workflowTypes'
import type { StudioFlowNode } from './WorkflowNodeCard'
import { clone, errorMessage, preferredNode, uid } from './workflowUtils'

export type WorkflowStudioProps = { projectId: number; initialWorkflowId?: number | null; initialName?: string; onSaved?: (workflow: WorkflowDefinition) => void | Promise<void>; onClose: () => void }
type Mode = 'nodes' | 'runs'
const workflowSnapshot = (name: string, nodes: WorkflowNode[]) => JSON.stringify({ name: name.trim(), nodes })
const sameNodes = (left: WorkflowNode[], right: WorkflowNode[]) => JSON.stringify(left) === JSON.stringify(right)
const sourceIdFromNodes = (nodes: WorkflowNode[]) => {
  const value = nodes.find(node => node.type === 'core.video_source')?.settings.source_id
  return typeof value === 'number' && value > 0 ? value : null
}

export function useWorkflowStudio({ projectId, initialWorkflowId = null, initialName = 'Untitled Workflow', onSaved, onClose }: WorkflowStudioProps) {
  const [catalog, setCatalog] = useState<WorkflowCatalogItem[]>([])
  const [templates, setTemplates] = useState<WorkflowTemplate[]>([])
  const [definitions, setDefinitions] = useState<WorkflowDefinition[]>([])
  const [sources, setSources] = useState<WorkflowSource[]>([])
  const [runs, setRuns] = useState<WorkflowRun[]>([])
  const [versions, setVersions] = useState<WorkflowVersion[]>([])
  const [activeId, setActiveId] = useState<number | null>(null)
  const [name, setName] = useState(initialName)
  const [nodes, setNodesState] = useState<WorkflowNode[]>([])
  const nodesRef = useRef<WorkflowNode[]>([])
  const [historyVersion, setHistoryVersion] = useState(0)
  const nodeHistory = useRef<{ past: WorkflowNode[][]; future: WorkflowNode[][] }>({ past: [], future: [] })
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [jsonEditor, setJsonEditor] = useState('{}')
  const [jsonError, setJsonError] = useState<string | null>(null)
  const [sourceId, setSourceId] = useState<number | null>(null)
  const [run, setRun] = useState<WorkflowRun | null>(null)
  const [working, setWorking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState('')
  const [page, setPage] = useState<Mode>('nodes')
  const [nodeSearch, setNodeSearch] = useState('')
  const [nodeGroup, setNodeGroup] = useState('All')
  const [inspectorTab, setInspectorTab] = useState<'settings' | 'wiring'>('settings')
  const [libraryOpen, setLibraryOpen] = useState(() => {
    try { return window.localStorage.getItem('cliptora.workflow.libraryOpen') !== 'false' }
    catch { return true }
  })
  const toolSearchRef = useRef<HTMLInputElement>(null)
  const lastSavedSnapshot = useRef(workflowSnapshot(initialName, []))
  const failedAutoSaveSnapshot = useRef('')

  const setNodes: Dispatch<SetStateAction<WorkflowNode[]>> = useCallback(value => {
    const previous = nodesRef.current
    const next = typeof value === 'function' ? value(previous) : value
    if (sameNodes(previous, next)) return
    nodeHistory.current.past.push(clone(previous))
    if (nodeHistory.current.past.length > 100) nodeHistory.current.past.shift()
    nodeHistory.current.future = []
    nodesRef.current = next
    setNodesState(next)
    setHistoryVersion(version => version + 1)
  }, [])

  const setNodesTransient: Dispatch<SetStateAction<WorkflowNode[]>> = useCallback(value => {
    const next = typeof value === 'function' ? value(nodesRef.current) : value
    nodesRef.current = next
    setNodesState(next)
  }, [])

  const replaceNodes = useCallback((next: WorkflowNode[]) => {
    const replacement = clone(next)
    nodeHistory.current = { past: [], future: [] }
    nodesRef.current = replacement
    setNodesState(replacement)
    setHistoryVersion(version => version + 1)
  }, [])

  const commitNodeHistory = useCallback((before: WorkflowNode[]) => {
    if (sameNodes(before, nodesRef.current)) return
    nodeHistory.current.past.push(clone(before))
    if (nodeHistory.current.past.length > 100) nodeHistory.current.past.shift()
    nodeHistory.current.future = []
    setHistoryVersion(version => version + 1)
  }, [])

  const undo = useCallback(() => {
    const previous = nodeHistory.current.past.pop()
    if (!previous) return
    nodeHistory.current.future.push(clone(nodesRef.current))
    const replacement = clone(previous)
    nodesRef.current = replacement
    setNodesState(replacement)
    setHistoryVersion(version => version + 1)
  }, [])

  const redo = useCallback(() => {
    const next = nodeHistory.current.future.pop()
    if (!next) return
    nodeHistory.current.past.push(clone(nodesRef.current))
    const replacement = clone(next)
    nodesRef.current = replacement
    setNodesState(replacement)
    setHistoryVersion(version => version + 1)
  }, [])

  const canUndo = useMemo(() => nodeHistory.current.past.length > 0, [historyVersion])
  const canRedo = useMemo(() => nodeHistory.current.future.length > 0, [historyVersion])
  useEffect(() => {
    try { window.localStorage.setItem('cliptora.workflow.libraryOpen', String(libraryOpen)) }
    catch {}
  }, [libraryOpen])

  const showToolLibrary = () => {
    setLibraryOpen(true)
    window.requestAnimationFrame(() => toolSearchRef.current?.focus())
  }

  const editorMedia = useEditor(state => state.media)
  const fileInput = useRef<HTMLInputElement>(null)
  const importInput = useRef<HTMLInputElement>(null)
  const flow = useRef<ReactFlowInstance<StudioFlowNode, Edge> | null>(null)
  const selected = nodes.find(node => node.id === selectedId) ?? null
  const selectedCatalog = catalog.find(item => item.type === selected?.type)
  const hasVideoSource = nodes.some(n => ['core.video_source', 'media.probe', 'audio.extract', 'video.render'].includes(n.type))

  const reload = useCallback(async () => {
    const [catalogRows, templateRows, definitionRows, sourceRows, runRows] = await Promise.all([
      api<WorkflowCatalogItem[]>('/workflows/catalog'),
      api<WorkflowTemplate[]>('/workflows/templates'),
      api<WorkflowDefinition[]>(`/workflows/${projectId}/definitions`),
      api<WorkflowSource[]>(`/workflows/${projectId}/sources`),
      api<WorkflowRun[]>(`/workflows/${projectId}/runs`),
    ])
    setCatalog(catalogRows); setTemplates(templateRows); setDefinitions(definitionRows); setSources(sourceRows); setRuns(runRows)
    const requested = initialWorkflowId ? definitionRows.find(item => item.id === initialWorkflowId) : null
    if (requested) {
      lastSavedSnapshot.current = workflowSnapshot(requested.name, requested.nodes)
      setActiveId(requested.id); setName(requested.name); replaceNodes(requested.nodes); setSelectedId(preferredNode(requested.nodes)); setSourceId(sourceIdFromNodes(requested.nodes))
      void api<WorkflowVersion[]>(`/workflows/${projectId}/definitions/${requested.id}/versions`).then(setVersions).catch(err => setError(errorMessage(err)))
    } else if (initialWorkflowId) {
      setError('Workflow not found or it does not belong to this project.')
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, initialWorkflowId, replaceNodes])

  useEffect(() => {
    let disposed = false
    void reload().catch(e => { if (!disposed) setError(errorMessage(e)) })
    return () => { disposed = true }
  }, [reload])

  useEffect(() => {
    if (!selected) { setJsonEditor('{}'); setJsonError(null); return }
    setJsonEditor(JSON.stringify(selected.settings, null, 2)); setJsonError(null)
  }, [selectedId, selected?.settings])

  useEffect(() => {
    setSourceId(sourceIdFromNodes(nodes))
    if (selectedId && !nodes.some(node => node.id === selectedId)) setSelectedId(preferredNode(nodes))
  }, [nodes, selectedId])

  useEffect(() => {
    if (!run || !['queued', 'running', 'cancelling'].includes(run.state)) return
    let live = true
    const timer = window.setInterval(() => {
      void api<WorkflowRun>(`/workflows/${projectId}/runs/${run.id}`).then(next => {
        if (!live) return
        setRun(next)
        if (next.state === 'completed' || next.state === 'failed' || next.state === 'cancelled') {
          setMessage(next.state === 'completed' ? 'Workflow finished. Inspect node artifacts before applying edits.' : `Run ${next.state}`)
        }
      }).catch(err => { if (live) setError(errorMessage(err)) })
    }, 1400)
    return () => { live = false; window.clearInterval(timer) }
  }, [run?.id, run?.state, projectId])

  const groups = useMemo(() => [...new Set(catalog.map(item => item.group))], [catalog])
  const visibleCatalog = useMemo(() => catalog.filter(item => (nodeGroup === 'All' || item.group === nodeGroup) && `${item.label} ${item.type}`.toLowerCase().includes(nodeSearch.toLowerCase())), [catalog, nodeGroup, nodeSearch])
  const updateNode = (id: string, delta: Partial<WorkflowNode>) => setNodes(prev => prev.map(node => node.id === id ? { ...node, ...delta } : node))
  const setWorkflowSourceId = (value: number | null) => {
    setSourceId(value)
    setNodes(previous => previous.map(node => node.type === 'core.video_source'
      ? { ...node, settings: { ...node.settings, source_id: value } }
      : node))
  }
  const updateSelectedSetting = (key: string, value: unknown) => {
    if (!selected) return
    const settings = { ...selected.settings, [key]: value }
    updateNode(selected.id, { settings }); setJsonEditor(JSON.stringify(settings, null, 2))
  }
  const addNode = (type: string, position?: { x: number; y: number }) => {
    const item = catalog.find(x => x.type === type)
    if (!item || item.status !== 'implemented' || nodes.length >= 100) return
    if (type === 'core.video_source') {
      const existing = nodes.find(node => node.type === type)
      if (existing) { setSelectedId(existing.id); setJsonEditor(JSON.stringify(existing.settings, null, 2)); return }
    }
    const id = uid(type, nodes.map(n => n.id))
    const next: WorkflowNode = { id, type, when: 'always', retry_limit: 1, cache: true, settings: structuredClone(item.settings), depends_on: [], position: position ?? { x: 80 + (nodes.length % 3) * 260, y: 60 + Math.floor(nodes.length / 3) * 150 } }
    setNodes(prev => [...prev, next]); setSelectedId(id)
    setJsonEditor(JSON.stringify(next.settings, null, 2))
    setMessage('New node added. Check its dependencies before running.')
  }
  const removeNode = (id: string) => {
    if (nodes.find(node => node.id === id)?.type === 'core.video_source') setSourceId(null)
    setNodes(prev => prev.filter(node => node.id !== id).map(node => {
      const sourceHandles = node.settings.__cliptora_ui_source_handles
      const nextHandles = sourceHandles && typeof sourceHandles === 'object' && !Array.isArray(sourceHandles)
        ? Object.fromEntries(Object.entries(sourceHandles).filter(([sourceId]) => sourceId !== id))
        : sourceHandles
      return {
        ...node,
        depends_on: node.depends_on.filter(dep => dep !== id),
        settings: nextHandles === sourceHandles ? node.settings : { ...node.settings, __cliptora_ui_source_handles: nextHandles },
      }
    }))
    setSelectedId(prev => prev === id ? null : prev)
  }
  const flowNodes = useMemo<StudioFlowNode[]>(() => nodes.map((node, index) => {
    const result = run?.results?.[node.id]
    const status: StudioFlowNode['data']['status'] = result?.state === 'completed'
      ? 'done'
      : result?.state === 'failed' || (run?.state === 'failed' && run.current_node === node.id)
        ? 'failed'
        : run?.state === 'running' && run.current_node === node.id
          ? 'running'
          : 'waiting'
    const count = Object.entries(result ?? {}).find(([key]) => key.endsWith('_count'))?.[1]
    return {
    id: node.id,
    type: 'studio',
    draggable: node.settings.__cliptora_ui_pinned !== true,
    position: node.position ?? { x: 80 + (index % 3) * 260, y: 60 + Math.floor(index / 3) * 150 },
    data: { label: typeof node.settings.__cliptora_ui_label === 'string' && node.settings.__cliptora_ui_label.trim() ? node.settings.__cliptora_ui_label : (catalog.find(item => item.type === node.type)?.label ?? node.type), pinned: node.settings.__cliptora_ui_pinned === true, nodeType: node.type, subtitle: node.type === 'core.video_source' ? (sources.find(item => item.id === node.settings.source_id)?.filename ?? 'Select a video') : node.depends_on.length ? `${node.depends_on.length} connected input${node.depends_on.length === 1 ? '' : 's'}` : 'Start workflow here', meta: count !== undefined ? `${String(count)} items` : node.when === 'always' ? 'Ready' : `If ${node.when}`, status },
    selected: selectedId === node.id,
  }}), [nodes, catalog, selectedId, run?.results, run?.state, run?.current_node, sources])
  const flowEdges = useMemo<Edge[]>(() => nodes.flatMap(node => node.depends_on.map(dep => ({ id: `${dep}:${node.id}`, source: dep, target: node.id, type: 'smoothstep', animated: run?.state === 'running' && run.current_node === node.id }))), [nodes, run?.state, run?.current_node])
  const connect = (connection: Connection) => {
    if (!connection.source || !connection.target || connection.source === connection.target) return
    updateNode(connection.target, { depends_on: [...new Set([...(nodes.find(node => node.id === connection.target)?.depends_on ?? []), connection.source])] })
  }
  const applySettings = () => {
    if (!selected) return
    try {
      const parsed: unknown = JSON.parse(jsonEditor)
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw Error('Settings must be a JSON object')
      updateNode(selected.id, { settings: parsed as Record<string, unknown> })
      setJsonError(null); setMessage('Node settings updated. Save workflow to persist.')
    } catch (err) { setJsonError(errorMessage(err)) }
  }
  const openDefinition = (definition: WorkflowDefinition) => {
    lastSavedSnapshot.current = workflowSnapshot(definition.name, definition.nodes)
    failedAutoSaveSnapshot.current = ''
    setActiveId(definition.id); setName(definition.name); replaceNodes(definition.nodes); setSelectedId(preferredNode(definition.nodes)); setSourceId(sourceIdFromNodes(definition.nodes))
    setJsonEditor(JSON.stringify(definition.nodes[0]?.settings ?? {}, null, 2)); setPage('nodes'); setError(null)
    void api<WorkflowVersion[]>(`/workflows/${projectId}/definitions/${definition.id}/versions`).then(setVersions).catch(err => setError(errorMessage(err)))
  }
  const openTemplate = (template: WorkflowTemplate) => {
    lastSavedSnapshot.current = ''
    failedAutoSaveSnapshot.current = ''
    setActiveId(null); setVersions([]); setName(template.name); replaceNodes(template.nodes); setSelectedId(preferredNode(template.nodes)); setSourceId(sourceIdFromNodes(template.nodes))
    setJsonEditor(JSON.stringify(template.nodes[0]?.settings ?? {}, null, 2)); setPage('nodes'); setMessage(`Template loaded: ${template.name}. Save it to your project.`)
  }
  const save = async (automatic = false): Promise<WorkflowDefinition | null> => {
    setWorking(true); setError(null)
    try {
      const data = { name: name.trim(), nodes }
      const result = activeId
        ? await api<WorkflowDefinition>(`/workflows/${projectId}/definitions/${activeId}`, { method: 'PUT', body: JSON.stringify(data) })
        : await api<WorkflowDefinition>(`/workflows/${projectId}/definitions`, { method: 'POST', body: JSON.stringify(data) })
      setActiveId(result.id)
      lastSavedSnapshot.current = workflowSnapshot(result.name, result.nodes)
      failedAutoSaveSnapshot.current = ''
      setName(result.name)
      const savedNodes = clone(result.nodes)
      nodesRef.current = savedNodes
      setNodesState(savedNodes)
      setDefinitions(previous => [result, ...previous.filter(item => item.id !== result.id)])
      await onSaved?.(result)
      setMessage(automatic ? 'Changes saved automatically.' : 'Workflow saved to MySQL.')
      return result
    } catch (err) {
      if (automatic) failedAutoSaveSnapshot.current = workflowSnapshot(name, nodes)
      setError(errorMessage(err)); return null
    }
    finally { setWorking(false) }
  }
  const currentSnapshot = useMemo(() => workflowSnapshot(name, nodes), [name, nodes])
  useEffect(() => {
    if (!nodes.length || !name.trim() || working || currentSnapshot === lastSavedSnapshot.current || currentSnapshot === failedAutoSaveSnapshot.current) return
    const timer = window.setTimeout(() => { void save(true) }, 650)
    return () => window.clearTimeout(timer)
  // save deliberately uses the latest render captured by this snapshot change.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentSnapshot, working])
  useEffect(() => {
    if (currentSnapshot === lastSavedSnapshot.current) return
    const warnBeforeLeaving = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', warnBeforeLeaving)
    return () => window.removeEventListener('beforeunload', warnBeforeLeaving)
  }, [currentSnapshot])
  const start = async () => {
    const definition = await save()
    if (!definition) return
    if (hasVideoSource && !sourceId) { setError('Upload/select a video in Sources first.'); return }
    setWorking(true); setError(null)
    try {
      const next = await api<WorkflowRun>(`/workflows/${projectId}/runs`, { method: 'POST', body: JSON.stringify({ workflow_id: definition.id, source_id: sourceId }) })
      setRun(next); setRuns(prev => [next, ...prev]); setPage('runs'); setMessage('Workflow queued. You can monitor each node here.')
    } catch (err) { setError(errorMessage(err)) }
    finally { setWorking(false) }
  }
  const testStep = async (nodeId: string) => {
    if (!nodes.some(node => node.id === nodeId)) { setError('The selected node no longer exists.'); return }
    const definition = await save()
    if (!definition) return
    const required = new Set<string>()
    const byId = new Map(nodes.map(node => [node.id, node]))
    const include = (id: string) => {
      if (required.has(id)) return
      required.add(id)
      for (const dependency of byId.get(id)?.depends_on ?? []) include(dependency)
    }
    include(nodeId)
    const stepNeedsVideo = nodes.some(node => required.has(node.id) && ['core.video_source', 'media.probe', 'audio.extract', 'video.render'].includes(node.type))
    if (stepNeedsVideo && !sourceId) { setError('Upload/select a video before testing this step.'); return }
    setWorking(true); setError(null)
    try {
      const next = await api<WorkflowRun>(`/workflows/${projectId}/runs`, {
        method: 'POST',
        body: JSON.stringify({ workflow_id: definition.id, source_id: sourceId, target_node_id: nodeId }),
      })
      setRun(next); setRuns(previous => [next, ...previous.filter(item => item.id !== next.id)])
      setMessage(`Testing ${nodeId} with its required upstream nodes.`)
    } catch (err) { setError(errorMessage(err)) }
    finally { setWorking(false) }
  }
  const upload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    setWorking(true); setError(null)
    try {
      const data = new FormData(); data.append('file', file)
      const source = await api<WorkflowSource>(`/workflows/${projectId}/sources`, { method: 'POST', body: data })
      setSources(prev => [source, ...prev]); setWorkflowSourceId(source.id); setMessage('Video uploaded and selected in the Source Video node.')
    } catch (err) { setError(errorMessage(err)) }
    finally { setWorking(false); event.target.value = '' }
  }
  const useMediaSource = async (mediaId: number) => {
    if (!mediaId) return
    setWorking(true); setError(null)
    try {
      const source = await api<WorkflowSource>(`/workflows/${projectId}/sources/from-media/${mediaId}`, { method: 'POST' })
      setSources(previous => [source, ...previous]); setWorkflowSourceId(source.id); setMessage('Media Library video linked to the Source Video node.')
    } catch (err) { setError(errorMessage(err)) }
    finally { setWorking(false) }
  }
  const fetchArtifact = async (nodeId: string) => {
    if (!run) return
    setWorking(true); setError(null)
    try {
      const payload = await api<Record<string, unknown>>(`/workflows/${projectId}/runs/${run.id}/artifacts/${nodeId}`)
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a'); anchor.href = url; anchor.download = `${nodeId}_${run.id}.json`; anchor.click()
      window.setTimeout(() => URL.revokeObjectURL(url), 10000)
    } catch (err) { setError(errorMessage(err)) }
    finally { setWorking(false) }
  }
  const downloadVideo = async () => {
    if (!run) return
    setWorking(true); setError(null)
    try {
      const base = import.meta.env.VITE_API_URL ?? 'http://127.0.0.1:8000/api/v1'
      const response = await fetch(`${base}/workflows/${projectId}/runs/${run.id}/video`, { credentials: 'include' })
      if (!response.ok) throw Error(`Video unavailable (HTTP ${response.status})`)
      const url = URL.createObjectURL(await response.blob())
      const anchor = document.createElement('a'); anchor.href = url; anchor.download = `cliptora_run_${run.id}.mp4`; anchor.click()
      window.setTimeout(() => URL.revokeObjectURL(url), 10000)
    } catch (err) { setError(errorMessage(err)) }
    finally { setWorking(false) }
  }

  const applyCutPlan = async () => {
    if (!run || run.state !== 'completed') return
    const source = sources.find(s => s.id === run.source_id)
    if (!source) { setError('This run has no video source.'); return }
    const mediaMatches = useEditor.getState().media.filter(m => m.kind === 'video' && (source.media_id ? m.id === source.media_id : mediaName(m).toLowerCase() === source.filename.toLowerCase()))
    if (mediaMatches.length !== 1) {
      setError('Import the SAME video into Media Library first (with same filename), then retry. Found ' + mediaMatches.length + ' matches.'); return
    }
    const cutNode = Object.entries(run.results ?? {}).find(([, value]) => value.type === 'timeline.cut_plan' && value.state === 'completed')
    if (!cutNode) { setError('No completed cut plan in this run'); return }
    if (!window.confirm('Add the proposed highlights as NEW Timeline clips? Existing Timeline clips are not deleted.')) return
    setWorking(true); setError(null)
    try {
      const artifact = await api<{ cut_plan: Array<{ source_start: number; source_end: number; timeline_start: number; duration: number }> }>(`/workflows/${projectId}/runs/${run.id}/artifacts/${cutNode[0]}`)
      const plans = artifact.cut_plan
      if (!Array.isArray(plans) || plans.length === 0) throw Error('Cut plan is empty')
      const media = mediaMatches[0]
      const measure = await probeMediaDuration(media)
      if (measure.measured) useEditor.getState().setMediaDuration(media.id, measure.duration)
      const before = useEditor.getState()
      const existingEnd = before.tracks.reduce((max, t) => Math.max(max, ...t.clips.map(c => c.start + c.duration), 0), 0)
      let newTrack: string | null = null
      let inserted = 0
      let offset = 0
      for (const cut of plans) {
        if (![cut.source_start, cut.source_end, cut.duration].every(Number.isFinite) || cut.duration < 0.1 || cut.source_start < 0) continue
        const state = useEditor.getState()
        const ids = new Set(state.tracks.flatMap(t => t.clips.map(c => c.client_id)))
        const added = state.addMediaClipAt(media, cut.duration, newTrack, existingEnd + offset, 'bottom')
        if (!added) break
        const updated = useEditor.getState()
        const created = updated.tracks.flatMap(t => t.clips).find(c => !ids.has(c.client_id) && String(c.media_id) === String(media.id))
        if (!created) break
        if (!newTrack) newTrack = updated.tracks.find(t => t.clips.some(c => c.client_id === created.client_id))?.client_id ?? null
        updated.patchClip(created.client_id, { duration: cut.duration, source_offset: cut.source_start, start: existingEnd + offset })
        offset += cut.duration
        inserted++
      }
      setMessage(`Added ${inserted}/${plans.length} clips to Timeline. Autosave will persist them. Review and save before exporting.`)
      if (inserted < plans.length) setError('Stopped early: layer/timeline limit or media placement rejected some clips.')
    } catch (err) { setError(errorMessage(err)) }
    finally { setWorking(false) }
  }

  const cancel = async () => {
    if (!run) return
    try { setRun(await api<WorkflowRun>(`/workflows/${projectId}/runs/${run.id}/cancel`, { method: 'POST' })) }
    catch (err) { setError(errorMessage(err)) }
  }
  const retry = async () => {
    if (!run) return
    try { const next = await api<WorkflowRun>(`/workflows/${projectId}/runs/${run.id}/retry`, { method: 'POST' }); setRun(next); setMessage('Run queued again. Matching completed-node checkpoints will be reused.') }
    catch (err) { setError(errorMessage(err)) }
  }
  const chooseRun = (item: WorkflowRun) => { setRun(item); setPage('nodes'); setError(null) }
  const dropNode = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    const type = event.dataTransfer.getData('text/cliptora-node')
    if (type && catalog.some(node => node.type === type)) addNode(type, flow.current?.screenToFlowPosition({ x: event.clientX, y: event.clientY }))
  }
  const exportWorkflow = () => {
    const blob = new Blob([JSON.stringify({ schema: 'cliptora.workflow.v1', name, nodes }, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = `${name.replace(/[^a-z0-9_-]+/gi, '_') || 'workflow'}.json`; anchor.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 10000)
  }
  const importWorkflow = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    try {
      const value: unknown = JSON.parse(await file.text())
      if (!value || typeof value !== 'object' || !Array.isArray((value as { nodes?: unknown }).nodes)) throw Error('Invalid CLIPTORA workflow JSON')
      const imported = value as { name?: unknown; nodes: WorkflowNode[] }
      setActiveId(null); setName(typeof imported.name === 'string' ? imported.name.slice(0, 160) : file.name.replace(/\.json$/i, ''))
      replaceNodes(imported.nodes); setSelectedId(imported.nodes[0]?.id ?? null); setSourceId(sourceIdFromNodes(imported.nodes)); setMessage('Workflow imported locally. Save to validate and persist it.')
    } catch (err) { setError(errorMessage(err)) }
    finally { event.target.value = '' }
  }
  const duplicateDefinition = async () => {
    if (!activeId) return
    setWorking(true)
    try {
      const copy = await api<WorkflowDefinition>(`/workflows/${projectId}/definitions/${activeId}/duplicate`, { method: 'POST' })
      setDefinitions(previous => [copy, ...previous]); openDefinition(copy); setMessage('Workflow duplicated with independent version history.')
    } catch (err) { setError(errorMessage(err)) }
    finally { setWorking(false) }
  }
  const restoreVersion = async (version: number) => {
    if (!activeId || !window.confirm(`Restore version ${version} as a new current version?`)) return
    setWorking(true)
    try {
      const restored = await api<WorkflowDefinition>(`/workflows/${projectId}/definitions/${activeId}/versions/${version}/restore`, { method: 'POST' })
      setDefinitions(previous => [restored, ...previous.filter(item => item.id !== restored.id)]); openDefinition(restored)
      setMessage(`Version ${version} restored as version ${restored.version}.`)
    } catch (err) { setError(errorMessage(err)) }
    finally { setWorking(false) }
  }
  const deleteDefinition = async () => {
    if (!activeId || !window.confirm('Delete this saved workflow? Runs will remain accessible.')) return
    setWorking(true)
    try {
      await api<void>(`/workflows/${projectId}/definitions/${activeId}`, { method: 'DELETE' })
      setDefinitions(prev => prev.filter(x => x.id !== activeId)); setActiveId(null)
      setMessage('Workflow deleted. Current canvas remains unsaved.')
    } catch (err) { setError(errorMessage(err)) }
    finally { setWorking(false) }
  }

  const source = sources.find(item => item.id === sourceId) ?? null
  const previewMedia = source?.media_id ? editorMedia.find(item => item.id === source.media_id) : null
  const completedNodes = Object.values(run?.results ?? {}).filter(item => item.state === 'completed').length
  const downstream = selected ? nodes.filter(node => node.depends_on.includes(selected.id)) : []
  const waitingNodes = Math.max(0, nodes.length - completedNodes)

  return {
    projectId, onClose,
    catalog, templates, definitions, sources, runs, versions, setVersions,
    activeId, setActiveId, name, setName, nodes, setNodes, setNodesTransient, replaceNodes, commitNodeHistory,
    undo, redo, canUndo, canRedo,
    selectedId, setSelectedId, jsonEditor, setJsonEditor, jsonError, setJsonError,
    sourceId, setSourceId: setWorkflowSourceId, run, setRun, working, error, setError, message, setMessage,
    page, setPage, nodeSearch, setNodeSearch, nodeGroup, setNodeGroup,
    inspectorTab, setInspectorTab, libraryOpen, setLibraryOpen, toolSearchRef, showToolLibrary,
    editorMedia, fileInput, importInput, flow, selected, selectedCatalog, hasVideoSource,
    groups, visibleCatalog, updateNode, updateSelectedSetting, addNode, removeNode,
    flowNodes, flowEdges, connect, applySettings, openDefinition, openTemplate, save,
    start, testStep, upload, useMediaSource, fetchArtifact, downloadVideo, applyCutPlan, cancel,
    retry, chooseRun, dropNode, exportWorkflow, importWorkflow, duplicateDefinition,
    restoreVersion, deleteDefinition, previewMedia, completedNodes, downstream, waitingNodes,
  }
}

export type WorkflowStudioState = ReturnType<typeof useWorkflowStudio>
