import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type DragEvent } from 'react'
import {
  ArrowDown, ArrowRight, ArrowUp, CheckCircle2, Download, Film, FolderOpen,
  GitBranch, Grip, LoaderCircle, Plus, Save, Scissors, Settings2, Trash2, Upload, WandSparkles, X,
} from 'lucide-react'
import { api } from '../../../lib/api'
import { probeMediaDuration } from '../../../lib/media'
import { useEditor } from '../../../stores/editorStore'
import { mediaName } from '../library/mediaLibraryUtils'
import type { WorkflowCatalogItem, WorkflowDefinition, WorkflowNode, WorkflowRun, WorkflowSource, WorkflowTemplate } from './workflowTypes'

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
const clone = (nodes: WorkflowNode[]) => nodes.map(node => ({ ...node, settings: structuredClone(node.settings), depends_on: [...node.depends_on] }))
const errorMessage = (err: unknown) => err instanceof Error ? err.message : String(err)

export function WorkflowStudio({ projectId, onClose }: Props) {
  const [catalog, setCatalog] = useState<WorkflowCatalogItem[]>([])
  const [templates, setTemplates] = useState<WorkflowTemplate[]>([])
  const [definitions, setDefinitions] = useState<WorkflowDefinition[]>([])
  const [sources, setSources] = useState<WorkflowSource[]>([])
  const [runs, setRuns] = useState<WorkflowRun[]>([])
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
  const fileInput = useRef<HTMLInputElement>(null)
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
      setName(templateRows[0].name); setNodes(clone(templateRows[0].nodes)); setSelectedId(templateRows[0].nodes[0]?.id ?? null)
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
  const updateNode = (id: string, delta: Partial<WorkflowNode>) => setNodes(prev => prev.map(node => node.id === id ? { ...node, ...delta } : node))
  const addNode = (type: string) => {
    const item = catalog.find(x => x.type === type)
    if (!item || nodes.length >= 28) return
    const id = uid(type, nodes.map(n => n.id))
    const next: WorkflowNode = { id, type, when: 'always', settings: structuredClone(item.settings), depends_on: nodes.length ? [nodes[nodes.length - 1].id] : [] }
    setNodes(prev => [...prev, next]); setSelectedId(id)
    setJsonEditor(JSON.stringify(next.settings, null, 2))
    setMessage('New node added. Check its dependencies before running.')
  }
  const removeNode = (id: string) => {
    setNodes(prev => prev.filter(node => node.id !== id).map(node => ({ ...node, depends_on: node.depends_on.filter(dep => dep !== id) })))
    setSelectedId(prev => prev === id ? null : prev)
  }
  const moveNode = (index: number, direction: -1 | 1) => {
    const target = index + direction
    if (target < 0 || target >= nodes.length) return
    setNodes(prev => { const result = [...prev]; [result[index], result[target]] = [result[target], result[index]]; return result })
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
    setActiveId(definition.id); setName(definition.name); setNodes(clone(definition.nodes)); setSelectedId(definition.nodes[0]?.id ?? null)
    setJsonEditor(JSON.stringify(definition.nodes[0]?.settings ?? {}, null, 2)); setPage('nodes'); setError(null)
  }
  const openTemplate = (template: WorkflowTemplate) => {
    setActiveId(null); setName(template.name); setNodes(clone(template.nodes)); setSelectedId(template.nodes[0]?.id ?? null)
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
    const mediaMatches = useEditor.getState().media.filter(m => m.kind === 'video' && mediaName(m).toLowerCase() === source.filename.toLowerCase())
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
  const chooseRun = (item: WorkflowRun) => { setRun(item); setPage('runs'); setError(null) }
  const dropNode = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    const type = event.dataTransfer.getData('text/cliptora-node')
    if (type && catalog.some(node => node.type === type)) addNode(type)
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

  return <div className="fixed inset-0 z-[100] flex min-h-0 flex-col overflow-hidden bg-[#0c0e13] text-white" role="dialog" aria-modal="true" aria-label="CLIPTORA Workflow Studio">
    <header className="flex shrink-0 flex-wrap items-center gap-3 border-b border-[#252a35] bg-[#12151c] px-4 py-3">
      <span className="flex items-center gap-2 text-lg font-bold"><WandSparkles size={20} className="text-[#a27aff]"/> Workflow Studio</span>
      <span className="rounded-full bg-[#2c2244] px-2.5 py-1 text-[10px] font-medium text-[#d7bcff]">Project {projectId}</span>
      <div className="ml-auto flex items-center gap-2">
        <button type="button" onClick={() => setPage('nodes')} className={page === 'nodes' ? accent : btn}><GitBranch size={14} className="mr-1 inline"/>Builder</button>
        <button type="button" onClick={() => setPage('runs')} className={page === 'runs' ? accent : btn}><Film size={14} className="mr-1 inline"/>Runs</button>
        <button type="button" className={btn} onClick={onClose} aria-label="Close Workflow Studio"><X size={16}/></button>
      </div>
    </header>
    {error && <div role="alert" className="shrink-0 border-b border-red-900 bg-red-950/60 px-4 py-2 text-xs text-red-200">{error}<button className="ml-3 font-bold" onClick={() => setError(null)}>×</button></div>}
    {message && <div className="shrink-0 border-b border-[#293043] px-4 py-2 text-xs text-[#bfcce2]">{message}</div>}
    <div className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden md:grid-cols-[225px_minmax(280px,1fr)_300px] 2xl:grid-cols-[270px_minmax(380px,1fr)_350px]">
      <aside className="min-h-0 overflow-y-auto border-b border-[#303542] bg-[#11141a] p-3 md:border-r md:border-b-0">
        <p className="mb-2 text-xs font-semibold text-[#9fa9ba]">START FROM TEMPLATE</p>
        <div className="space-y-2">{templates.map(t => <button key={t.key} type="button" onClick={() => openTemplate(t)} className={`${card} w-full p-3 text-left hover:border-[#794bc2]`}><span className="block text-xs font-semibold">{t.name}</span><span className="mt-1 block text-[10px] leading-4 text-[#9aa4b5]">{t.description}</span></button>)}</div>
        <div className="my-4 h-px bg-[#2c3140]"/>
        <p className="mb-2 text-xs font-semibold text-[#9fa9ba]">SAVED WORKFLOWS</p>
        {definitions.length ? definitions.map(d => <button key={d.id} onClick={() => openDefinition(d)} className={`mb-1 w-full truncate rounded-lg px-3 py-2 text-left text-xs ${activeId === d.id ? 'bg-[#4e3079] text-white' : 'bg-[#1b1f28] text-[#c3cbd7] hover:bg-[#30303b]'}`}>{d.name}</button>) : <p className="text-[11px] text-[#808c9c]">No saved workflows yet</p>}
        <div className="my-4 h-px bg-[#2c3140]"/>
        <p className="mb-2 text-xs font-semibold text-[#9fa9ba]">NODE CATALOG</p>
        {groups.map(group => <div key={group} className="mb-4"><p className="mb-1 text-[10px] uppercase tracking-wide text-[#778398]">{group}</p><div className="space-y-1">{catalog.filter(item => item.group === group).map(item => <button draggable onDragStart={e => e.dataTransfer.setData('text/cliptora-node', item.type)} key={item.type} onClick={() => addNode(item.type)} className="flex w-full items-center gap-2 rounded-lg border border-[#2a3040] px-2 py-2 text-left text-[11px] hover:bg-[#26243c]" title="Click or drag into canvas"><Plus size={13} className="text-[#ad85ff]"/><span className="truncate">{item.label}</span></button>)}</div></div>)}
      </aside>
      {page === 'nodes' ? <section className="min-h-0 min-w-0 overflow-y-auto bg-[#0d1016] p-4" onDragOver={e => e.preventDefault()} onDrop={dropNode}>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <input aria-label="Workflow name" value={name} onChange={e => setName(e.target.value)} className="min-w-[140px] flex-1 rounded-lg border border-[#373c4a] bg-[#181c25] px-3 py-2 text-sm font-semibold outline-none focus:border-purple-500"/>
          <button className={btn} onClick={() => { setActiveId(null); setName('Untitled Workflow'); setNodes([]); setSelectedId(null) }}><Plus size={14} className="mr-1 inline"/>New</button>
          <button disabled={working || !nodes.length} onClick={() => void save()} className={accent}><Save size={14} className="mr-1 inline"/>Save</button>
          <button disabled={working || !activeId} onClick={() => void deleteDefinition()} className={btn}><Trash2 size={14}/></button>
        </div>
        <p className="mb-4 text-[11px] text-[#8592a6]">Nodes execute by dependency order (DAG), not screen position. Click to edit inputs, settings or conditions.</p>
        {nodes.length ? <div className="mx-auto w-full max-w-[700px] space-y-0">{nodes.map((node, index) => {
          const item = catalog.find(c => c.type === node.type)
          const isSelected = selectedId === node.id
          return <div key={node.id}>
            <div onClick={() => { setSelectedId(node.id); setJsonEditor(JSON.stringify(node.settings, null, 2)) }} role="button" tabIndex={0} onKeyDown={e => { if (e.key === 'Enter') { setSelectedId(node.id); setJsonEditor(JSON.stringify(node.settings, null, 2)) } }} className={`${card} cursor-pointer p-3 transition-colors ${isSelected ? 'border-[#9450fa] bg-[#231b36] ring-1 ring-[#6a3ba7]' : 'hover:border-[#656078]'}`}>
              <div className="flex items-center gap-3"><Grip size={16} className="text-[#747b88]"/><span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#33234b] text-[#b995fd]">{index + 1}</span><div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">{item?.label ?? node.type}</p><p className="mt-0.5 truncate font-mono text-[10px] text-[#acafd0]">{node.id} · {node.type}</p></div>
                <button title="Move up visually" disabled={index === 0} className="p-1 text-[#aab4c3] disabled:opacity-30" onClick={e => { e.stopPropagation(); moveNode(index, -1) }}><ArrowUp size={16}/></button>
                <button title="Move down visually" disabled={index === nodes.length - 1} className="p-1 text-[#aab4c3] disabled:opacity-30" onClick={e => { e.stopPropagation(); moveNode(index, 1) }}><ArrowDown size={16}/></button>
                <button title="Remove node" className="p-1 text-[#ad7786] hover:text-red-300" onClick={e => { e.stopPropagation(); removeNode(node.id) }}><X size={17}/></button></div>
              <div className="mt-3 flex flex-wrap gap-1">{node.depends_on.length ? node.depends_on.map(dep => <span key={dep} className="rounded bg-[#293244] px-2 py-1 font-mono text-[10px] text-[#bacbe7]">← {dep}</span>) : <span className="rounded bg-[#1e3b32] px-2 py-1 text-[10px] text-[#86d3b6]">Start node</span>}{node.when !== 'always' && <span className="rounded bg-[#533e24] px-2 py-1 text-[10px] text-[#ffd89f]">if: {node.when}</span>}</div>
            </div>
            {index < nodes.length - 1 && <div className="flex h-7 items-center justify-center"><ArrowDown className="text-[#594b78]" size={18}/></div>}
          </div>
        })}</div> : <div className="grid min-h-[250px] place-content-center gap-2 rounded-xl border border-dashed border-[#454353] text-center text-sm text-[#a5a0b8]"><GitBranch className="mx-auto text-[#9c73dc]" size={34}/>Choose a template or drag a node here</div>}
      </section> : <section className="min-h-0 overflow-y-auto p-4">
        <h2 className="mb-3 text-lg font-semibold">Workflow Runs</h2>
        {run && <div className={`${card} mb-4 p-4`}><div className="mb-2 flex flex-wrap items-center gap-3"><span className="font-semibold">Run #{run.id}</span><span className="rounded-full bg-[#32234a] px-2 py-1 text-xs text-[#d6bdff]">{run.state}</span><span className="text-xs text-[#9fa5b6]">{run.current_node ?? 'Preparing'}</span></div>
          <div className="h-2 overflow-hidden rounded-full bg-[#272a37]"><div className="h-full bg-[#8448e5] transition-all" style={{ width: `${Math.min(100, run.progress)}%` }}/></div>
          <p className="mt-2 text-xs text-[#9fa5b6]">{run.progress}% · A completed run stores its editable JSON artifacts; cuts are not applied automatically.</p>
          {run.error && <p className="mt-3 rounded bg-red-950 p-3 text-xs text-red-200">{run.error}</p>}
          <div className="mt-3 flex flex-wrap gap-2"><button className={btn} disabled={!['queued', 'running'].includes(run.state)} onClick={() => void cancel()}>Cancel</button><button className={btn} disabled={run.state !== 'completed' || working} onClick={() => void applyCutPlan()}><Scissors size={14} className="mr-1 inline"/>Apply Cut Plan to Timeline</button><button className={btn} disabled={run.state !== 'completed' || working} onClick={() => void downloadVideo()}><Download className="mr-1 inline" size={14}/>Rendered Video</button></div>
          <div className="mt-4 space-y-2">{Object.entries(run.results ?? {}).map(([nodeId, info]) => <div key={nodeId} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[#303543] px-3 py-2"><div className="min-w-0"><p className="font-mono text-xs">{nodeId}</p><p className="text-[10px] text-[#929bb0]">{info.state} · {Object.entries(info).filter(([key]) => key.endsWith('_count')).map(([k, v]) => `${k}: ${String(v)}`).join(' · ')}</p></div><button className={btn} onClick={() => void fetchArtifact(nodeId)} disabled={!info.artifact || working}><Download size={14} className="mr-1 inline"/>JSON</button></div>)}</div>
        </div>}
        <p className="mb-2 text-xs font-semibold text-[#9aa5b7]">RECENT RUNS</p>
        {runs.map(item => <button key={item.id} onClick={() => chooseRun(item)} className={`${card} mb-2 flex w-full items-center justify-between gap-2 px-3 py-3 text-left text-xs hover:border-[#7047aa]`}><span>Run #{item.id} · Workflow #{item.workflow_id}</span><span>{item.state} · {item.progress}%</span></button>)}
      </section>}
      <aside className="min-h-0 overflow-y-auto border-t border-[#303542] bg-[#12161e] p-4 md:border-t-0 md:border-l">
        <div className="mb-5"><p className="mb-2 flex items-center gap-2 text-sm font-semibold"><FolderOpen size={16} className="text-[#ab85f0]"/>Source Video</p>
          <select aria-label="Source video" value={sourceId ?? ''} onChange={e => setSourceId(e.target.value ? Number(e.target.value) : null)} className="w-full rounded-lg border border-[#414657] bg-[#1b202a] px-2 py-2 text-xs"><option value="">{hasVideoSource ? 'Select a video...' : 'Optional for this workflow'}</option>{sources.map(s => <option key={s.id} value={s.id}>{s.filename} ({Math.round(s.size_bytes / 1024 / 1024)} MB)</option>)}</select>
          <input ref={fileInput} type="file" accept=".mp4,.mov,.mkv,.webm,.m4v" className="hidden" onChange={e => void upload(e)}/>
          <button disabled={working} className={`${btn} mt-2 w-full`} onClick={() => fileInput.current?.click()}><Upload size={14} className="mr-1 inline"/>Upload Video</button>
          <p className="mt-2 text-[10px] leading-4 text-[#8793a5]">Uses dedicated Workflow storage. Your existing Media Library files are not modified.</p>
        </div>
        {page === 'nodes' ? <><p className="mb-2 flex items-center gap-2 text-sm font-semibold"><Settings2 size={16} className="text-[#a57bff]"/>Node Inspector</p>
          {selected ? <div className="space-y-4"><p className="text-xs font-medium">{selectedCatalog?.label ?? selected.type}</p><label className="block text-[11px] text-[#9ea9b9]">Node ID<input value={selected.id} readOnly className="mt-1 w-full cursor-not-allowed rounded-lg border border-[#313749] bg-[#1c202a] p-2 font-mono text-xs text-white/70"/></label>
            <label className="block text-[11px] text-[#9ea9b9]">Condition<select value={selected.when} onChange={e => updateNode(selected.id, { when: e.target.value as WorkflowNode['when'] })} className="mt-1 w-full rounded-lg border border-[#373d4d] bg-[#1b202a] p-2 text-xs text-white">{CONDS.map(c => <option key={c}>{c}</option>)}</select></label>
            <div><p className="mb-2 text-xs text-[#a9b2c4]">Depends on (multiple allowed)</p>{nodes.filter(n => n.id !== selected.id).map(node => <label key={node.id} className="my-1 flex items-center gap-2 break-all text-[11px]"><input type="checkbox" checked={selected.depends_on.includes(node.id)} onChange={e => updateNode(selected.id, { depends_on: e.target.checked ? [...selected.depends_on, node.id] : selected.depends_on.filter(dep => dep !== node.id) })} className="accent-[#8c53e7]"/>{node.id}</label>)}</div>
            <div><label htmlFor="workflow-node-settings" className="mb-2 block text-xs text-[#a9b2c4]">Node settings (JSON)</label><textarea id="workflow-node-settings" value={jsonEditor} onChange={e => { setJsonEditor(e.target.value); setJsonError(null) }} rows={12} spellCheck={false} className="w-full rounded-lg border border-[#353a4a] bg-[#0b0f16] p-3 font-mono text-[11px] text-[#d5e0e8] outline-none focus:border-purple-500"/>
              {jsonError && <p role="alert" className="my-2 text-xs text-red-300">{jsonError}</p>}
              <button className={`${btn} w-full`} onClick={applySettings}><CheckCircle2 size={14} className="mr-1 inline"/>Apply JSON Settings</button>
            </div>
          </div> : <p className="text-xs text-[#9ba5b2]">Select a node to edit settings, dependencies or conditions.</p>}
        </> : <div className={`${card} p-3 text-xs text-[#aab1be]`}>Download each node's JSON to inspect exact word timestamps, AI highlights and cut plan. Editing can be done in the Timeline after review; there is no automatic destructive cut.</div>}
      </aside>
    </div>
    <footer className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-[#262b39] bg-[#13151d] px-4 py-3">
      <span className="text-xs text-[#99a5bb]">{nodes.length} nodes · {activeId ? `Saved workflow #${activeId}` : 'Unsaved configuration'} · Python + MySQL</span>
      <div className="flex items-center gap-2"><button className={btn} disabled={working || !nodes.length} onClick={() => void save()}><Save size={14} className="mr-1 inline"/>Save</button><button className={accent} disabled={working || !nodes.length} onClick={() => void start()}>{working ? <LoaderCircle size={14} className="mr-1 inline animate-spin"/> : <Scissors size={14} className="mr-1 inline"/>}Run Workflow <ArrowRight size={14} className="ml-1 inline"/></button></div>
    </footer>
  </div>
}
