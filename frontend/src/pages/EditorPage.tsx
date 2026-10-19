import { useCallback, useEffect, useRef, useState } from 'react'
import { Navigate, useParams } from 'react-router-dom'
import { api, ApiError } from '../api'
import { useQuery, useQueryClient } from '../query'
import type { Project, Timeline, Track } from '../types'
import { AppHeader } from '../components/AppHeader'
import { libraryItems } from '../features/editor/library/libraryItems'
import { Library } from '../features/editor/library/LibraryPanel'
import { Preview } from '../features/editor/preview/PreviewPanel'
import { Inspector } from '../features/editor/inspector/InspectorPanel'
import { Timeline as TimelinePanel } from '../features/editor/timeline/TimelinePanel'

export function EditorPage() {
  const { id } = useParams()
  const client = useQueryClient()
  const [active, setActive] = useState('media')
  const [saveStatus, setSaveStatus] = useState<'saved' | 'saving' | 'error'>('saved')
  const [tracks, setTracks] = useState<Track[]>([])
  const [editNumber, setEditNumber] = useState(0)
  const [menuOpen, setMenuOpen] = useState(false)
  const tracksRef = useRef<Track[]>([])
  const revisionRef = useRef(0)
  const hydratedRef = useRef(false)
  const savingRef = useRef(false)

  const project = useQuery({
    queryKey: ['project', id],
    queryFn: () => api<Project>(`/projects/${id}`),
  })
  const timeline = useQuery({
    queryKey: ['timeline', id],
    queryFn: () => api<Timeline>(`/projects/${id}/timeline`),
    enabled: !!project.data,
  })

  useEffect(() => {
    if (!timeline.data || hydratedRef.current) return
    hydratedRef.current = true
    tracksRef.current = timeline.data.tracks
    revisionRef.current = timeline.data.revision
    setTracks(timeline.data.tracks)
  }, [timeline.data])

  const changeTracks = useCallback((next: Track[]) => {
    if (!hydratedRef.current) return
    tracksRef.current = next
    setTracks(next)
    setSaveStatus('saving')
    setEditNumber(n => n + 1)
  }, [])

  const save = useCallback(async () => {
    if (!hydratedRef.current || savingRef.current || !id) return
    savingRef.current = true
    setSaveStatus('saving')
    try {
      for (;;) {
        const snapshot = tracksRef.current
        const result = await api<Timeline>(`/projects/${id}/timeline`, {
          method: 'PUT',
          body: JSON.stringify({ revision: revisionRef.current, tracks: snapshot }),
        })
        revisionRef.current = result.revision
        client.setQueryData(['timeline', id], result)
        if (tracksRef.current === snapshot) break
      }
      setSaveStatus('saved')
    } catch {
      setSaveStatus('error')
    } finally {
      savingRef.current = false
    }
  }, [client, id])

  useEffect(() => {
    if (editNumber === 0) return
    const timeout = window.setTimeout(() => { void save() }, 900)
    return () => window.clearTimeout(timeout)
  }, [editNumber, save])

  const addTrack = (type: Track['type']) => {
    const next: Track[] = [...tracksRef.current, {
      client_id: crypto.randomUUID(),
      name: `${type[0].toUpperCase()}${tracksRef.current.filter(t => t.type === type).length + 1}`,
      type, position: tracksRef.current.length,
      hidden: false, muted: false, locked: false,
    }]
    changeTracks(next)
    setMenuOpen(false)
  }

  if (project.error instanceof ApiError && project.error.status === 404) {
    return <Navigate to="/dashboard" replace />
  }
  if (project.error || timeline.error) {
    return <div className="page-loader"><p>Could not load this project. Please reload the page.</p></div>
  }
  if (!project.data || !timeline.data) {
    return <div className="page-loader"><span /></div>
  }

  return <div className="editor-shell">
    <AppHeader project={project.data} saving={saveStatus} onSave={() => { void save() }} />
    <main className="editor-workspace">
      <section className="upper-workspace">
        <aside className="library-panel">
          <nav className="tool-rail" aria-label="Editor tools">
            {libraryItems.map(item => <button key={item.id} className={active === item.id ? 'active' : ''} onClick={() => setActive(item.id)} title={item.label} aria-label={item.label}><item.icon /><span>{item.label}</span></button>)}
          </nav>
          <Library active={active} />
        </aside>
        <Preview />
        <Inspector />
      </section>
      <TimelinePanel tracks={tracks} setTracks={changeTracks} onAdd={() => setMenuOpen(!menuOpen)} menuOpen={menuOpen} addTrack={addTrack} />
    </main>
  </div>
}
