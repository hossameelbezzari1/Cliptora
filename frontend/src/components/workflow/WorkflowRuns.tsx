import type { WorkflowStudioState } from './useWorkflowStudio'
import { AlertCircle, CheckCircle2, Download, LoaderCircle, RotateCcw, Scissors, XCircle } from 'lucide-react'
import { btn, card } from './workflowUI'

const isActive = (state: string) => state === 'queued' || state === 'running' || state === 'cancelling'

export function WorkflowRuns({ studio }: { studio: WorkflowStudioState }) {
  const { run, cancel, retry, working, applyCutPlan, downloadVideo, fetchArtifact, runs, chooseRun } = studio

  return (
    <section className="min-h-0 min-w-0 flex-1 overflow-y-auto bg-[#fafafa] p-4 text-[#242424] sm:p-6">
      <div className="mb-5">
        <h2 className="text-lg font-bold tracking-tight">Execution History</h2>
        <p className="mt-1 text-xs text-[#858585]">Review each run, inspect artifacts, retry failed jobs and apply results to the Timeline.</p>
      </div>

      {run && (
        <div className={`${card} mb-6 p-4 sm:p-5`}>
          <div className="flex flex-wrap items-center gap-2">
            <strong className="text-sm">Run #{run.id}</strong>
            <span className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-semibold ${run.state === 'completed' ? 'bg-emerald-50 text-emerald-700' : run.state === 'failed' ? 'bg-red-50 text-red-700' : isActive(run.state) ? 'bg-amber-50 text-amber-800' : 'bg-[#f4f4f5] text-[#555]'}`}>
              {run.state === 'completed' ? <CheckCircle2 size={13} /> : run.state === 'failed' ? <XCircle size={13} /> : <LoaderCircle size={13} className={isActive(run.state) ? 'animate-spin' : ''} />}
              {run.state}
            </span>
            <span className="ml-auto truncate text-xs text-[#888]">{run.current_node ?? 'Preparing'}</span>
          </div>
          <div className="mt-4 h-2 overflow-hidden rounded-full bg-[#eeeeee]"><div className="h-full rounded-full bg-violet-600 transition-[width] duration-300" style={{ width: `${Math.min(100, Math.max(0, run.progress))}%` }} /></div>
          <p className="mt-2 text-xs text-[#777]">{run.progress}% complete · JSON artifacts remain editable, and source videos are never modified.</p>
          {run.error && <p className="mt-3 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700"><AlertCircle size={15} className="shrink-0" />{run.error}</p>}
          <div className="mt-4 flex flex-wrap gap-2">
            <button type="button" className={btn} disabled={!['queued', 'running'].includes(run.state)} onClick={() => void cancel()}>Cancel</button>
            <button type="button" className={btn} disabled={!['failed', 'cancelled'].includes(run.state)} onClick={() => void retry()}><RotateCcw size={14} /> Retry from checkpoint</button>
            <button type="button" className={btn} disabled={run.state !== 'completed' || working} onClick={() => void applyCutPlan()}><Scissors size={14} /> Apply Cut Plan</button>
            <button type="button" className={btn} disabled={run.state !== 'completed' || working} onClick={() => void downloadVideo()}><Download size={14} /> Rendered video</button>
          </div>
          <h3 className="mb-2 mt-5 text-xs font-semibold uppercase tracking-wide text-[#888]">Node artifacts</h3>
          <div className="space-y-2">
            {Object.entries(run.results ?? {}).map(([nodeId, info]) => (
              <div key={nodeId} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[#e5e7eb] bg-[#fafafa] px-3 py-2.5">
                <div className="min-w-0"><p className="truncate font-mono text-xs text-[#3b3b3b]">{nodeId}</p><p className="mt-1 text-[10px] text-[#888]">{info.state} · {Object.entries(info).filter(([key]) => key.endsWith('_count')).map(([key, value]) => `${key}: ${String(value)}`).join(' · ')}</p></div>
                <button type="button" className={btn} onClick={() => void fetchArtifact(nodeId)} disabled={!info.artifact || working}><Download size={14} /> JSON</button>
              </div>
            ))}
          </div>
        </div>
      )}

      <h3 className="mb-2 text-[11px] font-bold uppercase tracking-wider text-[#8a8a8a]">Recent runs</h3>
      {runs.length ? <div className="space-y-2">{runs.map(item => (
        <button key={item.id} type="button" onClick={() => chooseRun(item)} className={`${card} flex w-full items-center justify-between gap-3 px-4 py-3 text-left text-xs transition-colors hover:border-violet-300 hover:bg-violet-50/30`}>
          <span className="min-w-0 truncate font-medium">Run #{item.id} · Workflow #{item.workflow_id}</span>
          <span className="shrink-0 text-[#777]">{item.state} · {item.progress}%</span>
        </button>
      ))}</div> : <div className="rounded-xl border border-dashed border-[#ddd] bg-white p-6 text-center text-xs text-[#888]">No runs recorded yet.</div>}
    </section>
  )
}
