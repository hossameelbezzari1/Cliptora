import { useEffect, useLayoutEffect, useMemo, useRef, useState, type DragEvent, type MouseEvent, type PointerEvent, type ReactNode } from 'react'
import { Eye, EyeOff, Lock, Unlock, Volume2, VolumeX, Plus, Trash2, Music2, Type, Video, Image as ImageIcon, Minus, Maximize2, GripVertical, Crop, ArrowLeft, ArrowRight, ArrowUp, ArrowDown, MousePointer2, X } from 'lucide-react'
import { useEditor, canPlace, snapTime, MAX_LAYERS, MIN_CLIP, MAX_TIME, type DragItem } from '../../../stores/editorStore'
import { formatTime } from '../../../lib/api'
import { probeMediaDuration } from '../../../lib/media'
import type { Track, Clip } from '../../../types'
import { ContextMenu, type MenuState, type ContextAction } from '../../ui/ContextMenu'
import { effectiveTimelineEnd, repeatOccurrences, type Timing } from '../../../lib/repeat'
import './timeline-scroll.css'

const LABEL_W = 186
const ROW_H = 62
const MIN_ZOOM = 0.05
const MAX_ZOOM = 140
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

type DropProps = { backgroundColor?:string; insertion?: 'top'|'bottom'; trackId: string | null; zoom: number; preview: Preview | null; onPreview: (value: Preview | null) => void }

type SelectionBox = { x: number; y: number; width: number; height: number }
type MarqueeSession = {
  pointerId: number
  startX: number
  startY: number
  initialIds: string[]
  additive: boolean
  active: boolean
}


const clipKind = (dragging: DragItem, tracks: Track[]): Clip['type'] => {
  if (dragging.kind === 'text' || dragging.kind === 'shape') return 'text'
  if (dragging.kind === 'media') return useEditor.getState().media.find(m => m.id === dragging.mediaId)?.kind ?? 'video'
  return tracks.flatMap(t => t.clips).find(c => c.client_id === dragging.clipId)?.type ?? 'video'
}

function calculateDropPosition(clientX: number, left: number, dragging: DragItem, trackId: string | null, zoom: number) {
  const state = useEditor.getState()
  const duration = dragging.duration
  const raw = clamp((clientX - left) / zoom - (dragging.kind === 'clip' ? dragging.offset : 0), 0, MAX_TIME - duration)
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

function calculateDrop(event: DragEvent<HTMLDivElement>, dragging: DragItem, trackId: string | null, zoom: number) {
  return calculateDropPosition(event.clientX,event.currentTarget.getBoundingClientRect().left,dragging,trackId,zoom)
}

async function finishDrop(dragging: DragItem, drop: Preview, trackId: string | null, insertion: 'top'|'bottom' = 'bottom') {
  if (!drop.valid) return
  const store = useEditor.getState()
  if (dragging.kind === 'clip') store.moveClip(dragging.clipId, trackId, drop.start, insertion)
  if (dragging.kind === 'text') store.addTextClipAt(trackId, drop.start, insertion)
  if (dragging.kind === 'shape') store.addShapeClipAt(trackId, drop.start, dragging.shape, insertion)
  if (dragging.kind === 'media') {
    const media = store.media.find(m => m.id === dragging.mediaId)
    if (!media) return
    const { duration, measured } = await probeMediaDuration(media)
    if (measured) useEditor.getState().setMediaDuration(media.id, duration)
    const inserted = useEditor.getState().addMediaClipAt(media, duration, trackId, drop.start, insertion)
    if (!inserted) {
      const fallback=useEditor.getState()
      if (fallback.tracks.length < MAX_LAYERS && drop.start + duration <= MAX_TIME && fallback.addMediaClipAt(media,duration,null,drop.start,insertion)) return
      window.alert('Cannot drop here: not enough space, locked layers or timeline limit.')
    }
  }
}

function DropLane({ trackId, zoom, preview, onPreview, children, backgroundColor, insertion = 'bottom' }: DropProps & { children?: ReactNode }) {
  const setDragging = useEditor(s => s.startDrag)
  const onDragOver = (e: DragEvent<HTMLDivElement>) => {
    const dragging = useEditor.getState().dragging
    if (!dragging) return
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
    if (!dragging) return
    e.preventDefault()
    e.stopPropagation()
    const final = calculateDrop(e, dragging, trackId, zoom)
    onPreview(null)
    setDragging(null)
    void finishDrop(dragging, final, trackId, insertion)
  }
  return <div data-clip-lane data-track-id={trackId??`new-${insertion}`} style={{backgroundColor:backgroundColor||'#101214'}} className="relative my-0.5 min-w-0 flex-1 rounded" onDragOver={onDragOver} onDragLeave={e => {
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
  const selectedTrackId = useEditor(s => s.selectedTrackId)
  const dragged = useEditor(s => s.dragging)
  const selectedClipId = useEditor(s => s.selectedClipId)
  const previewTool = useEditor(s => s.previewTool)
  const selected = tracks.flatMap(t => t.clips.map(c => ({clip:c,track:t}))).find(item => item.clip.client_id === selectedClipId)
  const cropAllowed = !!selected && !selected.clip.locked && !selected.track.locked && (selected.clip.type === 'video' || selected.clip.type === 'image')
  const [pan, setPan] = useState({value:0,max:0,vertical:false,verticalValue:0,verticalMax:0})
  const [zoom, setZoom] = useState(23)
  const [timelineCeiling, setTimelineCeiling] = useState<number | null>(null)
  const [menu, setMenu] = useState<MenuState>(null)
  const [previewByTrack, setPreviewByTrack] = useState<Record<string, Preview | null>>({})
  const scroll = useRef<HTMLDivElement>(null)
  const timelineRoot = useRef<HTMLElement>(null)
  const manualZoom = useRef(false)
  const previousClipCount = useRef<number | null>(null)
  const previousLayerCount = useRef<number | null>(null)
  const pendingScrollTo = useRef<'top' | 'bottom' | null>(null)
  const scrubbing = useRef<number | null>(null)
  const [isScrubbing, setIsScrubbing] = useState(false)
  const [reorderingLayerId, setReorderingLayerId] = useState<string | null>(null)
  // Local UI selection: only the primary clip goes to Clip Settings. Selecting
  // several clips must never modify timeline records or trigger an autosave.
  const [selectedClipIds, setSelectedClipIds] = useState<string[]>([])
  const selectionIdsRef = useRef<string[]>([])
  const [selectionMode, setSelectionMode] = useState(false)
  const [selectionBox, setSelectionBox] = useState<SelectionBox | null>(null)
  const marqueeSession = useRef<MarqueeSession | null>(null)
  const selectionSurface = useRef<HTMLDivElement>(null)

  const commitSelection = (ids: string[]) => {
    const unique = [...new Set(ids)]
    if (selectionIdsRef.current.join('\u0001') === unique.join('\u0001')) return
    selectionIdsRef.current = unique
    setSelectedClipIds(unique)
    const editor = useEditor.getState()
    if (unique.length > 0) editor.selectClip(unique[unique.length - 1])
    else useEditor.setState({ selectedClipId: null })
  }
  const clickSelectClip = (id: string, additive: boolean) => {
    const prev = selectionIdsRef.current
    commitSelection(additive ? (prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]) : [id])
  }
  const getMarqueePosition = (clientX: number, clientY: number) => {
    const element = selectionSurface.current
    if (!element) return {x:0,y:0}
    const rect = element.getBoundingClientRect()
    return {x: clientX - rect.left, y: clientY - rect.top}
  }
  // Coordinates are relative to the actual rows, not the time ruler. This
  // makes the selection rectangle accurate after either axis has scrolled.
  const startMarquee = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || marqueeSession.current || useEditor.getState().dragging) return
    const target = event.target as HTMLElement
    const lane = target.closest('[data-clip-lane]')
    if (!lane || !lane.closest('[data-timeline-track-row]')) return
    if (target.closest('button,input,textarea,[role="separator"]')) return
    if (target.closest('[data-timeline-clip-id]')) return // clips still drag normally
    const {x,y} = getMarqueePosition(event.clientX, event.clientY)
    const additive = event.ctrlKey || event.metaKey || event.shiftKey
    marqueeSession.current = {pointerId:event.pointerId,startX:x,startY:y,initialIds:selectionIdsRef.current,additive,active:false}
    event.currentTarget.setPointerCapture(event.pointerId)
    timelineRoot.current?.focus({preventScroll:true})
  }
  const moveMarquee = (event: PointerEvent<HTMLDivElement>) => {
    const session = marqueeSession.current
    if (!session || session.pointerId !== event.pointerId) return
    const point = getMarqueePosition(event.clientX, event.clientY)
    const moved = Math.hypot(point.x-session.startX, point.y-session.startY)
    if (!session.active && moved < 4) return
    session.active = true
    event.preventDefault()
    const box:SelectionBox = {
      x:Math.min(session.startX,point.x), y:Math.min(session.startY,point.y),
      width:Math.abs(point.x-session.startX),height:Math.abs(point.y-session.startY)
    }
    setSelectionBox(box)
    const container = selectionSurface.current
    if (!container) return
    const outer = container.getBoundingClientRect()
    const hit: string[]=[]
    container.querySelectorAll<HTMLElement>('[data-timeline-clip-id]').forEach(el=>{
      const rect=el.getBoundingClientRect()
      const left=rect.left-outer.left, right=rect.right-outer.left
      const top=rect.top-outer.top, bottom=rect.bottom-outer.top
      if (left < box.x+box.width && right > box.x && top < box.y+box.height && bottom > box.y) {
        const id=el.dataset.timelineClipId
        if (id) hit.push(id)
      }
    })
    commitSelection(session.additive ? [...session.initialIds,...hit] : hit)
    // Keep the selection usable while crossing a crowded timeline.
    const pane=scroll.current
    if (pane) {
      const bounds=pane.getBoundingClientRect()
      const speed=12
      if (event.clientY > bounds.bottom - 28) pane.scrollTop += speed
      else if (event.clientY < bounds.top + 48) pane.scrollTop -= speed
      if (event.clientX > bounds.right - 24) pane.scrollLeft += speed
      else if (event.clientX < bounds.left + LABEL_W + 24) pane.scrollLeft -= speed
    }
  }
  const endMarquee = (event: PointerEvent<HTMLDivElement>) => {
    const session=marqueeSession.current
    if (!session || session.pointerId !== event.pointerId) return
    if (session.active) moveMarquee(event)
    else if (!session.additive) commitSelection([])
    marqueeSession.current=null
    setSelectionBox(null)
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }
  const cancelMarquee = () => {
    marqueeSession.current=null
    setSelectionBox(null)
  }
  const deleteSelectedClips = () => {
    const ids=selectionIdsRef.current
    const editor=useEditor.getState()
    // Skip locked clips/layers; the store also performs its own checks.
    const deletable=ids.filter(id=>editor.tracks.some(t=>!t.locked && t.clips.some(c=>c.client_id===id && !c.locked)))
    for(const id of deletable) useEditor.getState().removeClip(id)
    commitSelection(ids.filter(id=>!deletable.includes(id)))
  }
  useEffect(() => {
    const available=new Set(tracks.flatMap(t=>t.clips.map(c=>c.client_id)))
    const kept=selectionIdsRef.current.filter(id=>available.has(id))
    if (kept.length!==selectionIdsRef.current.length) commitSelection(kept)
  },[tracks])

  // New layers are above every existing layer, so reveal them immediately.
  useEffect(() => {
    const previous = previousLayerCount.current
    previousLayerCount.current = tracks.length
    if (previous !== null && tracks.length > previous && selectedTrackId) {
      // Also reveal layers inserted automatically by library imports or drag/drop.
      const target = tracks.find(t => t.client_id === selectedTrackId)
      if (target && !target.clips.length && target.position === tracks.length - 1) {
        requestAnimationFrame(() => { if (scroll.current) scroll.current.scrollTop = 0 })
      }
    }
  }, [tracks.length, selectedTrackId, tracks])
  // The explicit Add Layer controls must never leave the newly created layer off screen.
  useEffect(() => {
    const where = pendingScrollTo.current
    if (!where) return
    pendingScrollTo.current = null
    const frame = requestAnimationFrame(() => {
      const pane = scroll.current
      if (!pane) return
      pane.scrollTop = where === 'top' ? 0 : pane.scrollHeight
      syncPan()
    })
    return () => cancelAnimationFrame(frame)
  }, [tracks.length])
  function syncPan() {
    const pane=scroll.current
    if(!pane)return
    const value=Math.round(pane.scrollLeft)
    const max=Math.max(0,Math.ceil(pane.scrollWidth-pane.clientWidth))
    const verticalMax=Math.max(0,Math.ceil(pane.scrollHeight-pane.clientHeight))
    const vertical=verticalMax>2
    const verticalValue=Math.round(pane.scrollTop)
    setPan(old=>old.value===value&&old.max===max&&old.vertical===vertical&&old.verticalValue===verticalValue&&old.verticalMax===verticalMax?old:{value,max,vertical,verticalValue,verticalMax})
  }
  function shiftScroll(amountX=0,amountY=0){const pane=scroll.current;if(!pane)return;pane.scrollLeft+=amountX;pane.scrollTop+=amountY;syncPan()}

  const timelineClips=tracks.flatMap(t=>t.clips)
  const maxEnd = Math.max(30, playhead + 8, effectiveTimelineEnd(timelineClips))
  const repeatTimings = useMemo<Timing[]>(()=>tracks.flatMap(t=>t.clips.map(c=>({id:c.client_id,start:c.start,duration:c.duration}))),[tracks])
  const repeatProjectEnd = effectiveTimelineEnd(timelineClips)
  const duration = Math.min(MAX_TIME, Math.max(60, maxEnd + 16))
  const timelineWidth = duration * zoom

  // Without an actual height constraint flex-1/overflow-auto does not create a
  // scrollport: the whole Timeline grows with its rows and gets clipped by the
  // workspace. Bound its physical height to its allocated parent/viewport.
  useLayoutEffect(() => {
    const host = timelineRoot.current
    if (!host) return
    let frame = 0
    const update = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        const top = host.getBoundingClientRect().top
        const available = Math.max(164, Math.floor(window.innerHeight - top - 9))
        setTimelineCeiling(previous => previous === available ? previous : available)
      })
    }
    update()
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update)
    if (host.parentElement) observer?.observe(host.parentElement)
    window.addEventListener('resize', update)
    return () => {
      cancelAnimationFrame(frame)
      observer?.disconnect()
      window.removeEventListener('resize', update)
    }
  }, [])
  useEffect(()=>{
    const pane=scroll.current
    if(!pane)return
    const observer=new ResizeObserver(syncPan)
    observer.observe(pane)
    if(pane.firstElementChild)observer.observe(pane.firstElementChild)
    const frame=requestAnimationFrame(syncPan)
    return()=>{cancelAnimationFrame(frame);observer.disconnect()}
  },[zoom,tracks.length,timelineWidth])
  const candidateTicks = [0.5, 1, 2, 5, 10, 20, 30, 60, 120, 300, 600, 1200, 1800, 3600]
  const ticksEvery = candidateTicks.find(step => step * zoom >= 45 && duration / step <= 350) ?? 1200
  const ticks = useMemo(() => Array.from({ length: Math.floor(duration / ticksEvery) + 1 }, (_, i) => i * ticksEvery), [duration, ticksEvery])
  // A logarithmic control keeps short and long videos equally easy to zoom.
  const zoomSlider = 100 * Math.log(zoom / MIN_ZOOM) / Math.log(MAX_ZOOM / MIN_ZOOM)
  const sliderToZoom = (value: number) => MIN_ZOOM * Math.pow(MAX_ZOOM / MIN_ZOOM, value / 100)
  const preview = (trackId: string | null, value: Preview | null) => setPreviewByTrack(s => ({ ...s, [trackId ?? 'new']: value }))
  const pointerMoveClip = (dragItem: Extract<DragItem,{kind:'clip'}>, clientX:number, clientY:number, finish:boolean) => {
    const pane=scroll.current
    if (!pane) return
    let hovered=document.elementFromPoint(clientX,clientY) as HTMLElement | null
    let lane=hovered?.closest<HTMLElement>('[data-clip-lane]')
    // Labels are valid layer targets as well. Use the associated lane's time origin.
    if (!lane) lane=hovered?.closest<HTMLElement>('[data-timeline-track-row]')?.querySelector<HTMLElement>('[data-clip-lane]') ?? null
    const targetAttr=lane?.dataset.trackId
    if (!lane||!targetAttr) {
      if (finish) {useEditor.getState().startDrag(null);setPreviewByTrack({})}
      else setPreviewByTrack({})
      return
    }
    const trackId=targetAttr.startsWith('new-')?null:targetAttr
    const result=calculateDropPosition(clientX,lane.getBoundingClientRect().left,dragItem,trackId,zoom)
    if (finish) {
      useEditor.getState().startDrag(null)
      setPreviewByTrack({})
      if (result.valid) void finishDrop(dragItem,result,trackId,targetAttr==='new-top'?'top':'bottom')
    } else {
      if (useEditor.getState().dragging?.kind!=='clip') useEditor.getState().startDrag(dragItem)
      setPreviewByTrack({[trackId??targetAttr]:result})
      const rect=pane.getBoundingClientRect()
      if (clientX>rect.right-30) pane.scrollLeft+=12
      if (clientX<rect.left+LABEL_W+30) pane.scrollLeft-=12
      if (clientY>rect.bottom-28) pane.scrollTop+=12
      if (clientY<rect.top+62) pane.scrollTop-=12
    }
  }

  useEffect(() => { if (!dragged) setPreviewByTrack({}) }, [dragged])

  function zoomTo(next: number, anchorX?: number) {
    manualZoom.current = true
    const pane = scroll.current
    const value = clamp(Math.round(next * 1000) / 1000, MIN_ZOOM, MAX_ZOOM)
    if (!pane) { setZoom(value); return }
    const visualX = clamp(anchorX ?? Math.max(0, (pane.clientWidth - LABEL_W) / 2), 0, Math.max(0, pane.clientWidth - LABEL_W))
    const sourceTime = (pane.scrollLeft + visualX) / zoom
    setZoom(value)
    requestAnimationFrame(() => { if (scroll.current) {scroll.current.scrollLeft = Math.max(0, sourceTime * value - visualX);syncPan()} })
  }
  function fit(userInitiated = true) {
    if (userInitiated) manualZoom.current = true
    const pane = scroll.current
    if (!pane) return
    const content = Math.max(60, effectiveTimelineEnd(tracks.flatMap(t=>t.clips)) + 2)
    setZoom(clamp((pane.clientWidth - LABEL_W - 16) / content, MIN_ZOOM, MAX_ZOOM))
    pane.scrollLeft = 0
    requestAnimationFrame(syncPan)
  }
  // A time jump (or dropping a clip at the cursor) must remain visible inside the timeline,
  // without resizing the editor's other panels or changing browser zoom.
  useEffect(()=>{
    const pane=scroll.current
    if(!pane)return
    const visible=Math.max(1,pane.clientWidth-LABEL_W)
    const x=playhead*zoom
    if(x<pane.scrollLeft+5||x>pane.scrollLeft+visible-12){
      pane.scrollLeft=Math.max(0,x-visible*.35)
      syncPan()
    }
  },[playhead,zoom])
  useEffect(()=>{
    const pane=scroll.current
    if(!pane)return
    const wheel = (event:globalThis.WheelEvent) => {
      if (event.ctrlKey || event.metaKey) return // separate Ctrl+wheel zoom handler
      // Explicitly update the scrollport. Relying on native wheel alone can
      // accidentally scroll the editor page instead of its Timeline panel.
      const factor = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? pane.clientHeight : 1
      const deltaX = event.deltaX * factor
      const deltaY = event.deltaY * factor
      const onRuler = event.target instanceof Element && !!event.target.closest('[data-timeline-ruler]')
      const horizontal = event.shiftKey || onRuler
      const canScrollX = pane.scrollWidth > pane.clientWidth + 1
      const canScrollY = pane.scrollHeight > pane.clientHeight + 1
      if (!canScrollX && !canScrollY) return
      event.preventDefault()
      if (horizontal) {
        if (canScrollX) pane.scrollLeft += deltaX + deltaY
      } else {
        if (canScrollX && deltaX) pane.scrollLeft += deltaX
        if (canScrollY && deltaY) pane.scrollTop += deltaY
      }
      syncPan()
    }
    pane.addEventListener('wheel',wheel,{passive:false})
    return()=>pane.removeEventListener('wheel',wheel)
  },[])
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
  const addLayerFromToolbar = (insertion: 'top' | 'bottom' = 'top') => {
    if (useEditor.getState().tracks.length >= MAX_LAYERS) return
    pendingScrollTo.current = insertion
    addTrack(insertion)
  }
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
  // Pointer capture on the RULER means the orange marker follows the mouse in real time,
  // even if the pointer leaves the ruler while the button stays down.
  const scrubAt = (element: HTMLDivElement, clientX: number, followEdges: boolean) => {
    const pane = scroll.current
    if (pane && followEdges) {
      const rect = pane.getBoundingClientRect()
      const left = rect.left + LABEL_W + 16
      const right = rect.right - 22
      if (clientX < left) pane.scrollLeft = Math.max(0, pane.scrollLeft - Math.min(34, left - clientX + 8))
      else if (clientX > right) pane.scrollLeft += Math.min(34, clientX - right + 8)
    }
    const rect = element.getBoundingClientRect()
    setPlayhead(px(clamp((clientX - rect.left) / zoom, 0, MAX_TIME)))
  }
  const beginScrub = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    useEditor.getState().setPlaying(false)
    scrubbing.current = event.pointerId
    setIsScrubbing(true)
    event.currentTarget.setPointerCapture(event.pointerId)
    scrubAt(event.currentTarget, event.clientX, false)
  }
  const moveScrub = (event: PointerEvent<HTMLDivElement>) => {
    if (scrubbing.current !== event.pointerId) return
    event.preventDefault()
    scrubAt(event.currentTarget, event.clientX, true)
  }
  const endScrub = (event: PointerEvent<HTMLDivElement>) => {
    if (scrubbing.current !== event.pointerId) return
    scrubAt(event.currentTarget, event.clientX, false)
    scrubbing.current = null
    setIsScrubbing(false)
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }
  const cancelScrub = () => {scrubbing.current = null;setIsScrubbing(false)}
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement
      if (target.closest('input,textarea,select,[contenteditable="true"]')) return
      const timelineFocused=!!timelineRoot.current?.contains(document.activeElement)
      if (timelineFocused && (event.ctrlKey || event.metaKey) && event.key.toLowerCase()==='a') {
        event.preventDefault()
        commitSelection(useEditor.getState().tracks.flatMap(track=>track.clips.map(clip=>clip.client_id)))
      } else if (event.key==='Escape' && (selectionIdsRef.current.length || marqueeSession.current)) {
        event.preventDefault()
        commitSelection([])
        cancelMarquee()
      } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault()
        if (event.shiftKey) useEditor.getState().redo()
        else useEditor.getState().undo()
      } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') {
        event.preventDefault(); useEditor.getState().redo()
      } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'x') {
        const selected = useEditor.getState().selectedClipId
        if (selected) {event.preventDefault(); useEditor.getState().cutClip(selected)}
      } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'v') {
        if (useEditor.getState().clipboard) {event.preventDefault(); useEditor.getState().pasteClip()}
      } else if (event.key === 'Delete' || event.key === 'Backspace') {
        const ids=selectionIdsRef.current
        if (ids.length) {
          event.preventDefault()
          deleteSelectedClips()
        } else {
          const selected = useEditor.getState().selectedClipId
          if (selected) { event.preventDefault(); useEditor.getState().removeClip(selected) }
        }
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  return <><section ref={timelineRoot} tabIndex={-1} data-timeline-panel className="cliptora-timeline-panel relative flex h-full min-h-0 min-w-0 w-full max-w-full flex-col overflow-hidden rounded-lg bg-cl-panel [contain:layout]" style={{ maxHeight: timelineCeiling === null ? '62dvh' : `${timelineCeiling}px` }}>
    <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-white/5 px-3 py-2">
      <span className="mr-2 text-xs font-bold tracking-wide">TIMELINE</span>
      <button type="button" aria-pressed={selectionMode} title="Toggle selection mode (click clips or drag empty space to select multiple)" onClick={()=>setSelectionMode(value=>!value)} className={`flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs ${selectionMode?'border-[#a879f3] bg-[#6236a0] text-white':'border-white/10 bg-cl-panel-2 hover:bg-[#35383d]'}`}><MousePointer2 size={14}/>Select</button>
      {selectedClipIds.length>0 && <span className="flex items-center gap-1 rounded-md bg-[#392552] px-2 py-1 text-[11px] text-[#d8baff]" aria-live="polite">{selectedClipIds.length} selected <button type="button" aria-label="Delete selected clips" title="Delete selected unlocked clips" onClick={deleteSelectedClips} className="rounded p-0.5 hover:bg-red-700/40"><Trash2 size={12}/></button><button type="button" aria-label="Clear clip selection" title="Clear selection (Esc)" onClick={()=>commitSelection([])} className="rounded p-0.5 hover:bg-white/15"><X size={12}/></button></span>}

      <button title="Add a layer at the TOP of the stack" aria-label="Add top layer" disabled={tracks.length >= MAX_LAYERS} onClick={()=>addLayerFromToolbar('top')} className="flex items-center gap-1 rounded-lg bg-cl-panel-2 px-2.5 py-1.5 text-xs hover:bg-[#35383d] disabled:opacity-40"><Plus size={15}/>Layer <ArrowUp size={12}/></button>
      <button title="Add a layer at the BOTTOM of the stack" aria-label="Add bottom layer" disabled={tracks.length >= MAX_LAYERS} onClick={()=>addLayerFromToolbar('bottom')} className="flex items-center gap-1 rounded-lg bg-cl-panel-2 px-2.5 py-1.5 text-xs hover:bg-[#35383d] disabled:opacity-40"><Plus size={15}/>Layer <ArrowDown size={12}/></button>
      <button aria-label="Crop selected video or image" aria-pressed={previewTool==='crop'} title="Crop selected image/video in Preview (drag green crop edges)" disabled={!cropAllowed} onClick={()=>{const store=useEditor.getState();store.setPreviewTool(previewTool==='crop'?'select':'crop');if(selected&&previewTool!=='crop')store.setPlayhead(selected.clip.start+Math.min(.02,selected.clip.duration/4))}} className={`flex items-center gap-1 rounded-md px-2 py-1.5 text-xs ${previewTool==='crop'?'bg-[#55377b] text-white':'bg-cl-panel-2 text-cl-muted hover:text-white'}`}><Crop size={15}/>Crop</button>
      <span className="hidden text-[10px] text-cl-muted 2xl:inline">Drag empty space = select clips · Ctrl+click = multi-select · Esc = clear</span>
      <div className="ml-auto flex items-center gap-2">
        <button title="Zoom out" aria-label="Zoom out" onClick={() => zoomTo(zoom / 1.25)} className="rounded-lg p-1.5 hover:bg-cl-panel-2"><Minus size={16}/></button>
        <input aria-label="Timeline zoom" type="range" min={0} max={100} step={1} value={zoomSlider} onChange={e => zoomTo(sliderToZoom(Number(e.target.value)))} className="w-16 accent-[#a87cf4] sm:w-24"/>
        <button title="Zoom in" aria-label="Zoom in" onClick={() => zoomTo(zoom * 1.25)} className="rounded-lg p-1.5 hover:bg-cl-panel-2"><Plus size={16}/></button>
        <button title="Fit timeline" aria-label="Fit timeline" onClick={() => fit()} className="rounded-lg p-1.5 hover:bg-cl-panel-2"><Maximize2 size={15}/></button>
        <span className="w-16 text-right text-[10px] tabular-nums text-cl-muted">{zoom.toFixed(zoom < 10 ? 2 : 1)}px/s</span>
      </div>
    </div>
    <div data-timeline-scroll ref={scroll} className="cliptora-timeline-scroll relative min-h-0 min-w-0 w-full max-w-full flex-1 overscroll-contain" style={{ flex: '1 1 0px', overflowX: 'scroll', overflowY: 'scroll' }} onScroll={syncPan} onDragEnd={() => {
      useEditor.getState().startDrag(null); setPreviewByTrack({})
    }}>
      <div style={{ width: LABEL_W + timelineWidth, minWidth: '100%' }} className="relative">
        <div className="sticky top-0 z-20 flex h-9 border-b border-white/5 bg-cl-panel">
          <div className="sticky left-0 z-30 flex shrink-0 items-center border-r border-white/5 bg-cl-panel px-3 text-[10px] text-cl-muted" style={{ width: LABEL_W }}>Time · {formatTime(duration)}</div>
          <div data-timeline-ruler className={`relative h-full touch-none select-none bg-[#212427] ${isScrubbing ? 'cursor-grabbing' : 'cursor-crosshair'}`} style={{ width: timelineWidth }}
            onPointerDown={beginScrub} onPointerMove={moveScrub} onPointerUp={endScrub} onPointerCancel={cancelScrub} onLostPointerCapture={cancelScrub}
            title="Click or drag the orange playhead to scrub Preview in real time">
            {ticks.map(t => <div key={t} className="pointer-events-none absolute bottom-0 top-1 border-l border-white/10" style={{ left: t * zoom }}><span className="relative left-1 text-[10px] tabular-nums text-cl-muted">{formatTime(t)}</span></div>)}
            <div aria-label="Drag playhead" aria-hidden="true" className="pointer-events-none absolute top-0 z-30 flex -translate-x-1/2 flex-col items-center" style={{ left: playhead * zoom }}>
              <div className="h-[23px] w-[20px] rounded-b-[7px] rounded-t-[3px] bg-cl-orange shadow-[0_0_10px_#fe752699]"/>
              <div className="h-[13px] w-[2px] bg-cl-orange"/>
              {isScrubbing && <span className="absolute top-[22px] left-[18px] z-40 whitespace-nowrap rounded bg-[#17181e] px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-[#ffc29e] shadow-lg">{formatTime(playhead)}</span>}
            </div>
          </div>
        </div>
        <div ref={selectionSurface} data-timeline-selection-surface className="relative touch-pan-y" onPointerDown={startMarquee} onPointerMove={moveMarquee} onPointerUp={endMarquee} onPointerCancel={cancelMarquee} onLostPointerCapture={cancelMarquee}>
          {selectionBox && <div aria-hidden="true" data-marquee-selection className="pointer-events-none absolute z-40 border border-[#80b7ff] bg-[#4b92ef]/25 shadow-[0_0_0_1px_#4789c733]" style={{left:selectionBox.x,top:selectionBox.y,width:selectionBox.width,height:selectionBox.height}}/>}
          <div aria-hidden className="pointer-events-none absolute bottom-0 top-0 z-20 w-[2px] bg-cl-orange shadow-[0_0_15px_#fe7526]" style={{ left: LABEL_W + playhead * zoom }}/>

          {/* Real top drop zone: visible ABOVE the first layer, not on the ruler. */}
          {dragged && tracks.length < MAX_LAYERS && <div className="flex h-[52px] border-b border-dashed border-[#8752dc] bg-[#7547b3]/20">
            <div className="sticky left-0 z-30 flex shrink-0 items-center gap-1 border-r border-[#7547b3]/40 bg-[#20192c] px-3 text-[11px] font-semibold text-[#c9a6ff]" style={{ width: LABEL_W }}><Plus size={16}/>New top layer</div>
            <div style={{ width: timelineWidth }} className="flex min-w-0 flex-1">
              <DropLane insertion="top" trackId={null} zoom={zoom} preview={previewByTrack['new-top'] ?? null} onPreview={value => preview('new-top', value)}>
                <div className="pointer-events-none absolute inset-1 rounded-lg border border-dashed border-[#945fe2]/80"/>
              </DropLane>
            </div>
          </div>}
          {[...tracks].reverse().map(track => <TrackRow key={track.client_id} track={track} selectedClipIds={selectedClipIds} onClipSelect={clickSelectClip} selectionMode={selectionMode} layerDraggingId={reorderingLayerId} onLayerDragStart={setReorderingLayerId} onLayerDragEnd={() => setReorderingLayerId(null)} zoom={zoom} timelineWidth={timelineWidth} repeatTimings={repeatTimings} repeatProjectEnd={repeatProjectEnd} onPointerDrag={pointerMoveClip}
            preview={previewByTrack[track.client_id] ?? null} onPreview={value => preview(track.client_id, value)} onMenu={setMenu}/>) }
          {tracks.length < MAX_LAYERS && <div className={`flex border-b border-dashed border-[#8752dc]/60 ${dragged ? 'h-[62px] bg-[#7547b3]/20' : 'h-[48px] bg-[#1d1b23]'}`}>
            <button type="button" aria-label="Add layer below all layers" title="Add layer at the bottom" onClick={()=>addLayerFromToolbar('bottom')} className="sticky left-0 z-10 flex shrink-0 items-center gap-1 border-r border-[#7547b3]/40 bg-[#20192c] px-3 text-[11px] font-semibold text-[#c9a6ff] hover:bg-[#322543]" style={{ width: LABEL_W }}><Plus size={16}/>Layer below <ArrowDown size={13}/></button>
            <div style={{ width: timelineWidth }} className="flex min-w-0 flex-1">
              {dragged ? <DropLane insertion="bottom" trackId={null} zoom={zoom} preview={previewByTrack['new-bottom'] ?? null} onPreview={value => preview('new-bottom', value)}>
                <div className="pointer-events-none absolute inset-1 rounded-lg border border-dashed border-[#945fe2]/80"/>
              </DropLane> : <div className="flex flex-1 items-center px-3 text-[10px] text-cl-muted">Drag a clip here to create a layer below</div>}
            </div>
          </div>}
          {!tracks.length && !dragged && <div className="grid h-28 place-items-center text-xs text-cl-muted">Drag media here to begin editing.</div>}
        </div>
      </div>
    </div>
    <div className="flex h-8 shrink-0 items-center gap-2 border-t border-white/10 bg-[#1c1e21] px-2.5" aria-label="Timeline scrolling controls">
      <button aria-label="Pan timeline left" title="Pan left" disabled={!pan.max||!pan.value} onClick={()=>shiftScroll(-180)} className="rounded p-1 text-cl-muted hover:bg-white/10"><ArrowLeft size={13}/></button>
      <input aria-label="Timeline horizontal scroll" title="Pan timeline horizontally, independently of zoom" type="range" className="min-w-0 flex-1 accent-[#8952ce]" min={0} max={Math.max(1,pan.max)} step={1} disabled={!pan.max} value={Math.min(pan.value,Math.max(1,pan.max))} onChange={e=>{if(scroll.current){scroll.current.scrollLeft=Number(e.target.value);syncPan()}}}/>
      <button aria-label="Pan timeline right" title="Pan right" disabled={!pan.max||pan.value>=pan.max} onClick={()=>shiftScroll(180)} className="rounded p-1 text-cl-muted hover:bg-white/10"><ArrowRight size={13}/></button>
      <span className="hidden whitespace-nowrap text-[10px] text-cl-muted lg:block">{pan.verticalMax > 0 ? 'Wheel: layers' : 'All layers visible'} · Shift+wheel: time</span>
      <div className="h-4 w-px bg-white/10"/>
      <button aria-label="Scroll layers up" title="Scroll layers up" disabled={!pan.verticalMax || pan.verticalValue <= 0} onClick={()=>shiftScroll(0,-120)} className="rounded p-1 text-cl-muted hover:bg-white/10"><ArrowUp size={14}/></button>
      <input aria-label="Timeline vertical scroll" title="Scroll through layers" type="range" className="w-12 accent-[#8952ce] sm:w-16" min={0} max={Math.max(1,pan.verticalMax)} step={1} disabled={!pan.verticalMax} value={Math.min(pan.verticalValue,Math.max(1,pan.verticalMax))} onChange={e=>{if(scroll.current){scroll.current.scrollTop=Number(e.target.value);syncPan()}}}/>
      <button aria-label="Scroll layers down" title="Scroll layers down" disabled={!pan.verticalMax || pan.verticalValue >= pan.verticalMax} onClick={()=>shiftScroll(0,120)} className="rounded p-1 text-cl-muted hover:bg-white/10"><ArrowDown size={14}/></button>
    </div>
  </section><ContextMenu menu={menu} onClose={()=>setMenu(null)}/></>
}

type PointerClipDrag = (item:Extract<DragItem,{kind:'clip'}>,x:number,y:number,finish:boolean)=>void
function TrackRow({ track, zoom, timelineWidth, preview, onPreview, onMenu, onPointerDrag, repeatTimings, repeatProjectEnd, layerDraggingId, onLayerDragStart, onLayerDragEnd, selectedClipIds, onClipSelect, selectionMode }: { track: Track; zoom: number; timelineWidth: number; preview: Preview | null; onPreview: (value: Preview | null) => void; onMenu: (menu:MenuState)=>void; onPointerDrag:PointerClipDrag; repeatTimings:Timing[];repeatProjectEnd:number; layerDraggingId:string|null;onLayerDragStart:(id:string)=>void;onLayerDragEnd:()=>void;selectedClipIds:string[];onClipSelect:(id:string,additive:boolean)=>void;selectionMode:boolean }) {
  const toggle = useEditor(s => s.toggleTrack)
  const remove = useEditor(s => s.removeTrack)
  const rename = useEditor(s => s.renameTrack)
  const selectTrack = useEditor(s => s.selectTrack)
  const moveTrack = useEditor(s => s.moveTrack)
  const reorderTrack = useEditor(s => s.reorderTrack)
  const active = useEditor(s => s.selectedTrackId)
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(track.name)
  const finish = () => { rename(track.client_id, name); setEditing(false) }
  const showMenu=(event:MouseEvent<HTMLElement>)=>{
    event.preventDefault(); event.stopPropagation()
    selectTrack(track.client_id)
    const actions:ContextAction[]=[
      {label:'Rename layer',onClick:()=>{setName(track.name);setEditing(true)}},
      {label:'Duplicate layer',onClick:()=>useEditor.getState().duplicateTrack(track.client_id)},
      {label:'Move layer up',onClick:()=>moveTrack(track.client_id,'up'),disabled:track.locked||useEditor.getState().tracks.at(-1)?.client_id===track.client_id},
      {label:'Move layer down',onClick:()=>moveTrack(track.client_id,'down'),disabled:track.locked||useEditor.getState().tracks[0]?.client_id===track.client_id},
      {label:track.muted?'Unmute layer':'Mute layer',onClick:()=>toggle(track.client_id,'muted')},
      {label:track.hidden?'Show layer':'Hide layer',onClick:()=>toggle(track.client_id,'hidden')},
      {label:track.locked?'Unlock layer':'Lock layer',onClick:()=>toggle(track.client_id,'locked')},
      {label:'',divider:true},
      {label:'',content:<label className="flex items-center justify-between gap-2 text-xs">Background color <input aria-label="Layer background color" type="color" defaultValue={track.background_color||'#101214'} onChange={e=>useEditor.getState().patchTrack(track.client_id,{background_color:e.target.value})}/></label>},
      {label:'',divider:true},
      {label:'Remove layer and its clips',danger:true,onClick:()=>window.confirm(`Delete ${track.name} and its clips?`)&&remove(track.client_id)}
    ]
    onMenu({x:event.clientX,y:event.clientY,actions})
  }
  const [layerDropAbove, setLayerDropAbove] = useState<boolean | null>(null)
  const handleLayerDragOver = (event: DragEvent<HTMLDivElement>) => {
    if (!layerDraggingId || layerDraggingId === track.client_id) return
    event.preventDefault()
    event.stopPropagation()
    event.dataTransfer.dropEffect = 'move'
    setLayerDropAbove(event.clientY < event.currentTarget.getBoundingClientRect().top + event.currentTarget.clientHeight / 2)
  }
  const handleLayerDrop = (event: DragEvent<HTMLDivElement>) => {
    if (!layerDraggingId) return
    event.preventDefault()
    event.stopPropagation()
    if (layerDraggingId !== track.client_id) reorderTrack(layerDraggingId, track.client_id, layerDropAbove ?? true)
    setLayerDropAbove(null)
    onLayerDragEnd()
  }
  return <div data-timeline-track-row className="flex border-b border-white/5" style={{ height: ROW_H }}>
    <div onContextMenu={showMenu} onDragOver={handleLayerDragOver} onDrop={handleLayerDrop} onDragLeave={()=>setLayerDropAbove(null)} className={`sticky left-0 z-10 flex shrink-0 items-center gap-1.5 border-r border-white/5 px-2.5 ${layerDropAbove !== null ? (layerDropAbove ? "border-t-2 border-t-[#b58cff]" : "border-b-2 border-b-[#b58cff]") : ""} ${active === track.client_id ? 'bg-[#272131]' : 'bg-cl-panel'}`} style={{ width: LABEL_W }} onClick={() => selectTrack(track.client_id)}>
      <span draggable={!track.locked} role="button" tabIndex={0} title="Drag to reorder layer (or use right-click → Move layer up/down)" aria-label={`Drag to reorder ${track.name}`} onDragStart={event=>{event.stopPropagation();event.dataTransfer.setData('application/x-cliptora-layer',track.client_id);event.dataTransfer.effectAllowed='move';onLayerDragStart(track.client_id)}} onDragEnd={()=>{setLayerDropAbove(null);onLayerDragEnd()}} className={`shrink-0 touch-none ${track.locked ? 'cursor-not-allowed opacity-40' : 'cursor-grab active:cursor-grabbing'}`}><GripVertical size={13} className="text-cl-muted"/></span>
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
      <DropLane trackId={track.client_id} backgroundColor={track.background_color} zoom={zoom} preview={preview} onPreview={onPreview}>
        {track.clips.map(clip => <ClipBar key={clip.client_id} clip={clip} track={track} zoom={zoom} onMenu={onMenu} onPointerDrag={onPointerDrag} multiSelected={selectedClipIds.includes(clip.client_id)} hasMultiSelection={selectedClipIds.length>0} onClipSelect={onClipSelect} selectionMode={selectionMode}/>) }
        {track.clips.flatMap(clip => clip.props?.repeat?.mode && clip.props.repeat.mode!=='none' ?
          repeatOccurrences({id:clip.client_id,start:clip.start,duration:clip.duration},clip.props.repeat,repeatTimings,repeatProjectEnd,300)
            .filter(item=>Math.abs(item.start-clip.start)>0.01).map(item=><button key={item.id} type="button" onClick={event=>{event.stopPropagation();useEditor.getState().selectClip(clip.client_id);useEditor.getState().setPlayhead(item.start)}} title={`${clip.name} · repeated at ${formatTime(item.start)}`} aria-label={`Repeated occurrence ${clip.name} at ${formatTime(item.start)}`} className="pointer-events-auto absolute inset-y-2 z-[1] truncate rounded-md border border-dashed border-[#b48aff]/70 bg-[#6e478d]/35 px-2 text-left text-[10px] text-[#dfc4ff] hover:bg-[#6e478d]/65" style={{left:item.start*zoom,width:Math.max(8,item.duration*zoom)}}><TimelineClipVisual clip={clip} width={Math.max(8,item.duration*zoom)}/><span className="pointer-events-none absolute right-1 top-1 z-10 rounded bg-[#59327d]/95 px-1 py-0.5 text-[9px] font-bold text-white">↻</span></button>) : [])}
      </DropLane>
    </div>
  </div>
}


/** Resolve existing Media Library URLs without relying on a particular optional thumbnail field. */
function timelineMediaUrl(candidate: unknown): string | null {
  if (typeof candidate === 'string') {
    const url = candidate.trim()
    if (!url || /^(?:javascript|file):/i.test(url)) return null
    if (/^(?:https?:|blob:|data:image\/|data:video\/|data:audio\/)/i.test(url)) return url
    if (url.startsWith('/')) return url
    // Relative media endpoints are served by the existing Vite/FastAPI proxy.
    if (/^(?:api\/|media\/|uploads\/|storage\/|assets\/)/.test(url)) return `/${url}`
    return null
  }
  if (candidate && typeof candidate === 'object') {
    const obj = candidate as Record<string, unknown>
    return timelineMediaUrl(obj.url ?? obj.src ?? obj.href)
  }
  return null
}

function timelineMediaSources(clip: Clip, media: unknown) {
  const asset = media && typeof media === 'object' ? media as Record<string, unknown> : {}
  const props = clip.props as Record<string, unknown> | undefined
  const pick = (...candidates: unknown[]) => {
    for (const candidate of candidates) {
      const url = timelineMediaUrl(candidate)
      if (url) return url
    }
    return null
  }
  return {
    poster: pick(asset.thumbnail_url, asset.thumbnailUrl, asset.poster_url, asset.poster,
      asset.preview_url, asset.previewUrl, props?.thumbnail_url, props?.poster_url),
    source: pick(asset.url, asset.file_url, asset.fileUrl, asset.media_url,
      asset.playback_url, asset.stream_url, asset.download_url, asset.public_url,
      asset.src, asset.path, props?.source_url, props?.media_url),
  }
}

// Cache poster extraction across timeline instances so repeated clips do not decode
// their videos independently on each React render.
const timelinePosterCache = new Map<string, Promise<string | null>>()
function extractTimelineVideoPoster(src: string, offset: number): Promise<string | null> {
  const seek = Math.max(0, Math.round(offset * 2) / 2)
  const key = `${src}#${seek}`
  const cached = timelinePosterCache.get(key)
  if (cached) return cached
  const work = new Promise<string | null>(resolve => {
    const video = document.createElement('video')
    video.muted = true
    video.preload = 'auto'
    video.playsInline = true
    video.crossOrigin = 'anonymous'
    let completed = false
    const finish = (value: string | null) => {
      if (completed) return
      completed = true
      window.clearTimeout(timeout)
      video.pause()
      video.removeAttribute('src')
      video.load()
      resolve(value)
    }
    const capture = () => {
      if (video.videoWidth <= 0 || video.videoHeight <= 0) return finish(null)
      try {
        const canvas = document.createElement('canvas')
        const scale = Math.min(1, 240 / video.videoWidth, 140 / video.videoHeight)
        canvas.width = Math.max(1, Math.round(video.videoWidth * scale))
        canvas.height = Math.max(1, Math.round(video.videoHeight * scale))
        canvas.getContext('2d')?.drawImage(video, 0, 0, canvas.width, canvas.height)
        finish(canvas.toDataURL('image/webp', .72))
      } catch { finish(null) } // e.g. remote media without CORS support
    }
    const timeout = window.setTimeout(() => finish(null), 6000)
    video.onerror = () => finish(null)
    video.onseeked = capture
    video.onloadeddata = () => { if (video.currentTime === 0) capture() }
    video.onloadedmetadata = () => {
      const duration = Number.isFinite(video.duration) ? video.duration : 0
      const target = Math.min(seek || .12, Math.max(0, duration - .06))
      if (target <= .02 && video.readyState >= 2) capture()
      else {
        try { video.currentTime = target } catch { finish(null) }
      }
    }
    video.src = src
    video.load()
  })
  // Cache positive results. A failed poster can be retried after media finishes uploading.
  timelinePosterCache.set(key, work)
  void work.then(image => { if (!image) timelinePosterCache.delete(key) })
  if (timelinePosterCache.size > 160) timelinePosterCache.delete(timelinePosterCache.keys().next().value!)
  return work
}

function useTimelineVideoPoster(src: string | null, offset: number, enabled: boolean) {
  const [poster, setPoster] = useState<string | null>(null)
  useEffect(() => {
    let cancelled = false
    setPoster(null)
    if (enabled && src) void extractTimelineVideoPoster(src, offset).then(url => { if (!cancelled) setPoster(url) })
    return () => { cancelled = true }
  }, [src, offset, enabled])
  return poster
}

const timelineShapePreview = (shape: string, color: string) => {
  const common = {fill:color, stroke:'rgba(255,255,255,.65)', strokeWidth:1.25}
  switch (shape.toLowerCase()) {
    case 'rectangle': return <rect x="12" y="17" width="76" height="46" rx="5" {...common}/>
    case 'square': return <rect x="28" y="9" width="46" height="46" rx="4" {...common}/>
    case 'circle': return <circle cx="50" cy="38" r="30" {...common}/>
    case 'ellipse': return <ellipse cx="50" cy="38" rx="43" ry="24" {...common}/>
    case 'triangle': return <path d="M50 5 L94 67 L6 67 Z" {...common}/>
    case 'polygon': return <polygon points="27,10 71,10 95,38 71,66 27,66 5,38" {...common}/>
    case 'star': return <polygon points="50,4 62,29 90,30 70,49 77,72 50,57 23,72 30,49 10,30 38,29" {...common}/>
    case 'arrow': return <path d="M8 38 H85 M64 17 L87 38 L64 59" fill="none" stroke={color} strokeWidth="7" strokeLinecap="round" strokeLinejoin="round"/>
    case 'line': return <path d="M7 38 H93" fill="none" stroke={color} strokeWidth="7" strokeLinecap="round"/>
    default: return <rect x="15" y="15" width="70" height="45" rx="9" {...common}/>
  }
}

/** All clip kinds use one noninteractive visual so dragging, trim and marquee remain intact. */
function TimelineClipVisual({clip, width}: {clip: Clip; width: number}) {
  const media = useEditor(s => clip.media_id == null ? undefined : s.media.find(a => String(a.id) === String(clip.media_id)))
  const sources = useMemo(() => timelineMediaSources(clip, media), [clip, media])
  const [imageFailed, setImageFailed] = useState(false)
  const artRef = useRef<HTMLDivElement>(null)
  const [inView, setInView] = useState(false)
  useEffect(() => {
    const element = artRef.current
    if (!element) return
    if (typeof IntersectionObserver === 'undefined') { setInView(true); return }
    const observer = new IntersectionObserver(entries => {
      setInView(entries.some(entry => entry.isIntersecting))
    }, {root: element.closest('[data-timeline-scroll]'), rootMargin:'180px 250px'})
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  const frame = useTimelineVideoPoster(sources.poster ? null : sources.source, clip.source_offset ?? 0, clip.type === 'video' && inView)
  const picture = clip.type === 'image' ? (sources.poster || sources.source) : (sources.poster || frame)
  useEffect(() => { setImageFailed(false) }, [picture])
  const shape = clip.type === 'text' ? clip.props?.shape_kind : undefined
  const shapeName = typeof shape === 'string' ? shape : null
  const color = clip.color || '#b690ff'
  const tiles = Math.min(20, Math.max(1, Math.ceil(width / 96)))
  const label = clip.type === 'text' ? (clip.text?.trim() || clip.name) : clip.name
  // Audio waveform is a visual type cue, not a claim of sampled peaks. Media
  // backends providing actual waveform samples can supply those in media.waveform_peaks.
  const data = media as unknown as Record<string, unknown> | undefined
  const peaks = Array.isArray(data?.waveform_peaks) ? data.waveform_peaks : null
  const bars = Array.from({length: 42}, (_, i) => {
    const value = peaks && typeof peaks[i % peaks.length] === 'number' ? Number(peaks[i % peaks.length])
      : Math.abs(Math.sin(i * 1.29) * .57 + Math.sin(i * .61) * .25 + .2)
    return Math.max(10, Math.min(90, value * 90))
  })
  return <div ref={artRef} data-timeline-artwork={clip.type} aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden rounded-md">
    {(clip.type === 'image' || clip.type === 'video') && picture && !imageFailed
      ? <div className="absolute inset-0 flex opacity-90">
          {Array.from({length:tiles}, (_, i) => <img key={i} src={picture} loading="lazy" draggable={false}
            onError={() => setImageFailed(true)} alt="" className="h-full min-w-0 flex-1 object-cover"
            style={{width: `${100 / tiles}%`, maxWidth:'100%', borderRight: '1px solid rgba(0,0,0,.18)'}}/>) }
        </div>
      : null}
    {(clip.type === 'image' || clip.type === 'video') && (!picture || imageFailed) && <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-r from-[#344a6b] to-[#1b3049] text-white/50">
      {clip.type === 'video' ? <Video size={27}/> : <ImageIcon size={27}/>}
    </div>}
    {clip.type === 'audio' && <div className="absolute inset-0 flex items-center justify-around gap-[2px] bg-[#124457]/90 px-3">
      {bars.map((peak, index)=><span key={index} className="w-[3px] min-w-[2px] max-w-[5px] flex-1 rounded-full bg-[#51d4f2]/85" style={{height:`${peak}%`}}/>)}
    </div>}
    {clip.type === 'text' && shapeName && <div className="absolute inset-0 flex items-center justify-center bg-[#142432]/90">
      {shapeName.toLowerCase().includes('blur') ? <div className="relative h-4/5 w-4/5 rounded-md border border-white/35 bg-white/10 shadow-[inset_0_0_18px_#c6b4f8] backdrop-blur-lg"/>
        : <svg viewBox="0 0 100 76" className="h-[92%] max-h-[65px] w-[110px] max-w-[70%] drop-shadow-lg">{timelineShapePreview(shapeName,color)}</svg>}
    </div>}
    {clip.type === 'text' && !shapeName && <div className="absolute inset-0 flex items-center justify-center overflow-hidden bg-[linear-gradient(110deg,#07566e,#1a7fa0_55%,#0e455a)] px-5 text-center">
      <span className="max-h-full overflow-hidden text-[clamp(10px,1.1vw,17px)] font-bold leading-tight tracking-wide text-white/85 drop-shadow-md">{clip.text?.trim() || 'Aa'}</span>
    </div>}
    <div className="absolute inset-0 bg-gradient-to-t from-black/55 via-transparent to-black/10"/>
    <div className="absolute bottom-1 left-2 right-2 flex min-w-0 items-center gap-1 rounded-sm text-[10px] font-semibold text-white drop-shadow-[0_1px_2px_#000]">
      {clip.type === 'video' ? <Video size={12} className="shrink-0"/> : clip.type === 'audio' ? <Music2 size={12} className="shrink-0"/> : clip.type === 'text' ? <Type size={12} className="shrink-0"/> : <ImageIcon size={12} className="shrink-0"/>}
      <span className="truncate">{label}</span>
    </div>
  </div>
}

function ClipBar({ clip, track, zoom, onMenu, onPointerDrag, multiSelected, hasMultiSelection, onClipSelect, selectionMode }: { clip: Clip; track: Track; zoom: number; onMenu: (menu:MenuState)=>void;onPointerDrag:PointerClipDrag;multiSelected:boolean;hasMultiSelection:boolean;onClipSelect:(id:string,additive:boolean)=>void;selectionMode:boolean }) {
  const primarySelected = useEditor(s => s.selectedClipId === clip.client_id)
  const selected = hasMultiSelection ? multiSelected : primarySelected
  const selectClip = useEditor(s => s.selectClip)
  const rename = useEditor(s => s.patchClip)
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
    if (track.locked || clip.locked || event.button !== 0) return
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
  const suppressClick = useRef(false)
  const startPointerDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (selectionMode || event.button!==0 || track.locked || clip.locked || editing || origin.current) return
    if ((event.target as HTMLElement).closest('[role="separator"],input,button')) return
    const rect=event.currentTarget.getBoundingClientRect()
    const item:Extract<DragItem,{kind:'clip'}>={kind:'clip',clipId:clip.client_id,duration:clip.duration,offset:clamp((event.clientX-rect.left)/zoom,0,clip.duration)}
    const from={x:event.clientX,y:event.clientY}
    let activated=false
    const move=(next:globalThis.PointerEvent)=>{
      if (!activated && Math.hypot(next.clientX-from.x,next.clientY-from.y)<5) return
      activated=true
      next.preventDefault()
      onPointerDrag(item,next.clientX,next.clientY,false)
    }
    const finish=(next:globalThis.PointerEvent)=>{
      window.removeEventListener('pointermove',move)
      window.removeEventListener('pointerup',finish)
      window.removeEventListener('pointercancel',cancel)
      window.removeEventListener('blur',cancel)
      if (activated) {
        suppressClick.current=true
        onPointerDrag(item,next.clientX,next.clientY,true)
      }
    }
    const cancel=()=>{
      window.removeEventListener('pointermove',move)
      window.removeEventListener('pointerup',finish)
      window.removeEventListener('pointercancel',cancel)
      window.removeEventListener('blur',cancel)
      useEditor.getState().startDrag(null)
    }
    window.addEventListener('pointermove',move,{passive:false})
    window.addEventListener('pointerup',finish)
    window.addEventListener('pointercancel',cancel)
    window.addEventListener('blur',cancel)
  }
  const focusField=(field:string)=>{
    selectClip(clip.client_id)
    useEditor.getState().selectTrack(track.client_id)
    window.requestAnimationFrame(()=>{const input=document.querySelector<HTMLInputElement>(`[data-clip-field="${field}"]`);input?.focus();input?.select()})
  }
  const showClipMenu=(e:MouseEvent<HTMLDivElement>)=>{
    e.preventDefault();e.stopPropagation()
    selectClip(clip.client_id)
    useEditor.getState().selectTrack(track.client_id)
    const store=useEditor.getState()
    const isLocked=track.locked||clip.locked
    const canMerge=!!clip.props?.attached_to||store.tracks.some(t=>t.clips.some(c=>c.props?.attached_to===clip.client_id))
    const actions:ContextAction[]=[
      {label:'Rename',onClick:()=>{setName(clip.name);setEditing(true)},disabled:isLocked},
      {label:'Duplicate',onClick:()=>store.duplicateClip(clip.client_id),disabled:isLocked},
      {label:'Cut clip',onClick:()=>store.cutClip(clip.client_id),disabled:isLocked},
      {label:'Split at playhead',onClick:()=>store.splitClip(clip.client_id,store.playhead),disabled:isLocked || store.playhead<=clip.start+MIN_CLIP || store.playhead>=clip.start+clip.duration-MIN_CLIP},
      {label:'Paste at playhead',onClick:()=>store.pasteClip(),disabled:!store.clipboard||track.locked},
      {label:'',divider:true},
      {label:'Detach sound from video',onClick:()=>store.detachAudio(clip.client_id),disabled:isLocked||clip.type!=='video'||!!clip.props?.audio_muted},
      {label:'Merge sound with video',onClick:()=>store.mergeAudio(clip.client_id),disabled:isLocked||!canMerge},
      {label:clip.locked?'Unlock clip':'Lock clip',onClick:()=>store.patchClip(clip.client_id,{locked:!clip.locked}),disabled:track.locked},
      {label:'',divider:true},
      {label:'Set duration',onClick:()=>focusField('duration')},
      {label:'Repeat / Linked Element…',onClick:()=>focusField('repeat_mode')},
      {label:'Start at…',onClick:()=>focusField('start')},
      {label:'End at…',onClick:()=>focusField('end')},
      {label:'Crop in Preview',onClick:()=>{selectClip(clip.client_id);useEditor.getState().setPreviewTool('crop');useEditor.getState().setPlayhead(clip.start+Math.min(.02,clip.duration/4))},disabled:isLocked || (clip.type!=='video'&&clip.type!=='image')},
      {label:'Reset crop',onClick:()=>store.patchProps(clip.client_id,{crop_left:0,crop_right:0,crop_top:0,crop_bottom:0}),disabled:isLocked || (clip.type!=='video'&&clip.type!=='image')},
      {label:'Set width',onClick:()=>focusField('width'),disabled:clip.type==='audio'},
      {label:'Set height',onClick:()=>focusField('height'),disabled:clip.type==='audio'},
      {label:'Set position (X)',onClick:()=>focusField('x'),disabled:clip.type==='audio'},
      {label:'Set position (Y)',onClick:()=>focusField('y'),disabled:clip.type==='audio'},
      {label:'Set rotation',onClick:()=>focusField('rotation'),disabled:clip.type==='audio'},
      {label:'Set scale',onClick:()=>focusField('scale'),disabled:clip.type==='audio'},
      {label:clip.props?.reversed?'Normal playback':'Reverse video frames (silent)',onClick:()=>store.patchProps(clip.client_id,{reversed:!clip.props?.reversed}),disabled:clip.type!=='video'||isLocked},
      {label:'',divider:true},
      {label:`Indicator → start (${formatTime(clip.start)})`,onClick:()=>store.setPlayhead(clip.start)},
      {label:`Indicator → end (${formatTime(clip.start+clip.duration)})`,onClick:()=>store.setPlayhead(clip.start+clip.duration)},
      {label:'',divider:true},
      {label:'Remove clip',danger:true,onClick:()=>store.removeClip(clip.client_id),disabled:isLocked},
    ]
    onMenu({x:e.clientX,y:e.clientY,actions})
  }
  return <div data-timeline-clip-id={clip.client_id} aria-selected={selected} role="button" tabIndex={track.locked || clip.locked ? -1 : 0} onPointerDown={startPointerDrag}
    onClick={e => { e.stopPropagation(); if(suppressClick.current){suppressClick.current=false;return} onClipSelect(clip.client_id, selectionMode || e.ctrlKey || e.metaKey || e.shiftKey); useEditor.getState().selectTrack(track.client_id) }}
    onKeyDown={e => { if (e.key === 'Enter' || e.key===' ') { e.preventDefault();onClipSelect(clip.client_id,e.ctrlKey || e.metaKey || e.shiftKey || selectionMode) };  if (e.key === 'F2') { setName(clip.name); setEditing(true) } }}
    onDoubleClick={e => { e.stopPropagation(); if (!track.locked && !clip.locked) { setName(clip.name); setEditing(true) } }}
    onContextMenu={showClipMenu}
    title={`${clip.name} · ${clip.start.toFixed(2)}s → ${(clip.start + clip.duration).toFixed(2)}s · Ctrl+click to multi-select · drag to move`}
    style={{ left: displayStart * zoom, width: Math.max(visualDuration * zoom, 8) }}
    className={`group absolute inset-y-1 z-[2] flex min-w-0 select-none items-center overflow-hidden rounded-lg border px-2 text-left text-[11px] ${trackColor} ${selected ? 'ring-2 ring-[#b9d7ff] shadow-[0_0_16px_#77a9ef99]' : 'hover:brightness-125'} ${track.hidden ? 'opacity-30' : ''} ${track.locked || clip.locked ? 'cursor-not-allowed' : 'cursor-grab active:cursor-grabbing'} ${trimDraft && !validTrim ? 'ring-2 ring-red-400' : ''}`}>
    {!track.locked && !clip.locked && <span role="separator" aria-label="Trim clip start" title="Drag to trim start" onPointerDown={beginTrim('left')} onPointerMove={moveTrim} onPointerUp={endTrim} onPointerCancel={() => { origin.current = null; setTrimDraft(null) }} draggable={false} className="absolute inset-y-0 left-0 z-10 w-[9px] cursor-ew-resize rounded-l-md bg-black/15 hover:bg-white/40"/>}
    <TimelineClipVisual clip={clip} width={Math.max(8, visualDuration * zoom)}/>
    {editing && <input autoFocus className="relative z-20 ml-2 min-w-0 flex-1 rounded bg-black/75 px-1.5 py-1 text-white outline-none ring-1 ring-white/30" value={name} maxLength={160} onChange={e => setName(e.target.value)} onClick={e => e.stopPropagation()} onBlur={commitName} onKeyDown={e => { e.stopPropagation(); if (e.key === 'Enter') commitName(); if (e.key === 'Escape') { setName(clip.name); setEditing(false) } }}/>}
    {trimDraft && <span className="pointer-events-none z-10 ml-auto whitespace-nowrap rounded bg-black/70 px-1 text-[10px] tabular-nums">{visualDuration.toFixed(2)}s</span>}
    {!track.locked && !clip.locked && <span role="separator" aria-label="Trim clip end" title="Drag to trim end / change duration" onPointerDown={beginTrim('right')} onPointerMove={moveTrim} onPointerUp={endTrim} onPointerCancel={() => { origin.current = null; setTrimDraft(null) }} draggable={false} className="absolute inset-y-0 right-0 z-10 w-[9px] cursor-ew-resize rounded-r-md bg-black/15 hover:bg-white/40"/>}
  </div>
}
