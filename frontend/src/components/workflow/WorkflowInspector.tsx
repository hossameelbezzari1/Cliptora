import type { WorkflowStudioState } from './useWorkflowStudio'
import type { WorkflowNode } from './workflowTypes'
import { ArrowRight, CheckCircle2, CircleHelp, FolderOpen, GitBranch, Settings2, Upload, X } from 'lucide-react'
import { mediaName } from '../editor/library/mediaLibraryUtils'
import { btn, CONDS, iconFor, toneFor } from './workflowUI'
import { InspectVideoParameters } from './InspectVideoPanels'

const field = 'mt-1.5 min-h-10 w-full rounded-lg border border-[#dedede] dark:border-[#374151] bg-white dark:bg-cl-dark-panel px-3 py-2 text-xs text-[#292929] dark:text-[#f3f4f6] outline-none transition-colors focus:border-violet-400 focus:ring-2 focus:ring-violet-100 dark:focus:ring-violet-900/70 disabled:cursor-not-allowed disabled:opacity-50'
const label = 'block text-xs font-semibold text-[#52525b] dark:text-[#b8bec7]'

export function WorkflowInspector({ studio }: { studio: WorkflowStudioState }) {
  const {
    selected, selectedCatalog, run, setSelectedId, inspectorTab, setInspectorTab,
    sourceId, setSourceId, sources, hasVideoSource, working, editorMedia,
    useMediaSource, fileInput, upload, page, updateSelectedSetting, updateNode,
    nodes, jsonEditor, setJsonEditor, setJsonError, jsonError,
    applySettings, downstream, save,
  } = studio

  const nodeName = (node: WorkflowNode | undefined) => {
    if (!node) return 'Previous node'
    const custom = node.settings.__cliptora_ui_label
    return typeof custom === 'string' && custom.trim()
      ? custom : studio.catalog.find(item => item.type === node.type)?.label ?? 'Workflow node'
  }

  return (
    <aside className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-white dark:bg-cl-dark-panel text-[#262626] dark:text-[#f3f4f6]" aria-label="Node Inspector">
      <div className="flex min-h-[70px] shrink-0 items-center gap-2.5 border-b border-[#e8e8e8] dark:border-[#374151] px-4">
        <span className={`grid size-9 shrink-0 place-items-center rounded-lg border ${toneFor(selected?.type ?? '')}`}>
          {selected ? iconFor(selected.type, 18) : <Settings2 size={17} />}
        </span>
        <div className="min-w-0 flex-1">
          <strong className="block truncate text-sm font-semibold">{selectedCatalog?.label ?? 'Node settings'}</strong>
          <small className="mt-0.5 block truncate text-[11px] text-[#888] dark:text-[#b8bec7]">
            {selected ? run?.results?.[selected.id]?.state ?? 'Ready to configure' : 'Select a node on the canvas'}
          </small>
        </div>
        <button type="button" onClick={() => setSelectedId(null)} className="grid size-8 shrink-0 place-items-center rounded-md text-[#888] dark:text-[#b8bec7] hover:bg-[#f4f4f5] dark:hover:bg-[#1f2937] hover:text-[#333] dark:hover:text-[#f3f4f6]" aria-label="Close node details"><X size={17} /></button>
      </div>

      <div role="tablist" aria-label="Node details" className="flex h-[49px] shrink-0 items-stretch gap-5 border-b border-[#e8e8e8] dark:border-[#374151] px-4">
        {(['settings', 'wiring'] as const).map(tab => (
          <button
            key={tab}
            type="button"
            role="tab"
            aria-selected={inspectorTab === tab}
            onClick={() => setInspectorTab(tab)}
            className={`border-b-2 px-1 text-xs font-semibold capitalize transition-colors ${inspectorTab === tab ? 'border-[#d1d5db] dark:border-[#252525] text-[#252525] dark:text-[#f3f4f6]' : 'border-transparent text-[#4b5563] dark:text-[#929292] hover:text-[#444] dark:hover:text-[#f3f4f6]'}`}
          >
            {tab === 'settings' ? 'Parameters' : 'Input / Output'}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain [scrollbar-width:thin]">
        {inspectorTab === 'settings' && (
          <>
            <section className="space-y-3 border-b border-[#ededed] dark:border-[#374151] p-4">
              <h3 className="flex items-center gap-2 text-xs font-semibold"><FolderOpen size={16} className="text-[#777] dark:text-[#b8bec7]" /> Source Video</h3>
              <label className={label} htmlFor="ws-source-select">Workflow source</label>
              <select id="ws-source-select" aria-label="Source video" value={sourceId ?? ''} onChange={event => setSourceId(event.target.value ? Number(event.target.value) : null)} className={field}>
                <option value="">{hasVideoSource ? 'Select a video...' : 'Optional for this workflow'}</option>
                {sources.map(source => <option key={source.id} value={source.id}>{source.filename} ({Math.round(source.size_bytes / 1024 / 1024)} MB)</option>)}
              </select>
              <select
                aria-label="Use Media Library video"
                disabled={working}
                defaultValue=""
                onChange={event => { const id = Number(event.target.value); event.target.value = ''; void useMediaSource(id) }}
                className={field}
              >
                <option value="">Use from Media Library...</option>
                {editorMedia.filter(item => item.kind === 'video').map(item => <option key={item.id} value={item.id}>{mediaName(item)}</option>)}
              </select>
              <input ref={fileInput} type="file" accept=".mp4,.mov,.mkv,.webm,.m4v" className="hidden" onChange={event => void upload(event)} />
              <button type="button" disabled={working} className={`${btn} w-full`} onClick={() => fileInput.current?.click()}><Upload size={15} /> Upload video</button>
              <p className="text-[11px] leading-relaxed text-[#858585] dark:text-[#b8bec7]">Project media is linked safely to workflow runs. Original files are not modified.</p>
            </section>

            {page === 'nodes' && selected ? (
              <div className="space-y-4 p-4">
                <h3 className="text-sm font-semibold">{selectedCatalog?.label ?? selected.type}</h3>
                {selected.type === 'media.probe' && <InspectVideoParameters settings={selected.settings} onChange={updateSelectedSetting} />}
                {selected.type === 'ai.highlights' && (
                  <section className="space-y-4 rounded-xl border border-[#e8e8e8] dark:border-[#374151] bg-[#fafafa] dark:bg-[#1f2937] p-3">
                    <label className={label}>AI Mode
                      <select value={String(selected.settings.mode ?? 'offline')} onChange={event => updateSelectedSetting('mode', event.target.value)} className={field}>
                        <option value="offline">Offline transcript analysis</option>
                        <option value="openai">OpenAI structured output</option>
                        <option value="manual">Manual highlights</option>
                      </select>
                    </label>
                    <label className={label}>
                      <span className="flex items-center justify-between gap-2">Target Duration <span className="text-violet-700 dark:text-violet-300">{Number(selected.settings.target_duration ?? 90)} sec</span></span>
                      <input type="range" min={15} max={1800} step={15} value={Number(selected.settings.target_duration ?? 90)} onChange={event => updateSelectedSetting('target_duration', Number(event.target.value))} className="mt-3 w-full accent-violet-600" />
                      <span className="mt-1 flex items-center justify-between text-[10px] font-normal text-[#4b5563] dark:text-[#939393]"><span>15 seconds</span><span>30 minutes</span></span>
                    </label>
                    <label className={label}>Selection Strategy
                      <select value={String(selected.settings.strategy ?? 'story_recap')} onChange={event => updateSelectedSetting('strategy', event.target.value)} className={field}>
                        <option value="story_recap">Story recap</option>
                        <option value="shorts_hook">Short-form hook</option>
                        <option value="podcast_clips">Podcast clips</option>
                      </select>
                    </label>
                  </section>
                )}

                <label className={label}>Condition
                  <select value={selected.when} onChange={event => updateNode(selected.id, { when: event.target.value as WorkflowNode['when'] })} className={field}>
                    {CONDS.map(condition => <option key={condition} value={condition}>{condition}</option>)}
                  </select>
                </label>
                <label className={label}>Retry limit
                  <input type="number" min={0} max={5} value={selected.retry_limit ?? 1} onChange={event => updateNode(selected.id, { retry_limit: Math.max(0, Math.min(5, Number(event.target.value) || 0)) })} className={field} />
                </label>
                <label className="flex cursor-pointer items-start gap-2 text-[11px] leading-relaxed text-[#626262] dark:text-[#b8bec7]">
                  <input type="checkbox" checked={selected.cache ?? true} onChange={event => updateNode(selected.id, { cache: event.target.checked })} className="mt-0.5 size-4 accent-violet-600" />
                  Reuse matching checkpoint when retrying
                </label>

                <fieldset className="space-y-2 border-t border-[#eee] dark:border-[#374151] pt-4">
                  <legend className="text-xs font-semibold text-[#555] dark:text-[#b8bec7]">Depends on</legend>
                  {nodes.filter(node => node.id !== selected.id).map(node => (
                    <label key={node.id} className="flex items-center gap-2 rounded-lg border border-[#ededed] dark:border-[#374151] px-3 py-2 text-[11px] text-[#555] dark:text-[#b8bec7]">
                      <input type="checkbox" className="size-4 accent-violet-600" checked={selected.depends_on.includes(node.id)} onChange={event => updateNode(selected.id, { depends_on: event.target.checked ? [...selected.depends_on, node.id] : selected.depends_on.filter(dep => dep !== node.id) })} />
                      <span className="min-w-0 break-words">{nodeName(node)}</span>
                    </label>
                  ))}
                  {nodes.length < 2 && <p className="text-[11px] text-[#4b5563] dark:text-[#929292]">Add another node to configure dependencies.</p>}
                </fieldset>

                <details className="group rounded-xl border border-[#e8e8e8] dark:border-[#374151] p-3">
                  <summary className="cursor-pointer text-xs font-semibold text-[#555] dark:text-[#b8bec7]">Advanced settings (JSON)</summary>
                  <div className="mt-3 space-y-2">
                    <label htmlFor="workflow-node-settings" className={label}>Node settings JSON</label>
                    <textarea
                      id="workflow-node-settings"
                      value={jsonEditor}
                      onChange={event => { setJsonEditor(event.target.value); setJsonError(null) }}
                      rows={10}
                      spellCheck={false}
                      className={`${field} min-h-[160px] resize-y font-mono text-[11px] leading-relaxed`}
                    />
                    {jsonError && <p role="alert" className="rounded-md bg-red-50 dark:bg-red-950/40 px-2 py-1.5 text-[11px] text-red-700 dark:text-red-300">{jsonError}</p>}
                    <button type="button" className={`${btn} w-full`} onClick={applySettings}><CheckCircle2 size={14} /> Apply JSON settings</button>
                  </div>
                </details>
              </div>
            ) : (
              <div className="p-4 text-xs leading-relaxed text-[#888] dark:text-[#b8bec7]">{page === 'nodes' ? 'Select a node to configure its parameters and connections.' : 'Select a workflow run to inspect its execution data.'}</div>
            )}
          </>
        )}

        {inspectorTab === 'wiring' && (
          <div className="space-y-7 p-4">
            <section className="space-y-3">
              <h3 className="flex items-center justify-between text-xs font-bold uppercase tracking-wide text-[#777] dark:text-[#b8bec7]">Inputs <CircleHelp size={15} /></h3>
              {selected?.depends_on.length ? selected.depends_on.map(id => (
                <div key={id} className="space-y-1 rounded-lg border border-[#e5e7eb] dark:border-[#374151] p-2.5">
                  <span className="inline-flex rounded bg-emerald-50 dark:bg-emerald-950/35 px-2 py-1 text-[10px] font-semibold text-emerald-700 dark:text-emerald-300">Input</span>
                  <label className="flex items-center gap-2"><GitBranch size={15} className="text-[#888] dark:text-[#b8bec7]" />
                    <select aria-label={`Change dependency ${id}`} value={id} onChange={event => updateNode(selected.id, { depends_on: [...selected.depends_on.filter(dep => dep !== id), event.target.value] })} className={`${field} min-w-0 flex-1`}>
                      {nodes.filter(node => node.id !== selected.id).map(node => <option key={node.id} value={node.id}>{nodeName(node)}</option>)}
                    </select>
                  </label>
                </div>
              )) : <p className="rounded-lg border border-dashed border-[#dedede] dark:border-[#374151] p-4 text-center text-xs text-[#4b5563] dark:text-[#939393]">Nothing wired</p>}
            </section>

            <section className="space-y-3">
              <h3 className="flex items-center justify-between text-xs font-bold uppercase tracking-wide text-[#777] dark:text-[#b8bec7]">Outputs <CircleHelp size={15} /></h3>
              {downstream.length ? downstream.map(node => <div key={node.id} className="flex items-center gap-2 rounded-lg border border-[#e5e7eb] dark:border-[#374151] p-3 text-[11px] text-[#555] dark:text-[#b8bec7]"><ArrowRight size={15} className="text-violet-600 dark:text-violet-300" /><span className="min-w-0 break-words">{nodeName(node)}</span></div>) : <p className="rounded-lg border border-dashed border-[#dedede] dark:border-[#374151] p-4 text-center text-xs text-[#4b5563] dark:text-[#939393]">Nothing wired</p>}
            </section>

            <section className="space-y-3">
              <h3 className="text-xs font-bold uppercase tracking-wide text-[#777] dark:text-[#b8bec7]">Last run output</h3>
              {selected && run?.results?.[selected.id] ? <pre className="max-h-[260px] overflow-auto whitespace-pre-wrap break-all rounded-lg border border-[#e8e8e8] dark:border-[#374151] bg-[#fafafa] dark:bg-[#1f2937] p-3 text-[11px] text-[#555] dark:text-[#b8bec7]">{JSON.stringify(run.results[selected.id], null, 2)}</pre> : <p className="rounded-lg border border-dashed border-[#dedede] dark:border-[#374151] p-4 text-center text-xs text-[#4b5563] dark:text-[#939393]">No execution output available</p>}
            </section>
          </div>
        )}
      </div>

      <div className="grid shrink-0 grid-cols-2 gap-2 border-t border-[#e8e8e8] dark:border-[#374151] bg-white dark:bg-cl-dark-panel p-4">
        <button type="button" className={btn} onClick={() => setSelectedId(null)}>Close</button>
        <button type="button" disabled={!selected || working} onClick={() => void save()} className="inline-flex h-10 items-center justify-center rounded-lg bg-[#f8fafc] dark:bg-[#222] px-3 text-xs font-semibold text-gray-900 dark:text-white hover:bg-[#f8fafc] dark:hover:bg-[#444] disabled:cursor-not-allowed disabled:opacity-40">Save task</button>
      </div>
    </aside>
  )
}
