
import { useState, type ReactNode } from 'react'
import {
  ChevronDown,
  Film,
  FolderOpen,
  Upload,
  X,
} from 'lucide-react'

import { WorkflowTopbar } from '../components/workflow/WorkflowTopbar'
import { ToolLibrary } from '../components/workflow/ToolLibrary'
import { WorkflowCanvas } from '../components/workflow/WorkflowCanvas'
import { WorkflowRuns } from '../components/workflow/WorkflowRuns'
import { WorkflowNodeEditor } from '../components/workflow/WorkflowNodeEditor'
import { mediaName } from '../components/editor/library/mediaLibraryUtils'
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
  const [sourcePickerOpen, setSourcePickerOpen] = useState(false)

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
    sourceId,
    setSourceId,
    sources,
    editorMedia,
    useMediaSource,
    fileInput,
    upload,
    working,
  } = studio

  const currentSource = sources.find(
    source => source.id === sourceId
  )

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
            <>
              <WorkflowCanvas
                studio={studio}
                onOpenNode={() => setNodeEditorOpen(true)}
              />

              {/* Source selector replaces the old Inspector source controls */}
              <div className="pointer-events-none absolute right-3 top-[62px] z-30 sm:right-4">
                <div className="pointer-events-auto relative flex flex-col items-end">
                  <button
                    type="button"
                    aria-label="Select workflow source video"
                    aria-expanded={sourcePickerOpen}
                    onClick={() =>
                      setSourcePickerOpen(open => !open)
                    }
                    className="inline-flex h-9 max-w-[220px] items-center gap-2 rounded-lg border border-[#dedede] bg-white px-3 text-xs font-medium text-[#333] shadow-sm hover:bg-[#f8f8f8] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-600"
                  >
                    <Film
                      size={15}
                      className="shrink-0 text-[#7950bd]"
                    />
                    <span className="truncate">
                      {currentSource?.filename ?? 'Source video'}
                    </span>
                    <ChevronDown
                      size={14}
                      className="shrink-0 text-[#888]"
                    />
                  </button>

                  {sourcePickerOpen && (
                    <div className="mt-2 w-[min(340px,calc(100vw-28px))] space-y-4 rounded-xl border border-[#e4e4e7] bg-white p-4 shadow-xl">
                      <div className="flex items-center justify-between">
                        <h2 className="flex items-center gap-2 text-sm font-semibold text-[#27272a]">
                          <FolderOpen size={16} />
                          Source video
                        </h2>
                        <button
                          type="button"
                          aria-label="Close source picker"
                          onClick={() => setSourcePickerOpen(false)}
                          className="rounded p-1 text-[#777] hover:bg-[#f4f4f5]"
                        >
                          <X size={16} />
                        </button>
                      </div>

                      <label className="block space-y-1.5 text-xs font-medium text-[#52525b]">
                        Workflow source
                        <select
                          aria-label="Workflow source video"
                          value={sourceId ?? ''}
                          onChange={event =>
                            setSourceId(
                              event.target.value
                                ? Number(event.target.value)
                                : null
                            )
                          }
                          className="h-10 w-full rounded-lg border border-[#dedede] bg-white px-3 text-xs text-[#27272a] outline-none focus:border-violet-500"
                        >
                          <option value="">
                            Select a video...
                          </option>
                          {sources.map(source => (
                            <option key={source.id} value={source.id}>
                              {source.filename}
                            </option>
                          ))}
                        </select>
                      </label>

                      <label className="block space-y-1.5 text-xs font-medium text-[#52525b]">
                        Use from Media Library
                        <select
                          aria-label="Link video from Media Library"
                          value=""
                          disabled={working}
                          onChange={event => {
                            const id = Number(event.target.value)
                            if (id > 0) {
                              void useMediaSource(id)
                            }
                          }}
                          className="h-10 w-full rounded-lg border border-[#dedede] bg-white px-3 text-xs text-[#27272a] outline-none focus:border-violet-500 disabled:opacity-50"
                        >
                          <option value="">
                            Choose a video...
                          </option>
                          {editorMedia
                            .filter(item => item.kind === 'video')
                            .map(item => (
                              <option key={item.id} value={item.id}>
                                {mediaName(item)}
                              </option>
                            ))}
                        </select>
                      </label>

                      <input
                        ref={fileInput}
                        type="file"
                        accept=".mp4,.mov,.mkv,.webm,.m4v"
                        className="hidden"
                        onChange={event => void upload(event)}
                      />

                      <button
                        type="button"
                        disabled={working}
                        onClick={() => fileInput.current?.click()}
                        className="flex h-10 w-full items-center justify-center gap-2 rounded-lg border border-[#dedede] bg-white text-xs font-semibold text-[#333] hover:bg-[#f6f6f6] disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <Upload size={15} />
                        Upload video
                      </button>

                      <p className="text-[11px] leading-4 text-[#858585]">
                        Originals stay unchanged. Sources are linked to workflow runs.
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </>
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
          onClose={() => setNodeEditorOpen(false)}
        />
      )}
    </main>
  )
}

export default WorkflowLayout
