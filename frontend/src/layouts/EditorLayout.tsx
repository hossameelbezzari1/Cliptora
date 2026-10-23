import type { ReactNode } from 'react'
import { Header } from '../components/common/Header'
import { ResizableEditorWorkspace } from '../components/editor/workspace/ResizableEditorWorkspace'
import type { Project } from '../types'

/**
 * Provide `panels` from EditorPage to enable draggable dividers between
 * Library / Preview / Clip Settings / Timeline. Existing `children` usage
 * remains supported and is rendered exactly as before when `panels` is absent.
 */
export type EditorPanels = {
  library: ReactNode
  preview: ReactNode
  inspector: ReactNode
  timeline: ReactNode
}

type Props = {
  project: Project
  saveStatus: string
  editorTools: ReactNode
  children?: ReactNode
  panels?: EditorPanels
}

export function EditorLayout({ project, saveStatus, editorTools, children, panels }: Props) {
  return (
    <div className="flex h-dvh min-h-0 w-full min-w-0 max-w-full flex-col overflow-hidden bg-cl-bg">
      <Header project={project} saveStatus={saveStatus} editorTools={editorTools} />
      {panels ? (
        <main className="min-h-0 min-w-0 flex-1 overflow-hidden" aria-label="Resizable editor workspace">
          <ResizableEditorWorkspace
            library={panels.library}
            preview={panels.preview}
            inspector={panels.inspector}
            timeline={panels.timeline}
          />
        </main>
      ) : children}
    </div>
  )
}
