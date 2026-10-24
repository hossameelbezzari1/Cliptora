import { useEffect, useMemo, useRef, useState, type DragEvent, type ReactNode } from 'react'
import {
  AudioLines, Folder, FolderPlus, Grid2X2, Image as ImageIcon, List,
  PanelLeft, PanelRight, Search, SlidersHorizontal, Trash2, Upload, Video, X,
} from 'lucide-react'
import { Alert } from '../../ui/Field'
import type { MediaAsset } from '../../../types'
import { useEditor } from '../../../stores/editorStore'
import { MediaAssetCard } from './MediaAssetCard'
import { MediaDetailsPanel } from './MediaDetailsPanel'
import { useMediaOrganization } from './useMediaOrganization'
import { mediaDuration, mediaName, mediaSizeBytes, mediaTime } from './mediaLibraryUtils'

type Filter = 'all' | 'video' | 'image' | 'audio'
type Sort = 'newest' | 'oldest' | 'name' | 'kind' | 'size'
type View = 'grid' | 'list'
type FolderSelection = Filter | `folder:${string}`
type Layout = 'wide' | 'medium' | 'compact'

const accept = 'video/mp4,video/webm,video/quicktime,image/png,image/jpeg,image/webp,audio/mpeg,audio/wav,audio/ogg,audio/mp4,audio/webm'
const filters: Array<{ id: Filter; label: string }> = [
  { id: 'all', label: 'All' }, { id: 'video', label: 'Video' },
  { id: 'image', label: 'Image' }, { id: 'audio', label: 'Sound' },
]
const controlClass = 'inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-lg border border-[#343d4d] bg-[#1a212c] px-3 text-[11px] text-[#d3d8e4] hover:border-[#8e63d8] hover:text-white disabled:opacity-50'

function ResponsiveDrawer({
  side, title, onClose, children,
}: { side: 'left' | 'right'; title: string; onClose: () => void; children: ReactNode }) {
  return <div className={`absolute inset-0 z-40 flex ${side === 'right' ? 'justify-end' : 'justify-start'}`}>
    <button type="button" className="absolute inset-0 bg-[#05070b]/70" onClick={onClose} aria-label={`Close ${title}`}/>
    <aside aria-label={title} className={`relative flex h-full min-h-0 w-[min(340px,92%)] flex-col overflow-hidden border-[#414052] bg-[#141a24] shadow-2xl ${side === 'right' ? 'border-l' : 'border-r'}`}>
      <div className="flex shrink-0 items-center justify-between border-b border-[#31394b] px-3 py-2 text-xs font-semibold text-white">
        <span>{title}</span>
        <button type="button" onClick={onClose} title={`Close ${title}`} aria-label={`Close ${title}`} className="rounded-md p-1.5 text-[#aeb9c9] hover:bg-[#293040] hover:text-white"><X size={16}/></button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-3 [scrollbar-width:thin]">{children}</div>
    </aside>
  </div>
}

export function MediaLibraryTab({ projectId, media, onUpload, onAdd, busy, error }: {
  projectId: string
  media: MediaAsset[]
  onUpload: (files: FileList | null) => Promise<void>
  onAdd: (asset: MediaAsset) => Promise<void>
  busy: boolean
  error: unknown
}) {
  const rootRef = useRef<HTMLElement>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const { folders, assignments, tags, createFolder, renameFolder, deleteFolder, setFolder, addTag, removeTag } = useMediaOrganization(projectId)
  const [width, setWidth] = useState(0)
  const [filter, setFilter] = useState<Filter>('all')
  const [folder, setSelectedFolder] = useState<FolderSelection>('all')
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<Sort>('newest')
  const [view, setView] = useState<View>('grid')
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [folderInput, setFolderInput] = useState('')
  const [creating, setCreating] = useState(false)
  const [foldersOpen, setFoldersOpen] = useState(false)
  const [detailsOpen, setDetailsOpen] = useState(false)

  // Use the *actual Library panel width*, not the browser viewport and not CSS @container
  // selectors which previously stacked the Folders and Preview below the asset list.
  useEffect(() => {
    const el = rootRef.current
    if (!el) return
    const update = () => setWidth(el.getBoundingClientRect().width)
    update()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(update)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const layout: Layout = width >= 890 ? 'wide' : width >= 640 ? 'medium' : 'compact'
  const selectedFolder = folder.startsWith('folder:') ? folders.find(f => f.id === folder.slice(7)) : null
  const folderLabel = selectedFolder?.name ?? (folder !== 'all' ? `${folder[0].toUpperCase()}${folder.slice(1)}` : '')

  const shown = useMemo(() => {
    const search = query.trim().toLowerCase()
    return media.filter(asset => {
      if (filter !== 'all' && asset.kind !== filter) return false
      if (folder.startsWith('folder:') && assignments[String(asset.id)] !== folder.slice(7)) return false
      if (folder === 'video' || folder === 'image' || folder === 'audio') {
        if (asset.kind !== folder) return false
      }
      return !search || `${mediaName(asset)} ${asset.kind} ${(tags[String(asset.id)] ?? []).join(' ')}`.toLowerCase().includes(search)
    }).sort((a, b) => {
      switch (sort) {
        case 'name': return mediaName(a).localeCompare(mediaName(b))
        case 'kind': return a.kind.localeCompare(b.kind)
        case 'oldest': return mediaTime(a) - mediaTime(b)
        case 'size': return (mediaSizeBytes(b) ?? 0) - (mediaSizeBytes(a) ?? 0)
        default: return mediaTime(b) - mediaTime(a)
      }
    })
  }, [media, filter, folder, query, sort, assignments, tags])

  // Keep selection even when a filter changes; fallback to a real imported file.
  const selected = media.find(asset => asset.id === selectedId) ?? shown[0] ?? media[0] ?? null
  const counts = {
    all: media.length,
    video: media.filter(asset => asset.kind === 'video').length,
    image: media.filter(asset => asset.kind === 'image').length,
    audio: media.filter(asset => asset.kind === 'audio').length,
  }
  const hasFilters = filter !== 'all' || folder !== 'all' || query.trim() !== ''

  function resetFilters() {
    setFilter('all')
    setSelectedFolder('all')
    setQuery('')
  }

  function chooseFilter(value: Filter) {
    // A hidden folder selection must never invisibly suppress the 'All' media tab.
    setSelectedFolder('all')
    setFilter(value)
  }

  function chooseFolder(value: FolderSelection) {
    setSelectedFolder(value)
    setFilter('all')
    setFoldersOpen(false)
  }

  function doDrag(event: DragEvent<HTMLElement>, asset: MediaAsset) {
    useEditor.getState().startDrag({ kind: 'media', mediaId: asset.id, duration: mediaDuration(asset) ?? 5 })
    event.dataTransfer.setData('application/x-cliptora', `media:${asset.id}`)
    event.dataTransfer.setData('text/plain', `cliptora:media:${asset.id}`)
    event.dataTransfer.effectAllowed = 'copy'
  }

  function navItem(value: FolderSelection, label: string, count: number, Icon: typeof Folder, color: string) {
    return <button type="button" key={value} onClick={() => chooseFolder(value)}
      aria-pressed={folder === value}
      className={`flex min-w-0 flex-1 items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[11px] transition-colors ${folder === value ? 'bg-[#3c2c68] text-white' : 'text-[#c1c9d7] hover:bg-[#242b3a]'}`}>
      <Icon size={16} className={`shrink-0 ${color}`}/>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <span className="rounded-md bg-[#293242] px-1.5 py-0.5 text-[10px] text-[#c3cadb]">{count}</span>
    </button>
  }

  const foldersContent = <div className="min-w-0">
    <p className="mb-2 px-2 text-[11px] font-semibold text-[#e2e5f0]">Library</p>
    <nav aria-label="Media categories" className="space-y-0.5">
      {navItem('all', 'All media', counts.all, Folder, 'text-[#b494ef]')}
      {navItem('video', 'Videos', counts.video, Video, 'text-[#a77de7]')}
      {navItem('image', 'Images', counts.image, ImageIcon, 'text-[#64c9ba]')}
      {navItem('audio', 'Audio', counts.audio, AudioLines, 'text-[#e4a865]')}
    </nav>
    <div className="mt-4 flex items-center justify-between border-t border-[#2d3743] px-2 pt-3">
      <span className="text-[11px] font-semibold text-white">My folders</span>
      <button type="button" onClick={() => setCreating(value => !value)} title="New folder" aria-label="New folder" className="rounded-lg border border-[#364052] p-1.5 text-[#ad98e8] hover:bg-[#302544]"><FolderPlus size={15}/></button>
    </div>
    {creating && <form className="mt-2 flex gap-1" onSubmit={event => {
      event.preventDefault()
      createFolder(folderInput)
      setFolderInput('')
      setCreating(false)
    }}>
      <input autoFocus maxLength={80} value={folderInput} onChange={event => setFolderInput(event.target.value)} placeholder="Folder name" className="min-w-0 flex-1 rounded border border-[#5a4774] bg-[#0d131b] px-2 py-1 text-[11px] text-white outline-none"/>
      <button type="submit" disabled={!folderInput.trim()} className="rounded bg-[#6e3dc3] px-2 text-xs text-white disabled:opacity-40">+</button>
    </form>}
    <div className="mt-2 space-y-1">
      {folders.map(item => <div key={item.id} className="group flex min-w-0 items-center gap-1">
        {navItem(`folder:${item.id}`, item.name, media.filter(asset => assignments[String(asset.id)] === item.id).length, Folder, 'text-[#70b1f3]')}
        <button type="button" title={`Rename ${item.name}`} aria-label={`Rename ${item.name}`} onClick={() => {
          const value = window.prompt('Folder name', item.name)
          if (value !== null) renameFolder(item.id, value)
        }} className="shrink-0 rounded px-1 text-[#bca8f9] opacity-70 hover:bg-[#32304a] group-hover:opacity-100">✎</button>
        <button type="button" title={`Delete ${item.name}`} aria-label={`Delete ${item.name}`} onClick={() => {
          if (window.confirm(`Delete folder "${item.name}"? Media files will not be deleted.`)) {
            deleteFolder(item.id)
            if (folder === `folder:${item.id}`) setSelectedFolder('all')
          }
        }} className="shrink-0 rounded p-1 text-[#d38b9b] opacity-70 hover:bg-[#44303b] group-hover:opacity-100"><Trash2 size={12}/></button>
      </div>)}
      {!folders.length && <p className="px-2 py-3 text-[10px] leading-4 text-[#7d8c9c]">No custom folders. Create one to organize your assets.</p>}
    </div>
  </div>

  const detailsContent = <MediaDetailsPanel key={selected?.id ?? 'none'} media={selected} folders={folders}
    folderId={selected ? assignments[String(selected.id)] ?? '' : ''}
    tags={selected ? tags[String(selected.id)] ?? [] : []}
    onFolder={value => { if (selected) setFolder(selected.id, value) }}
    onAddTag={value => { if (selected) addTag(selected.id, value) }}
    onRemoveTag={value => { if (selected) removeTag(selected.id, value) }}
    onAdd={() => { if (selected) void onAdd(selected) }}/>

  return <section ref={rootRef} className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-[#0e131a] p-3 text-white">
    <div className="mb-3 flex shrink-0 flex-wrap items-center justify-between gap-2">
      <div className="min-w-0">
        <h2 className="flex items-center gap-2 text-base font-bold">Media Library <span className="rounded-full bg-[#322849] px-2 py-0.5 text-[10px] text-[#dcc7ff]">{media.length}</span></h2>
        <p className="mt-1 text-[10px] leading-4 text-[#96a3b7]">Import, organize, preview and drag media into Timeline</p>
      </div>
      <div className="flex gap-1.5">
        <button type="button" onClick={() => setView('grid')} title="Grid view" aria-label="Grid view" aria-pressed={view === 'grid'} className={`${controlClass} !px-2 ${view === 'grid' ? '!border-[#8958d9] !bg-[#40276b] !text-white' : ''}`}><Grid2X2 size={16}/></button>
        <button type="button" onClick={() => setView('list')} title="List view" aria-label="List view" aria-pressed={view === 'list'} className={`${controlClass} !px-2 ${view === 'list' ? '!border-[#8958d9] !bg-[#40276b] !text-white' : ''}`}><List size={16}/></button>
      </div>
    </div>

    <div className="mb-3 flex min-w-0 shrink-0 items-center gap-2">
      <button type="button" disabled={busy} onClick={() => fileInput.current?.click()} className="inline-flex h-9 shrink-0 items-center gap-2 rounded-lg bg-[#7443e0] px-3 text-xs font-semibold text-white hover:bg-[#8758f5] disabled:opacity-50"><Upload size={15}/>{busy ? 'Uploading…' : 'Upload'}</button>
      {layout === 'compact' && <button type="button" onClick={() => { setFoldersOpen(true); setDetailsOpen(false) }} title="Open folders" aria-label="Open folders" className={`${controlClass} !px-2`}><PanelLeft size={17}/></button>}
      {layout !== 'wide' && <button type="button" onClick={() => { setDetailsOpen(true); setFoldersOpen(false) }} title="Open media details" aria-label="Open media details" className={`${controlClass} !px-2`}><PanelRight size={17}/></button>}
      <label className="flex min-w-0 flex-1 items-center gap-2 rounded-lg border border-[#354051] bg-[#141b26] px-2.5 py-2"><Search size={16} className="shrink-0 text-[#8d9bb0]"/><input value={query} onChange={event => setQuery(event.target.value)} className="w-full min-w-0 bg-transparent text-xs text-white outline-none placeholder:text-[#78869b]" aria-label="Search media" placeholder="Search media…"/>{query && <button type="button" aria-label="Clear search" onClick={() => setQuery('')}><X size={15}/></button>}</label>
      <input ref={fileInput} hidden type="file" accept={accept} multiple onChange={event => { void onUpload(event.target.files); event.currentTarget.value = '' }}/>
    </div>
    {Boolean(error) && <div className="mb-2 shrink-0"><Alert error={error}/></div>}

    {/* Only one real layout. On narrow widths, folders and details move into *overlay drawers*, never below the cards. */}
    <div className="relative min-h-0 min-w-0 flex-1 overflow-hidden">
      <div className="grid h-full min-h-0 min-w-0 gap-2.5" style={{ gridTemplateColumns: layout === 'wide' ? 'minmax(145px,19%) minmax(0,1fr) minmax(225px,27%)' : layout === 'medium' ? 'minmax(155px,24%) minmax(0,1fr)' : 'minmax(0,1fr)' }}>
        {layout !== 'compact' && <aside aria-label="Media folders" className="min-h-0 min-w-0 overflow-y-auto rounded-xl border border-[#303946] bg-[#141a22] p-2 [scrollbar-width:thin]">{foldersContent}</aside>}

        <main className="flex min-h-0 min-w-0 flex-col overflow-hidden" aria-label="Media assets">
          <div className="mb-2 flex shrink-0 flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap gap-1">{filters.map(item => <button type="button" key={item.id} onClick={() => chooseFilter(item.id)} aria-pressed={filter === item.id} className={`rounded-full border px-2.5 py-1.5 text-[10px] transition-colors ${filter === item.id ? 'border-[#9764f8] bg-[#743ee0] text-white' : 'border-[#374253] bg-[#151d27] text-[#bcc6d7] hover:bg-[#263043]'}`}>{item.label}</button>)}</div>
            <label className="flex items-center gap-1.5 rounded-lg border border-[#303b4a] bg-[#19212c] px-2 py-1.5 text-[10px] text-[#b4bfd0]"><SlidersHorizontal size={12}/><select value={sort} onChange={event => setSort(event.target.value as Sort)} aria-label="Sort media" className="max-w-[135px] bg-transparent outline-none"><option value="newest">Newest first</option><option value="oldest">Oldest first</option><option value="name">File name</option><option value="kind">File type</option><option value="size">Largest first</option></select></label>
          </div>
          {folder !== 'all' && <div className="mb-2 flex shrink-0 items-center gap-1.5 text-[10px] text-[#aebacf]">Folder: <span className="rounded-md border border-[#584379] bg-[#2e2348] px-2 py-1 text-[#e0ccff]">{folderLabel}</span><button type="button" title="Clear folder filter" aria-label="Clear folder filter" onClick={() => setSelectedFolder('all')} className="rounded p-1 hover:bg-[#2e2842]"><X size={13}/></button></div>}

          <div className="min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden pr-1 [scrollbar-width:thin] [scrollbar-color:#555a6a_transparent]">
            {shown.length > 0 ? <div className={view === 'grid' ? 'grid gap-2.5' : 'flex flex-col gap-2'} style={view === 'grid' ? { gridTemplateColumns: 'repeat(auto-fill,minmax(min(100%,145px),1fr))' } : undefined}>{shown.map(asset => <MediaAssetCard key={asset.id} media={asset} selected={selected?.id === asset.id} view={view}
              onSelect={() => { setSelectedId(asset.id); if (layout !== 'wide') { setDetailsOpen(true); setFoldersOpen(false) } }}
              onAdd={() => { void onAdd(asset) }} onDragStart={event => doDrag(event, asset)} onDragEnd={() => useEditor.getState().startDrag(null)}/>)}</div>
            : <div className="grid min-h-[190px] place-content-center gap-3 rounded-xl border border-dashed border-[#394255] bg-[#131a23] p-4 text-center">
              <ImageIcon size={26} className="mx-auto text-[#9484b7]"/>
              <p className="text-xs text-[#b7c0ce]">{media.length ? 'No media matches the active filters.' : 'No media imported yet.'}</p>
              <div className="flex justify-center gap-2">
                {hasFilters && <button type="button" onClick={resetFilters} className={controlClass}>Clear filters</button>}
                {!media.length && <button type="button" onClick={() => fileInput.current?.click()} className="rounded-lg bg-[#7443e0] px-3 py-2 text-[11px] text-white">Upload media</button>}
              </div>
              {media.length > 0 && !hasFilters && <p className="text-[10px] text-[#8090a4]">No supported media types matched. Check the asset kind returned by your API.</p>}
            </div>}
          </div>
          <p className="mt-2 shrink-0 border-t border-[#293342] bg-[#10161e] py-2 text-[10px] text-[#8190a4]">{shown.length} / {media.length} assets · Drag to Timeline · Click + to append</p>
        </main>

        {layout === 'wide' && <aside aria-label="Selected media details" className="min-h-0 min-w-0 overflow-y-auto [scrollbar-width:thin]">{detailsContent}</aside>}
      </div>

      {layout === 'compact' && foldersOpen && <ResponsiveDrawer side="left" title="Folders" onClose={() => setFoldersOpen(false)}>{foldersContent}</ResponsiveDrawer>}
      {layout !== 'wide' && detailsOpen && <ResponsiveDrawer side="right" title="Media details" onClose={() => setDetailsOpen(false)}>{detailsContent}</ResponsiveDrawer>}
    </div>
  </section>
}
