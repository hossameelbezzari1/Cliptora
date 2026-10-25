import { useRef, useState } from 'react'
import type { WorkflowStudioState } from './useWorkflowStudio'
import { Check, Film, Maximize2, Play, Sparkles } from 'lucide-react'
import { fileUrl } from '../../lib/api'
import { btn } from './workflowUI'

export function WorkflowBottomDeck({ studio }: { studio: WorkflowStudioState }) {
  const { nodes, run, catalog, completedNodes, cancel, previewMedia, applyCutPlan } = studio
  const [tab, setTab] = useState<'execution' | 'logs' | 'results'>('execution')
  const videoRef = useRef<HTMLVideoElement>(null)
  const activeNode = nodes.find(node => node.id === run?.current_node)
  const results = Object.entries(run?.results ?? {})

  return (
    <section className="flex h-[245px] shrink-0 overflow-hidden border-t border-[#e5e7eb] bg-white text-[#252525] 2xl:h-[275px]">
      <div className="flex min-w-0 flex-[1.15] flex-col border-r border-[#e5e7eb]">
        <div className="flex h-10 shrink-0 items-center gap-3 border-b border-[#ededed] px-3">
          {(['execution', 'logs', 'results'] as const).map(value => (
            <button key={value} type="button" onClick={() => setTab(value)} className={`h-full border-b-2 px-2 text-[11px] font-semibold capitalize ${tab === value ? 'border-violet-600 text-violet-700' : 'border-transparent text-[#858585] hover:text-[#444]'}`}>{value}</button>
          ))}
          <span className="ml-auto text-[11px] text-[#858585]">{run ? `Run #${run.id}` : 'No active run'}</span>
        </div>

        {tab === 'execution' && (
          <div className="flex min-h-0 flex-1 overflow-hidden">
            <div className="hidden w-[190px] shrink-0 overflow-y-auto border-r border-[#f0f0f0] p-2 lg:block">
              {nodes.map(node => {
                const result = run?.results?.[node.id]
                const current = run?.state === 'running' && run.current_node === node.id
                return (
                  <div key={node.id} className={`mb-1 flex items-center gap-2 rounded-md p-2 text-[11px] ${current ? 'bg-violet-50 text-violet-700' : 'text-[#626262]'}`}>
                    {result?.state === 'completed' ? <Check size={13} className="shrink-0 text-emerald-600" /> : current ? <Sparkles size={13} className="shrink-0 animate-pulse text-violet-600" /> : <span className="size-3 shrink-0 rounded-full border border-[#c9c9c9]" />}
                    <span className="min-w-0 truncate">{catalog.find(item => item.type === node.type)?.label ?? node.id}</span>
                  </div>
                )
              })}
            </div>
            <div className="flex min-w-0 flex-1 flex-col justify-center gap-3 p-4">
              <div className="flex items-center gap-3">
                <div className="grid size-14 shrink-0 place-items-center rounded-full border-[6px] border-violet-100 bg-white text-sm font-bold text-violet-700">{run?.progress ?? 0}%</div>
                <div className="min-w-0">
                  <h3 className="truncate text-sm font-semibold text-[#242424]">
                    {run?.state === 'running' ? `Processing ${catalog.find(item => item.type === activeNode?.type)?.label ?? run.current_node}…` : run?.state === 'completed' ? 'Workflow completed' : run?.state === 'failed' ? 'Execution failed' : 'Ready to run workflow'}
                  </h3>
                  <p className="mt-1 text-[11px] text-[#858585]">{run ? `${completedNodes} of ${nodes.length} nodes completed` : 'Select a source and run the workflow.'}</p>
                </div>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-[#ececec]"><div className="h-full rounded-full bg-violet-600 transition-[width] duration-300" style={{ width: `${Math.max(0, Math.min(run?.progress ?? 0, 100))}%` }} /></div>
              <div className="flex flex-wrap justify-end gap-2">
                <button type="button" className={btn} disabled={!run || !['queued', 'running'].includes(run.state)} onClick={() => void cancel()}>Cancel</button>
                <button type="button" className={btn} onClick={() => setTab('logs')}>View details</button>
              </div>
            </div>
          </div>
        )}

        {tab === 'logs' && (
          <div className="min-h-0 flex-1 overflow-auto p-3 text-[11px] text-[#666]">
            {run ? <div className="space-y-2">
              <p className="font-medium text-[#333]">Run #{run.id} · {run.state}</p>
              {run.error && <pre className="whitespace-pre-wrap break-words rounded-lg border border-red-200 bg-red-50 p-2 text-red-700">{run.error}</pre>}
              {results.map(([id, result]) => <div key={id} className="flex items-center justify-between gap-2 rounded-md border border-[#e8e8e8] px-3 py-2"><span className="truncate font-mono">{id}</span><span className="shrink-0 capitalize">{result.state}</span></div>)}
            </div> : <p>Run the workflow to see execution results and errors.</p>}
          </div>
        )}

        {tab === 'results' && (
          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            {results.length ? results.map(([id, result]) => <div key={id} className="mb-2 rounded-lg border border-[#e8e8e8] bg-[#fafafa] p-3 text-[11px]"><p className="font-mono font-semibold text-[#333]">{id}</p><pre className="mt-2 max-h-32 overflow-auto whitespace-pre-wrap break-all text-[#666]">{JSON.stringify(result, null, 2)}</pre></div>) : <p className="text-xs text-[#888]">No node results yet.</p>}
          </div>
        )}
      </div>

      <div className="hidden min-w-0 flex-1 flex-col p-3 xl:flex">
        <div className="mb-2 flex items-center justify-between">
          <strong className="text-[11px]">Source preview</strong>
          <button type="button" onClick={() => void videoRef.current?.requestFullscreen?.()} disabled={!previewMedia} title="Fullscreen video" className="rounded-md p-1 text-[#777] hover:bg-[#f4f4f4] disabled:opacity-40"><Maximize2 size={14} /></button>
        </div>
        <div className="relative min-h-0 flex-1 overflow-hidden rounded-lg bg-[#101114]">
          {previewMedia ? <video ref={videoRef} src={fileUrl(previewMedia.id)} controls preload="metadata" className="h-full w-full object-contain" /> : <div className="grid h-full place-content-center justify-items-center gap-2 text-[11px] text-[#9a9a9a]"><Film size={25} />Choose a video in Source settings</div>}
        </div>
        <div className="mt-2 flex items-center justify-between gap-3">
          <span className="inline-flex min-w-0 items-center gap-1.5 truncate text-[10px] text-[#777]"><Play size={12} />{run ? `${completedNodes} nodes ready · ${run.progress}%` : 'No execution yet'}</span>
          {run?.state === 'completed' && <button type="button" onClick={() => void applyCutPlan()} className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-violet-700 px-2 py-1.5 text-[10px] font-semibold text-white hover:bg-violet-800"><Check size={12} /> Apply cuts</button>}
        </div>
      </div>
    </section>
  )
}
