
import {
  Activity,
  AlertCircle,
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
  className?: string
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : null
}

function formatTime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60

  return h
    ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
    : `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
}

export function NodeProgress({
  run,
  nodeId,
  label = 'Node execution',
  className = '',
}: Props) {
  const raw = run?.results?.[nodeId]

  const node: Record<string, unknown> =
    raw && typeof raw === 'object' && !Array.isArray(raw)
      ? raw as Record<string, unknown>
      : {}

  const state = String(node.state ?? '')

  const queued =
    run?.state === 'queued' &&
    (!state || state === 'queued')

  const running =
    state === 'running' ||
    (
      run?.state === 'running' &&
      run.current_node === nodeId &&
      !['completed', 'skipped', 'failed'].includes(state)
    )

  const failed = state === 'failed'

  if (!queued && !running && !failed) {
    return null
  }

  const processedSeconds = asNumber(node.processed_seconds)
  const totalSeconds = asNumber(node.total_seconds)
  const processed = asNumber(node.processed)
  const total = asNumber(node.total)
  const words = asNumber(node.words_processed)

  const reportedProgress = asNumber(node.progress)

  const derivedProgress =
    totalSeconds !== null &&
    totalSeconds > 0 &&
    processedSeconds !== null
      ? (processedSeconds / totalSeconds) * 100
      : total !== null && total > 0 && processed !== null
        ? (processed / total) * 100
        : null

  const rawProgress = reportedProgress ?? derivedProgress

  const progress = rawProgress === null
    ? null
    : Math.max(0, Math.min(100, Math.round(rawProgress)))

  const stage = String(
    node.stage || (queued ? 'queued' : 'processing')
  )
    .replace(/[_-]/g, ' ')
    .replace(/\b\w/g, letter => letter.toUpperCase())

  const message =
    typeof node.message === 'string' ? node.message : ''

  const error =
    typeof node.error === 'string'
      ? node.error
      : run?.error ?? ''

  const unit =
    typeof node.unit === 'string' ? node.unit : 'items'

  return (
    <div
      className={`mx-3 my-3 rounded-xl border border-[#e7e7eb] bg-white p-4 text-[#292929] shadow-sm ${className}`}
      role="status"
      aria-live="polite"
      aria-label={`${label} progress`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          {failed ? (
            <AlertCircle
              size={17}
              className="shrink-0 text-red-600"
            />
          ) : queued ? (
            <Clock3
              size={17}
              className="shrink-0 text-[#777]"
            />
          ) : (
            <LoaderCircle
              size={17}
              className="shrink-0 animate-spin text-[#7555cf]"
            />
          )}

          <div className="min-w-0">
            <p className="truncate text-[13px] font-semibold">
              {label}
            </p>
            <p className="mt-0.5 text-[11px] text-[#777]">
              {failed ? 'Execution failed' : stage}
            </p>
          </div>
        </div>

        <span className={`shrink-0 text-[20px] font-semibold tabular-nums ${failed ? 'text-red-600' : 'text-[#292929]'}`}>
          {failed ? 'Failed' : progress !== null ? `${progress}%` : '—'}
        </span>
      </div>

      <div
        className="mt-3 h-[7px] overflow-hidden rounded-full bg-[#ececf0]"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={progress ?? undefined}
        aria-valuetext={progress === null ? stage : `${progress}%`}
      >
        {progress !== null ? (
          <div
            className={`h-full rounded-full transition-[width] duration-500 ease-out ${failed ? 'bg-red-500' : 'bg-[#7555cf]'}`}
            style={{ width: `${progress}%` }}
          />
        ) : (
          <div className="h-full w-1/3 animate-pulse rounded-full bg-[#a68ce5]" />
        )}
      </div>

      {processedSeconds !== null &&
        totalSeconds !== null &&
        totalSeconds > 0 && (
          <div className="mt-2 flex items-center justify-between gap-2 text-[11px] tabular-nums text-[#777]">
            <span>Audio processed</span>
            <span>
              {formatTime(processedSeconds)} / {formatTime(totalSeconds)}
            </span>
          </div>
        )}

      {processed !== null &&
        total !== null &&
        total > 0 && (
          <div className="mt-2 flex items-center justify-between gap-2 text-[11px] tabular-nums text-[#777]">
            <span>{unit} processed</span>
            <span>
              {processed.toLocaleString()} / {total.toLocaleString()}
            </span>
          </div>
        )}

      {words !== null && (
        <div className="mt-2 flex items-center justify-between gap-2 text-[11px] text-[#777]">
          <span className="flex items-center gap-1">
            <Activity size={12} />
            Words processed
          </span>
          <span className="tabular-nums">
            {words.toLocaleString()}
          </span>
        </div>
      )}

      {message && !failed && (
        <p className="mt-2 text-[11px] leading-5 text-[#777]">
          {message}
        </p>
      )}

      {failed && error && (
        <p className="mt-2 break-words text-[11px] leading-5 text-red-700">
          {error}
        </p>
      )}

      {queued && (
        <p className="mt-2 text-[11px] text-[#777]">
          Waiting for execution to start...
        </p>
      )}
    </div>
  )
}

export default NodeProgress
