import { useEffect, useMemo, useRef, useState, type DragEvent, type MouseEvent, type PointerEvent, type ReactNode } from 'react'
import { Eye, EyeOff, Lock, Unlock, Volume2, VolumeX, Plus, Trash2, Music2, Type, Video, Image as ImageIcon, Minus, Maximize2, GripVertical } from 'lucide-react'
import { useEditor, canPlace, snapTime, MAX_LAYERS, MIN_CLIP, MAX_TIME, type DragItem } from '../../../stores/editorStore'
import { formatTime } from '../../../lib/api'
import { probeMediaDuration } from '../../../lib/media'
import type { Track, Clip } from '../../../types'

const LABEL_W = 186
const ROW_H = 62
const MIN_ZOOM = 0.05
const MAX_ZOOM = 140
const DRAG_MIME = 'application/x-cliptora'
const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n))
const px = (n: number) => Math.round(n * 100) / 100

type Preview = {
  start: number
  duration: number
  valid: boolean
  type: Clip['type']
  gapStart: number
  gapEnd: number | null
  snapEdge: number | null
}

type DropProps = { trackId: string | null; zoom: number; preview: Preview | null; onPreview: (value: Preview | null) => void }

const clipKind = (dragging: DragItem, tracks: Track[]): Clip['type'] => {
  if (dragging.kind === 'text') return 'text'
  if (dragging.kind === 'media') return useEditor.getState().media.find(m => m.id === dragging.mediaId)?.kind ?? 'video'
  return tracks.flatMap(t => t.clips).find(c => c.client_id === dragging.clipId)?.type ?? 'video'
}

function calculateDrop(event: DragEvent<HTMLDivElement>, dragging: DragItem, trackId: string | null, zoom: number) {
  const state = useEditor.getState()
  const rect = event.currentTarget.getBoundingClientRect()
  const duration = dragging.duration
  const raw = clamp((event.clientX - rect.left) / zoom - (dragging.kind === 'clip' ? dragging.offset : 0), 0, MAX_TIME - duration)
  const clipId = dragging.kind === 'clip' ? dragging.clipId : undefined
  const startSnap = snapTime(raw, state.tracks, state.playhead, zoom, clipId)
  const endSnap = snapTime(raw + duration, state.tracks, state.playhead, zoom, clipId) - duration
  const start = clamp(Math.abs(endSnap - raw) < Math.abs(startSnap - raw) ? endSnap : startSnap, 0, MAX_TIME - duration)
  const destination = state.tracks.find(t => t.client_id === trackId)
  const origin = clipId ? state.tracks.find(t => t.clips.some(c => c.client_id === clipId)) : undefined
  const valid = (!trackId || Boolean(destination)) && (!origin || !origin.locked) &&
    (destination ? canPlace(destination, start, duration, clipId) : state.tracks.length < MAX_LAYERS)
  // The hovered interval is bounded by its neighboring clips on this same layer.
  // Draw guides for that free slot instead of changing the global viewport width.
  const neighbors = (destination?.clips ?? []).filter(c => c.client_id !== clipId).sort((a, b) => a.start - b.start)
  let gapStart = 0
  let gapEnd: number | null = null
  for (const neighbor of neighbors) {
    if (neighbor.start + neighbor.duration <= start + 0.001) gapStart = Math.max(gapStart, neighbor.start + neighbor.duration)
    else { gapEnd = neighbor.start; break }
  }
  const snapThreshold = Math.min(1.5, 9 / zoom) + 0.02
  const snapCandidates = [gapStart, ...(gapEnd === null ? [] : [gapEnd])]
  const snapEdge = snapCandidates.find(edge => Math.abs(edge - start) < snapThreshold || Math.abs(edge - start - duration) < snapThreshold) ?? null
  return { start: px(start), duration, valid, type: clipKind(dragging, state.tracks), gapStart, gapEnd, snapEdge } satisfies Preview
}

async function finishDrop(dragging: DragItem, drop: Preview, trackId: string | null) {
  if (!drop.valid) return
  const store = useEditor.getState()
  if (dragging.kind === 'clip') store.moveClip(dragging.clipId, trackId, drop.start)
  if (dragging.kind === 'text') store.addTextClipAt(trackId, drop.start)
  if (dragging.kind === 'media') {
    const media = store.media.find(m => m.id === dragging.mediaId)
    if (!media) return
    const { duration, measured } = await probeMediaDuration(media)
    if (measured) useEditor.getState().setMediaDuration(media.id, duration)
    const inserted = useEditor.getState().addMediaClipAt(media, duration, trackId, drop.start)
    if (!inserted) window.alert('Cannot drop here: the layer is locked, the clip overlaps another, or it exceeds the timeline length.')
  }
}

function DropLane({ trackId, zoom, preview, onPreview, children }: DropProps & { children?: ReactNode }) {
  const setDragging = useEditor(s => s.startDrag)
  const onDragOver = (e: DragEvent<HTMLDivElement>) => {
    const dragging = useEditor.getState().dragging
    if (!dragging || !e.dataTransfer.types.includes(DRAG_MIME)) return
    e.preventDefault()
    e.dataTransfer.dropEffect = dragging.kind === 'clip' ? 'move' : 'copy'
    const position = calculateDrop(e, dragging, trackId, zoom)
    onPreview(position)
    const scroll = e.currentTarget.closest('[data-timeline-scroll]') as HTMLElement | null
    if (scroll) {
      const bounds = scroll.getBoundingClientRect()
      if (e.clientX > bounds.right - 40) scroll.scrollLeft += 16
      if (e.clientX < bounds.left + LABEL_W + 40) scroll.scrollLeft -= 16
      if (e.clientY > bounds.bottom - 35) scroll.scrollTop += 12
      if (e.clientY < bounds.top + 80) scroll.scrollTop -= 12
    }
  }
  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    const dragging = useEditor.getState().dragging
    if (!dragging || !e.dataTransfer.types.includes(DRAG_MIME)) return
    e.preventDefault()
    e.stopPropagation()
    const final = calculateDrop(e, dragging, trackId, zoom)
    onPreview(null)
    setDragging(null)
    void finishDrop(dragging, final, trackId)
  }
  return <div data-clip-lane className="relative my-0.5 min-w-0 flex-1 rounded bg-[#101214]" onDragOver={onDragOver} onDragLeave={e => {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) onPreview(null)
  }} onDrop={onDrop} onClick={() => useEditor.getState().selectTrack(trackId)}>
    {children}
    {preview && <>
      {/* The neighbors of a dragged clip define its available slot. */}
      {trackId && <>
        <div aria-hidden className="pointer-events-none absolute inset-y-0 z-20 w-px border-l border-dashed border-emerald-400/80" style={{ left: preview.gapStart * zoom }}/>
        {preview.gapEnd !== null && <div aria-hidden className="pointer-events-none absolute inset-y-0 z-20 w-px border-l border-dashed border-emerald-400/80" style={{ left: preview.gapEnd * zoom }}/>} 
        {preview.gapEnd !== null && preview.gapEnd > preview.gapStart && <div aria-hidden className="pointer-events-none absolute top-0 z-20 h-0.5 bg-emerald-400/70" style={{ left: preview.gapStart * zoom, width: (preview.gapEnd - preview.gapStart) * zoom }}/>} 
        <span aria-live="polite" className="pointer-events-none absolute top-1 z-40 whitespace-nowrap rounded bg-[#111819]/95 px-1.5 py-0.5 text-[9px] text-emerald-300 shadow-md" style={{ left: Math.max(3, preview.start * zoom + 8) }}>
          {preview.gapEnd === null ? `Free after ${formatTime(preview.gapStart)}` : `Free gap ${formatTime(Math.max(0, preview.gapEnd - preview.gapStart))}`}
        </span>
      </>}
      {preview.snapEdge !== null && <div aria-hidden className="pointer-events-none absolute -top-1 bottom-[-4px] z-40 w-[2px] bg-[#e8d5ff] shadow-[0_0_9px_#a473ff]" style={{ left: preview.snapEdge * zoom }}/>} 
      <div aria-hidden className={`pointer-events-none absolute inset-y-1 z-30 flex items-center overflow-hidden rounded border-2 border-dashed px-2 text-[10px] font-semibold ${preview.valid ? 'border-[#b78aff] bg-[#813edb]/40 text-white' : 'border-red-400 bg-red-950/70 text-red-100'}`} style={{ left: preview.start * zoom, width: Math.max(preview.duration * zoom, 12) }}>
        {preview.valid ? `Drop ${preview.type}` : 'No space / locked'}
      </div>
    </>}
  </div>
}

export function TimelinePanel() {
  const tracks = useEditor(s => s.tracks)
  const playhead = useEditor(s => s.playhead)
  const setPlayhead = useEditor(s => s.setPlayhead)
  const addTrack = useEditor(s => s.addTrack)
  const dragged = useEditor(s => s.dragging)
  const [zoom, setZoom] = useState(23)
  const [previewByTrack, setPreviewByTrack] = useState<Record<string, Preview | null>>({})
  const scroll = useRef<HTMLDivElement>(null)
  const timelineRoot = useRef<HTMLElement>(null)
  const manualZoom = useRef(false)
  const previousClipCount = useRef<number | null>(null)
  const maxEnd = Math.max(30, playhead + 8, ...tracks.flatMap(t => t.clips.map(c => c.start + c.duration)))
  const duration = Math.min(MAX_TIME, Math.max(60, maxEnd + 16))
  const timelineWidth = duration * zoom
  const candidateTicks = [0.5, 1, 2, 5, 10, 20, 30, 60, 120, 300, 600, 1200, 1800, 3600]
  const ticksEvery = candidateTicks.find(step => step * zoom >= 45 && duration / step <= 350) ?? 1200
  const ticks = useMemo(() => Array.from({ length: Math.floor(duration / ticksEvery) + 1 }, (_, i) => i * ticksEvery), [duration, ticksEvery])
  // A logarithmic control keeps short and long videos equally easy to zoom.
  const zoomSlider = 100 * Math.log(zoom / MIN_ZOOM) / Math.log(MAX_ZOOM / MIN_ZOOM)
  const sliderToZoom = (value: number) => MIN_ZOOM * Math.pow(MAX_ZOOM / MIN_ZOOM, value / 100)
  const preview = (trackId: string | null, value: Preview | null) => setPreviewByTrack(s => ({ ...s, [trackId ?? 'new']: value }))
  useEffect(() => { if (!dragged) setPreviewByTrack({}) }, [dragged])

  function zoomTo(next: number, anchorX?: number) {
    manualZoom.current = true
    const pane = scroll.current
    const value = clamp(Math.round(next * 1000) / 1000, MIN_ZOOM, MAX_ZOOM)
    if (!pane) { setZoom(value); return }
    const visualX = clamp(anchorX ?? Math.max(0, (pane.clientWidth - LABEL_W) / 2), 0, Math.max(0, pane.clientWidth - LABEL_W))
    const sourceTime = (pane.scrollLeft + visualX) / zoom
    setZoom(value)
    requestAnimationFrame(() => { if (scroll.current) scroll.current.scrollLeft = Math.max(0, sourceTime * value - visualX) })
  }
  function fit(userInitiated = true) {
    if (userInitiated) manualZoom.current = true
    const pane = scroll.current
    if (!pane) return
    const content = Math.max(60, ...tracks.flatMap(t => t.clips.map(c => c.start + c.duration + 2)))
    setZoom(clamp((pane.clientWidth - LABEL_W - 16) / content, MIN_ZOOM, MAX_ZOOM))
    pane.scrollLeft = 0
  }
  // Intercept Ctrl+Wheel over the timeline and toolbar, not only the ruler.
  // Otherwise browsers zoom the entire editor when hovering a track label or toolbar.
  useEffect(() => {
    const root = timelineRoot.current?.parentElement
    const pane = scroll.current
    if (!root || !pane) return
    const handle = (event: globalThis.WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return
      event.preventDefault()
      event.stopPropagation()
      const rect = pane.getBoundingClientRect()
      zoomTo(zoom * (event.deltaY < 0 ? 1.16 : 1 / 1.16), event.clientX - rect.left - LABEL_W)
    }
    root.addEventListener('wheel', handle, { passive: false })
    return () => root.removeEventListener('wheel', handle)
  }, [zoom])
  const clipCount = tracks.reduce((sum, track) => sum + track.clips.length, 0)
  // First populated timeline or first imported clip: fit without resizing other panels.
  useEffect(() => {
    const prev = previousClipCount.current
    previousClipCount.current = clipCount
    if (clipCount && !manualZoom.current && (prev === null || prev === 0)) {
      const id = requestAnimationFrame(() => fit(false))
      return () => cancelAnimationFrame(id)
    }
  }, [clipCount])
  function scrub(event: MouseEvent<HTMLDivElement>) {
    const rect = event.currentTarget.getBoundingClientRect()
    setPlayhead(px(clamp((event.clientX - rect.left) / zoom, 0, MAX_TIME)))
  }
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement
      if (target.closest('input,textarea,select,[contenteditable="true"]')) return
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault()
        if (event.shiftKey) useEditor.getState().redo()
        else useEditor.getState().undo()
      } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') {
        event.preventDefault(); useEditor.getState().redo()
      } else if (event.key === 'Delete' || event.key === 'Backspace') {
        const selected = useEditor.getState().selectedClipId
        if (selected) { event.preventDefault(); useEditor.getState().removeClip(selected) }
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  return <section ref={timelineRoot} className="relative flex min-h-0 min-w-0 w-full max-w-full flex-col overflow-hidden rounded-lg bg-cl-panel [contain:layout]">
    <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-white/5 px-3 py-2">
      <span className="mr-2 text-xs font-bold tracking-wide">TIMELINE</span>
      <button title="Add layer (optional)" disabled={tracks.length >= MAX_LAYERS} onClick={addTrack} className="flex items-center gap-1 rounded-lg bg-cl-panel-2 px-3 py-1.5 text-xs hover:bg-[#35383d] disabled:opacity-40"><Plus size={15}/>Layer</button>
      <span className="hidden text-[10px] text-cl-muted xl:inline">Drag clips between layers · Drag edges to trim · Double-click to rename</span>
      <div className="ml-auto flex items-center gap-2">
        <button title="Zoom out" aria-label="Zoom out" onClick={() => zoomTo(zoom / 1.25)} className="rounded-lg p-1.5 hover:bg-cl-panel-2"><Minus size={16}/></button>
        <input aria-label="Timeline zoom" type="range" min={0} max={100} step={1} value={zoomSlider} onChange={e => zoomTo(sliderToZoom(Number(e.target.value)))} className="w-16 accent-[#a87cf4] sm:w-24"/>
        <button title="Zoom in" aria-label="Zoom in" onClick={() => zoomTo(zoom * 1.25)} className="rounded-lg p-1.5 hover:bg-cl-panel-2"><Plus size={16}/></button>
        <button title="Fit timeline" aria-label="Fit timeline" onClick={() => fit()} className="rounded-lg p-1.5 hover:bg-cl-panel-2"><Maximize2 size={15}/></button>
        <span className="w-16 text-right text-[10px] tabular-nums text-cl-muted">{zoom.toFixed(zoom < 10 ? 2 : 1)}px/s</span>
      </div>
    </div>
    <div data-timeline-scroll ref={scroll} className="relative min-h-0 min-w-0 w-full max-w-full flex-1 overflow-auto overscroll-contain" onDragEnd={() => {
      useEditor.getState().startDrag(null); setPreviewByTrack({})
    }}>
      <div style={{ width: LABEL_W + timelineWidth, minWidth: '100%' }} className="relative">
        <div className="sticky top-0 z-20 flex h-9 border-b border-white/5 bg-cl-panel">
          <div className="sticky left-0 z-30 flex shrink-0 items-center border-r border-white/5 bg-cl-panel px-3 text-[10px] text-cl-muted" style={{ width: LABEL_W }}>Time · {formatTime(duration)}</div>
          <div className="relative h-full cursor-crosshair bg-[#212427]" style={{ width: timelineWidth }} onClick={scrub}>
            {ticks.map(t => <div key={t} className="absolute bottom-0 top-1 border-l border-white/10" style={{ left: t * zoom }}><span className="relative left-1 text-[10px] tabular-nums text-cl-muted">{formatTime(t)}</span></div>)}
          </div>
        </div>
        <div className="relative">
          <div aria-hidden className="pointer-events-none absolute bottom-0 top-0 z-10 w-[2px] bg-cl-orange shadow-[0_0_15px_#fe7526]" style={{ left: LABEL_W + playhead * zoom }}><span className="absolute -top-1 -left-2 h-6 w-4 rounded-md bg-cl-orange"/></div>
          {[...tracks].reverse().map(track => <TrackRow key={track.client_id} track={track} zoom={zoom} timelineWidth={timelineWidth}
            preview={previewByTrack[track.client_id] ?? null} onPreview={value => preview(track.client_id, value)}/>) }
          {dragged && <div className="flex h-[66px] border-b border-dashed border-[#8752dc] bg-[#7547b3]/10">
            <div className="sticky left-0 z-10 flex shrink-0 items-center gap-1 border-r border-[#7547b3]/40 bg-[#20192c] px-3 text-[11px] font-semibold text-[#c9a6ff]" style={{ width: LABEL_W }}><Plus size={16}/>New layer on drop</div>
            <div style={{ width: timelineWidth }} className="flex min-w-0 flex-1">
              <DropLane trackId={null} zoom={zoom} preview={previewByTrack.new ?? null} onPreview={value => preview(null, value)}>
                <div className="pointer-events-none absolute inset-1 rounded-lg border border-dashed border-[#945fe2]/80"/>
              </DropLane>
            </div>
          </div>}
          {!tracks.length && !dragged && <div className="grid h-28 place-items-center text-xs text-cl-muted">Drag media here to begin editing.</div>}
        </div>
      </div>
    </div>
  </section>
}

function TrackRow({ track, zoom, timelineWidth, preview, onPreview }: { track: Track; zoom: number; timelineWidth: number; preview: Preview | null; onPreview: (value: Preview | null) => void }) {
  const toggle = useEditor(s => s.toggleTrack)
  const remove = useEditor(s => s.removeTrack)
  const rename = useEditor(s => s.renameTrack)
  const selectTrack = useEditor(s => s.selectTrack)
  const active = useEditor(s => s.selectedTrackId)
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(track.name)
  const finish = () => { rename(track.client_id, name); setEditing(false) }
  return <div className="flex border-b border-white/5" style={{ height: ROW_H }}>
    <div className={`sticky left-0 z-10 flex shrink-0 items-center gap-1.5 border-r border-white/5 px-2.5 ${active === track.client_id ? 'bg-[#272131]' : 'bg-cl-panel'}`} style={{ width: LABEL_W }} onClick={() => selectTrack(track.client_id)}>
      <GripVertical size={13} className="shrink-0 text-cl-muted"/>
      <div className="mr-auto min-w-0 flex-1">
        {editing ? <input autoFocus aria-label="Layer name" maxLength={100} className="w-full rounded bg-[#30343a] px-1 text-[11px] outline-none focus:ring-1 focus:ring-[#b387fd]" value={name} onChange={e => setName(e.target.value)} onBlur={finish} onKeyDown={e => { if (e.key === 'Enter') finish(); if (e.key === 'Escape') { setName(track.name); setEditing(false) } }} onClick={e => e.stopPropagation()}/>
          : <button title="Double-click to rename layer" onDoubleClick={() => { setName(track.name); setEditing(true) }} className="block max-w-full truncate text-left text-[11px] font-bold text-[#d4c0ff]">{track.name}</button>}
        <span className="text-[9px] text-cl-muted">Mixed clips</span>
      </div>
      <div className="grid grid-cols-2 gap-1">
        <button title={track.hidden ? 'Show' : 'Hide'} aria-label={track.hidden ? 'Show layer' : 'Hide layer'} onClick={() => toggle(track.client_id, 'hidden')} className="rounded bg-cl-panel-2 p-1.5 hover:bg-[#353a3e]">{track.hidden ? <EyeOff size={12}/> : <Eye size={12}/>}</button>
        <button title={track.muted ? 'Unmute' : 'Mute'} aria-label={track.muted ? 'Unmute layer' : 'Mute layer'} onClick={() => toggle(track.client_id, 'muted')} className="rounded bg-cl-panel-2 p-1.5 hover:bg-[#353a3e]">{track.muted ? <VolumeX size={12}/> : <Volume2 size={12}/>}</button>
        <button title={track.locked ? 'Unlock' : 'Lock'} aria-label={track.locked ? 'Unlock layer' : 'Lock layer'} onClick={() => toggle(track.client_id, 'locked')} className="rounded bg-cl-panel-2 p-1.5 hover:bg-[#353a3e]">{track.locked ? <Lock size={12}/> : <Unlock size={12}/>}</button>
        <button title="Delete layer" aria-label="Delete layer" onClick={() => window.confirm(`Delete ${track.name} and all clips inside?`) && remove(track.client_id)} className="rounded bg-cl-panel-2 p-1.5 text-cl-muted hover:text-red-400"><Trash2 size={12}/></button>
      </div>
    </div>
    <div className="flex" style={{ width: timelineWidth }}>
      <DropLane trackId={track.client_id} zoom={zoom} preview={preview} onPreview={onPreview}>
        {track.clips.map(clip => <ClipBar key={clip.client_id} clip={clip} track={track} zoom={zoom}/>) }
      </DropLane>
    </div>
  </div>
}

function ClipBar({ clip, track, zoom }: { clip: Clip; track: Track; zoom: number }) {
  const selected = useEditor(s => s.selectedClipId === clip.client_id)
  const selectClip = useEditor(s => s.selectClip)
  const rename = useEditor(s => s.patchClip)
  const drag = useEditor(s => s.startDrag)
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(clip.name)
  const [trimDraft, setTrimDraft] = useState<{ edge: 'left' | 'right'; delta: number } | null>(null)
  const origin = useRef<{ x: number; edge: 'left' | 'right' } | null>(null)
  const trackColor = clip.type === 'audio' ? 'bg-[#174b5c] border-[#2d92ab]' : clip.type === 'text' ? 'bg-[#207e9c] border-[#39b2d7]' : clip.type === 'image' ? 'bg-[#46577f] border-[#6f89ce]' : 'bg-[#7b2fbe] border-[#b875e9]'
  const boundedDelta = () => {
    if (!trimDraft) return 0
    if (trimDraft.edge === 'left') return clamp(trimDraft.delta, clip.type === 'text' || clip.type === 'image' ? -clip.start : Math.max(-clip.start, -clip.source_offset), clip.duration - MIN_CLIP)
    const state = useEditor.getState()
    const known = clip.media_id ? state.mediaDurations[clip.media_id] : undefined
    const maxDuration = Math.min(MAX_TIME - clip.start, known && clip.type !== 'image' ? known - clip.source_offset : MAX_TIME)
    return clamp(trimDraft.delta, MIN_CLIP - clip.duration, maxDuration - clip.duration)
  }
  const delta = boundedDelta()
  const displayStart = clip.start + (trimDraft?.edge === 'left' ? delta : 0)
  const visualDuration = trimDraft?.edge === 'left' ? clip.duration - delta : trimDraft?.edge === 'right' ? clip.duration + delta : clip.duration
  const validTrim = canPlace(track, displayStart, visualDuration, clip.client_id)
  const commitName = () => { if (name.trim()) rename(clip.client_id, { name: name.trim().slice(0, 160) }); setEditing(false) }
  const beginTrim = (edge: 'left' | 'right') => (event: PointerEvent<HTMLSpanElement>) => {
    if (track.locked || event.button !== 0) return
    event.preventDefault(); event.stopPropagation()
    origin.current = { x: event.clientX, edge }
    setTrimDraft({ edge, delta: 0 })
    event.currentTarget.setPointerCapture(event.pointerId)
    selectClip(clip.client_id)
  }
  const moveTrim = (event: PointerEvent<HTMLSpanElement>) => {
    if (!origin.current) return
    setTrimDraft({ edge: origin.current.edge, delta: (event.clientX - origin.current.x) / zoom })
  }
  const endTrim = (event: PointerEvent<HTMLSpanElement>) => {
    if (!origin.current) return
    const { x, edge } = origin.current
    origin.current = null
    const difference = (event.clientX - x) / zoom
    useEditor.getState().trimClip(clip.client_id, edge, difference, zoom)
    setTrimDraft(null)
  }
  const startDrag = (event: DragEvent<HTMLDivElement>) => {
    if (track.locked || editing || origin.current) { event.preventDefault(); return }
    const rect = event.currentTarget.getBoundingClientRect()
    const item: DragItem = { kind: 'clip', clipId: clip.client_id, duration: clip.duration, offset: clamp((event.clientX - rect.left) / zoom, 0, clip.duration) }
    drag(item); event.dataTransfer.setData(DRAG_MIME, clip.client_id); event.dataTransfer.effectAllowed = 'move'
  }
  return <div role="button" tabIndex={track.locked ? -1 : 0} draggable={!track.locked && !editing && !trimDraft} onDragStart={startDrag} onDragEnd={() => drag(null)}
    onClick={e => { e.stopPropagation(); selectClip(clip.client_id); useEditor.getState().selectTrack(track.client_id) }}
    onKeyDown={e => { if (e.key === 'Enter') selectClip(clip.client_id); if (e.key === 'F2') { setName(clip.name); setEditing(true) } }}
    onDoubleClick={e => { e.stopPropagation(); if (!track.locked) { setName(clip.name); setEditing(true) } }}
    onContextMenu={e => { e.preventDefault(); if (!track.locked && window.confirm(`Remove ${clip.name}?`)) useEditor.getState().removeClip(clip.client_id) }}
    title={`${clip.name} · ${clip.start.toFixed(2)}s → ${(clip.start + clip.duration).toFixed(2)}s · drag to move, drag edges to trim`}
    style={{ left: displayStart * zoom, width: Math.max(visualDuration * zoom, 8) }}
    className={`group absolute inset-y-1 z-[2] flex min-w-0 items-center overflow-hidden rounded-lg border px-2 text-left text-[11px] ${trackColor} ${selected ? 'ring-2 ring-white/90 shadow-[0_0_15px_#a968f655]' : 'hover:brightness-125'} ${track.hidden ? 'opacity-30' : ''} ${track.locked ? 'cursor-not-allowed' : 'cursor-grab active:cursor-grabbing'} ${trimDraft && !validTrim ? 'ring-2 ring-red-400' : ''}`}>
    {!track.locked && <span role="separator" aria-label="Trim clip start" title="Drag to trim start" onPointerDown={beginTrim('left')} onPointerMove={moveTrim} onPointerUp={endTrim} onPointerCancel={() => { origin.current = null; setTrimDraft(null) }} draggable={false} className="absolute inset-y-0 left-0 z-10 w-[9px] cursor-ew-resize rounded-l-md bg-black/15 hover:bg-white/40"/>}
    <span className="ml-1 flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden">
      {clip.type === 'video' ? <Video size={13} className="shrink-0"/> : clip.type === 'audio' ? <Music2 size={13} className="shrink-0"/> : clip.type === 'text' ? <Type size={13} className="shrink-0"/> : <ImageIcon size={13} className="shrink-0"/>}
      {editing ? <input autoFocus className="min-w-0 flex-1 bg-black/35 px-1 outline-none" value={name} maxLength={160} onChange={e => setName(e.target.value)} onClick={e => e.stopPropagation()} onBlur={commitName} onKeyDown={e => { e.stopPropagation(); if (e.key === 'Enter') commitName(); if (e.key === 'Escape') { setName(clip.name); setEditing(false) } }}/>
        : <span className="truncate whitespace-nowrap">{clip.name}</span>}
    </span>
    {trimDraft && <span className="pointer-events-none z-10 ml-auto whitespace-nowrap rounded bg-black/70 px-1 text-[10px] tabular-nums">{visualDuration.toFixed(2)}s</span>}
    {!track.locked && <span role="separator" aria-label="Trim clip end" title="Drag to trim end / change duration" onPointerDown={beginTrim('right')} onPointerMove={moveTrim} onPointerUp={endTrim} onPointerCancel={() => { origin.current = null; setTrimDraft(null) }} draggable={false} className="absolute inset-y-0 right-0 z-10 w-[9px] cursor-ew-resize rounded-r-md bg-black/15 hover:bg-white/40"/>}
  </div>
}
