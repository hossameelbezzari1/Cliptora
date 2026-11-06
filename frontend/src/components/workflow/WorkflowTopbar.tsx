import { useState } from 'react'
import type { WorkflowStudioState } from './useWorkflowStudio'
import {
  ArrowLeft,
  CheckCircle2,
  Clock3,
  History,
  LoaderCircle,
  Play,
  Plus,
  Save,
  Undo2,
  Redo2,
  Copy,
} from 'lucide-react'
import { btn, accent } from './workflowUI'

export function WorkflowTopbar({
  studio,
}: {
  studio: WorkflowStudioState
}) {
  const {
    onClose,
    name,
    setName,
    run,
    activeId,
    waitingNodes,
    completedNodes,
    showToolLibrary,
    working,
    nodes,
    start,
    save,
    page,
    setPage,
    undo,
    redo,
    canUndo,
    canRedo,
    duplicateDefinition,
    canvasDragging,
  } = studio

  const [saving, setSaving] = useState(false)

  const saveWorkflow = async () => {
    if (saving || working) return
    setSaving(true)
    try {
      await save()
    } finally {
      setSaving(false)
    }
  }

  return (
    <header className="relative z-20 flex h-[66px] shrink-0 items-center gap-2 border-b border-[#e5e7eb] bg-white px-3 text-[#171717] sm:gap-3 sm:px-5">
      <button
        type="button"
        onClick={onClose}
        title="Back to Timeline"
        aria-label="Back to Timeline"
        className="inline-flex h-9 shrink-0 items-center gap-2 rounded-lg px-2 text-xs font-semibold text-[#626976] hover:bg-[#f3f4f6]"
      >
        <ArrowLeft size={17} />
        <span className="hidden lg:inline">Timeline</span>
      </button>

      <span className="hidden h-6 w-px bg-[#e5e7eb] sm:block" />


      <div className="flex min-w-0 flex-1 items-center gap-2 lg:flex-initial">
        <input
          aria-label="Workflow name"
          value={name}
          onChange={event => setName(event.target.value)}
          placeholder="Untitled Workflow"
          maxLength={160}
          className="h-9 w-auto min-w-[20px] max-w-[200px] [field-sizing:content] rounded-lg border border-transparent bg-transparent px-2 text-sm font-semibold text-[#171717] outline-none"
        />

        <span className="hidden shrink-0 rounded-md bg-[#f4f4f5] px-2 py-1 text-[10px] font-semibold text-[#71717a] xl:inline">
          {activeId ? `#${activeId}` : 'Draft'}
        </span>
      </div>

      <div
        className="hidden items-center gap-3 text-[11px] text-[#777] 2xl:flex"
        aria-live="polite"
      >
        {run && <span>Run #{run.id} · {run.state}</span>}

        <span className="inline-flex items-center gap-1 text-emerald-700">
          <CheckCircle2 size={14} />
          {completedNodes}
        </span>

        <span className="inline-flex items-center gap-1 text-amber-700">
          <Clock3 size={14} />
          {waitingNodes}
        </span>
      </div>

      <div className="ml-auto flex shrink-0 items-center gap-1.5 sm:gap-2">
        <div
          className="flex shrink-0 items-center gap-1 rounded-xl border border-[#ededf0] bg-[#fafafa] p-1"
          aria-label="Workflow edit history"
        >
          <button
            type="button"
            className="grid size-8 place-items-center rounded-lg text-[#52525b] transition-colors hover:bg-white hover:text-[#18181b] disabled:cursor-not-allowed disabled:opacity-30"
            onClick={undo}
            disabled={!canUndo || working || canvasDragging}
            title="Undo (Ctrl+Z)"
            aria-label="Undo"
          >
            <Undo2 size={17} />
          </button>

          <button
            type="button"
            className="grid size-8 place-items-center rounded-lg text-[#52525b] transition-colors hover:bg-white hover:text-[#18181b] disabled:cursor-not-allowed disabled:opacity-30"
            onClick={redo}
            disabled={!canRedo || working || canvasDragging}
            title="Redo (Ctrl+Y)"
            aria-label="Redo"
          >
            <Redo2 size={17} />
          </button>
        </div>

        <button
          type="button"
          className={btn}
          onClick={() => void duplicateDefinition()}
          disabled={
            working ||
            saving ||
            canvasDragging ||
            !activeId
          }
          title={
            activeId
              ? 'Duplicate saved workflow'
              : 'Save workflow before duplicating'
          }
          aria-label="Duplicate workflow"
        >
          <Copy size={16} />
          <span className="hidden 2xl:inline">Duplicate</span>
        </button>

        <button
          type="button"
          className={`${btn} hidden lg:inline-flex`}
          onClick={showToolLibrary}
          title="Find and add a tool"
        >
          <Plus size={16} />
          Add tool
        </button>

        <button
          type="button"
          className={btn}
          onClick={() =>
            setPage(page === 'nodes' ? 'runs' : 'nodes')
          }
          title={
            page === 'nodes'
              ? 'Execution history'
              : 'Back to canvas'
          }
          aria-label="Toggle execution history"
        >
          <History size={16} />
          <span className="hidden xl:inline">
            {page === 'nodes' ? 'Executions' : 'Editor'}
          </span>
        </button>

        <button
          type="button"
          className={btn}
          onClick={() => void saveWorkflow()}
          disabled={working || saving || !name.trim()}
          title="Save workflow"
        >
          {saving
            ? <LoaderCircle size={16} className="animate-spin" />
            : <Save size={16} />}

          <span className="hidden md:inline">Save</span>
        </button>

        <button
          type="button"
          className={accent}
          onClick={() => void start()}
          disabled={working || nodes.length === 0 || !name.trim()}
          title="Run workflow"
        >
          {working
            ? <LoaderCircle size={16} className="animate-spin" />
            : <Play size={16} />}

          Run
        </button>
      </div>
    </header>
  )
}
