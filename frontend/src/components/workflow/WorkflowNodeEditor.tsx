import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { CircleAlert, LoaderCircle, Play, Save, Settings2, X } from 'lucide-react'
import { api } from '../../lib/api'
import type { WorkflowStudioState } from './useWorkflowStudio'
import type { WorkflowRun } from './workflowTypes'
import { WorkflowToolIcon } from './WorkflowToolIcon'
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
  const [testing, setTesting] = useState(false)
  const [openAIConfigured, setOpenAIConfigured] = useState<boolean | null>(null)
  const [geminiConfigured, setGeminiConfigured] = useState<boolean | null>(null)
  const [copyStatus, setCopyStatus] = useState('')
  const dataRequestRef = useRef(0)
  const layoutRef = useRef<HTMLDivElement>(null)
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
    return [33, 34, 33]
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
  const result = selectedId ? inspectedRun?.results?.[selectedId] : undefined
  const dependencies = useMemo(() => selected?.depends_on ?? [], [selected?.depends_on])
  const agentInputs = Object.values(getObject(selected?.settings.__cliptora_ui_target_handles)).map(String)
  const hasAgentModel = !agentNode || agentInputs.includes('chat_model')
  const requiresOpenAI = openAINode || agentNode
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
    let active = true
    api<{ configured: boolean }>('/workflows/gemini/status')
      .then(status => { if (active) setGeminiConfigured(status.configured) })
      .catch(() => { if (active) setGeminiConfigured(false) })
    return () => { active = false }
  }, [requiresGemini])
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
  useEffect(() => { const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }; document.addEventListener('keydown', onKey); return () => document.removeEventListener('keydown', onKey) }, [onClose])

  const execute = async () => {
    if (!selected || !onExecuteStep) return
    setLocalError(''); setTesting(true)
    try { await onExecuteStep(selected.id) }
    catch (error) { setLocalError(error instanceof Error ? error.message : String(error)) }
    finally { setTesting(false) }
  }

  const executeDisabled = working || testing || !hasAgentModel ||
    (requiresOpenAI && openAIConfigured === false) || (requiresGemini && geminiConfigured === false)

  if (!selected) return null
  const view = <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 p-1 sm:p-5" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
    <div className="relative h-[min(92dvh,960px)] w-full max-w-[1780px] lg:w-[calc(100%-104px)]">
    <div role="dialog" aria-modal="true" aria-label={`${title} node configuration`} className="flex h-full w-full flex-col overflow-hidden rounded-2xl border border-[#d5d5d5] bg-white text-[#292929] shadow-[0_35px_110px_#0005]">
      <header className="relative flex min-h-[48px] shrink-0 items-center justify-between gap-3 border-b border-[#e6e6e6] bg-white px-4 py-0.5">
        <div className="flex min-w-0 flex-1 items-center gap-2.5">
          <span className="shrink-0"><WorkflowToolIcon label={title} type={selected.type} size={23} /></span>
          <span className="min-w-0 truncate text-[14px] font-medium text-[#212121]">{title}</span>
          <span aria-hidden="true" className="hidden h-4 w-px shrink-0 bg-[#e5e5e5] md:block" />
          <span className="hidden shrink-0 items-center gap-1.5 text-[11px] text-[#888] md:inline-flex">
            <Settings2 size={13} />
            {selectedCatalog?.group ?? 'Workflow node'}
          </span>
          <span aria-hidden="true" className="hidden h-3 w-px shrink-0 bg-[#e5e5e5] md:block" />
          <span className="hidden shrink-0 text-[11px] text-[#888] md:inline" title={result?.state ?? (inspectedRun?.state === 'running' || inspectedRun?.state === 'queued' ? inspectedRun.state : 'Not executed')}>
            {result?.state ?? (inspectedRun?.state === 'running' || inspectedRun?.state === 'queued' ? inspectedRun.state : 'Not executed')}
          </span>
          <span aria-hidden="true" className="hidden h-4 w-px shrink-0 bg-[#e5e5e5] xl:block" />
          
          <span className="hidden min-w-0 truncate text-[11px] text-[#888] lg:inline" title={copyStatus || (inspectedRun ? `Execution #${inspectedRun.id} · ${inspectedRun.state}` : 'No execution selected')}>
            {copyStatus || (inspectedRun ? `Execution #${inspectedRun.id} · ${inspectedRun.state}` : 'No execution selected')}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
          {providerNode && <a href={geminiNode ? 'https://ai.google.dev/gemini-api/docs' : 'https://platform.openai.com/docs'} target="_blank" rel="noreferrer" className="mr-1 hidden text-[12px] font-medium text-[#555] underline underline-offset-2 hover:text-[#111] xl:block">Docs ↗</a>}
          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={() => void save()}
              disabled={working || testing}
              title="Save workflow"
              aria-label="Save workflow"
              className="inline-flex cursor-pointer items-center gap-1.5 bg-transparent p-0 text-[12px] font-medium text-[#555] transition-colors hover:text-violet-600 disabled:cursor-not-allowed disabled:opacity-40">
              <Save size={17} strokeWidth={1.8} />
              <span>Save workflow</span>
            </button>
            <button
              type="button"
              onClick={() => void start()}
              disabled={working || testing}
              title="Run workflow"
              aria-label="Run workflow"
              className="inline-flex cursor-pointer items-center gap-1.5 bg-transparent p-0 text-[12px] font-medium text-[#555] transition-colors hover:text-violet-600 disabled:cursor-not-allowed disabled:opacity-40">
              <Play size={17} strokeWidth={1.8} />
              <span>Run workflow</span>
            </button>
          </div>
          <span aria-hidden="true" className="mx-0.5 h-5 w-px bg-[#e5e5e5]" />
          <button type="button" onClick={onClose} aria-label="Close node editor" title="Close" className="grid size-8 shrink-0 place-items-center rounded-md text-[#444] hover:bg-[#f4f4f4] focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet-500"><X size={20} /></button>
        </div>
      </header>
      <nav aria-label="Node editor sections" className="flex shrink-0 items-center justify-around border-b border-[#e5e5e5] bg-white px-1 py-1 lg:hidden">{(isEntryTrigger ? ['parameters', 'output'] as const : ['input', 'parameters', 'output'] as const).map(panel => <button key={panel} type="button" onClick={() => setMobilePanel(panel)} className={`rounded-lg px-3 py-2 text-xs font-semibold capitalize ${mobilePanel === panel ? 'bg-violet-100 text-violet-800' : 'text-[#888]'}`}>{panel}</button>)}</nav>
      <div ref={layoutRef} className="flex min-h-0 flex-1 overflow-hidden lg:grid" style={{
        gridTemplateColumns: isEntryTrigger
          ? `${triggerParametersWidth}fr 9px ${100 - triggerParametersWidth}fr`
          : `${panelSizes[0]}fr 9px ${panelSizes[1]}fr 9px ${panelSizes[2]}fr`
      }}>
        {!isEntryTrigger && <WorkflowNodeDataPanel key={`${selected.id}:input`} side="input" studio={editorStudio} mobilePanel={mobilePanel}
          inputValue={inputValue} outputValue={outputValue} loadingData={loadingData} isEntryTrigger={isEntryTrigger}
          disableExecute={executeDisabled} hasExecuteStep={Boolean(onExecuteStep)} onRun={start} onExecute={execute} onRefresh={loadData} onCopyStatus={setCopyStatus} />}
        {!isEntryTrigger && <WorkflowNodePanelDivider side="input" onPointerDown={onResizePointerDown} onKeyDown={onResizeKeyDown} />}
        <section className={`${mobilePanel === 'parameters' ? 'flex' : 'hidden'} min-h-0 min-w-0 w-full flex-col bg-white lg:flex`}>
          <div className="flex h-[54px] shrink-0 items-center justify-between gap-2 border-b border-[#e5e5e5] px-4">
            <div className="flex h-full gap-5">{(['parameters', 'settings'] as const).map(t => <button type="button" key={t} onClick={() => setTab(t)} className={`relative text-[13px] font-medium capitalize ${tab === t ? 'text-[#202020] after:absolute after:bottom-0 after:left-0 after:h-[2px] after:w-full after:bg-[#202020]' : 'text-[#666]'}`}>{t}</button>)}</div>
            <button type="button" disabled={(!onExecuteStep && !isManualTrigger) || testing || working || !hasAgentModel || (requiresOpenAI && openAIConfigured === false) || (requiresGemini && geminiConfigured === false)} onClick={() => { if (onExecuteStep) void execute(); else if (isManualTrigger) void start() }} title={!hasAgentModel ? 'Connect an OpenAI Chat Model to the required Chat Model port first.' : requiresOpenAI && openAIConfigured === false ? 'Configure OPENAI_API_KEY in the backend environment first.' : requiresGemini && geminiConfigured === false ? 'Configure GEMINI_API_KEY in the backend environment first.' : !onExecuteStep ? 'Single-node execution requires a backend executor; Run workflow is available.' : 'Execute this node only'} className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-[#242424] px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-[#404040] disabled:cursor-not-allowed disabled:opacity-45">{testing ? <LoaderCircle size={15} className="animate-spin" /> : <Play size={14} />} Execute step</button>
          </div>
          <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-5 [scrollbar-width:thin]">
            {localError && <div role="alert" className="flex gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-[12px] text-red-700"><CircleAlert size={16} className="shrink-0" />{localError}</div>}
            <NodeProgress run={inspectedRun} nodeId={selected.id} label={title} />
            {requiresOpenAI && openAIConfigured === false && <div role="alert" className="flex gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-[12px] leading-5 text-amber-900"><CircleAlert size={16} className="mt-0.5 shrink-0" /><span><strong className="block">OpenAI API key is not configured</strong>Add <code>OPENAI_API_KEY</code> to the backend environment, then recreate the backend container. Model execution stays disabled until the secret is available.</span></div>}
            {requiresGemini && geminiConfigured === false && <div role="alert" className="flex gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-[12px] leading-5 text-amber-900"><CircleAlert size={16} className="mt-0.5 shrink-0" /><span><strong className="block">Gemini API key is not configured</strong>Add <code>GEMINI_API_KEY</code> to the backend environment, then recreate the backend container. Gemini execution stays disabled until the secret is available.</span></div>}
            {tab === 'parameters'
              ? <WorkflowNodeParameters key={selected.id} studio={studio} onManageCredentials={onManageCredentials}
                isManualTrigger={isManualTrigger} hasAgentModel={hasAgentModel} />
              : <WorkflowNodeSettings key={selected.id} studio={studio} />}
          </div>
          {agentNode && <footer className="grid h-[66px] shrink-0 grid-cols-3 border-t border-[#e7e7e7] px-3 text-center text-[11px] text-[#555]">{[['chat_model', 'Chat Model *'], ['memory', 'Memory'], ['tool', 'Tool']].map(([handle, label]) => <div key={handle} className="flex flex-col items-center justify-center gap-1"><span className={`size-3 rotate-45 rounded-[2px] border ${agentInputs.includes(handle) ? 'border-violet-600 bg-violet-100' : 'border-[#aaa] bg-white'}`} /><span>{label}</span></div>)}</footer>}
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
