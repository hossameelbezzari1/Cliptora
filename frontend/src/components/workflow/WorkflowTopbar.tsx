import { useState } from 'react'
import type { WorkflowStudioState } from './useWorkflowStudio'
import {
  ArrowLeft, CheckCircle2, Clock3, History, LoaderCircle,
  PanelLeftClose, PanelLeftOpen, Play, Plus, Save,
} from 'lucide-react'
import { btn, accent } from './workflowUI'

export function WorkflowTopbar({ studio }: { studio: WorkflowStudioState }) {
  const {
    onClose, libraryOpen, setLibraryOpen, name, setName, run, activeId,
    waitingNodes, completedNodes, showToolLibrary, working, nodes,
    start, save, page, setPage,
  } = studio
  const [saving, setSaving] = useState(false)

  const saveWorkflow = async () => {
    if (saving || working) return
    setSaving(true)
    try { await save() } finally { setSaving(false) }
  }

  return (
    <header className="relative z-20 flex h-[66px] shrink-0 items-center gap-2 border-b border-[#e5e7eb] bg-white px-3 text-[#171717] sm:gap-3 sm:px-5">
      <button
        type="button"
        onClick={onClose}
        title="Back to Timeline"
        aria-label="Back to Timeline"
        className="inline-flex h-9 shrink-0 items-center gap-2 rounded-lg px-2 text-xs font-semibold text-[#626976] hover:bg-[#f3f4f6] focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet-500"
      >
        <ArrowLeft size={17} />
        <span className="hidden lg:inline">Timeline</span>
      </button>

      <span className="hidden h-6 w-px bg-[#e5e7eb] sm:block" />

      <button
        type="button"
        onClick={() => setLibraryOpen(open => !open)}
        aria-label={libraryOpen ? 'Hide Tool Library' : 'Show Tool Library'}
        title={libraryOpen ? 'Hide Tool Library' : 'Show Tool Library'}
        aria-controls="ws-tool-library"
        aria-expanded={libraryOpen}
        className={`${btn} ${libraryOpen ? 'border-violet-200 bg-violet-50 text-violet-700' : ''}`}
      >
        {libraryOpen ? <PanelLeftClose size={17} /> : <PanelLeftOpen size={17} />}
        <span className="hidden sm:inline">Tools</span>
      </button>

      <div className="flex min-w-0 flex-1 items-center gap-2 lg:flex-initial">
        <input
          aria-label="Workflow name"
          value={name}
          onChange={event => setName(event.target.value)}
          placeholder="Untitled Workflow"
          maxLength={160}
          className="h-9 w-full min-w-0 rounded-lg border border-transparent bg-transparent px-2 text-sm font-semibold text-[#171717] outline-none hover:border-[#e5e7eb] focus:border-violet-400 focus:bg-white lg:w-[250px]"
        />
        <span className="hidden shrink-0 rounded-md bg-[#f4f4f5] px-2 py-1 text-[10px] font-semibold text-[#71717a] xl:inline">
          {activeId ? `#${activeId}` : 'Draft'}
        </span>
      </div>

      <div className="hidden items-center gap-3 text-[11px] text-[#777] 2xl:flex" aria-live="polite">
        {run && <span>Run #{run.id} · {run.state}</span>}
        <span className="inline-flex items-center gap-1 text-emerald-700"><CheckCircle2 size={14} />{completedNodes}</span>
        <span className="inline-flex items-center gap-1 text-amber-700"><Clock3 size={14} />{waitingNodes}</span>
      </div>

      <div className="ml-auto flex shrink-0 items-center gap-1.5 sm:gap-2">
        <button type="button" className={`${btn} hidden lg:inline-flex`} onClick={showToolLibrary} title="Find and add a tool">
          <Plus size={16} /> Add tool
        </button>
        <button
          type="button"
          className={btn}
          onClick={() => setPage(page === 'nodes' ? 'runs' : 'nodes')}
          title={page === 'nodes' ? 'Execution history' : 'Back to canvas'}
          aria-label={page === 'nodes' ? 'Execution history' : 'Back to canvas'}
        >
          <History size={16} /><span className="hidden xl:inline">{page === 'nodes' ? 'Executions' : 'Editor'}</span>
        </button>
        <button type="button" className={btn} onClick={() => void saveWorkflow()} disabled={working || saving || !name.trim()} title="Save workflow">
          {saving ? <LoaderCircle size={16} className="animate-spin" /> : <Save size={16} />}
          <span className="hidden md:inline">Save</span>
        </button>
        <button type="button" className={accent} onClick={() => void start()} disabled={working || nodes.length === 0 || !name.trim()} title="Run workflow">
          {working ? <LoaderCircle size={16} className="animate-spin" /> : <Play size={16} />}
          Run
        </button>
      </div>
    </header>
  )
}
