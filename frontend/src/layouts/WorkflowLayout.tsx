
import { useState, type ReactNode } from 'react'
import { X } from 'lucide-react'

import { WorkflowTopbar } from '../components/workflow/WorkflowTopbar'
import { ToolLibrary } from '../components/workflow/ToolLibrary'
import { WorkflowCanvas } from '../components/workflow/WorkflowCanvas'
import { WorkflowRuns } from '../components/workflow/WorkflowRuns'
import { WorkflowNodeEditor } from '../components/workflow/WorkflowNodeEditor'
import type { WorkflowStudioState } from '../components/workflow/useWorkflowStudio'

type WorkflowLayoutProps = {
  children?: ReactNode
  studio?: WorkflowStudioState
}

export function WorkflowLayout({
  children,
  studio,
}: WorkflowLayoutProps) {
  const [nodeEditorOpen, setNodeEditorOpen] = useState(false)

  if (!studio) {
    return (
      <main
        className="h-dvh min-h-0 min-w-0 overflow-hidden bg-[#fafafa] text-[#171717]"
        aria-label="Workflow workspace"
      >
        {children}
      </main>
    )
  }

  const {
    error,
    setError,
    message,
    page,
    libraryOpen,
    selected,
  } = studio

  return (
    <main
      className="fixed inset-0 z-[100] flex min-h-0 min-w-0 flex-col overflow-hidden bg-[#fafafa] text-[#171717]"
      aria-label="CLIPTORA Workflow Studio"
    >
      <WorkflowTopbar studio={studio} />

      {error && (
        <div
          role="alert"
          className="relative z-10 flex shrink-0 items-center justify-between gap-3 border-b border-red-200 bg-red-50 px-4 py-2 text-xs text-red-800"
        >
          <span>{error}</span>
          <button
            type="button"
            aria-label="Dismiss error"
            onClick={() => setError(null)}
            className="rounded-md p-1 hover:bg-red-100 focus-visible:outline-2 focus-visible:outline-red-500"
          >
            <X size={15} />
          </button>
        </div>
      )}

      {message && (
        <div
          role="status"
          className="shrink-0 border-b border-blue-100 bg-blue-50 px-4 py-2 text-xs text-blue-800"
        >
          {message}
        </div>
      )}

      <div className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden">
        {libraryOpen && <ToolLibrary studio={studio} />}

        <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          {page === 'nodes' ? (
            <WorkflowCanvas studio={studio} onOpenNode={() => setNodeEditorOpen(true)} />
          ) : (
            <div className="min-h-0 min-w-0 flex-1 overflow-y-auto [&>section]:h-full [&>section]:w-full">
              <WorkflowRuns studio={studio} />
            </div>
          )}
        </div>
      </div>

      {/* Full-screen Node Editor instead of right-side Inspector */}
      {nodeEditorOpen && selected && (
        <WorkflowNodeEditor
          studio={studio}
          onExecuteStep={studio.testStep}
          onClose={() => setNodeEditorOpen(false)}
        />
      )}
    </main>
  )
}

export default WorkflowLayout
