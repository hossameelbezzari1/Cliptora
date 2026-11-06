import { useEffect, useState } from 'react'
import {
  Activity,
  AlertCircle,
  CheckCircle2,
  Clock3,
  LoaderCircle,
} from 'lucide-react'

type RunLike = {
  id?: number
  state?: string
  current_node?: string | null
  results?: Record<string, unknown> | null
  error?: string | null
} | null

type Props = {
  run?: RunLike
  nodeId: string
  label?: string
  variant?: 'compact' | 'detailed'
  showCompleted?: boolean
  className?: string
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : null
}

function formatTime(seconds: number): string {
  const value = Math.max(0, Math.floor(seconds))
  const hours = Math.floor(value / 3600)
  const minutes = Math.floor((value % 3600) / 60)
  const remainder = value % 60
  return hours
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`
    : `${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`
}

function clockFrom(value: unknown): number | null {
  if (typeof value !== 'string' || !value.trim()) return null
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) ? timestamp : null
}

export function NodeProgress({
  run,
  nodeId,
  label = 'Node execution',
  variant = 'detailed',
  showCompleted = false,
  className = '',
}: Props) {
  const [now, setNow] = useState(() => Date.now())
  const raw = run?.results?.[nodeId]
  const node: Record<string, unknown> =
    raw && typeof raw === 'object' && !Array.isArray(raw)
      ? raw as Record<string, unknown>
      : {}

  const state = String(node.state ?? '')
  const isCurrent = run?.current_node === nodeId
  const failed = state === 'failed' || (run?.state === 'failed' && isCurrent && state !== 'completed')
  const running = !failed && (state === 'running' ||
    (run?.state === 'running' && isCurrent && !['completed', 'skipped', 'cancelled'].includes(state)))
  const queued = !running && !failed && run?.state === 'queued' && !state
  const completed = state === 'completed' && showCompleted
  const visible = Boolean(running || queued || failed || completed)

  useEffect(() => {
    if (!running) return
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [running])

  if (!visible) return null

  const processedSeconds = asNumber(node.processed_seconds)
  const totalSeconds = asNumber(node.total_seconds)
  const processed = asNumber(node.processed)
  const total = asNumber(node.total)
  const words = asNumber(node.words_processed)
  const segments = asNumber(node.segments_processed)
  const frames = asNumber(node.frames_processed)
  const requests = asNumber(node.requests_processed)

  const derivedProgress = totalSeconds !== null && totalSeconds > 0 && processedSeconds !== null
    ? processedSeconds / totalSeconds * 100
    : total !== null && total > 0 && processed !== null
      ? processed / total * 100
      : null
  const reportedProgress = asNumber(node.progress)
  const value = completed ? 100 : reportedProgress ?? derivedProgress
  const percent = value === null ? null : Math.max(0, Math.min(100, Math.round(value)))

  const stage = String(node.stage || (queued ? 'queued' : 'processing'))
    .replace(/[_-]/g, ' ')
    .replace(/\b\w/g, letter => letter.toUpperCase())
  const message = typeof node.message === 'string' ? node.message : ''
  const error = typeof node.error === 'string' ? node.error : run?.error ?? ''
  const started = clockFrom(node.started_at)
  const finished = clockFrom(node.finished_at)
  const elapsed = started === null
    ? asNumber(node.elapsed_seconds)
    : Math.max(0, ((running ? now : finished ?? now) - started) / 1000)
  const unit = typeof node.unit === 'string' ? node.unit : 'items'

  const StatusIcon = failed ? AlertCircle : completed ? CheckCircle2 : queued ? Clock3 : LoaderCircle
  const colorClass = failed ? 'text-red-600 dark:text-red-300' : completed ? 'text-emerald-600 dark:text-emerald-300' : 'text-[#7c3aed] dark:text-[#c8acf7]'

  if (variant === 'compact') {
    return (
      <div className={`nodrag nopan w-full min-w-0 text-left ${className}`} role="status" aria-label={`${label} progress`}>
        <div className="flex items-center justify-between gap-1 text-[10px] leading-4">
          <span className="inline-flex min-w-0 items-center gap-1 truncate text-[#777] dark:text-[#b8bec7]">
            <StatusIcon size={12} className={`${colorClass} shrink-0 ${running ? 'animate-spin' : ''}`} />
            <span className="truncate">{failed ? 'Failed' : completed ? 'Completed' : stage}</span>
          </span>
          <strong className="shrink-0 tabular-nums text-[#444] dark:text-[#b8bec7]">
            {percent === null ? '—' : `${percent}%`}
          </strong>
        </div>
        <div className="mt-1 h-[4px] overflow-hidden rounded-full bg-[#e7e7eb] dark:bg-[#1f2937]" role="progressbar"
          aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent ?? undefined}>
          {percent !== null
            ? <div className={`h-full rounded-full transition-[width] duration-500 ${failed ? 'bg-red-500' : completed ? 'bg-emerald-500' : 'bg-[#8b5cf6]'}`}
                style={{ width: `${percent}%` }} />
            : <div className="h-full w-1/3 animate-pulse rounded-full bg-[#a78bfa]" />}
        </div>
        {elapsed !== null && <div className="mt-1 text-[10px] tabular-nums text-[#888] dark:text-[#b8bec7]">{formatTime(elapsed)} elapsed</div>}
      </div>
    )
  }

  const metrics: { label: string; value: string }[] = []
  if (processedSeconds !== null && totalSeconds !== null && totalSeconds > 0) {
    metrics.push({ label: 'Audio processed', value: `${formatTime(processedSeconds)} / ${formatTime(totalSeconds)}` })
  }
  if (processed !== null && total !== null && total > 0) {
    metrics.push({ label: `${unit} processed`, value: `${processed.toLocaleString()} / ${total.toLocaleString()}` })
  }
  if (words !== null) metrics.push({ label: 'Words recognized', value: words.toLocaleString() })
  if (segments !== null) metrics.push({ label: 'Segments', value: segments.toLocaleString() })
  if (frames !== null) metrics.push({ label: 'Frames', value: frames.toLocaleString() })
  if (requests !== null) metrics.push({ label: 'Requests', value: requests.toLocaleString() })
  if (elapsed !== null) metrics.push({ label: 'Real elapsed time', value: formatTime(elapsed) })

  return (
    <section className={`rounded-xl border border-[#e7e7eb] dark:border-[#374151] bg-white dark:bg-cl-dark-panel p-4 text-[#292929] dark:text-[#f3f4f6] ${className}`}
      role="status" aria-live="polite" aria-label={`${label} progress`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <StatusIcon size={18} className={`shrink-0 ${colorClass} ${running ? 'animate-spin' : ''}`} />
          <div className="min-w-0">
            <p className="truncate text-[13px] font-semibold">{label}</p>
            <p className="mt-0.5 text-[11px] text-[#777] dark:text-[#b8bec7]">{failed ? 'Execution failed' : completed ? 'Completed' : stage}</p>
          </div>
        </div>
        <span className={`shrink-0 text-[20px] font-semibold tabular-nums ${failed ? 'text-red-600 dark:text-red-300' : 'text-[#292929] dark:text-[#f3f4f6]'}`}>
          {failed ? 'Failed' : percent === null ? '—' : `${percent}%`}
        </span>
      </div>
      <div className="mt-3 h-[7px] overflow-hidden rounded-full bg-[#ececf0] dark:bg-[#1f2937]" role="progressbar"
        aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent ?? undefined}
        aria-valuetext={percent === null ? stage : `${percent}%`}>
        {percent !== null
          ? <div className={`h-full rounded-full transition-[width] duration-500 ${failed ? 'bg-red-500' : completed ? 'bg-emerald-500' : 'bg-[#8b5cf6]'}`}
              style={{ width: `${percent}%` }} />
          : <div className="h-full w-1/3 animate-pulse rounded-full bg-[#a78bfa]" />}
      </div>
      {metrics.length > 0 && <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2">
        {metrics.map(item => <div key={item.label} className="min-w-0">
          <p className="truncate text-[10px] text-[#888] dark:text-[#b8bec7]">{item.label}</p>
          <p className="mt-0.5 break-words text-[12px] font-medium tabular-nums text-[#444] dark:text-[#b8bec7]">{item.value}</p>
        </div>)}
      </div>}
      {message && !failed && <p className="mt-3 flex items-start gap-1.5 text-[11px] leading-5 text-[#777] dark:text-[#b8bec7]">
        <Activity size={13} className="mt-0.5 shrink-0" />{message}
      </p>}
      {failed && error && <p className="mt-3 break-words text-[11px] leading-5 text-red-700 dark:text-red-300">{error}</p>}
      {queued && <p className="mt-2 text-[11px] text-[#777] dark:text-[#b8bec7]">Waiting for execution to start...</p>}
    </section>
  )
}

export default NodeProgress
