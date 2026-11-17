
import { useCallback, useEffect, useRef, useState } from 'react'

type LaunchResponse = { run_id: number; state: string }
type ResultResponse = {
  run_id: number
  status: string
  media_id: number | null
  duration: number | null
  target_clip_client_id: string | null
}

type Props = {
  projectId: number
  workflowId: number | null
  selectedMediaId: number | null
  emptyClipClientId?: string | null
  /** Pass CLIPTORA's existing authenticated/CSRF-aware JSON API client. */
  postJson: <T,>(path: string, body: object) => Promise<T>
  getJson: <T,>(path: string) => Promise<T>
  /** Update the selected Empty Element in editor state and refresh the timeline. */
  onVideoReady: (mediaId: number, runId: number) => void
}

export function TimelineWorkflowLauncher({
  projectId, workflowId, selectedMediaId, emptyClipClientId,
  postJson, getJson, onVideoReady,
}: Props) {
  const [runId, setRunId] = useState<number | null>(null)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState('')
  const delivered = useRef<number | null>(null)

  const launch = useCallback(async () => {
    if (!workflowId || !selectedMediaId || running) return
    setError(null)
    setMessage('Starting workflow…')
    setRunning(true)
    delivered.current = null
    try {
      const result = await postJson<LaunchResponse>(
        `/workflow-events/projects/${projectId}/timeline/${workflowId}`,
        { media_id: selectedMediaId, target_clip_client_id: emptyClipClientId ?? null },
      )
      setRunId(result.run_id)
      setMessage(`Run #${result.run_id}: ${result.state}`)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to launch the workflow')
      setRunning(false)
    }
  }, [emptyClipClientId, postJson, projectId, running, selectedMediaId, workflowId])

  useEffect(() => {
    if (!runId) return
    let alive = true
    let busy = false
    const poll = async () => {
      if (busy) return
      busy = true
      try {
        const result = await getJson<ResultResponse>(
          `/workflow-events/projects/${projectId}/timeline-runs/${runId}`,
        )
        if (!alive) return
        setMessage(`Run #${runId}: ${result.status}`)
        if (result.status === 'completed') {
          if (result.media_id && delivered.current !== runId) {
            delivered.current = runId
            // Synchronize an existing DB clip if the Empty Element is persisted.
            // If the element lives only in frontend state, onVideoReady updates it.
            if (emptyClipClientId) {
              await postJson(
                `/workflow-events/projects/${projectId}/timeline-runs/${runId}/apply`,
                {},
              )
            }
            if (alive) onVideoReady(result.media_id, runId)
          } else if (!result.media_id) {
            setError('Run completed but no valid MP4 render output was found')
          }
          setRunning(false)
          setRunId(null)
        } else if (result.status === 'failed' || result.status === 'cancelled') {
          setError(`Workflow run ${result.status}`)
          setRunning(false)
          setRunId(null)
        }
      } catch (reason) {
        if (alive) setError(reason instanceof Error ? reason.message : 'Unable to check run status')
      } finally {
        busy = false
      }
    }
    void poll()
    const timer = window.setInterval(() => void poll(), 2500)
    return () => { alive = false; window.clearInterval(timer) }
  }, [emptyClipClientId, getJson, onVideoReady, postJson, projectId, runId])

  return (
    <div className="inline-flex min-w-0 flex-col gap-1">
      <button
        type="button"
        onClick={() => void launch()}
        disabled={!workflowId || !selectedMediaId || running}
        className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
        title={!selectedMediaId ? 'Select a video clip in the Timeline first' : undefined}
      >
        {running ? 'Workflow running…' : 'Add Video to Workflow'}
      </button>
      {message && <small className="text-xs text-slate-500">{message}</small>}
      {error && <small role="alert" className="text-xs text-red-600">{error}</small>}
    </div>
  )
}
