import type { ReactNode } from 'react'

/** A dedicated, full-viewport workspace for node-based automations. */
export function WorkflowLayout({ children }: { children: ReactNode }) {
  return <main className="h-dvh min-h-0 w-full min-w-0 overflow-hidden bg-[#080d17]" aria-label="Workflow workspace">
    {children}
  </main>
}
