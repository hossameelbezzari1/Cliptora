import { useCallback, useEffect, useMemo, useState } from 'react'
import { CheckCircle2, CircleAlert, ExternalLink, LoaderCircle, Play, Power, Search, XCircle } from 'lucide-react'
import { api } from '../../../lib/api'
import type { WorkflowNode } from '../workflowTypes'
import type { WorkflowStudioState } from '../useWorkflowStudio'

type DevCommandResult = {
  key: string
  command: string
  status: 'running' | 'completed' | 'failed'
  target?: string
  element_status?: 'searching' | 'found' | 'not_found' | 'not_required'
  elapsed_seconds?: number
  error?: string
  value?: string
}

type DevSession = {
  session_id?: string
  status: 'inactive' | 'starting' | 'ready' | 'running' | 'failed' | 'closed'
  message?: string
  url?: string
  title?: string
  history: DevCommandResult[]
}

const inactive: DevSession = { status: 'inactive', history: [] }

function useBrowserDev(studio: WorkflowStudioState | undefined) {
  const [session, setSession] = useState<DevSession>(inactive)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState('')
  const definitionId = studio?.activeId ?? null

  const refresh = useCallback(async () => {
    if (!studio || definitionId == null) {
      setSession(inactive)
      return
    }
    try {
      setSession(await api<DevSession>(`/workflows/${studio.projectId}/definitions/${definitionId}/browser-dev`))
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : 'Cannot read developer browser status')
    }
  }, [definitionId, studio])

  useEffect(() => {
    void refresh()
    const timer = window.setInterval(() => { void refresh() }, 1500)
    return () => window.clearInterval(timer)
  }, [refresh])

  const withSavedDefinition = async <T,>(work: (id: number) => Promise<T>): Promise<T | null> => {
    if (!studio) return null
    setError('')
    const definition = await studio.save()
    if (!definition) return null
    return work(definition.id)
  }

  const start = async (browserNodeId: string) => {
    if (!studio) return
    setBusy('start')
    try {
      const next = await withSavedDefinition(id => api<DevSession>(
        `/workflows/${studio.projectId}/definitions/${id}/browser-dev/start`,
        { method: 'POST', body: JSON.stringify({ browser_node_id: browserNodeId }) },
      ))
      if (next) setSession(next)
      studio.setMessage('Developer browser is open. It will stay alive while you test commands.')
    } catch (exc) {
      const message = exc instanceof Error ? exc.message : 'Cannot start developer browser'
      setError(message)
      studio.setError(message)
    } finally {
      setBusy(null)
    }
  }

  const execute = async (browserNodeId: string, commandsNodeId: string, commandIndex: number) => {
    if (!studio) return
    const key = `${commandsNodeId}:${commandIndex}`
    setBusy(key)
    try {
      const response = await withSavedDefinition(id => api<{ session: DevSession; result: DevCommandResult }>(
        `/workflows/${studio.projectId}/definitions/${id}/browser-dev/command`,
        { method: 'POST', body: JSON.stringify({
          browser_node_id: browserNodeId,
          commands_node_id: commandsNodeId,
          command_index: commandIndex,
        }) },
      ))
      if (response) setSession(response.session)
    } catch (exc) {
      const message = exc instanceof Error ? exc.message : 'Browser command failed'
      setError(message)
      await refresh()
    } finally {
      setBusy(null)
    }
  }

  const close = async () => {
    if (!studio || definitionId == null) return
    setBusy('close')
    try {
      await api<DevSession>(`/workflows/${studio.projectId}/definitions/${definitionId}/browser-dev`, { method: 'DELETE' })
      setSession(inactive)
      studio.setMessage('Developer browser closed.')
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : 'Cannot close developer browser')
    } finally {
      setBusy(null)
    }
  }

  return { session, busy, error, refresh, start, execute, close }
}

function StatusBadge({ session }: { session: DevSession }) {
  const active = session.status === 'ready' || session.status === 'running'
  return <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold ${active ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300' : session.status === 'failed' ? 'bg-red-100 text-red-700 dark:bg-red-950/60 dark:text-red-300' : 'bg-[#ededed] text-[#666] dark:bg-[#374151] dark:text-[#cbd5e1]'}`}>
    {session.status === 'running' && <LoaderCircle size={12} className="animate-spin" />}
    {active ? 'Browser open' : session.status === 'starting' ? 'Opening…' : 'Browser closed'}
  </span>
}

export function PlaywrightDevPanel({ node, studio }: { node: WorkflowNode; studio?: WorkflowStudioState }) {
  const dev = useBrowserDev(studio)
  return <section className="mb-5 rounded-xl border border-violet-200 bg-violet-50/60 p-3.5 dark:border-violet-900/70 dark:bg-violet-950/20" aria-label="Playwright developer session">
    <div className="flex flex-wrap items-center gap-2">
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-semibold text-[#292929] dark:text-white">Developer Browser</p>
        <p className="mt-0.5 text-[11px] leading-4 text-[#6f6879] dark:text-[#bbb1c9]">Keep one visible browser open while testing Browser Commands one by one.</p>
      </div>
      <StatusBadge session={dev.session} />
    </div>
    {dev.session.url && <p className="mt-2 flex items-center gap-1 truncate text-[10px] text-[#777] dark:text-[#aeb5c1]" title={dev.session.url}><ExternalLink size={11}/>{dev.session.url}</p>}
    {dev.error && <p role="alert" className="mt-2 flex items-start gap-1.5 text-[11px] text-red-700 dark:text-red-300"><CircleAlert size={13} className="mt-0.5 shrink-0"/>{dev.error}</p>}
    <div className="mt-3 flex gap-2">
      <button type="button" onClick={() => void dev.start(node.id)} disabled={dev.busy !== null} className="inline-flex min-h-9 items-center gap-1.5 rounded-full bg-violet-600 px-3.5 text-[12px] font-semibold text-white hover:bg-violet-700 disabled:opacity-50">
        {dev.busy === 'start' ? <LoaderCircle size={14} className="animate-spin"/> : <Play size={13}/>} {dev.session.status === 'ready' || dev.session.status === 'running' ? 'Restart browser' : 'Start browser'}
      </button>
      <button type="button" onClick={() => void dev.close()} disabled={dev.busy !== null || !dev.session.session_id} className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-[#ddd] bg-white px-3 text-[12px] font-medium text-[#444] hover:bg-[#f5f5f5] disabled:opacity-40 dark:border-[#4b5563] dark:bg-[#252b36] dark:text-[#e5e7eb]"><Power size={13}/>Close</button>
    </div>
  </section>
}

const actionsOf = (node: WorkflowNode): Array<Record<string, unknown>> =>
  Array.isArray(node.settings.actions)
    ? node.settings.actions.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object' && !Array.isArray(item))
    : []

export function BrowserCommandsDevPanel({ node, studio }: { node: WorkflowNode; studio?: WorkflowStudioState }) {
  const dev = useBrowserDev(studio)
  const browserNode = studio?.nodes.find(item => item.type === 'browser.playwright' && item.depends_on.includes(node.id)) ?? null
  const actions = actionsOf(node)
  const results = useMemo(() => new Map(dev.session.history.map(item => [item.key, item])), [dev.session.history])
  const active = dev.session.status === 'ready' || dev.session.status === 'running'

  return <section className="mb-5 overflow-hidden rounded-xl border border-[#dedee3] bg-white dark:border-[#414753] dark:bg-[#202631]" aria-label="Step-by-step browser command runner">
    <div className="flex flex-wrap items-center gap-2 border-b border-[#ececf0] bg-[#fafafa] px-3.5 py-3 dark:border-[#374151] dark:bg-[#262d39]">
      <div className="min-w-0 flex-1"><p className="text-[13px] font-semibold text-[#292929] dark:text-white">Command-by-command test</p><p className="mt-0.5 text-[10px] text-[#777] dark:text-[#aeb5c1]">The same browser, page, cookies and tabs stay open.</p></div>
      <StatusBadge session={dev.session}/>
      {browserNode && !active && <button type="button" onClick={() => void dev.start(browserNode.id)} disabled={dev.busy !== null} className="inline-flex min-h-8 items-center gap-1 rounded-full bg-violet-600 px-3 text-[11px] font-semibold text-white disabled:opacity-50">{dev.busy === 'start' ? <LoaderCircle size={12} className="animate-spin"/> : <Play size={12}/>}Start browser</button>}
      {active && <button type="button" onClick={() => void dev.close()} disabled={dev.busy !== null} className="grid size-8 place-items-center rounded-full text-[#666] hover:bg-[#eee] dark:text-[#bbb] dark:hover:bg-[#374151]" title="Close developer browser" aria-label="Close developer browser"><Power size={14}/></button>}
    </div>
    {!browserNode && <div role="alert" className="m-3 flex gap-2 rounded-lg bg-amber-50 p-3 text-[11px] text-amber-900 dark:bg-amber-950/30 dark:text-amber-300"><CircleAlert size={14} className="shrink-0"/>Connect this Browser Commands node to a Playwright Browser first.</div>}
    {dev.session.url && <p className="truncate border-b border-[#eee] px-3.5 py-2 text-[10px] text-[#777] dark:border-[#374151] dark:text-[#aeb5c1]" title={dev.session.url}>{dev.session.url}</p>}
    {dev.error && <p role="alert" className="mx-3 mt-3 flex items-start gap-1.5 text-[11px] text-red-700 dark:text-red-300"><CircleAlert size={13} className="mt-0.5 shrink-0"/>{dev.error}</p>}
    <div className="max-h-[360px] overflow-y-auto p-2 [scrollbar-width:thin]">
      {actions.map((action, index) => {
        const key = `${node.id}:${index}`
        const result = results.get(key)
        const running = dev.busy === key
        const target = typeof action.target === 'string' ? action.target : ''
        const command = typeof action.command === 'string' ? action.command : 'command'
        return <div key={key} className={`mb-1.5 rounded-lg border p-2.5 ${result?.status === 'completed' ? 'border-emerald-200 bg-emerald-50/50 dark:border-emerald-900/60 dark:bg-emerald-950/20' : result?.status === 'failed' ? 'border-red-200 bg-red-50/50 dark:border-red-900/60 dark:bg-red-950/20' : 'border-[#e6e6e8] bg-white dark:border-[#414753] dark:bg-[#252b36]'}`}>
          <div className="flex items-center gap-2">
            {result?.status === 'completed' ? <CheckCircle2 size={15} className="shrink-0 text-emerald-600"/> : result?.status === 'failed' ? <XCircle size={15} className="shrink-0 text-red-600"/> : running ? <LoaderCircle size={15} className="shrink-0 animate-spin text-violet-600"/> : <span className="grid size-[15px] shrink-0 place-items-center rounded-full bg-[#e8e8ea] text-[9px] font-semibold text-[#666] dark:bg-[#4b5563] dark:text-white">{index + 1}</span>}
            <strong className="min-w-0 flex-1 truncate font-mono text-[11px] text-[#333] dark:text-[#f3f4f6]">{command}</strong>
            {result?.elapsed_seconds != null && <span className="text-[9px] tabular-nums text-[#888]">{result.elapsed_seconds}s</span>}
            <button type="button" onClick={() => browserNode && void dev.execute(browserNode.id, node.id, index)} disabled={!browserNode || !active || dev.busy !== null} className="inline-flex min-h-7 items-center gap-1 rounded-full bg-[#242424] px-2.5 text-[10px] font-semibold text-white hover:bg-[#3b3b3b] disabled:opacity-35 dark:bg-white dark:text-[#202020]"><Play size={10}/>Run</button>
          </div>
          {target && <div className="mt-1.5 flex min-w-0 items-center gap-1 text-[9px]"><Search size={10} className={result?.element_status === 'found' ? 'text-emerald-600' : result?.element_status === 'not_found' ? 'text-red-600' : 'text-[#999]'}/><span className={result?.element_status === 'found' ? 'text-emerald-700' : result?.element_status === 'not_found' ? 'text-red-700' : 'text-[#888]'}>{result?.element_status === 'found' ? 'found' : result?.element_status === 'not_found' ? 'not found' : 'not tested'}</span><code className="min-w-0 truncate text-[#777] dark:text-[#aeb5c1]" title={target}>{target}</code></div>}
          {result?.error && <p className="mt-1.5 line-clamp-2 text-[9px] leading-3 text-red-700 dark:text-red-300" title={result.error}>{result.error}</p>}
          {result?.value && <p className="mt-1.5 truncate text-[9px] text-[#666] dark:text-[#bbb]" title={result.value}>Result: {result.value}</p>}
        </div>
      })}
      {!actions.length && <p className="px-3 py-6 text-center text-[11px] text-[#888]">Add commands below, then test each one here.</p>}
    </div>
  </section>
}
