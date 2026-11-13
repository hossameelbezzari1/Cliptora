import { useEffect, useState } from 'react'
import { ExternalLink, Maximize2, MonitorPlay, RefreshCw, X } from 'lucide-react'

type PreviewFrame = {
  url: string
  label: string
  step: number
  timestamp: number
}

type PreviewStatus = {
  available: boolean
  node_id?: string
  provider?: string
  status: string
  step?: number
  total?: number
  message?: string
  url?: string
  updated_at?: number
  frames: PreviewFrame[]
}

type Props = { projectId: number; runId: number; runState: string }

const activeStates = new Set(['queued', 'running', 'cancelling'])
const displayState = (status: string) => ({
  starting: 'Starting', running: 'Running', waiting: 'Waiting for verification',
  completed: 'Completed', failed: 'Failed', cancelled: 'Cancelled', queued: 'Queued',
}[status] ?? status)

export function BrowserExecutionPreview({ projectId, runId, runState }: Props) {
  const [preview, setPreview] = useState<PreviewStatus | null>(null)
  const [selectedFrame, setSelectedFrame] = useState<string | null>(null)
  const [fullscreen, setFullscreen] = useState(false)
  const [error, setError] = useState('')
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => {
    setPreview(null)
    setSelectedFrame(null)
    setError('')
  }, [projectId, runId])

  useEffect(() => {
    let stopped = false
    let busy = false
    const controller = new AbortController()

    const refresh = async () => {
      if (busy || stopped) return
      busy = true
      try {
        const response = await fetch(
          `/api/v1/workflows/${projectId}/runs/${runId}/browser-preview`,
          { credentials: 'same-origin', cache: 'no-store', signal: controller.signal },
        )
        if (!response.ok) throw new Error(`Browser preview request failed (${response.status})`)
        const data = await response.json() as PreviewStatus
        if (!stopped) {
          setPreview(data)
          setError('')
        }
      } catch (err) {
        if (!stopped && !controller.signal.aborted) {
          setError(err instanceof Error ? err.message : 'Could not load browser preview')
        }
      } finally {
        busy = false
      }
    }

    void refresh()
    // Keep polling while mounted; historic runs can be inspected too.
    const timer = window.setInterval(() => { void refresh() }, activeStates.has(runState) ? 1200 : 3500)
    return () => {
      stopped = true
      controller.abort()
      window.clearInterval(timer)
    }
  }, [projectId, runId, runState, refreshKey])

  if (!preview?.available) return null

  const frames = preview.frames ?? []
  const last = frames[frames.length - 1]
  const current = frames.find(frame => frame.url === selectedFrame) ?? last
  const isLive = activeStates.has(runState) && activeStates.has(preview.status)
  const currentStatus = activeStates.has(runState) ? preview.status : runState

  const frameView = (
    <div className="relative flex min-h-[180px] flex-1 items-center justify-center overflow-hidden rounded-xl bg-[#111827]">
      {current ? (
        <img
          key={current.url}
          src={current.url}
          alt={`Browser screenshot: ${current.label}`}
          className="max-h-full max-w-full object-contain"
          loading="eager"
        />
      ) : (
        <div className="flex flex-col items-center gap-2 p-5 text-center text-sm text-slate-300">
          <MonitorPlay size={25} />
          Waiting for first screenshot…
        </div>
      )}
      {isLive && (
        <span className="absolute left-3 top-3 inline-flex items-center gap-1.5 rounded-full bg-black/75 px-2.5 py-1 text-[11px] font-semibold text-white">
          <span className="size-1.5 animate-pulse rounded-full bg-emerald-400" />
          LIVE · Snapshots
        </span>
      )}
    </div>
  )

  return (
    <section className="shrink-0 border-b border-[#e9e9e9] bg-white p-3 dark:border-[#393939] dark:bg-[#202020] sm:p-4" aria-label="Browser execution preview">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <MonitorPlay size={17} className="text-violet-600" />
          <strong className="text-[13px] font-semibold text-[#262626] dark:text-white">Browser execution</strong>
          <span className="rounded-full bg-[#f2f2f2] px-2 py-0.5 text-[11px] text-[#666] dark:bg-[#343c4b] dark:text-[#d0d7e2]">{preview.provider || 'Browser'}</span>
          <span className="text-[11px] text-[#777] dark:text-[#a9afba]">{displayState(currentStatus)}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <button type="button" onClick={() => setRefreshKey(key => key + 1)} title="Refresh preview" aria-label="Refresh preview" className="rounded-lg p-2 text-[#666] hover:bg-[#f3f3f3] dark:text-[#cbd5e1] dark:hover:bg-[#343c4b]"><RefreshCw size={15} /></button>
          <button type="button" onClick={() => setFullscreen(true)} title="Enlarge browser preview" aria-label="Enlarge browser preview" className="rounded-lg p-2 text-[#666] hover:bg-[#f3f3f3] dark:text-[#cbd5e1] dark:hover:bg-[#343c4b]"><Maximize2 size={15} /></button>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-[minmax(0,1fr)_220px]">
        <div className="flex h-[220px] min-w-0 flex-col">{frameView}</div>
        <div className="min-w-0 space-y-2 text-[12px] text-[#444] dark:text-[#d1d5db]">
          <div className="font-medium">Step {preview.step ?? 0} / {preview.total ?? 0}</div>
          <div className="h-1.5 overflow-hidden rounded-full bg-[#e9e9e9] dark:bg-[#404958]">
            <div className="h-full rounded-full bg-violet-500 transition-all" style={{ width: `${Math.min(100, Math.max(0, (preview.step ?? 0) / Math.max(1, preview.total ?? 1) * 100))}%` }} />
          </div>
          <div className="line-clamp-2 text-[#777] dark:text-[#abb3c0]">{preview.message || 'Waiting for browser'}</div>
          {preview.url && <div title={preview.url} className="truncate text-[#777] dark:text-[#abb3c0]">{preview.url}</div>}
          <div className="max-h-[103px] space-y-1 overflow-y-auto">
            {frames.slice(-12).map((frame, index) => (
              <button type="button" key={`${frame.url}-${index}`} onClick={() => setSelectedFrame(frame.url)} className={`block w-full truncate rounded-md px-2 py-1 text-left text-[11px] ${current?.url === frame.url ? 'bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-200' : 'hover:bg-[#f3f3f3] dark:hover:bg-[#343c4b]'}`}>#{frame.step} · {frame.label}</button>
            ))}
          </div>
        </div>
      </div>
      {error && <p className="mt-2 text-[11px] text-rose-600">{error}</p>}
      {fullscreen && (
        <div className="fixed inset-0 z-[300] flex flex-col bg-black/95 p-3 sm:p-6" role="dialog" aria-modal="true" aria-label="Browser preview full screen">
          <div className="mb-3 flex items-center justify-between gap-3 text-white">
            <div className="min-w-0 truncate text-sm">Browser execution · {displayState(currentStatus)} · Step {preview.step ?? 0}/{preview.total ?? 0}</div>
            <div className="flex items-center gap-2">
              {current && <a href={current.url} target="_blank" rel="noopener noreferrer" title="Open screenshot" className="rounded-lg p-2 hover:bg-white/20"><ExternalLink size={17} /></a>}
              <button type="button" onClick={() => setFullscreen(false)} aria-label="Close full screen" className="rounded-lg p-2 hover:bg-white/20"><X size={20} /></button>
            </div>
          </div>
          <div className="min-h-0 flex-1">{frameView}</div>
        </div>
      )}
    </section>
  )
}
