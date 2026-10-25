import { useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { WandSparkles } from 'lucide-react'
import { SmartLibrary } from './SmartLibrary'
import { MediaLibraryTab } from './MediaLibraryTab'
import { SubtitlesTab } from './SubtitlesTab'
import { api } from '../../../lib/api'
import { probeMediaDuration } from '../../../lib/media'
import { useEditor } from '../../../stores/editorStore'
import { items, type Tab } from '../sidebar/ToolRail'
import type { MediaAsset } from '../../../types'

/** Keeps all existing editor tabs and media API behavior; Media lives in a separate component. */
export function LibraryPanel({ active }: { active: Tab }) {
  const { id } = useParams()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const media = useEditor(state => state.media)
  const setMedia = useEditor(state => state.setMedia)
  const setDuration = useEditor(state => state.setMediaDuration)
  const addMediaClip = useEditor(state => state.addMediaClip)
  const mediaRef = useRef(media)
  mediaRef.current = media

  async function upload(files: FileList | null) {
    if (!files || !id || files.length === 0) return
    setBusy(true)
    setError(null)
    try {
      const result = await Promise.all(Array.from(files).map(file => {
        const body = new FormData()
        body.append('file', file)
        return api<MediaAsset>(`/projects/${id}/media`, { method: 'POST', body })
      }))
      setMedia([...result.reverse(), ...mediaRef.current])
    } catch (err) {
      setError(err)
    } finally {
      setBusy(false)
    }
  }

  async function add(asset: MediaAsset) {
    try {
      const result = await probeMediaDuration(asset)
      if (result.measured) setDuration(asset.id, result.duration)
      addMediaClip(asset, result.duration)
      setError(null)
    } catch (err) {
      setError(err)
    }
  }

  if (['components', 'effects', 'animations', 'variables', 'transitions'].includes(active)) {
    return <SmartLibrary active={active}/>
  }

  if (active === 'subtitles') {
    return <SubtitlesTab key={id ?? 'unknown'} projectId={id ?? 'unknown'} media={media}/>
  }

  if (active !== 'media') {
    return <section className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto p-3 text-white">
      <h2 className="text-sm font-bold">{items.find(item => item.id === active)?.label}</h2>
      <div className="mt-12 grid justify-items-center gap-3 text-center">
        <WandSparkles size={27} className="text-cl-muted"/>
        <p className="text-xs text-cl-muted">This tool is planned. It is not implemented in this foundation release.</p>
      </div>
    </section>
  }

  return <MediaLibraryTab projectId={id ?? 'unknown'} media={media} onUpload={upload} onAdd={add} busy={busy} error={error}/>
}
