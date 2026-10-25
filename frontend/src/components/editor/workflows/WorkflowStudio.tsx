import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ChangeEvent, type DragEvent } from 'react'
import {
  ArrowRight, AudioLines, Captions, Check, CheckCircle2, ChevronDown, ChevronRight, CircleHelp, Clock3, Copy,
  Download, Film, FolderOpen, Gauge, GitBranch, Home, Import, Layers3, LoaderCircle, Maximize2,
  MoreHorizontal, Move3D, Play, Plus, Save, Scissors, Search, Settings, Settings2, Sparkles,
  Subtitles, Trash2, Upload, WandSparkles, X, Zap,
} from 'lucide-react'
import { Background, Controls, Handle, Position, ReactFlow, type Connection, type Edge, type Node as FlowNode, type NodeProps, type ReactFlowInstance } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { api, fileUrl } from '../../../lib/api'
import { probeMediaDuration } from '../../../lib/media'
import { useEditor } from '../../../stores/editorStore'
import { mediaName } from '../library/mediaLibraryUtils'
import type { WorkflowCatalogItem, WorkflowDefinition, WorkflowNode, WorkflowRun, WorkflowSource, WorkflowTemplate, WorkflowVersion } from './workflowTypes'
import './WorkflowStudio.css'

type Props = { projectId: number; onClose: () => void }
type Mode = 'nodes' | 'runs'
const CONDS: WorkflowNode['when'][] = ['always', 'has_video', 'has_transcript', 'ai_enabled']
const card = 'rounded-xl border border-[#303441] bg-[#171a21]'
const btn = 'rounded-lg border border-[#343b4b] bg-[#212630] px-3 py-2 text-xs text-[#e3e6ef] hover:bg-[#2c3040] disabled:cursor-not-allowed disabled:opacity-40'
const accent = 'rounded-lg bg-[#7038dd] px-4 py-2 text-xs font-semibold text-white hover:bg-[#8758f3] disabled:opacity-40'
const uid = (type: string, used: string[]) => {
  const base = type.replace(/[^a-zA-Z0-9]/g, '_').slice(0, 25)
  let name = base
  let n = 2
  while (used.includes(name)) name = `${base}_${n++}`
  return name
}
const clone = (nodes: WorkflowNode[]) => nodes.map((node, index) => ({ ...node, settings: structuredClone(node.settings), depends_on: [...node.depends_on], position: node.position ?? { x: 80 + (index % 3) * 260, y: 60 + Math.floor(index / 3) * 150 } }))
const preferredNode = (nodes: WorkflowNode[]) => nodes.find(node => node.type === 'ai.highlights')?.id ?? nodes[0]?.id ?? null
const errorMessage = (err: unknown) => err instanceof Error ? err.message : String(err)
const accentFor = (type: string) => type.startsWith('ai.') ? '#f34aa9' : type.startsWith('audio.') ? '#2a9dff' : type.startsWith('caption.') ? '#f6b72f' : type.startsWith('video.') ? '#ff457d' : type.startsWith('timeline.') ? '#20c997' : type.startsWith('animation.') ? '#9a55ff' : '#7057f5'
const iconFor = (type: string, size = 15) => {
  if (type.includes('transcribe')) return <AudioLines size={size}/>
  if (type.includes('highlight') || type.includes('summary')) return <Sparkles size={size}/>
  if (type.includes('caption')) return <Captions size={size}/>
  if (type.includes('render')) return <Film size={size}/>
  if (type.includes('cut')) return <Scissors size={size}/>
  if (type.includes('animation')) return <Move3D size={size}/>
  if (type.includes('audio')) return <AudioLines size={size}/>
  if (type.includes('media') || type.includes('video')) return <Film size={size}/>
  return <GitBranch size={size}/>
}

type StudioFlowNode = FlowNode<{ label: string; nodeType: string; subtitle: string; meta: string; status: 'done' | 'running' | 'waiting' }, 'studio'>
function StudioNodeCard({ data, selected }: NodeProps<StudioFlowNode>) {
  const accent = accentFor(data.nodeType)
  return <div className={`ws-node-card ${selected ? 'is-selected' : ''}`} style={{ '--node-accent': accent } as CSSProperties}>
    <Handle type="target" position={Position.Left} className="ws-handle"/>
    <div className="ws-node-head"><span className="ws-node-icon">{iconFor(data.nodeType)}</span><strong>{data.label}</strong><span className={`ws-node-status ${data.status}`}>{data.status === 'done' ? <Check size={12}/> : data.status === 'running' ? <LoaderCircle size={12}/> : <Clock3 size={11}/>}</span></div>
    <div className="ws-node-body"><span>{data.subtitle}</span><span>{data.meta}</span></div>
    <Handle type="source" position={Position.Right} className="ws-handle"/>
  </div>
}
const flowNodeTypes = { studio: StudioNodeCard }

export function WorkflowStudio({ projectId, onClose }: Props) {
  const [catalog, setCatalog] = useState<WorkflowCatalogItem[]>([])
  const [templates, setTemplates] = useState<WorkflowTemplate[]>([])
  const [definitions, setDefinitions] = useState<WorkflowDefinition[]>([])
  const [sources, setSources] = useState<WorkflowSource[]>([])
  const [runs, setRuns] = useState<WorkflowRun[]>([])
  const [versions, setVersions] = useState<WorkflowVersion[]>([])
  const [activeId, setActiveId] = useState<number | null>(null)
  const [name, setName] = useState('Untitled Workflow')
  const [nodes, setNodes] = useState<WorkflowNode[]>([])
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
  const [inspectorTab, setInspectorTab] = useState<'settings' | 'input' | 'output'>('settings')
  const editorMedia = useEditor(state => state.media)
  const fileInput = useRef<HTMLInputElement>(null)
  const importInput = useRef<HTMLInputElement>(null)
  const flow = useRef<ReactFlowInstance<StudioFlowNode, Edge> | null>(null)
  const selected = nodes.find(node => node.id === selectedId) ?? null
  const selectedCatalog = catalog.find(item => item.type === selected?.type)
  const hasVideoSource = nodes.some(n => ['media.probe', 'audio.extract', 'video.render'].includes(n.type))

  const reload = useCallback(async () => {
    const [catalogRows, templateRows, definitionRows, sourceRows, runRows] = await Promise.all([
      api<WorkflowCatalogItem[]>('/workflows/catalog'),
      api<WorkflowTemplate[]>('/workflows/templates'),
      api<WorkflowDefinition[]>(`/workflows/${projectId}/definitions`),
      api<WorkflowSource[]>(`/workflows/${projectId}/sources`),
      api<WorkflowRun[]>(`/workflows/${projectId}/runs`),
    ])
    setCatalog(catalogRows); setTemplates(templateRows); setDefinitions(definitionRows); setSources(sourceRows); setRuns(runRows)
    if (!nodes.length && !activeId && templateRows[0]) {
      setName(templateRows[0].name); setNodes(clone(templateRows[0].nodes)); setSelectedId(preferredNode(templateRows[0].nodes))
    }
  // First load only; manually invoke refresh after changes so no unsaved state is discarded.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId])

  useEffect(() => {
    let disposed = false
    void reload().catch(e => { if (!disposed) setError(errorMessage(e)) })
    return () => { disposed = true }
  }, [reload])

  useEffect(() => {
    if (!selected) { setJsonEditor('{}'); setJsonError(null); return }
    setJsonEditor(JSON.stringify(selected.settings, null, 2)); setJsonError(null)
  }, [selectedId]) // Deliberately not on every settings change while typing

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
  const updateSelectedSetting = (key: string, value: unknown) => {
    if (!selected) return
    const settings = { ...selected.settings, [key]: value }
    updateNode(selected.id, { settings }); setJsonEditor(JSON.stringify(settings, null, 2))
  }
  const addNode = (type: string, position?: { x: number; y: number }) => {
    const item = catalog.find(x => x.type === type)
    if (!item || nodes.length >= 100) return
    const id = uid(type, nodes.map(n => n.id))
    const next: WorkflowNode = { id, type, when: 'always', retry_limit: 1, cache: true, settings: structuredClone(item.settings), depends_on: [], position: position ?? { x: 80 + (nodes.length % 3) * 260, y: 60 + Math.floor(nodes.length / 3) * 150 } }
    setNodes(prev => [...prev, next]); setSelectedId(id)
    setJsonEditor(JSON.stringify(next.settings, null, 2))
    setMessage('New node added. Check its dependencies before running.')
  }
  const removeNode = (id: string) => {
    setNodes(prev => prev.filter(node => node.id !== id).map(node => ({ ...node, depends_on: node.depends_on.filter(dep => dep !== id) })))
    setSelectedId(prev => prev === id ? null : prev)
  }
  const flowNodes = useMemo<StudioFlowNode[]>(() => nodes.map((node, index) => {
    const result = run?.results?.[node.id]
    const status: StudioFlowNode['data']['status'] = result?.state === 'completed' ? 'done' : run?.state === 'running' && run.current_node === node.id ? 'running' : 'waiting'
    const count = Object.entries(result ?? {}).find(([key]) => key.endsWith('_count'))?.[1]
    return {
    id: node.id,
    type: 'studio',
    position: node.position ?? { x: 80 + (index % 3) * 260, y: 60 + Math.floor(index / 3) * 150 },
    data: { label: catalog.find(item => item.type === node.type)?.label ?? node.type, nodeType: node.type, subtitle: node.depends_on.length ? `${node.depends_on.length} connected input${node.depends_on.length === 1 ? '' : 's'}` : 'Start workflow here', meta: count !== undefined ? `${String(count)} items` : node.when === 'always' ? 'Ready' : `If ${node.when}`, status },
    selected: selectedId === node.id,
  }}), [nodes, catalog, selectedId, run?.results, run?.state, run?.current_node])
  const flowEdges = useMemo<Edge[]>(() => nodes.flatMap(node => node.depends_on.map(dep => ({ id: `${dep}:${node.id}`, source: dep, target: node.id, animated: run?.state === 'running' && run.current_node === node.id, style: { stroke: '#9467dc' } }))), [nodes, run?.state, run?.current_node])
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
    setActiveId(definition.id); setName(definition.name); setNodes(clone(definition.nodes)); setSelectedId(preferredNode(definition.nodes))
    setJsonEditor(JSON.stringify(definition.nodes[0]?.settings ?? {}, null, 2)); setPage('nodes'); setError(null)
    void api<WorkflowVersion[]>(`/workflows/${projectId}/definitions/${definition.id}/versions`).then(setVersions).catch(err => setError(errorMessage(err)))
  }
  const openTemplate = (template: WorkflowTemplate) => {
    setActiveId(null); setVersions([]); setName(template.name); setNodes(clone(template.nodes)); setSelectedId(preferredNode(template.nodes))
    setJsonEditor(JSON.stringify(template.nodes[0]?.settings ?? {}, null, 2)); setPage('nodes'); setMessage(`Template loaded: ${template.name}. Save it to your project.`)
  }
  const save = async (): Promise<WorkflowDefinition | null> => {
    setWorking(true); setError(null)
    try {
      const data = { name: name.trim(), nodes }
      const result = activeId
        ? await api<WorkflowDefinition>(`/workflows/${projectId}/definitions/${activeId}`, { method: 'PUT', body: JSON.stringify(data) })
        : await api<WorkflowDefinition>(`/workflows/${projectId}/definitions`, { method: 'POST', body: JSON.stringify(data) })
      setActiveId(result.id)
      setDefinitions(previous => [result, ...previous.filter(item => item.id !== result.id)])
      setMessage('Workflow saved to MySQL.')
      return result
    } catch (err) { setError(errorMessage(err)); return null }
    finally { setWorking(false) }
  }
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
  const upload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    setWorking(true); setError(null)
    try {
      const data = new FormData(); data.append('file', file)
      const source = await api<WorkflowSource>(`/workflows/${projectId}/sources`, { method: 'POST', body: data })
      setSources(prev => [source, ...prev]); setSourceId(source.id); setMessage('Video uploaded for workflow processing.')
    } catch (err) { setError(errorMessage(err)) }
    finally { setWorking(false); event.target.value = '' }
  }
  const useMediaSource = async (mediaId: number) => {
    if (!mediaId) return
    setWorking(true); setError(null)
    try {
      const source = await api<WorkflowSource>(`/workflows/${projectId}/sources/from-media/${mediaId}`, { method: 'POST' })
      setSources(previous => [source, ...previous]); setSourceId(source.id); setMessage('Media Library video linked as the workflow source.')
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
      // Append to the current Timeline end, never erase existing clips.
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
      setNodes(clone(imported.nodes)); setSelectedId(imported.nodes[0]?.id ?? null); setMessage('Workflow imported locally. Save to validate and persist it.')
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

  return <div className="ws-shell" role="dialog" aria-modal="true" aria-label="CLIPTORA Workflow Studio">
    <header className="ws-topbar">
      <span className="ws-brand"><img src="/assets/logo.png" alt=""/><strong>Cliptora</strong></span>
      <nav className="ws-breadcrumb" aria-label="Breadcrumb"><Home size={14}/><ChevronRight size={13}/><span>Projects</span><ChevronRight size={13}/><span>Project {projectId}</span><ChevronRight size={13}/><strong>Workflow Studio</strong></nav>
      <span className="ws-save-state"><CheckCircle2 size={14}/> {activeId ? 'All changes saved' : 'Unsaved workflow'}</span>
      <div className="ws-top-actions">
        <button type="button" className="ws-icon-button" onClick={() => importInput.current?.click()} title="Import workflow"><Import size={15}/></button>
        <button type="button" className="ws-primary" disabled={working || !nodes.length} onClick={() => void start()}>{working ? <LoaderCircle size={15} className="animate-spin"/> : <Play size={15}/>} Run Workflow</button>
        <button type="button" className="ws-secondary" disabled={run?.state !== 'completed'} onClick={() => void downloadVideo()}><Upload size={15}/> Export Video</button>
        <button type="button" className="ws-icon-button" onClick={exportWorkflow} title="Export workflow JSON"><MoreHorizontal size={17}/></button>
        <button type="button" className="ws-avatar" onClick={onClose} aria-label="Close Workflow Studio">M</button>
      </div>
    </header>
    {error && <div role="alert" className="shrink-0 border-b border-red-900 bg-red-950/60 px-4 py-2 text-xs text-red-200">{error}<button className="ml-3 font-bold" onClick={() => setError(null)}>×</button></div>}
    {message && <div className="shrink-0 border-b border-[#293043] px-4 py-2 text-xs text-[#bfcce2]">{message}</div>}
    <div className="ws-body">
      <aside className="ws-app-nav" aria-label="Editor navigation">
        {[['Dashboard', Home], ['Media', Film], ['AI Studio', Sparkles], ['Subtitles', Subtitles], ['Components', Layers3], ['Effects', WandSparkles], ['Animations', Move3D], ['Workflow', GitBranch], ['Timeline', Gauge], ['Preview', Play], ['Export', Upload]].map(([label, Icon]) => <button key={String(label)} className={label === 'Workflow' ? 'active' : ''}><Icon size={17}/><span>{String(label)}</span></button>)}
        <div className="ws-nav-spacer"/><button><Settings size={17}/><span>Settings</span></button><button><CircleHelp size={17}/><span>Help</span></button>
      </aside>
      <aside className="ws-node-library">
        <div className="ws-panel-title"><strong>Nodes</strong><span><Zap size={13}/><Maximize2 size={13}/></span></div>
        <label className="ws-search"><Search size={14}/><input value={nodeSearch} onChange={event => setNodeSearch(event.target.value)} placeholder="Search nodes…"/></label>
        <div className="ws-filter-tabs">{['All', ...groups.slice(0, 4)].map(group => <button key={group} className={nodeGroup === group ? 'active' : ''} onClick={() => setNodeGroup(group)}>{group === 'Analysis' ? 'Video' : group === 'Creative' ? 'Edit' : group}</button>)}</div>
        <div className="ws-library-meta">
        <p className="mb-2 text-xs font-semibold text-[#9fa9ba]">START FROM TEMPLATE</p>
        <div className="space-y-2">{templates.map(t => <button key={t.key} type="button" onClick={() => openTemplate(t)} className={`${card} w-full p-3 text-left hover:border-[#794bc2]`}><span className="block text-xs font-semibold">{t.name}</span><span className="mt-1 block text-[10px] leading-4 text-[#9aa4b5]">{t.description}</span></button>)}</div>
        <div className="my-4 h-px bg-[#2c3140]"/>
        <p className="mb-2 text-xs font-semibold text-[#9fa9ba]">SAVED WORKFLOWS</p>
        {definitions.length ? definitions.map(d => <button key={d.id} onClick={() => openDefinition(d)} className={`mb-1 w-full truncate rounded-lg px-3 py-2 text-left text-xs ${activeId === d.id ? 'bg-[#4e3079] text-white' : 'bg-[#1b1f28] text-[#c3cbd7] hover:bg-[#30303b]'}`}>{d.name}</button>) : <p className="text-[11px] text-[#808c9c]">No saved workflows yet</p>}
        {activeId && versions.length > 1 && <div className="mt-2 rounded-lg border border-[#303647] bg-[#151923] p-2"><p className="mb-1 text-[10px] text-[#929db0]">VERSION HISTORY</p>{versions.slice(0, 5).map(version => <button key={version.id} disabled={working || version.version === definitions.find(item => item.id === activeId)?.version} onClick={() => void restoreVersion(version.version)} className="flex w-full items-center justify-between rounded px-2 py-1 text-[10px] text-[#cbd3e1] hover:bg-[#252b39] disabled:opacity-40"><span>v{version.version}</span><span>{new Date(version.created_at).toLocaleString()}</span></button>)}</div>}
        </div>
        <div className="ws-node-list">{groups.map(group => {
          const items = visibleCatalog.filter(item => item.group === group)
          if (!items.length) return null
          return <section key={group}><h3>{group}<ChevronDown size={13}/></h3>{items.map(item => <button draggable onDragStart={event => event.dataTransfer.setData('text/cliptora-node', item.type)} key={item.type} onClick={() => addNode(item.type)} className="ws-library-node"><span style={{ background: accentFor(item.type) }}>{iconFor(item.type, 16)}</span><span><strong>{item.label}</strong><small>{item.type.replace('.', ' · ')}</small></span></button>)}</section>
        })}</div>
      </aside>
      {page === 'nodes' ? <section className="ws-workspace">
        <div className="ws-canvas-heading">
          <div><span className="ws-name-row"><input aria-label="Workflow name" value={name} onChange={event => setName(event.target.value)}/><Settings2 size={13}/></span><small>Automate your edit with a reusable AI workflow</small></div>
          <div className="ws-canvas-tools">
            <select aria-label="Workflow template" value="" onChange={event => { const template = templates.find(item => item.key === event.target.value); if (template) openTemplate(template) }}><option value="">Template: Custom</option>{templates.map(template => <option key={template.key} value={template.key}>{template.name}</option>)}</select>
            <button onClick={() => flow.current?.zoomOut()}>−</button><span>100%</span><button onClick={() => flow.current?.zoomIn()}>+</button><button onClick={() => flow.current?.fitView()}><Maximize2 size={13}/></button>
          </div>
          <div className="ws-hidden-actions">
          <button className={btn} onClick={() => { setActiveId(null); setVersions([]); setName('Untitled Workflow'); setNodes([]); setSelectedId(null) }}><Plus size={14} className="mr-1 inline"/>New</button>
          <button disabled={working || !nodes.length} onClick={() => void save()} className={accent}><Save size={14} className="mr-1 inline"/>Save</button>
          <input ref={importInput} type="file" accept="application/json,.json" className="hidden" onChange={e => void importWorkflow(e)}/>
          <button className={btn} onClick={() => importInput.current?.click()}><Import size={14} className="mr-1 inline"/>Import</button>
          <button disabled={!nodes.length} className={btn} onClick={exportWorkflow}><Download size={14} className="mr-1 inline"/>Export</button>
          <button disabled={working || !activeId} className={btn} onClick={() => void duplicateDefinition()}><Copy size={14}/></button>
          <button disabled={working || !activeId} onClick={() => void deleteDefinition()} className={btn}><Trash2 size={14}/></button>
          </div>
        </div>
        <div className="ws-canvas" onDragOver={event => event.preventDefault()} onDrop={dropNode}>
          <ReactFlow<StudioFlowNode, Edge> nodes={flowNodes} edges={flowEdges} nodeTypes={flowNodeTypes} onInit={instance => { flow.current = instance }} onConnect={connect}
            onNodeClick={(_, node) => { setSelectedId(node.id); setJsonEditor(JSON.stringify(nodes.find(item => item.id === node.id)?.settings ?? {}, null, 2)) }}
            onNodeDragStop={(_, node) => updateNode(node.id, { position: node.position })}
            onEdgesDelete={deleted => deleted.forEach(edge => updateNode(edge.target, { depends_on: (nodes.find(node => node.id === edge.target)?.depends_on ?? []).filter(id => id !== edge.source) }))}
            onNodesDelete={deleted => deleted.forEach(node => removeNode(node.id))} fitView deleteKeyCode="Delete" colorMode="dark">
            <Background color="#263041" gap={20} size={1}/><Controls showInteractive={false}/>
          </ReactFlow>
        </div>
        <section className="ws-bottom-deck">
          <div className="ws-execution">
            <div className="ws-deck-tabs"><button className="active">Execution</button><button>Logs</button><button>Results</button></div>
            <div className="ws-execution-body">
              <div className="ws-run-steps">{nodes.map(node => { const item = run?.results?.[node.id]; const current = run?.state === 'running' && run.current_node === node.id; return <button key={node.id} className={current ? 'active' : ''}><span className={item?.state === 'completed' ? 'done' : current ? 'processing' : ''}>{item?.state === 'completed' ? <Check size={11}/> : current ? <Sparkles size={11}/> : null}</span><strong>{catalog.find(entry => entry.type === node.type)?.label ?? node.id}</strong><small>{item?.state === 'completed' ? 'Completed' : current ? 'Processing…' : 'Waiting…'}</small></button> })}</div>
              <div className="ws-run-progress"><div className="ws-progress-ring" style={{ '--progress': `${run?.progress ?? 0}%` } as CSSProperties}><strong>{run?.progress ?? 0}%</strong></div><div><h3>{run?.state === 'running' ? `Processing ${catalog.find(item => item.type === nodes.find(node => node.id === run.current_node)?.type)?.label ?? run.current_node}…` : run?.state === 'completed' ? 'Workflow completed' : 'Ready to run workflow'}</h3><p>{run ? `${completedNodes} of ${nodes.length} nodes completed.` : 'Choose a source and run the workflow to monitor every step here.'}</p><div className="ws-progress-checks"><span className={completedNodes > 0 ? 'done' : ''}><Check size={11}/> Source loaded</span><span className={run?.state === 'running' ? 'active' : completedNodes > 1 ? 'done' : ''}><Check size={11}/> Processing workflow nodes</span><span className={run?.state === 'completed' ? 'done' : ''}><Check size={11}/> Editable results ready</span></div></div><div className="ws-progress-actions"><button disabled={!['queued', 'running'].includes(run?.state ?? '')} onClick={() => void cancel()}>Cancel</button><button className="primary" disabled={!run} onClick={() => setMessage(run ? `Run #${run.id}: ${run.state}` : '')}>View Logs</button></div></div>
            </div>
          </div>
          <div className="ws-preview-card"><header><strong>Preview</strong><button><Maximize2 size={12}/> Full Screen</button></header><div className="ws-preview-media">{previewMedia ? <video src={fileUrl(previewMedia.id)} controls preload="metadata"/> : <div className="ws-preview-empty"><Film size={28}/><span>Select a Media Library video to preview</span></div>}</div><div className="ws-preview-results"><strong><Play size={12}/> Workflow output</strong><span>{run ? `${completedNodes} nodes ready · ${run.progress}%` : 'No execution yet'}</span>{run?.state === 'completed' && <button onClick={() => void applyCutPlan()}>Apply cuts to timeline</button>}</div></div>
        </section>
      </section> : <section className="min-h-0 overflow-y-auto p-4">
        <h2 className="mb-3 text-lg font-semibold">Workflow Runs</h2>
        {run && <div className={`${card} mb-4 p-4`}><div className="mb-2 flex flex-wrap items-center gap-3"><span className="font-semibold">Run #{run.id}</span><span className="rounded-full bg-[#32234a] px-2 py-1 text-xs text-[#d6bdff]">{run.state}</span><span className="text-xs text-[#9fa5b6]">{run.current_node ?? 'Preparing'}</span></div>
          <div className="h-2 overflow-hidden rounded-full bg-[#272a37]"><div className="h-full bg-[#8448e5] transition-all" style={{ width: `${Math.min(100, run.progress)}%` }}/></div>
          <p className="mt-2 text-xs text-[#9fa5b6]">{run.progress}% · A completed run stores its editable JSON artifacts; cuts are not applied automatically.</p>
          {run.error && <p className="mt-3 rounded bg-red-950 p-3 text-xs text-red-200">{run.error}</p>}
          <div className="mt-3 flex flex-wrap gap-2"><button className={btn} disabled={!['queued', 'running'].includes(run.state)} onClick={() => void cancel()}>Cancel</button><button className={btn} disabled={!['failed', 'cancelled'].includes(run.state)} onClick={() => void retry()}>Retry from checkpoint</button><button className={btn} disabled={run.state !== 'completed' || working} onClick={() => void applyCutPlan()}><Scissors size={14} className="mr-1 inline"/>Apply Cut Plan to Timeline</button><button className={btn} disabled={run.state !== 'completed' || working} onClick={() => void downloadVideo()}><Download className="mr-1 inline" size={14}/>Rendered Video</button></div>
          <div className="mt-4 space-y-2">{Object.entries(run.results ?? {}).map(([nodeId, info]) => <div key={nodeId} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[#303543] px-3 py-2"><div className="min-w-0"><p className="font-mono text-xs">{nodeId}</p><p className="text-[10px] text-[#929bb0]">{info.state} · {Object.entries(info).filter(([key]) => key.endsWith('_count')).map(([k, v]) => `${k}: ${String(v)}`).join(' · ')}</p></div><button className={btn} onClick={() => void fetchArtifact(nodeId)} disabled={!info.artifact || working}><Download size={14} className="mr-1 inline"/>JSON</button></div>)}</div>
        </div>}
        <p className="mb-2 text-xs font-semibold text-[#9aa5b7]">RECENT RUNS</p>
        {runs.map(item => <button key={item.id} onClick={() => chooseRun(item)} className={`${card} mb-2 flex w-full items-center justify-between gap-2 px-3 py-3 text-left text-xs hover:border-[#7047aa]`}><span>Run #{item.id} · Workflow #{item.workflow_id}</span><span>{item.state} · {item.progress}%</span></button>)}
      </section>}
      <aside className="ws-inspector">
        <div className="ws-inspector-head"><span style={{ background: selected ? accentFor(selected.type) : '#7256ee' }}>{selected ? iconFor(selected.type, 15) : <Settings2 size={15}/>}</span><div><strong>{selectedCatalog?.label ?? 'Node Settings'}</strong><small>{selected ? 'Configure this workflow node.' : 'Select a node on the canvas.'}</small></div><button onClick={() => setSelectedId(null)}><X size={14}/></button></div>
        <div className="ws-inspector-tabs">{(['settings', 'input', 'output'] as const).map(tab => <button key={tab} className={inspectorTab === tab ? 'active' : ''} onClick={() => setInspectorTab(tab)}>{tab[0].toUpperCase() + tab.slice(1)}</button>)}</div>
        {inspectorTab === 'settings' && <>
        <div className="ws-source-box"><p><FolderOpen size={15}/>Source Video</p>
          <select aria-label="Source video" value={sourceId ?? ''} onChange={e => setSourceId(e.target.value ? Number(e.target.value) : null)} className="w-full rounded-lg border border-[#414657] bg-[#1b202a] px-2 py-2 text-xs"><option value="">{hasVideoSource ? 'Select a video...' : 'Optional for this workflow'}</option>{sources.map(s => <option key={s.id} value={s.id}>{s.filename} ({Math.round(s.size_bytes / 1024 / 1024)} MB)</option>)}</select>
          <select aria-label="Use Media Library video" disabled={working} defaultValue="" onChange={event => { const id = Number(event.target.value); event.target.value = ''; void useMediaSource(id) }} className="mt-2 w-full rounded-lg border border-[#414657] bg-[#1b202a] px-2 py-2 text-xs"><option value="">Use from Media Library…</option>{editorMedia.filter(item => item.kind === 'video').map(item => <option key={item.id} value={item.id}>{mediaName(item)}</option>)}</select>
          <input ref={fileInput} type="file" accept=".mp4,.mov,.mkv,.webm,.m4v" className="hidden" onChange={e => void upload(e)}/>
          <button disabled={working} className={`${btn} mt-2 w-full`} onClick={() => fileInput.current?.click()}><Upload size={14} className="mr-1 inline"/>Upload Video</button>
          <p className="mt-2 text-[10px] leading-4 text-[#8793a5]">Media Library sources are safely linked or copied into run storage; originals are never modified.</p>
        </div>
        {page === 'nodes' ? <>
          {selected ? <div className="space-y-4"><p className="text-xs font-medium">{selectedCatalog?.label ?? selected.type}</p>
            {selected.type === 'ai.highlights' && <div className="ws-highlight-controls">
              <label>AI Mode<select value={String(selected.settings.mode ?? 'offline')} onChange={event => updateSelectedSetting('mode', event.target.value)}><option value="offline">Offline transcript analysis</option><option value="openai">OpenAI structured output</option><option value="manual">Manual highlights</option></select></label>
              <label>Target Duration <span>{Number(selected.settings.target_duration ?? 90)} sec</span><input type="range" min={15} max={1800} step={15} value={Number(selected.settings.target_duration ?? 90)} onChange={event => updateSelectedSetting('target_duration', Number(event.target.value))}/><small><span>15 sec</span><span>30 min</span></small></label>
              <label>Selection Strategy<select value={String(selected.settings.strategy ?? 'story_recap')} onChange={event => updateSelectedSetting('strategy', event.target.value)}><option value="story_recap">Story recap</option><option value="shorts_hook">Short-form hook</option><option value="podcast_clips">Podcast clips</option></select></label>
            </div>}
            <label className="block text-[11px] text-[#9ea9b9]">Node ID<input value={selected.id} readOnly className="mt-1 w-full cursor-not-allowed rounded-lg border border-[#313749] bg-[#1c202a] p-2 font-mono text-xs text-white/70"/></label>
            <label className="block text-[11px] text-[#9ea9b9]">Condition<select value={selected.when} onChange={e => updateNode(selected.id, { when: e.target.value as WorkflowNode['when'] })} className="mt-1 w-full rounded-lg border border-[#373d4d] bg-[#1b202a] p-2 text-xs text-white">{CONDS.map(c => <option key={c}>{c}</option>)}</select></label>
            <label className="block text-[11px] text-[#9ea9b9]">Retry limit<input type="number" min={0} max={5} value={selected.retry_limit ?? 1} onChange={event => updateNode(selected.id, { retry_limit: Math.max(0, Math.min(5, Number(event.target.value) || 0)) })} className="mt-1 w-full rounded-lg border border-[#373d4d] bg-[#1b202a] p-2 text-xs text-white"/></label>
            <label className="flex items-center gap-2 text-[11px] text-[#9ea9b9]"><input type="checkbox" checked={selected.cache ?? true} onChange={event => updateNode(selected.id, { cache: event.target.checked })} className="accent-[#8c53e7]"/>Reuse matching checkpoint on retry</label>
            <div><p className="mb-2 text-xs text-[#a9b2c4]">Depends on (multiple allowed)</p>{nodes.filter(n => n.id !== selected.id).map(node => <label key={node.id} className="my-1 flex items-center gap-2 break-all text-[11px]"><input type="checkbox" checked={selected.depends_on.includes(node.id)} onChange={e => updateNode(selected.id, { depends_on: e.target.checked ? [...selected.depends_on, node.id] : selected.depends_on.filter(dep => dep !== node.id) })} className="accent-[#8c53e7]"/>{node.id}</label>)}</div>
            <div><label htmlFor="workflow-node-settings" className="mb-2 block text-xs text-[#a9b2c4]">Node settings (JSON)</label><textarea id="workflow-node-settings" value={jsonEditor} onChange={e => { setJsonEditor(e.target.value); setJsonError(null) }} rows={12} spellCheck={false} className="w-full rounded-lg border border-[#353a4a] bg-[#0b0f16] p-3 font-mono text-[11px] text-[#d5e0e8] outline-none focus:border-purple-500"/>
              {jsonError && <p role="alert" className="my-2 text-xs text-red-300">{jsonError}</p>}
              <button className={`${btn} w-full`} onClick={applySettings}><CheckCircle2 size={14} className="mr-1 inline"/>Apply JSON Settings</button>
            </div>
          </div> : <p className="text-xs text-[#9ba5b2]">Select a node to edit settings, dependencies or conditions.</p>}
        </> : <div className={`${card} p-3 text-xs text-[#aab1be]`}>Download each node's JSON to inspect exact word timestamps, AI highlights and cut plan. Editing can be done in the Timeline after review; there is no automatic destructive cut.</div>}
        </>}
        {inspectorTab === 'input' && <div className="ws-io-panel"><h3>Connected inputs</h3>{selected?.depends_on.length ? selected.depends_on.map(id => <span key={id}><ArrowRight size={12}/>{id}</span>) : <p>This node starts without upstream input.</p>}</div>}
        {inspectorTab === 'output' && <div className="ws-io-panel"><h3>Latest output</h3>{selected && run?.results?.[selected.id] ? Object.entries(run.results[selected.id]).map(([key, value]) => <span key={key}><strong>{key}</strong>{typeof value === 'object' ? JSON.stringify(value) : String(value)}</span>) : <p>Run the workflow to inspect this node's output.</p>}</div>}
      </aside>
    </div>
    <footer className="ws-legacy-footer">
      <span className="text-xs text-[#99a5bb]">{nodes.length} nodes · {activeId ? `Saved workflow #${activeId}` : 'Unsaved configuration'} · Python + MySQL</span>
      <div className="flex items-center gap-2"><button className={btn} disabled={working || !nodes.length} onClick={() => void save()}><Save size={14} className="mr-1 inline"/>Save</button><button className={accent} disabled={working || !nodes.length} onClick={() => void start()}>{working ? <LoaderCircle size={14} className="mr-1 inline animate-spin"/> : <Scissors size={14} className="mr-1 inline"/>}Run Workflow <ArrowRight size={14} className="ml-1 inline"/></button></div>
    </footer>
  </div>
}
