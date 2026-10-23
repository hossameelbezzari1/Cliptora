import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Alert } from '../../components/ui/Field'
import { EditorLayout } from '../../layouts/EditorLayout'
import { LibraryPanel } from '../../components/editor/library/LibraryPanel'
import { InspectorPanel } from '../../components/editor/inspector/InspectorPanel'
import { PreviewPanel } from '../../components/editor/preview/PreviewPanel'
import { TimelinePanel } from '../../components/editor/timeline/TimelinePanel'
import { ToolRail, type Tab } from '../../components/editor/sidebar/ToolRail'
import { ResizableEditorWorkspace } from '../../components/editor/workspace/ResizableEditorWorkspace'
import { EditorToolbar } from '../../components/editor/toolbar/EditorToolbar'
import { api } from '../../lib/api'
import { useEditor } from '../../stores/editorStore'
import { effectiveTimelineEnd } from '../../lib/repeat'
import type { Project, Timeline, MediaAsset } from '../../types'

/**
 * This page keeps the existing editor state, hydration, autosave and playback.
 * Only the panel layout is connected to the working draggable separators.
 */
export function EditorPage() {
  const { id } = useParams()
  const projectId = Number(id)
  const [project, setProject] = useState<Project | null>(null)
  const [active, setActive] = useState<Tab>('media')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<unknown>(null)
  const [saveStatus, setSaveStatus] = useState('saved')

  const hydrate = useEditor(s => s.hydrate)
  const setMedia = useEditor(s => s.setMedia)
  const dirty = useEditor(s => s.dirty)
  const lastSave = useRef(0)
  const saving = useRef(false)
  const alive = useRef(false)

  useEffect(() => {
    if (!Number.isInteger(projectId) || projectId < 1) {
      setError(new Error('Invalid project.'))
      setLoading(false)
      return
    }
    let cancel = false
    alive.current = true
    ;(async () => {
      try {
        const [p, t, m] = await Promise.all([
          api<Project>(`/projects/${projectId}`),
          api<Timeline>(`/projects/${projectId}/timeline`),
          api<MediaAsset[]>(`/projects/${projectId}/media`),
        ])
        if (!cancel) {
          setProject(p)
          hydrate(projectId, t)
          setMedia(m)
          lastSave.current = 0
          setLoading(false)
        }
      } catch (err) {
        if (!cancel) {
          setError(err)
          setLoading(false)
        }
      }
    })()
    return () => {
      cancel = true
      alive.current = false
    }
  }, [projectId, hydrate, setMedia])

  const save = useCallback(async () => {
    if (saving.current || !alive.current || !project) return
    saving.current = true
    setSaveStatus('saving')
    try {
      for (let i = 0; i < 10; i++) {
        const state = useEditor.getState()
        if (state.dirty === lastSave.current) break
        const serialized: Timeline = { revision: state.revision, tracks: state.tracks }
        const result = await api<Timeline>(`/projects/${project.id}/timeline`, {
          method: 'PUT',
          body: JSON.stringify(serialized),
        })
        useEditor.getState().markSaved(result.revision)
        lastSave.current = state.dirty
        if (useEditor.getState().dirty === state.dirty) break
      }
      setSaveStatus(lastSave.current === useEditor.getState().dirty ? 'saved' : 'saving')
    } catch (err) {
      setSaveStatus('error')
      setError(err)
    } finally {
      saving.current = false
    }
  }, [project])

  useEffect(() => {
    if (!dirty || !project) return
    setSaveStatus('saving')
    const timer = window.setTimeout(() => { void save() }, 950)
    return () => window.clearTimeout(timer)
  }, [dirty, project, save])

  const playing = useEditor(s => s.playing)
  useEffect(() => {
    if (!playing) return
    const tick = window.setInterval(() => {
      const state = useEditor.getState()
      const max = effectiveTimelineEnd(state.tracks.flatMap(t => t.clips))
      if (state.playhead + .1 >= max) {
        state.setPlaying(false)
        return
      }
      state.setPlayhead(state.playhead + .1)
    }, 100)
    return () => window.clearInterval(tick)
  }, [playing])

  if (loading) {
    return <div className="grid min-h-screen place-items-center bg-cl-bg text-sm text-cl-muted">Loading editor…</div>
  }
  if (!project) {
    return <div className="grid min-h-screen place-items-center bg-cl-bg text-sm">
      <div><Alert error={error}/><Link to="/dashboard" className="mt-4 block text-cl-cyan">Back to projects</Link></div>
    </div>
  }

  return <EditorLayout
    project={project}
    saveStatus={saveStatus}
    editorTools={<EditorToolbar project={project} onSave={() => void save()}/>}
  >
    <main className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <ResizableEditorWorkspace
        className="min-h-0 min-w-0 flex-1"
        library={<><ToolRail active={active} onChange={setActive}/><LibraryPanel active={active}/></>}
        preview={<PreviewPanel project={project}/>}
        inspector={<InspectorPanel/>}
        timeline={<TimelinePanel/>}
      />
      {Boolean(error) && <div role="alert" className="absolute right-4 bottom-4 z-50 max-w-lg rounded-xl border border-red-500/50 bg-red-950 p-4 text-sm text-red-200">
        <button className="float-right ml-3" aria-label="Dismiss" onClick={() => setError(null)}>×</button>
        {error instanceof Error ? error.message : String(error)}
      </div>}
    </main>
  </EditorLayout>
}
