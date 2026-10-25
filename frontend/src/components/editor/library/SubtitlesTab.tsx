import { useEffect, useMemo, useRef, useState } from 'react'
import { Captions, ChevronDown, ChevronLeft, FileUp, Grid2X2, List, MoreVertical, Plus, Search, Sparkles, Star, Trash2, X } from 'lucide-react'
import { fileUrl } from '../../../lib/api'
import { useEditor } from '../../../stores/editorStore'
import type { MediaAsset } from '../../../types'
import { SubtitleEditorPanel } from './SubtitleEditorPanel'
import { useSubtitlesLibrary } from './useSubtitlesLibrary'
import { shortTime, type SubtitleCue, type SubtitleKind, type SubtitleStyle } from './subtitleUtils'

type Filter = 'All' | 'Drafts' | 'Auto Generated' | 'Imported' | 'Favorites'
type Sort = 'newest' | 'oldest' | 'name' | 'duration'
type View = 'list' | 'grid'
const filters: Filter[] = ['All', 'Drafts', 'Auto Generated', 'Imported', 'Favorites']
const uiButton = 'inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg border border-[#354052] bg-[#18212d] px-3 py-2 text-[11px] text-[#d9dfed] hover:border-[#8754da] hover:text-white disabled:opacity-50'

function kindLabel(kind: SubtitleKind): string {
  if (kind === 'auto') return 'Auto Generated'
  if (kind === 'imported') return 'Imported'
  if (kind === 'template') return 'Template'
  if (kind === 'manual') return 'Manual'
  return 'Draft'
}
function kindClass(kind: SubtitleKind): string {
  if (kind === 'auto') return 'bg-[#3d2868] text-[#d6bbff]'
  if (kind === 'imported') return 'bg-[#493119] text-[#ffd3a0]'
  if (kind === 'template') return 'bg-[#1b4332] text-[#baf6d2]'
  if (kind === 'manual') return 'bg-[#153e5a] text-[#a7e6ff]'
  return 'bg-[#292d3d] text-[#c0cada]'
}
export function SubtitlesTab({ projectId, media }: { projectId: string; media: MediaAsset[] }) {
  const library = useSubtitlesLibrary(projectId)
  const container = useRef<HTMLElement>(null)
  const upload = useRef<HTMLInputElement>(null)
  const [width, setWidth] = useState(0)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<Filter>('All')
  const [sort, setSort] = useState<Sort>('newest')
  const [view, setView] = useState<View>('list')
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [newMenuOpen, setNewMenuOpen] = useState(false)
  const [message, setMessage] = useState('')
  const [pending, setPending] = useState(false)
  const wide = width >= 860
  useEffect(() => {
    const node = container.current
    if (!node) return
    const update = () => setWidth(node.getBoundingClientRect().width)
    update()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(update)
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  const shown = useMemo(() => {
    const text = search.trim().toLowerCase()
    const docs = library.docs.filter(doc => {
      if (filter === 'Drafts' && !['draft', 'manual'].includes(doc.kind)) return false
      if (filter === 'Auto Generated' && doc.kind !== 'auto') return false
      if (filter === 'Imported' && doc.kind !== 'imported') return false
      if (filter === 'Favorites' && !doc.favorite) return false
      return !text || `${doc.title} ${doc.language} ${doc.tags.join(' ')} ${doc.cues.map(cue => cue.text).join(' ')}`.toLowerCase().includes(text)
    })
    docs.sort((a, b) => sort === 'oldest' ? a.updatedAt - b.updatedAt :
      sort === 'name' ? a.title.localeCompare(b.title) :
      sort === 'duration' ? Math.max(0, ...b.cues.map(cue => cue.end)) - Math.max(0, ...a.cues.map(cue => cue.end)) :
      b.updatedAt - a.updatedAt)
    return docs
  }, [library.docs, search, filter, sort])

  function newDocument() {
    library.create()
    setFilter('All')
    setSearch('')
    setNewMenuOpen(false)
    setDetailsOpen(true)
    setMessage('')
  }
  async function importDocument(file: File | null) {
    if (!file) return
    setPending(true)
    setNewMenuOpen(false)
    setMessage('')
    try {
      await library.importFile(file)
      setFilter('All')
      setSearch('')
      setDetailsOpen(true)
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not import this file.')
    } finally {
      setPending(false)
      if (upload.current) upload.current.value = ''
    }
  }
  function addCueToTimeline(cue: SubtitleCue, style: SubtitleStyle): string {
    try {
      const state = useEditor.getState()
      const beforeIds = new Set(state.tracks.flatMap(track => track.clips).map(clip => clip.client_id))
      // Existing public store method creates a real text clip on a new top layer.
      // We inspect the created clip before patching: never modify a pre-existing clip.
      state.addTextClipAt(null, cue.start, 'top')
      const next = useEditor.getState()
      const created = next.tracks.flatMap(track => track.clips).find(clip => !beforeIds.has(clip.client_id) && clip.type === 'text')
      if (!created) return 'The Timeline could not place this cue. Check the layer limit or available space.'
      next.patchClip(created.client_id, {
        name: `Subtitle — ${cue.text.slice(0, 32)}`,
        text: cue.text,
        color: style.textColor,
        start: cue.start,
        duration: Math.max(0.1, cue.end - cue.start),
      })
      next.patchProps(created.client_id, {
        x: 5, y: style.position === 'top' ? 6 : style.position === 'middle' ? 44 : 81,
        width: 90, height: 15,
      })
      next.selectClip(created.client_id)
      next.setPlayhead(cue.start)
      return 'Subtitle text clip added to Timeline. It will save with the normal Timeline autosave.'
    } catch (err) {
      return err instanceof Error ? `Timeline: ${err.message}` : 'Could not add the cue to Timeline.'
    }
  }
  const selected = library.selected
  return <section ref={container} className="relative flex h-full min-h-0 min-w-0 flex-1 overflow-hidden bg-[#0a0f17] text-white">
    <div className={`flex h-full min-h-0 min-w-0 flex-col overflow-hidden ${wide ? 'w-[53%] border-r border-[#293446]' : 'w-full'}`}>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto p-3 pb-6 [scrollbar-width:thin]">
        <header className="mb-3 flex shrink-0 flex-wrap items-start justify-between gap-2">
          <div className="min-w-0"><div className="flex items-center gap-2"><h2 className="text-[18px] font-bold tracking-tight text-white">Subtitles</h2><span className="rounded-full bg-[#362c4f] px-2 py-0.5 text-[11px] font-semibold text-[#e0caff]">{library.docs.length}</span></div>
            <p className="mt-1 max-w-sm text-[11px] leading-5 text-[#9cabbf]">Create, edit and style subtitles for your video.</p>
          </div>
          <div className="relative flex shrink-0 gap-1.5">
            {!wide && <button type="button" className={uiButton} disabled={!selected} onClick={() => setDetailsOpen(true)}><Captions size={14}/> Editor</button>}
            <button type="button" onClick={newDocument} className="inline-flex h-9 items-center gap-1.5 rounded-l-lg bg-[#7835e6] px-3 text-[11px] font-semibold text-white hover:bg-[#8c50f1]"><Plus size={15}/> New Subtitle</button>
            <button type="button" aria-expanded={newMenuOpen} aria-label="More subtitle actions" onClick={() => setNewMenuOpen(open => !open)} className="h-9 rounded-r-lg border-l border-white/15 bg-[#7835e6] px-2 hover:bg-[#8c50f1]"><ChevronDown size={15}/></button>
            {newMenuOpen && <div className="absolute right-0 top-11 z-40 w-56 rounded-lg border border-[#485270] bg-[#1a2230] p-1 shadow-2xl">
              <button type="button" className="flex w-full items-center gap-2 rounded p-2 text-left text-[11px] hover:bg-[#313c50]" onClick={newDocument}><Plus size={14}/> Create manual subtitles</button>
              <button type="button" className="flex w-full items-center gap-2 rounded p-2 text-left text-[11px] hover:bg-[#313c50]" onClick={() => { upload.current?.click(); setNewMenuOpen(false) }}><FileUp size={14}/> Import .srt / .vtt</button>
              <span className="block cursor-not-allowed rounded p-2 text-[11px] text-[#8793a5]" title="No verified transcription API in current project"><Sparkles size={14} className="mr-2 inline"/> Auto Generate (API needed)</span>
            </div>}
          </div>
        </header>
        <input ref={upload} type="file" accept=".srt,.vtt,text/vtt,application/x-subrip" className="hidden" onChange={event => void importDocument(event.target.files?.[0] ?? null)}/>
        {library.storageError && <p role="alert" className="mb-2 rounded border border-amber-700 bg-amber-950/30 p-2 text-[11px] text-amber-200">{library.storageError}</p>}
        {message && <p role="alert" className="mb-2 flex items-start justify-between gap-2 rounded border border-[#775069] bg-[#2a1c2c] p-2 text-[11px] text-rose-200">{message}<button type="button" aria-label="Dismiss" onClick={() => setMessage('')}><X size={13}/></button></p>}
        <nav aria-label="Subtitle filters" className="mb-3 flex shrink-0 gap-1 overflow-x-auto pb-1 [scrollbar-width:thin]">{filters.map(item => <button type="button" key={item} aria-pressed={filter === item} onClick={() => setFilter(item)} className={`shrink-0 whitespace-nowrap rounded-lg border px-2.5 py-2 text-[11px] transition-colors ${filter === item ? 'border-[#8e57e8] bg-[#752deb] text-white' : 'border-[#2b3444] bg-[#111721] text-[#bec9da] hover:bg-[#242f40]'}`}>{item}</button>)}</nav>
        <div className="mb-3 flex shrink-0 flex-wrap items-center gap-2">
          <div className="flex h-9 min-w-[150px] flex-[1_1_130px] items-center gap-2 rounded-lg border border-[#303b4c] bg-[#121a25] px-2.5"><Search size={15} className="shrink-0 text-[#96a3b5]"/><input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search subtitles..." aria-label="Search subtitles" className="w-full min-w-0 bg-transparent text-[11px] text-white outline-none placeholder:text-[#8390a2]"/>{search && <button aria-label="Clear search" type="button" onClick={() => setSearch('')}><X size={13}/></button>}</div>
          <select aria-label="Sort subtitles" className="h-9 rounded-lg border border-[#303b4c] bg-[#121a25] px-2 text-[11px] text-[#d2daeb] outline-none" value={sort} onChange={e => setSort(e.target.value as Sort)}><option value="newest">Newest first</option><option value="oldest">Oldest first</option><option value="name">Name A–Z</option><option value="duration">Longest first</option></select>
          <div className="flex items-center gap-1 rounded-lg border border-[#303b4c] p-1"><button type="button" aria-label="List view" aria-pressed={view === 'list'} onClick={() => setView('list')} className={`rounded p-1 ${view === 'list' ? 'bg-[#46306e] text-white' : 'text-[#a0a9b8]'}`}><List size={16}/></button><button type="button" aria-label="Grid view" aria-pressed={view === 'grid'} onClick={() => setView('grid')} className={`rounded p-1 ${view === 'grid' ? 'bg-[#46306e] text-white' : 'text-[#a0a9b8]'}`}><Grid2X2 size={16}/></button></div>
        </div>
        {shown.length ? <div className={view === 'grid' ? 'grid auto-rows-max grid-cols-[repeat(auto-fit,minmax(170px,1fr))] gap-2' : 'flex flex-col gap-2'}>{shown.map(doc => {
          const asset = media.find(m => m.id === doc.mediaId)
          const length = Math.max(0, ...doc.cues.map(cue => cue.end))
          return <div key={doc.id} className={`group relative min-w-0 rounded-xl border transition-colors ${selected?.id === doc.id ? 'border-[#8554ec] bg-[#211c35] shadow-[inset_0_0_0_1px_#674099]' : 'border-[#273244] bg-[#111922] hover:border-[#67568c]'} ${view === 'grid' ? 'p-2' : 'p-2'}`}>
            <div className={`flex min-w-0 ${view === 'grid' ? 'flex-col' : 'items-center'} gap-2`}>
              <button type="button" aria-label={`Edit ${doc.title}`} onClick={() => { library.setSelectedId(doc.id); setDetailsOpen(true) }} className={`flex min-w-0 flex-1 text-left ${view === 'grid' ? 'flex-col' : 'items-center'} gap-2`}>
                <span className={`relative shrink-0 overflow-hidden rounded-lg border border-[#28354b] bg-[#172234] ${view === 'grid' ? 'aspect-video w-full' : 'h-16 w-24'}`}>
                  {asset ? (asset.kind === 'image' ? <img src={fileUrl(asset.id)} alt="" className="h-full w-full object-cover"/> : asset.kind === 'video' ? <video preload="metadata" muted src={fileUrl(asset.id)} className="h-full w-full object-cover"/> : <div className="grid h-full place-items-center bg-[#142c43]"><Captions className="text-[#a185df]" size={20}/></div>) : <div className="grid h-full place-items-center bg-[linear-gradient(140deg,#172845,#271840)]"><Captions className="text-[#b08bea]" size={22}/></div>}
                  <Captions className="absolute bottom-1 left-1 rounded bg-[#0e1018]/90 p-0.5" size={16}/>
                </span>
                <span className="min-w-0 flex-1"><span className="block truncate text-[12px] font-semibold text-white">{doc.title || 'Untitled subtitles'}</span>
                  <span className="mt-1 flex flex-wrap items-center gap-1 text-[10px] text-[#9ba9bd]"><span className="rounded border border-[#3a4558] px-1.5 py-0.5 tabular-nums">00:00 – {shortTime(length)}</span><span className={`rounded-full px-1.5 py-0.5 ${kindClass(doc.kind)}`}>{kindLabel(doc.kind)}</span><span>{doc.language}</span></span>
                  <span className="mt-1 block text-[10px] text-[#75879f]">{doc.cues.length} cues · {new Date(doc.updatedAt).toLocaleDateString()}</span>
                </span>
              </button>
              <div className={`flex shrink-0 gap-1 ${view === 'grid' ? 'justify-end' : 'self-start'}`}>
                <button aria-label={doc.favorite ? 'Remove favorite' : 'Add favorite'} title={doc.favorite ? 'Unfavorite' : 'Favorite'} className={`rounded p-1.5 ${doc.favorite ? 'text-amber-400' : 'text-[#98a4b9] hover:text-amber-400'}`} type="button" onClick={() => library.update(doc.id, { favorite: !doc.favorite })}><Star size={16} fill={doc.favorite ? 'currentColor' : 'none'}/></button>
                <details className="relative"><summary title="Subtitle actions" aria-label="Subtitle actions" className="list-none cursor-pointer rounded p-1.5 text-[#97a3b9] hover:bg-[#30394a] hover:text-white [&::-webkit-details-marker]:hidden"><MoreVertical size={16}/></summary>
                  <div className="absolute right-0 top-8 z-20 min-w-32 rounded-lg border border-[#3c4962] bg-[#242b3b] p-1 shadow-lg"><button type="button" className="w-full rounded p-2 text-left text-[11px] hover:bg-[#38445b]" onClick={() => library.duplicate(doc.id)}>Duplicate</button><button type="button" className="flex w-full items-center gap-1 rounded p-2 text-left text-[11px] text-rose-300 hover:bg-[#38445b]" onClick={() => library.remove(doc.id)}><Trash2 size={12}/> Delete</button></div>
                </details>
              </div>
            </div>
          </div>
        })}</div> : <div className="mt-4 flex min-h-52 flex-col items-center justify-center rounded-xl border border-dashed border-[#354155] bg-[#121824] p-5 text-center"><Captions size={30} className="mb-3 text-[#7f5ebc]"/><p className="text-[12px] font-semibold text-[#d6dce9]">{library.docs.length ? 'No matching subtitles' : 'No subtitles yet'}</p><p className="mt-2 max-w-xs text-[11px] leading-5 text-[#9aa7b9]">{library.docs.length ? 'Change filters or search to see other projects.' : 'Create your first subtitle document or import a timed SRT/VTT file.'}</p><div className="mt-3 flex flex-wrap justify-center gap-2"><button type="button" className={uiButton} onClick={library.docs.length ? () => { setFilter('All'); setSearch('') } : newDocument}>{library.docs.length ? 'Clear filters' : 'Create subtitles'}</button><button type="button" className={uiButton} onClick={() => upload.current?.click()} disabled={pending}><FileUp size={13}/> Import file</button></div></div>}
        <div className="mt-auto pt-4 text-[10px] text-[#7d8da3]">{shown.length} / {library.docs.length} documents · Saved locally per project</div>
      </div>
    </div>
    {wide && <div className="min-h-0 min-w-0 flex-1 overflow-hidden"><SubtitleEditorPanel library={library} media={media} onAddCueToTimeline={addCueToTimeline}/></div>}
    {!wide && detailsOpen && <div className="absolute inset-0 z-30 flex justify-end"><button type="button" aria-label="Close subtitle editor" className="absolute inset-0 bg-[#05080d]/80" onClick={() => setDetailsOpen(false)}/><div className="relative flex h-full min-h-0 w-[min(520px,96%)] flex-col overflow-hidden border-l border-[#4e4164] bg-[#0c1119] shadow-2xl"><div className="flex shrink-0 items-center justify-between border-b border-[#323d4f] px-3 py-2"><span className="text-xs font-semibold">Subtitle Editor</span><button type="button" onClick={() => setDetailsOpen(false)} className={uiButton}><ChevronLeft size={14}/> Back</button></div><div className="min-h-0 flex-1 overflow-hidden"><SubtitleEditorPanel library={library} media={media} onAddCueToTimeline={addCueToTimeline}/></div></div></div>}
  </section>
}
