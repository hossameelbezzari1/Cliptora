import type { ReactNode } from 'react'
import { X } from 'lucide-react'
import { WorkflowTopbar } from '../components/workflow/WorkflowTopbar'
import { ToolLibrary } from '../components/workflow/ToolLibrary'
import { WorkflowCanvas } from '../components/workflow/WorkflowCanvas'
import { WorkflowInspector } from '../components/workflow/WorkflowInspector'
import { WorkflowRuns } from '../components/workflow/WorkflowRuns'
import type { WorkflowStudioState } from '../components/workflow/useWorkflowStudio'

export function WorkflowLayout({ children, studio }: { children?: ReactNode; studio?: WorkflowStudioState }) {
  if (!studio) {
    return <main className="h-dvh min-h-0 min-w-0 overflow-hidden bg-[#fafafa] text-[#171717]" aria-label="Workflow workspace">{children}</main>
  }

  const { error, setError, message, page, libraryOpen, selected } = studio

  return (
    <main className="fixed inset-0 z-[100] flex min-h-0 min-w-0 flex-col overflow-hidden bg-[#fafafa] text-[#171717]" aria-label="CLIPTORA Workflow Studio">
      <WorkflowTopbar studio={studio} />

      {error && (
        <div role="alert" className="relative z-10 flex shrink-0 items-center justify-between gap-3 border-b border-red-200 bg-red-50 px-4 py-2 text-xs text-red-800">
          <span>{error}</span>
          <button type="button" aria-label="Dismiss error" onClick={() => setError(null)} className="rounded-md p-1 hover:bg-red-100 focus-visible:outline-2 focus-visible:outline-red-500"><X size={15} /></button>
        </div>
      )}
      {message && (
        <div role="status" className="shrink-0 border-b border-blue-100 bg-blue-50 px-4 py-2 text-xs text-blue-800">{message}</div>
      )}

      <div className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden">
        {libraryOpen && <ToolLibrary studio={studio} />}
        {page === 'nodes' ? <WorkflowCanvas studio={studio} /> : <WorkflowRuns studio={studio} />}
        <div className={`${selected ? 'flex' : 'hidden'} absolute inset-y-0 right-0 z-30 w-[min(390px,calc(100%-24px))] flex-col border-l border-[#e5e7eb] bg-white shadow-xl lg:relative lg:z-auto lg:flex lg:w-[355px] lg:shrink-0 lg:shadow-none xl:w-[385px]`}>
          <WorkflowInspector studio={studio} />
        </div>
      </div>
    </main>
  )
}

export default WorkflowLayout
