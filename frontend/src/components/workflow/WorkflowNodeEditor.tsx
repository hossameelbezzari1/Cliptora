import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { CircleAlert, LoaderCircle, Play, Save, Settings2, X, Plus, Search } from 'lucide-react'
import { api } from '../../lib/api'
import type { WorkflowStudioState } from './useWorkflowStudio'
import type { WorkflowRun } from './workflowTypes'
import { WorkflowToolIcon } from './WorkflowToolIcon'
import { uid } from './workflowUtils'
import { getObject } from './editor/WorkflowNodeFields'
import { WorkflowNodeDataPanel, WorkflowNodePanelDivider } from './editor/WorkflowNodeDataPanel'
import { WorkflowNodeParameters } from './editor/WorkflowNodeParameters'
import { WorkflowNodeSettings } from './editor/WorkflowNodeSettings'
import { WorkflowNodeSideRail } from './editor/WorkflowNodeSideRail'
import { NodeProgress } from './editor/NodeProgress'
type Props = {
  studio: WorkflowStudioState
  onClose: () => void
  onExecuteStep?: (nodeId: string) => Promise<void>
  onManageCredentials?: () => void
}
type Tab = 'parameters' | 'settings'
type MobilePanel = 'input' | 'parameters' | 'output'
type JsonObject = Record<string, unknown>
function confirmedManualEvent(result: { state: string; [key: string]: unknown }) {
  for (const key of ['output', 'data', 'payload', 'items']) {
    if (result[key] !== undefined && result[key] !== null) return result[key]
  }
  return [{ trigger: { type: 'manual', status: 'received' } }]
}
export function WorkflowNodeEditor({ studio, onClose, onExecuteStep, onManageCredentials }: Props) {
  const { projectId, selected, selectedCatalog, run, working, save, start } = studio
  const [tab, setTab] = useState<Tab>('parameters')
  const [mobilePanel, setMobilePanel] = useState<MobilePanel>('parameters')
  const [inputValue, setInputValue] = useState<unknown>(null)
  const [outputValue, setOutputValue] = useState<unknown>(null)
  const [backendRun, setBackendRun] = useState<WorkflowRun | null>(null)
  const [loadingData, setLoadingData] = useState(false)
  const [localError, setLocalError] = useState('')
  const [agentPortPicker, setAgentPortPicker] = useState<string | null>(null)
  const [agentPortSearch, setAgentPortSearch] = useState('')
  const [agentMoreOpen, setAgentMoreOpen] = useState<'chat_model' | 'memory' | 'tool' | null>(null)
  const [testing, setTesting] = useState(false)
  const [openAIConfigured, setOpenAIConfigured] = useState<boolean | null>(null)
  const [geminiConfigured, setGeminiConfigured] = useState<boolean | null>(null)
  const [copyStatus, setCopyStatus] = useState('')
  const dataRequestRef = useRef(0)
  const layoutRef = useRef<HTMLDivElement>(null)
  const toolStackRef = useRef<HTMLDivElement>(null)
  const activeResize = useRef<{ side: 'input' | 'output'; startX: number; sizes: [number, number, number] } | null>(null)
  const triggerResizeRef = useRef<{ startX: number; startWidth: number } | null>(null)
  const [triggerParametersWidth, setTriggerParametersWidth] = useState(() => {
    try {
      const saved = Number(window.localStorage.getItem('cliptora.workflow.nodeEditor.triggerParametersWidth'))
      if (Number.isFinite(saved) && saved >= 25 && saved <= 75) return saved
    } catch { }
    return 38
  })
  const [panelSizes, setPanelSizes] = useState<[number, number, number]>(() => {
    try {
      const saved = JSON.parse(window.localStorage.getItem('cliptora.workflow.nodeEditor.panelSizes') ?? 'null') as unknown
      if (Array.isArray(saved) && saved.length === 3 && saved.every(x => typeof x === 'number' && Number.isFinite(x) && x >= 16) && Math.abs(saved.reduce((a: number, b: number) => a + b, 0) - 100) < 1) return [saved[0], saved[1], saved[2]]
    } catch { /* Use default pane proportions. */ }
    return [29, 42, 29]
  })
  const resizePanels = useCallback((sizes: [number, number, number], side: 'input' | 'output', delta: number): [number, number, number] => {
    if (side === 'input') {
      const first = Math.max(17, Math.min(sizes[0] + sizes[1] - 27, sizes[0] + delta))
      return [first, sizes[0] + sizes[1] - first, sizes[2]]
    }
    const middle = Math.max(27, Math.min(sizes[1] + sizes[2] - 17, sizes[1] + delta))
    return [sizes[0], middle, sizes[1] + sizes[2] - middle]
  }, [])
  const onTriggerResizePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    triggerResizeRef.current = { startX: event.clientX, startWidth: triggerParametersWidth }
    event.currentTarget.setPointerCapture(event.pointerId)
  }
  const onResizePointerDown = (event: ReactPointerEvent<HTMLDivElement>, side: 'input' | 'output') => {
    if (event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    activeResize.current = { side, startX: event.clientX, sizes: panelSizes }
    event.currentTarget.setPointerCapture(event.pointerId)
  }
  const onResizeMove = useCallback((event: PointerEvent) => {
    const triggerState = triggerResizeRef.current
    const triggerWidth = layoutRef.current?.clientWidth
    if (triggerState && triggerWidth) {
      setTriggerParametersWidth(Math.max(25, Math.min(75,
        triggerState.startWidth + 100 * (event.clientX - triggerState.startX) / Math.max(1, triggerWidth - 9))))
      return
    }
    const state = activeResize.current
    const width = layoutRef.current?.clientWidth
    if (!state || !width) return
    setPanelSizes(resizePanels(state.sizes, state.side, ((event.clientX - state.startX) / Math.max(1, width - 18)) * 100))
  }, [resizePanels])
  const onResizeStop = useCallback(() => {
    if (triggerResizeRef.current) {
      triggerResizeRef.current = null
      setTriggerParametersWidth(current => {
        try { window.localStorage.setItem('cliptora.workflow.nodeEditor.triggerParametersWidth', String(current)) } catch { }
        return current
      })
      return
    }
    if (!activeResize.current) return
    activeResize.current = null
    setPanelSizes(current => {
      try { window.localStorage.setItem('cliptora.workflow.nodeEditor.panelSizes', JSON.stringify(current)) } catch { }
      return current
    })
  }, [])
  useEffect(() => {
    window.addEventListener('pointermove', onResizeMove)
    window.addEventListener('pointerup', onResizeStop)
    window.addEventListener('pointercancel', onResizeStop)
    return () => {
      window.removeEventListener('pointermove', onResizeMove)
      window.removeEventListener('pointerup', onResizeStop)
      window.removeEventListener('pointercancel', onResizeStop)
    }
  }, [onResizeMove, onResizeStop])
  const onResizeKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>, side: 'input' | 'output') => {
    if (!['ArrowLeft', 'ArrowRight', 'Home'].includes(event.key)) return
    event.preventDefault()
    const next = event.key === 'Home' ? [33, 34, 33] as [number, number, number] : resizePanels(panelSizes, side, event.key === 'ArrowLeft' ? -3 : 3)
    setPanelSizes(next)
    try { window.localStorage.setItem('cliptora.workflow.nodeEditor.panelSizes', JSON.stringify(next)) } catch { }
  }
  // Discover the newest persisted workflow run while the editor is open.
  // Progress updates arrive through this existing watcher (no extra hook needed).
  const activeWorkflowId = studio.activeId
  useEffect(() => {
    if (activeWorkflowId == null) {
      setBackendRun(null)
      return
    }
    let alive = true
    let inFlight = false
    const refreshRuns = async () => {
      if (inFlight) return
      inFlight = true
      try {
        const recent = await api<WorkflowRun[]>(`/workflows/${projectId}/runs`)
        if (!alive) return
        const latest = recent
          .filter(item => item.workflow_id === activeWorkflowId)
          .sort((a, b) => b.id - a.id)[0] ?? null
        setBackendRun(previous => {
          if (previous?.id === latest?.id &&
              previous?.state === latest?.state &&
              previous?.progress === latest?.progress &&
              previous?.current_node === latest?.current_node &&
              JSON.stringify(previous?.results) === JSON.stringify(latest?.results) &&
              previous?.error === latest?.error) return previous
          return latest
        })
      } catch {
        // Preserve the last known state if the API is temporarily unavailable.
      } finally {
        inFlight = false
      }
    }
    void refreshRuns()
    const timer = window.setInterval(() => { void refreshRuns() }, 1000)
    return () => { alive = false; window.clearInterval(timer) }
  }, [activeWorkflowId, projectId])
  const inspectedRun = useMemo(() => {
    const local = run && activeWorkflowId != null && run.workflow_id === activeWorkflowId ? run : null
    const remote = backendRun && activeWorkflowId != null && backendRun.workflow_id === activeWorkflowId ? backendRun : null
    if (!remote) return local
    if (!local) return remote
    // Crucial: for the SAME run ID, prefer the fresher backend polling result,
    // not the stale copy of studio.run that may still say 'running: 75%'.
    return remote.id >= local.id ? remote : local
  }, [run, backendRun, activeWorkflowId])
  // Data panels use studio.run for upstream data and $execution context.
  const editorStudio = useMemo(() => ({ ...studio, run: inspectedRun }), [studio, inspectedRun])
  const selectedType = selected?.type?.toLowerCase() ?? ''
  const selectedLabel = (selectedCatalog?.label ?? '').toLowerCase()
  const isManualTrigger = /manual[._-]?trigger|trigger[._-]?manual|when[._ -]?click|execute[._ -]?workflow/.test(`${selectedType} ${selectedLabel}`)
  const isEntryTrigger = selected != null && selected.depends_on.length === 0 &&
    (/trigger|webhook|schedule|cron/.test(selectedType) || /trigger|when clicking/.test(selectedLabel) || isManualTrigger)
  const onTriggerResizeKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home'].includes(event.key)) return
    event.preventDefault()
    const next = event.key === 'Home' ? 38 : Math.max(25, Math.min(75, triggerParametersWidth + (event.key === 'ArrowLeft' ? -3 : 3)))
    setTriggerParametersWidth(next)
    try { window.localStorage.setItem('cliptora.workflow.nodeEditor.triggerParametersWidth', String(next)) } catch { }
  }
  useEffect(() => {
    if (isEntryTrigger && mobilePanel === 'input') setMobilePanel('parameters')
  }, [isEntryTrigger, mobilePanel])
  const openAINode = selected?.type === 'ai.openai'
  const geminiNode = selected?.type === 'ai.gemini'
  const providerNode = openAINode || geminiNode
  const agentNode = selected?.type === 'ai.agent'
  const providerAction = String(selected?.settings?.action ?? 'message_model')
  const providerCapability = selectedCatalog?.action_capabilities?.[providerAction]
  const title = providerNode ? (providerCapability?.label ?? selectedCatalog?.label ?? 'AI') : selectedCatalog?.label ?? selected?.type ?? 'Node'
  const selectedId = selected?.id
  useEffect(() => { setAgentMoreOpen(null) }, [selectedId])
  useEffect(() => {
    if (agentMoreOpen !== 'tool') return
    const closeOutside = (event: PointerEvent) => {
      if (toolStackRef.current?.contains(event.target as Node)) return
      setAgentMoreOpen(null)
    }
    document.addEventListener('pointerdown', closeOutside)
    return () => document.removeEventListener('pointerdown', closeOutside)
  }, [agentMoreOpen])
  const selectedCredentialId = selected?.settings?.credential_id
  const result = selectedId ? inspectedRun?.results?.[selectedId] : undefined
  const dependencies = useMemo(() => selected?.depends_on ?? [], [selected?.depends_on])
  // Resolve the REAL connected nodes, rather than just showing the port '+' button.
  // The saved handle map is the authoritative source; the type fallback supports
  // workflows created before these handles were persisted.
  const agentConnections = useMemo(() => {
    const result: Record<'chat_model' | 'memory' | 'tool', typeof studio.nodes> = {
      chat_model: [], memory: [], tool: [],
    }
    if (!selected || selected.type !== 'ai.agent') return result
    const handles = getObject(selected.settings.__cliptora_ui_target_handles)
    const upstreamIds = new Set(selected.depends_on)
    const seen = new Set<string>()
    for (const candidate of studio.nodes) {
      if (!upstreamIds.has(candidate.id) || seen.has(candidate.id)) continue
      const assigned = handles[candidate.id]
      const port = assigned === 'chat_model' || assigned === 'memory' || assigned === 'tool'
        ? assigned
        : candidate.type === 'ai.chat_model'
          ? 'chat_model'
          : /memory/i.test(candidate.type)
            ? 'memory'
            : /^(browser\.|ai\.tool)/.test(candidate.type)
              ? 'tool'
              : null
      if (port) {
        result[port].push(candidate)
        seen.add(candidate.id)
      }
    }
    return result
  }, [selected, studio.nodes])
  const hasAgentModel = !agentNode || agentConnections.chat_model.length > 0
  const requiresOpenAI = openAINode
  const requiresGemini = geminiNode
  useEffect(() => {
    if (!requiresOpenAI) { setOpenAIConfigured(null); return }
    let active = true
    api<{ configured: boolean }>('/workflows/openai/status')
      .then(status => { if (active) setOpenAIConfigured(status.configured) })
      .catch(() => { if (active) setOpenAIConfigured(false) })
    return () => { active = false }
  }, [requiresOpenAI])
  useEffect(() => {
    if (!requiresGemini) { setGeminiConfigured(null); return }
    if (typeof selectedCredentialId !== 'number' || !Number.isInteger(selectedCredentialId) || selectedCredentialId < 1) {
      setGeminiConfigured(false)
      return
    }
    let active = true
    setGeminiConfigured(null)
    api<Array<{ id: number; provider: string }>>('/credentials')
      .then(rows => { if (active) setGeminiConfigured(rows.some(item => item.id === selectedCredentialId && item.provider === 'gemini')) })
      .catch(() => { if (active) setGeminiConfigured(null) })
    return () => { active = false }
  }, [requiresGemini, selectedCredentialId])
  const loadData = useCallback(async () => {
    if (!selectedId) return
    const request = ++dataRequestRef.current
    setLocalError('')
    setLoadingData(true)
    setInputValue(null)
    setOutputValue(null)
    try {
      let nextInput: unknown = null
      let nextOutput: unknown = null
      if (inspectedRun) {
        const parentEntries = await Promise.all(dependencies.map(async id => {
          const info = inspectedRun.results?.[id]
          if (!info) return [id, null] as const
          if (!info.artifact || info.state !== 'completed') return [id, info] as const
          try { return [id, await api<JsonObject>(`/workflows/${projectId}/runs/${inspectedRun.id}/artifacts/${encodeURIComponent(id)}`)] as const }
          catch { return [id, info] as const }
        }))
        if (parentEntries.length) nextInput = Object.fromEntries(parentEntries)
        if (result) {
          if (result.type && result.type !== selected?.type) {
            if (dataRequestRef.current === request) {
              setLocalError('This execution was created for a different node type. Execute the selected node again.')
            }
          } else if (result.state === 'completed') {
            if (result.artifact) {
              try {
                nextOutput = await api<unknown>(`/workflows/${projectId}/runs/${inspectedRun.id}/artifacts/${encodeURIComponent(selectedId)}`)
              } catch (error) {
                if (dataRequestRef.current === request) setLocalError(error instanceof Error ? error.message : String(error))
              }
            } else if (isManualTrigger) {
              nextOutput = confirmedManualEvent(result)
            } else if (dataRequestRef.current === request) {
              setLocalError('Execution completed without an output artifact. Check the backend run log.')
            }
          } else if (result.state === 'failed' && dataRequestRef.current === request) {
            setLocalError(typeof result.error === 'string' ? result.error : inspectedRun.error ?? 'Node execution failed.')
          }
        }
        if (!result && inspectedRun.state === 'failed' && dataRequestRef.current === request) {
          setLocalError(inspectedRun.error || 'Workflow execution failed before this node produced output.')
        }
      }
      if (dataRequestRef.current === request) {
        setInputValue(nextInput)
        setOutputValue(nextOutput)
      }
    } catch (error) {
      if (dataRequestRef.current === request) setLocalError(error instanceof Error ? error.message : String(error))
    } finally {
      if (dataRequestRef.current === request) setLoadingData(false)
    }
  }, [dependencies, projectId, result?.state, result?.artifact, inspectedRun?.id, inspectedRun?.state, inspectedRun?.error, selectedId, selected?.type, isManualTrigger])
  useEffect(() => { void loadData(); return () => { dataRequestRef.current += 1 } }, [loadData])
  useEffect(() => { const onKey = (e: KeyboardEvent) => { if (e.key !== 'Escape') return; if (agentMoreOpen) setAgentMoreOpen(null); else onClose() }; document.addEventListener('keydown', onKey); return () => document.removeEventListener('keydown', onKey) }, [onClose, agentMoreOpen])
  const execute = async () => {
    if (!selected || !onExecuteStep) return
    setLocalError(''); setTesting(true)
    try { await onExecuteStep(selected.id) }
    catch (error) { setLocalError(error instanceof Error ? error.message : String(error)) }
    finally { setTesting(false) }
  }
  const addAgentAttachment = (type: string) => {
    if (!selected || selected.type !== 'ai.agent' || !agentPortPicker) return
    const catalogItem = studio.catalog.find(item => item.type === type)
    if (!catalogItem) return
    const port = agentPortPicker
    const id = uid(type, studio.nodes.map(node => node.id))
    const position = selected.position ?? {x: 150,y: 130}
    const newNode = {
      id, type, depends_on: [] as string[], when: 'always' as const,
      retry_limit: 1, cache: true,
      settings: structuredClone(catalogItem.settings),
      position: {x: position.x + (port === 'chat_model' ? -250 : port === 'tool' ? 250 : 0),y:position.y + 300},
    }
    studio.setNodes(previous => [...previous.map(node => {
      if (node.id !== selected.id) return node
      const raw = node.settings.__cliptora_ui_target_handles
      const handles: Record<string,string> = raw && typeof raw === 'object' && !Array.isArray(raw) ? {...raw as Record<string,string>} : {}
      const replaced = port === 'chat_model' ? Object.keys(handles).filter(key => handles[key] === 'chat_model') : []
      replaced.forEach(key => delete handles[key])
      handles[id] = port
      return {...node, depends_on: [...node.depends_on.filter(key => !replaced.includes(key)),id], settings: {...node.settings,__cliptora_ui_target_handles:handles}}
    }),newNode])
    studio.setMessage(`Added ${catalogItem.label} to ${port} port. Save the workflow.`)
    setAgentPortPicker(null)
    setAgentPortSearch('')
    studio.setSelectedId(id)
  }
  const availableAgentAttachments = studio.catalog.filter(item => item.status === 'implemented' && Boolean(item.backend_executor) &&
    (agentPortPicker === 'chat_model' ? item.type === 'ai.chat_model' : agentPortPicker === 'memory' ? /memory/i.test(item.type) :
      agentPortPicker === 'tool' ? item.type !== 'ai.agent' && item.type !== 'ai.chat_model' && !/trigger/i.test(item.type) : false) &&
    `${item.label} ${item.type}`.toLowerCase().includes(agentPortSearch.toLowerCase()))
  const executeDisabled = working || testing || !hasAgentModel ||
    (requiresOpenAI && openAIConfigured === false) || (requiresGemini && geminiConfigured === false)
  if (!selected) return null
  const view = <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 p-1 sm:p-5" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
    <div className="relative h-[min(92dvh,960px)] w-full max-w-[1780px] lg:w-[calc(100%-104px)]">
    <div role="dialog" aria-modal="true" aria-label={`${title} node configuration`} className="flex h-full w-full flex-col overflow-visible rounded-2xl border border-[#d5d5d5] dark:border-[#374151] bg-white dark:bg-cl-dark-panel text-[#292929] dark:text-[#f3f4f6] shadow-[0_35px_110px_#0005]">
      <header className="relative flex min-h-[48px] shrink-0 items-center justify-between gap-3 border-b border-[#e6e6e6] dark:border-[#374151] dark:bg-cl-dark-panel px-4 py-0.5">
        <div className="flex min-w-0 flex-1 items-center gap-2.5">
          <span className="shrink-0"><WorkflowToolIcon label={title} type={selected.type} size={23} /></span>
          <span className="min-w-0 truncate text-[14px] font-medium text-[#212121] dark:text-[#f3f4f6]">{title}</span>
          <span aria-hidden="true" className="hidden h-4 w-px shrink-0 bg-[#e5e5e5] dark:bg-[#1f2937] md:block" />
          <span className="hidden shrink-0 items-center gap-1.5 text-[11px] text-[#888] dark:text-[#b8bec7] md:inline-flex">
            <Settings2 size={13} />
            {selectedCatalog?.group ?? 'Workflow node'}
          </span>
          <span aria-hidden="true" className="hidden h-3 w-px shrink-0 bg-[#e5e5e5] dark:bg-[#1f2937] md:block" />
          <span className="hidden shrink-0 text-[11px] text-[#888] dark:text-[#b8bec7] md:inline" title={result?.state ?? (inspectedRun?.state === 'running' || inspectedRun?.state === 'queued' ? inspectedRun.state : 'Not executed')}>
            {result?.state ?? (inspectedRun?.state === 'running' || inspectedRun?.state === 'queued' ? inspectedRun.state : 'Not executed')}
          </span>
          <span aria-hidden="true" className="hidden h-4 w-px shrink-0 bg-[#e5e5e5] dark:bg-[#1f2937] xl:block" />
          <span className="hidden min-w-0 truncate text-[11px] text-[#888] dark:text-[#b8bec7] lg:inline" title={copyStatus || (inspectedRun ? `Execution #${inspectedRun.id} · ${inspectedRun.state}` : 'No execution selected')}>
            {copyStatus || (inspectedRun ? `Execution #${inspectedRun.id} · ${inspectedRun.state}` : 'No execution selected')}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
          {providerNode && <a href={geminiNode ? 'https://ai.google.dev/gemini-api/docs' : 'https://platform.openai.com/docs'} target="_blank" rel="noreferrer" className="mr-1 hidden text-[12px] font-medium text-[#555] dark:text-[#b8bec7] underline underline-offset-2 hover:text-[#111] dark:hover:text-[#f3f4f6] xl:block">Docs ↗</a>}
          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={() => void save()}
              disabled={working || testing}
              title="Save workflow"
              aria-label="Save workflow"
              className="inline-flex cursor-pointer items-center gap-1.5 bg-transparent p-0 text-[12px] font-medium text-[#555] dark:text-[#b8bec7] transition-colors hover:text-violet-600 dark:hover:text-violet-300 disabled:cursor-not-allowed disabled:opacity-40">
              <Save size={17} strokeWidth={1.8} />
              <span>Save workflow</span>
            </button>
            <button
              type="button"
              onClick={() => void start()}
              disabled={working || testing}
              title="Run workflow"
              aria-label="Run workflow"
              className="inline-flex cursor-pointer items-center gap-1.5 bg-transparent p-0 text-[12px] font-medium text-[#555] dark:text-[#b8bec7] transition-colors hover:text-violet-600 dark:hover:text-violet-300 disabled:cursor-not-allowed disabled:opacity-40">
              <Play size={17} strokeWidth={1.8} />
              <span>Run workflow</span>
            </button>
          </div>
          <span aria-hidden="true" className="mx-0.5 h-5 w-px bg-[#e5e5e5] dark:bg-[#1f2937]" />
          <button type="button" onClick={onClose} aria-label="Close node editor" title="Close" className="grid size-8 shrink-0 place-items-center rounded-md text-[#444] dark:text-[#b8bec7] hover:bg-[#f4f4f4] dark:hover:bg-[#1f2937] focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet-500"><X size={20} /></button>
        </div>
      </header>
      <nav aria-label="Node editor sections" className="flex shrink-0 items-center justify-around border-b border-[#e5e5e5] dark:border-[#374151] bg-white dark:bg-cl-dark-panel px-1 py-1 lg:hidden">{(isEntryTrigger ? ['parameters', 'output'] as const : ['input', 'parameters', 'output'] as const).map(panel => <button key={panel} type="button" onClick={() => setMobilePanel(panel)} className={`rounded-lg px-3 py-2 text-xs font-semibold capitalize ${mobilePanel === panel ? 'bg-violet-100 dark:bg-violet-950/40 text-violet-800 dark:text-violet-300' : 'text-[#888] dark:text-[#b8bec7]'}`}>{panel}</button>)}</nav>
      <div ref={layoutRef} className="flex min-h-0 flex-1 overflow-visible lg:grid" style={{
        gridTemplateColumns: isEntryTrigger
          ? `${triggerParametersWidth}fr 9px ${100 - triggerParametersWidth}fr`
          : `${panelSizes[0]}fr 9px ${panelSizes[1]}fr 9px ${panelSizes[2]}fr`
      }}>
        {!isEntryTrigger && <WorkflowNodeDataPanel key={`${selected.id}:input`} side="input" studio={editorStudio} mobilePanel={mobilePanel}
          inputValue={inputValue} outputValue={outputValue} loadingData={loadingData} isEntryTrigger={isEntryTrigger}
          disableExecute={executeDisabled} hasExecuteStep={Boolean(onExecuteStep)} onRun={start} onExecute={execute} onRefresh={loadData} onCopyStatus={setCopyStatus} />}
        {!isEntryTrigger && <WorkflowNodePanelDivider side="input" onPointerDown={onResizePointerDown} onKeyDown={onResizeKeyDown} />}
        <section className={`${mobilePanel === 'parameters' ? 'flex' : 'hidden'} ${agentNode ? 'relative z-30' : ''} min-h-0 min-w-0 w-full flex-col bg-white dark:bg-cl-dark-panel lg:flex`}>
          <div className="flex h-[54px] shrink-0 items-center justify-between gap-2 border-b border-[#e5e5e5] dark:border-[#374151] px-4">
            <div className="flex h-full gap-5">{(['parameters', 'settings'] as const).map(t => <button type="button" key={t} onClick={() => setTab(t)} className={`relative text-[13px] font-medium capitalize ${tab === t ? 'text-[#202020] dark:text-[#f3f4f6] after:absolute after:bottom-0 after:left-0 after:h-[2px] after:w-full after:bg-[#202020] dark:after:bg-white' : 'text-[#666] dark:text-[#b8bec7]'}`}>{t}</button>)}</div>
            <button type="button" disabled={(!onExecuteStep && !isManualTrigger) || testing || working || !hasAgentModel || (requiresOpenAI && openAIConfigured === false) || (requiresGemini && geminiConfigured === false)} onClick={() => { if (onExecuteStep) void execute(); else if (isManualTrigger) void start() }} title={!hasAgentModel ? 'Connect a Chat Model to the required Chat Model port first.' : requiresOpenAI && openAIConfigured === false ? 'Configure an OpenAI credential first.' : requiresGemini && geminiConfigured === false ? 'Select a saved Gemini credential in this node first.' : !onExecuteStep ? 'Single-node execution requires a backend executor; Run workflow is available.' : 'Execute this node only'} className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-[#242424] px-4 py-2 text-[13px] font-semibold text-white transition-colors hover:bg-[#383838] disabled:cursor-not-allowed disabled:opacity-45 dark:bg-[#e8e8e8] dark:text-[#202020] dark:hover:bg-white">{testing ? <LoaderCircle size={15} className="animate-spin" /> : <Play size={14} />} Execute step</button>
          </div>
          <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-5 [scrollbar-width:thin]">
            {localError && <div role="alert" className="flex gap-2 rounded-lg border border-red-200 dark:border-red-900/70 bg-red-50 dark:bg-red-950/40 p-3 text-[12px] text-red-700 dark:text-red-300"><CircleAlert size={16} className="shrink-0" />{localError}</div>}
            <NodeProgress run={inspectedRun} nodeId={selected.id} label={title} />
            {requiresOpenAI && openAIConfigured === false && <div role="alert" className="flex gap-2 rounded-lg border border-amber-300 dark:border-amber-900/70 bg-amber-50 dark:bg-amber-950/35 p-3 text-[12px] leading-5 text-amber-900 dark:text-amber-300"><CircleAlert size={16} className="mt-0.5 shrink-0" /><span><strong className="block">OpenAI API key is not configured</strong>Add <code>OPENAI_API_KEY</code> to the backend environment, then recreate the backend container. Model execution stays disabled until the secret is available.</span></div>}
            {requiresGemini && geminiConfigured === false && <div role="alert" className="flex gap-2 rounded-lg border border-amber-300 dark:border-amber-900/70 bg-amber-50 dark:bg-amber-950/35 p-3 text-[12px] leading-5 text-amber-900 dark:text-amber-300"><CircleAlert size={16} className="mt-0.5 shrink-0" /><span><strong className="block">Google Gemini credential is not selected</strong>Use Connect or select an existing saved credential in Parameters, then save the workflow. API keys are stored encrypted in MySQL.</span></div>}
            {tab === 'parameters'
              ? <WorkflowNodeParameters key={selected.id} studio={studio} inputValue={inputValue} onManageCredentials={onManageCredentials}
                isManualTrigger={isManualTrigger} hasAgentModel={hasAgentModel} />
              : <WorkflowNodeSettings key={selected.id} studio={studio} />}
          </div>
          {agentNode && <footer className="relative z-20 grid h-[58px] shrink-0 grid-cols-3 gap-1 border-t border-[#e7e7e7] bg-white px-3 text-center text-[11px] text-[#555] dark:border-[#374151] dark:bg-cl-dark-panel dark:text-[#b8bec7]">
            {([['chat_model', 'Chat Model *'], ['memory', 'Memory'], ['tool', 'Tool']] as const).map(([handle, label]) => {
              const connections = agentConnections[handle]
              const primary = connections[0]
              const extras = connections.slice(1)
              const blurred = agentMoreOpen !== null && agentMoreOpen !== handle
              const openPicker = () => {
                setAgentMoreOpen(null)
                setAgentPortPicker(agentPortPicker === handle ? null : handle)
                setAgentPortSearch('')
              }
              const connectedButton = (connected: (typeof studio.nodes)[number]) => {
                const connectedLabel = studio.catalog.find(item => item.type === connected.type)?.label ?? connected.type
                return <button
                  key={connected.id}
                  type="button"
                  title={`Open ${connectedLabel}`}
                  aria-label={`Open connected ${connectedLabel}`}
                  onClick={() => studio.setSelectedId(connected.id)}
                  className="grid size-[52px] shrink-0 place-items-center rounded-full border-2 border-violet-400 bg-white shadow-[0_2px_7px_#00000012] transition hover:bg-violet-50 dark:bg-cl-dark-panel dark:hover:bg-[#374151]"
                >
                  <WorkflowToolIcon type={connected.type} label={connectedLabel} size={22} nodeId={connected.id} />
                </button>
              }
              return <div key={handle} className={`relative flex min-w-0 flex-col items-center transition-[filter,opacity] duration-200 ${blurred ? 'pointer-events-none blur-[3px] opacity-30' : ''}`}>
                <span className="absolute inset-x-0 top-1 truncate text-center text-[12px] font-medium" title={label}>{label}</span>
                {handle === 'tool' ? (
                  <div ref={toolStackRef} className="absolute -bottom-[28px] left-1/2 z-[80] flex -translate-x-1/2 items-center justify-center">
                    {connections.length === 0 ? (
                      <button
                        type="button"
                        onClick={openPicker}
                        title="Add Tool"
                        aria-label="Add Tool"
                        className="grid size-[52px] shrink-0 place-items-center rounded-full border border-[#dedee3] bg-white text-[#555] shadow-[0_2px_7px_#00000012] transition hover:bg-violet-50 dark:bg-cl-dark-panel dark:hover:bg-[#374151]"
                      ><Plus size={21} /></button>
                    ) : agentMoreOpen === 'tool' ? (
                      <div
                        role="group"
                        aria-label="Expanded connected Tool nodes"
                        className="flex w-max max-w-[min(850px,calc(100vw-80px))] items-center gap-2.5 overflow-x-auto overflow-y-hidden whitespace-nowrap bg-transparent p-0 shadow-none [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
                      >
                        <button
                          type="button"
                          onClick={() => setAgentMoreOpen(null)}
                          title="Collapse Tools"
                          aria-label="Collapse stacked Tools"
                          className="grid size-[38px] shrink-0 place-items-center rounded-full border border-[#dedee3] bg-white text-[23px] leading-none text-[#555] transition hover:bg-[#f5f5f7] dark:bg-cl-dark-panel dark:hover:bg-[#374151]"
                        >−</button>
                        <button
                          type="button"
                          onClick={openPicker}
                          title="Add Tool"
                          aria-label="Add Tool"
                          className="grid size-[52px] shrink-0 place-items-center rounded-full border border-[#dedee3] bg-white text-[#555] transition hover:bg-violet-50 dark:bg-cl-dark-panel dark:hover:bg-[#374151]"
                        ><Plus size={21} /></button>
                        {connections.map(connected => connectedButton(connected))}
                      </div>
                    ) : (
                      <button
                        type="button"
                        title={`Show ${connections.length} connected Tool${connections.length === 1 ? '' : 's'}`}
                        aria-label={`Expand ${connections.length} stacked Tool${connections.length === 1 ? '' : 's'}`}
                        aria-expanded={false}
                        onClick={() => { setAgentMoreOpen('tool'); setAgentPortPicker(null) }}
                        className="group relative block h-[54px] shrink-0 rounded-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-violet-500"
                        style={{ width: 54 + Math.min(connections.length - 1, 2) * 17 }}
                      >
                        {connections.slice(0, 3).map((connected, index) => {
                          const connectedLabel = studio.catalog.find(item => item.type === connected.type)?.label ?? connected.type
                          return <span
                            key={connected.id}
                            aria-hidden="true"
                            className="absolute top-[1px] grid size-[52px] place-items-center rounded-full border-2 border-violet-400 bg-white shadow-[0_2px_7px_#00000018] transition-transform duration-200 group-hover:-translate-y-1 dark:bg-cl-dark-panel"
                            style={{ left: index * 17, zIndex: index + 1 }}
                          >
                            <WorkflowToolIcon type={connected.type} label={connectedLabel} size={22} nodeId={connected.id} />
                          </span>
                        })}
                        {connections.length > 1 && <span
                          aria-hidden="true"
                          className="absolute -bottom-[7px] -right-[10px] z-10 grid min-w-[23px] h-[23px] place-items-center rounded-full border-2 border-white bg-violet-600 px-1 text-[10px] font-bold text-white shadow-sm dark:border-cl-dark-panel"
                        >{connections.length}</span>}
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="absolute -bottom-[26px] left-1/2 z-30 flex -translate-x-1/2 items-center justify-center">
                    <div className="relative shrink-0">
                      {primary ? connectedButton(primary) : <button
                        type="button"
                        onClick={openPicker}
                        title={`Add ${label}`}
                        aria-label={`Add ${label}`}
                        className="grid size-[52px] shrink-0 place-items-center rounded-full border border-[#dedee3] bg-white text-[#555] shadow-[0_2px_7px_#00000012] transition hover:bg-violet-50 dark:bg-cl-dark-panel dark:hover:bg-[#374151]"
                      ><Plus size={21} /></button>}
                      {extras.length > 0 && <button
                        type="button"
                        aria-label={`Show ${extras.length} more connected ${label} nodes`}
                        aria-expanded={agentMoreOpen === handle}
                        title={`Show ${extras.length} more connected ${label} nodes`}
                        onClick={() => { setAgentMoreOpen(agentMoreOpen === handle ? null : handle); setAgentPortPicker(null) }}
                        className="absolute -left-[29px] top-[12px] z-40 grid size-7 place-items-center rounded-full border border-violet-300 bg-white text-[10px] font-semibold text-violet-700 shadow-sm transition hover:bg-violet-50 dark:bg-cl-dark-panel dark:text-violet-300"
                      >+{extras.length}</button>}
                    </div>
                  </div>
                )}
              </div>
            })}
            {agentMoreOpen && agentMoreOpen !== 'tool' && (() => {
              const handle = agentMoreOpen
              const label = handle === 'chat_model' ? 'Chat Model *' : 'Memory'
              const connections = agentConnections[handle]
              return <div role="group" aria-label={`Expanded connected ${label} nodes`} className="pointer-events-none absolute -bottom-[27px] inset-x-0 top-0 z-50">
                <span className="absolute inset-x-0 top-1 text-center text-[12px] font-medium">{label}</span>
                <div className="pointer-events-auto absolute inset-x-2 bottom-0 flex items-end justify-center gap-2">
                  <button type="button" onClick={() => setAgentMoreOpen(null)} title={`Hide additional ${label} nodes`} aria-label={`Hide additional ${label} nodes`} className="mb-1 grid size-8 shrink-0 place-items-center rounded-full border border-[#dedee3] bg-white text-[16px] font-semibold shadow-sm hover:bg-[#f5f5f7] dark:bg-cl-dark-panel dark:hover:bg-[#374151]">−</button>
                  <div className="flex min-w-0 max-w-full items-center gap-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                    {connections.map(connected => {
                      const connectedLabel = studio.catalog.find(item => item.type === connected.type)?.label ?? connected.type
                      return <button key={connected.id} type="button" title={`Open ${connectedLabel}`} aria-label={`Open connected ${connectedLabel}`} onClick={() => { setAgentMoreOpen(null); studio.setSelectedId(connected.id) }} className="grid size-[52px] shrink-0 place-items-center rounded-full border-2 border-violet-400 bg-white shadow-[0_2px_7px_#00000012] transition hover:bg-violet-50 dark:bg-cl-dark-panel dark:hover:bg-[#374151]"><WorkflowToolIcon type={connected.type} label={connectedLabel} size={22} nodeId={connected.id}/></button>
                    })}
                  </div>
                  <button type="button" onClick={() => { setAgentMoreOpen(null); setAgentPortPicker(handle); setAgentPortSearch('') }} title={`Add ${label}`} aria-label={`Add ${label}`} className="mb-1 grid size-8 shrink-0 place-items-center rounded-full border border-[#dedee3] bg-white text-[#555] shadow-sm hover:bg-violet-50 dark:bg-cl-dark-panel dark:hover:bg-[#374151]"><Plus size={18}/></button>
                </div>
              </div>
            })()}
            {agentPortPicker && <div className="absolute bottom-[calc(100%+8px)] left-0 right-0 z-50 rounded-xl border border-[#dedee3] bg-white p-2 text-left shadow-xl dark:border-[#374151] dark:bg-[#252b36]">
              <div className="flex items-center gap-2 border-b border-[#eee] pb-2 dark:border-[#374151]"><Search size={16}/><input className="min-w-0 flex-1 bg-transparent p-1 text-sm outline-none" autoFocus value={agentPortSearch} onChange={e => setAgentPortSearch(e.target.value)} placeholder={`Search ${agentPortPicker.replace('_',' ')} nodes...`}/><button type="button" onClick={() => setAgentPortPicker(null)} aria-label="Close picker"><X size={17}/></button></div>
              <div className="max-h-56 overflow-y-auto">{availableAgentAttachments.map(item => <button type="button" key={item.type} className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm hover:bg-[#f5f5f7] dark:hover:bg-[#374151]" onClick={() => addAgentAttachment(item.type)}><WorkflowToolIcon type={item.type} label={item.label} size={20}/>{item.label}</button>)}
                {!availableAgentAttachments.length && <p className="p-3 text-xs text-[#888]">No compatible implemented nodes found.</p>}</div>
            </div>}
          </footer>}
        </section>
        <WorkflowNodePanelDivider side="output"
          onPointerDown={isEntryTrigger ? event => onTriggerResizePointerDown(event) : onResizePointerDown}
          onKeyDown={isEntryTrigger ? event => onTriggerResizeKeyDown(event) : onResizeKeyDown} />
        <WorkflowNodeDataPanel key={`${selected.id}:output`} side="output" studio={editorStudio} mobilePanel={mobilePanel}
          inputValue={inputValue} outputValue={outputValue} loadingData={loadingData} isEntryTrigger={isEntryTrigger}
          disableExecute={executeDisabled} hasExecuteStep={Boolean(onExecuteStep)} onRun={start} onExecute={execute} onRefresh={loadData} onCopyStatus={setCopyStatus} />
      </div>
    </div>
    <WorkflowNodeSideRail key={`input:${selected.id}`} studio={studio} side="input" />
    <WorkflowNodeSideRail key={`output:${selected.id}`} studio={studio} side="output" />
    </div>
  </div>
  return createPortal(view, document.body)
}
export default WorkflowNodeEditor
