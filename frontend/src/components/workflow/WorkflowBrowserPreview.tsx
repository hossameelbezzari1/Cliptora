import { useEffect, useMemo, useState } from 'react'
import { Camera, CheckCircle2, ChevronLeft, ChevronRight, LoaderCircle, Maximize2, MonitorPlay, Radio, RefreshCw, Search, X, XCircle } from 'lucide-react'
import { api } from '../../lib/api'

export type BrowserPreviewFrame = {
  id: string
  filename: string
  label: string
  captured_at: string
  modified_ms: number
  size_bytes: number
}

type BrowserCommandState = {
  index: number
  command?: string
  status?: string
  target?: string
  element_status?: string
  error?: string
  elapsed_seconds?: number
}

type BrowserPreviewPayload = {
  frames: BrowserPreviewFrame[]
  total: number
  live?: {
    status?: string
    message?: string
    url?: string
    step?: number
    total?: number
    commands?: BrowserCommandState[]
  }
}

type Props = {
  projectId: number
  runId: number | null | undefined
  runState?: string | null
  currentNode?: string | null
  compact?: boolean
}

const frameUrl = (projectId: number, runId: number, frame: BrowserPreviewFrame) =>
  `/api/v1/workflows/${projectId}/runs/${runId}/browser-preview/${frame.id}?v=${frame.modified_ms}`

export function WorkflowBrowserPreview({ projectId, runId, runState, currentNode, compact = false }: Props) {
  const [frames, setFrames] = useState<BrowserPreviewFrame[]>([])
  const [live, setLive] = useState<BrowserPreviewPayload['live']>({})
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [followLatest, setFollowLatest] = useState(true)
  const [refreshKey, setRefreshKey] = useState(0)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [expanded, setExpanded] = useState(false)

  useEffect(() => {
    setFrames([])
    setLive({})
    setSelectedId(null)
    setFollowLatest(true)
    setError('')
    if (runId == null) return
    let mounted = true
    let pending = false
    const refresh = async () => {
      if (!mounted || pending) return
      pending = true
      try {
        const response = await api<BrowserPreviewPayload>(`/workflows/${projectId}/runs/${runId}/browser-preview`)
        if (!mounted) return
        setFrames(previous => {
          const next = response.frames ?? []
          return JSON.stringify(previous) === JSON.stringify(next) ? previous : next
        })
        setLive(response.live ?? {})
        setError('')
      } catch (exc) {
        if (mounted) setError(exc instanceof Error ? exc.message : 'Cannot load browser screenshots')
      } finally {
        pending = false
        if (mounted) setLoading(false)
      }
    }
    setLoading(true)
    void refresh()
    const timer = window.setInterval(() => { void refresh() }, 1500)
    return () => { mounted = false; window.clearInterval(timer) }
  }, [projectId, runId, refreshKey])

  const latest = frames.at(-1) ?? null
  const selected = useMemo(() => frames.find(frame => frame.id === selectedId) ?? latest, [frames, selectedId, latest])
  const selectedIndex = selected ? frames.findIndex(frame => frame.id === selected.id) : -1
  const playing = runState === 'queued' || runState === 'running' || runState === 'cancelling'
  const latestSelected = selected?.id === latest?.id
  const showLatest = () => { setSelectedId(null); setFollowLatest(true) }
  const move = (delta: number) => {
    const next = frames[selectedIndex + delta]
    if (!next) return
    setFollowLatest(false)
    setSelectedId(next.id)
  }
  // The live-follow mode intentionally selects the newest *available* frame.
  const shown = followLatest ? latest : selected
  const picture = shown && runId != null ? frameUrl(projectId, runId, shown) : null
  const commands = live?.commands ?? []

  const display = <section className="flex h-full min-h-0 min-w-0 flex-col bg-white text-[#282828] dark:bg-[#1f2937] dark:text-[#eaeaea]" aria-label="Browser live preview">
    <div className="flex min-h-[37px] shrink-0 items-center gap-2 border-b border-[#ebebeb] px-2.5 py-1.5 dark:border-[#374151]">
      <MonitorPlay size={16} className="shrink-0 text-violet-600" />
      <strong className="min-w-0 truncate text-xs">Browser Live Preview</strong>
      <span className={`ml-auto inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] ${playing ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300' : 'bg-[#f0f0f0] text-[#777] dark:bg-[#394250] dark:text-[#ccc]'}`}>
        {playing && <Radio size={11} className="animate-pulse" />}{live?.status || (playing ? 'Watching run' : 'History')}
      </span>
      <button type="button" title="Refresh browser frames" aria-label="Refresh browser frames" onClick={() => setRefreshKey(n => n + 1)} className="rounded-md p-1 text-[#666] hover:bg-[#f3f3f3] dark:text-[#ccc] dark:hover:bg-[#303947]"><RefreshCw size={14} className={loading ? 'animate-spin' : ''} /></button>
      {!compact && <button type="button" title="Expand preview" aria-label="Expand browser preview" onClick={() => setExpanded(true)} className="rounded-md p-1 text-[#666] hover:bg-[#f3f3f3] dark:text-[#ccc] dark:hover:bg-[#303947]"><Maximize2 size={14} /></button>}
    </div>
    <div className="flex min-h-0 flex-1 overflow-hidden bg-[#111318]">
      <div className="relative flex min-w-0 flex-1 items-center justify-center overflow-hidden">
        {picture ? <img key={picture} src={picture} alt={`Browser screenshot: ${shown?.label ?? 'latest step'}`} className="h-full max-h-full w-full object-contain" />
          : <div className="max-w-sm px-5 py-5 text-center text-xs leading-5 text-[#b9bfca]">
            <Camera size={29} className="mx-auto mb-2 text-[#777f8b]" />
            {runId == null ? 'Start or select a workflow execution to see browser screenshots.' :
              playing ? 'Waiting for the first browser screenshot. The browser may still be opening the page.' :
                'No browser screenshots saved for this execution.'}
            {runId != null && <p className="mt-2 text-[11px] text-[#838b98]">Enable Dev Mode or connect Browser Preview Snapshots to capture every step.</p>}
          </div>}
        {error && <div role="alert" className="absolute inset-x-2 bottom-2 rounded bg-red-950/85 px-3 py-2 text-xs text-white">{error}</div>}
      </div>
      {commands.length > 0 && <aside className={`${compact ? 'w-[44%] min-w-[180px]' : 'w-[310px]'} flex shrink-0 flex-col border-l border-[#303642] bg-[#171a20] text-[#d9dde5]`} aria-label="Browser command diagnostics">
        <div className="flex items-center gap-2 border-b border-[#303642] px-2.5 py-2 text-[10px] font-semibold uppercase tracking-wide text-[#9ca3af]">
          <span>Dev console</span><span className="ml-auto tabular-nums">{commands.filter(item => item.status === 'completed').length}/{commands.length}</span>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-1.5 [scrollbar-width:thin]">
          {commands.map(item => <div key={item.index} className={`mb-1 rounded-md border px-2 py-1.5 ${item.status === 'failed' ? 'border-red-900/80 bg-red-950/30' : item.status === 'completed' ? 'border-emerald-900/60 bg-emerald-950/20' : 'border-violet-800/70 bg-violet-950/25'}`}>
            <div className="flex items-center gap-1.5 text-[11px]">
              {item.status === 'completed' ? <CheckCircle2 size={13} className="shrink-0 text-emerald-400" /> : item.status === 'failed' ? <XCircle size={13} className="shrink-0 text-red-400" /> : <LoaderCircle size={13} className="shrink-0 animate-spin text-violet-400" />}
              <span className="text-[#89909c]">#{item.index}</span>
              <strong className="truncate font-mono text-[#edf0f5]">{item.command ?? 'command'}</strong>
              {item.elapsed_seconds != null && <span className="ml-auto shrink-0 tabular-nums text-[9px] text-[#89909c]">{item.elapsed_seconds}s</span>}
            </div>
            {item.target && <div className="mt-1 flex min-w-0 items-center gap-1 text-[9px]">
              <Search size={10} className={item.element_status === 'found' ? 'text-emerald-400' : item.element_status === 'not_found' ? 'text-red-400' : 'text-amber-400'} />
              <span className={`shrink-0 ${item.element_status === 'found' ? 'text-emerald-400' : item.element_status === 'not_found' ? 'text-red-400' : 'text-amber-400'}`}>{item.element_status === 'found' ? 'found' : item.element_status === 'not_found' ? 'not found' : 'searching'}</span>
              <code className="min-w-0 truncate text-[#8f98a7]" title={item.target}>{item.target}</code>
            </div>}
            {item.error && <p className="mt-1 line-clamp-2 text-[9px] leading-3 text-red-300" title={item.error}>{item.error}</p>}
          </div>)}
        </div>
      </aside>}
    </div>
    <div className="shrink-0 border-t border-[#ebebeb] px-2.5 py-2 dark:border-[#374151]">
      <div className="flex min-w-0 items-center gap-1.5 text-[11px]">
        <span className="min-w-0 flex-1 truncate text-[#777] dark:text-[#b6bac2]" title={live?.url || shown?.filename || ''}>{live?.message || (shown ? shown.label : (currentNode ?? 'Browser not started'))}</span>
        {frames.length > 0 && <span className="shrink-0 tabular-nums text-[#888]">{selectedIndex + 1}/{frames.length}</span>}
        <button type="button" onClick={() => move(-1)} disabled={!frames.length || selectedIndex <= 0} aria-label="Previous browser screenshot" title="Previous frame" className="rounded p-1 hover:bg-[#ededed] disabled:opacity-25 dark:hover:bg-[#353b45]"><ChevronLeft size={15} /></button>
        <button type="button" onClick={() => move(1)} disabled={!frames.length || selectedIndex >= frames.length - 1} aria-label="Next browser screenshot" title="Next frame" className="rounded p-1 hover:bg-[#ededed] disabled:opacity-25 dark:hover:bg-[#353b45]"><ChevronRight size={15} /></button>
        <button type="button" onClick={showLatest} disabled={followLatest && latestSelected} className={`rounded-md px-2 py-1 text-[10px] font-semibold disabled:opacity-45 ${followLatest ? 'bg-violet-100 text-violet-700 dark:bg-violet-950/50 dark:text-violet-300' : 'bg-[#eee] text-[#555] dark:bg-[#374151] dark:text-[#ddd]'}`}>Live</button>
      </div>
      {live?.url && <p className="mt-1 truncate text-[10px] text-[#8c939e]" title={live.url}>{live.url}</p>}
      {!compact && frames.length > 1 && <div className="mt-2 flex gap-1.5 overflow-x-auto pb-1 [scrollbar-width:thin]">
        {frames.slice(-22).map(frame => <button type="button" key={frame.id} title={frame.label} onClick={() => { setSelectedId(frame.id); setFollowLatest(false) }} className={`h-9 w-[70px] shrink-0 overflow-hidden rounded-md border-2 bg-[#111318] ${shown?.id === frame.id ? 'border-violet-500' : 'border-transparent'}`}><img src={frameUrl(projectId, runId!, frame)} alt={frame.label} loading="lazy" className="h-full w-full object-cover" /></button>)}
      </div>}
    </div>
  </section>

  if (!expanded) return display
  return <>
    {display}
    <div role="dialog" aria-modal="true" aria-label="Expanded browser live preview" className="fixed inset-0 z-[10000] flex flex-col bg-[#111318]/95 p-3 sm:p-6">
      <div className="mb-2 flex shrink-0 items-center justify-between text-white"><strong>Browser Live Preview · Run #{runId ?? '—'}</strong><button type="button" onClick={() => setExpanded(false)} aria-label="Close expanded preview" className="rounded-lg p-2 hover:bg-white/20"><X size={20} /></button></div>
      <div className="min-h-0 flex-1 overflow-hidden rounded-xl border border-[#404958]">{display}</div>
    </div>
  </>
}
