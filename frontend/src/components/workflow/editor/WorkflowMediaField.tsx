
import {
  useRef,
  useState,
  type ChangeEvent,
} from 'react'
import {
  AlertCircle,
  FileVideo,
  FolderOpen,
  Info,
  Upload,
} from 'lucide-react'
import { fileUrl } from '../../../lib/api'
import type { WorkflowStudioState } from '../useWorkflowStudio'
import type { WorkflowCatalogInput } from '../workflowTypes'

const fieldClass =
  'min-h-11 w-full rounded-xl border border-[#dedee1] bg-white px-3 text-[13px] text-[#292929] outline-none focus:border-violet-400 dark:border-[#414753] dark:bg-cl-dark-panel dark:text-white'

export function WorkflowMediaField({
  input,
  studio,
}: {
  input: WorkflowCatalogInput
  studio: WorkflowStudioState
}) {
  const uploadRef = useRef<HTMLInputElement>(null)
  const [error, setError] = useState('')

  const selected = studio.sources.find(
    item => item.id === studio.sourceId,
  )

  const isVideo = input.accepts.includes('video')
  const mediaId = selected?.media_id ?? null
  const kinds = input.accepts.length
    ? input.accepts
    : ['video']

  const mediaOptions = studio.editorMedia.filter(
    item => kinds.includes(item.kind),
  )

  const useMedia = async (id: number) => {
    setError('')

    try {
      await studio.useMediaSource(id)
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : 'Cannot select media',
      )
    }
  }

  const upload = async (
    event: ChangeEvent<HTMLInputElement>,
  ) => {
    setError('')

    try {
      await studio.upload(event)
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : 'Upload failed',
      )
    }
  }

  const supported =
    isVideo &&
    input.binding === 'workflow_source'

  return (
    <section
      className="min-w-0 space-y-4 border-b border-[#e9e9e9] pb-5 dark:border-[#374151]"
      data-workflow-media-input={input.name}
    >
      <div className="flex items-center justify-between gap-2 border-b border-[#ededed] pb-2 dark:border-[#374151]">
        <div className="flex items-center gap-2">
          <FileVideo
            size={17}
            className="text-violet-600 dark:text-violet-300"
          />

          <h3 className="text-[13px] font-semibold text-[#303030] dark:text-[#f3f4f6]">
            {input.title ?? 'Media input'}
          </h3>
        </div>

        {input.description && (
          <span
            className="group/help relative flex shrink-0 items-center"
            tabIndex={0}
            aria-label={input.description}
          >
            <Info
              size={16}
              className="cursor-help text-[#888] dark:text-[#b8bec7]"
            />

            <span
              role="tooltip"
              className="pointer-events-none absolute right-0 top-7 z-40 hidden w-64 rounded-lg bg-[#252525] p-3 text-[11px] leading-5 text-white shadow-xl group-hover/help:block group-focus/help:block"
            >
              {input.description}
            </span>
          </span>
        )}
      </div>

      {!supported ? (
        <p className="text-[12px] text-amber-700 dark:text-amber-300">
          This media input is declared in the node schema,
          but its execution binding is not implemented yet.
        </p>
      ) : (
        <>
          <label className="block space-y-2">
            <span className="text-[13px] font-medium dark:text-[#f3f4f6]">
              {input.label ?? 'Video source'}
            </span>

            <select
              aria-label={input.label ?? 'Video source'}
              value={studio.sourceId ?? ''}
              className={fieldClass}
              onChange={event =>
                studio.setSourceId(
                  event.target.value
                    ? Number(event.target.value)
                    : null,
                )
              }
            >
              <option value="">
                Select a video...
              </option>

              {studio.sources.map(source => (
                <option
                  key={source.id}
                  value={source.id}
                >
                  {source.filename}
                </option>
              ))}
            </select>
          </label>

          {input.preview !== false && selected && (
            <div className="overflow-hidden rounded-xl border border-[#e5e5e8] bg-[#121212] dark:border-[#414753]">
              {mediaId ? (
                <video
                  key={mediaId}
                  src={fileUrl(mediaId)}
                  controls
                  playsInline
                  preload="metadata"
                  className="aspect-video w-full bg-black object-contain"
                  aria-label={`Preview ${selected.filename}`}
                  onError={() =>
                    setError(
                      'Unable to load the selected video preview.',
                    )
                  }
                />
              ) : (
                <div className="flex aspect-video items-center justify-center px-4 text-center text-[12px] text-white/75">
                  This legacy workflow source has no Media
                  Library ID. It needs the authenticated
                  source-streaming endpoint for preview.
                </div>
              )}

              <p
                className="truncate px-3 py-2 text-[12px] text-white/85"
                title={selected.filename}
              >
                {selected.filename}
              </p>
            </div>
          )}

          <label className="block space-y-2">
            <span className="text-[13px] font-medium dark:text-[#f3f4f6]">
              Use from Media Library
            </span>

            <select
              aria-label="Use from Media Library"
              className={fieldClass}
              value=""
              disabled={studio.working}
              onChange={event => {
                const id = Number(event.target.value)

                if (id > 0) {
                  void useMedia(id)
                }
              }}
            >
              <option value="">
                Choose a video...
              </option>

              {mediaOptions.map(item => (
                <option
                  key={item.id}
                  value={item.id}
                >
                  {item.name}
                </option>
              ))}
            </select>
          </label>

          <div className="space-y-2">
            <span className="block text-[13px] font-medium dark:text-[#f3f4f6]">
              Upload video
            </span>

            <input
              ref={uploadRef}
              type="file"
              accept=".mp4,.mov,.mkv,.webm,.m4v"
              className="sr-only"
              tabIndex={-1}
              onChange={event => {
                void upload(event)
              }}
            />

            <button
              type="button"
              disabled={studio.working}
              onClick={() =>
                uploadRef.current?.click()
              }
              className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-[#dedee1] bg-white px-4 text-[13px] font-medium text-[#303030] shadow-sm hover:bg-[#f7f7f8] disabled:opacity-50 dark:border-[#414753] dark:bg-cl-dark-panel dark:text-white"
            >
              <Upload size={17} />
              Upload video
            </button>
          </div>
        </>
      )}

      {error && (
        <p
          role="alert"
          className="flex items-start gap-2 text-[12px] text-red-600 dark:text-red-300"
        >
          <AlertCircle size={15} />
          {error}
        </p>
      )}

      {!selected && supported && (
        <p className="flex items-center gap-2 text-[11px] text-[#888] dark:text-[#b8bec7]">
          <FolderOpen size={14} />
          Select or upload a source to preview it.
        </p>
      )}
    </section>
  )
}
