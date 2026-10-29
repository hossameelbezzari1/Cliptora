
import { useState, type ReactNode } from 'react'
import { WorkflowTopbar } from '../components/workflow/WorkflowTopbar'
import { ToolLibrary } from '../components/workflow/ToolLibrary'
import { WorkflowCanvas } from '../components/workflow/WorkflowCanvas'
import { WorkflowRuns } from '../components/workflow/WorkflowRuns'
import { WorkflowNodeEditor } from '../components/workflow/WorkflowNodeEditor'
import type { WorkflowStudioState } from '../components/workflow/useWorkflowStudio'
import { Toast, ToastViewport, type ToastVariant } from '../components/ui/Toast'

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
    setMessage,
    page,
    libraryOpen,
    selected,
  } = studio

  const messageVariant: ToastVariant = /saved|finished|uploaded|linked|added|copied|pasted|duplicated|restored|arranged|renamed/i.test(message)
    ? 'success'
    : /does not|cannot|more than|no nodes|not available|failed|cancelled/i.test(message)
      ? 'warning'
      : 'info'

  return (
    <main
      className="fixed inset-0 z-[100] flex min-h-0 min-w-0 flex-col overflow-hidden bg-[#fafafa] text-[#171717]"
      aria-label="CLIPTORA Workflow Studio"
    >
      <WorkflowTopbar studio={studio} />

      <ToastViewport>
        {error && <Toast message={error} variant="error" duration={7000} onDismiss={() => setError(null)} />}
        {message && <Toast message={message} variant={messageVariant} duration={message === 'Changes saved automatically.' ? 2600 : 4500} onDismiss={() => setMessage('')} />}
      </ToastViewport>

      <div className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden">
        {libraryOpen && <ToolLibrary studio={studio} onOpenNode={() => setNodeEditorOpen(true)} />}

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
