import { useEffect, useRef, useState, type CSSProperties, type PointerEvent, type RefObject, type MouseEvent } from 'react'
import { Move, RotateCw, Scaling, Maximize2, LockKeyhole } from 'lucide-react'
import { useEditor } from '../../../stores/editorStore'
import { fileUrl } from '../../../lib/api'
import type { Clip, ClipProperties } from '../../../types'
import {
  clamp, getObjectTransform, getTransformDelta,
  type PointerGesture, type PreviewTool,
} from './previewGeometry'

type Props = {
  clip: Clip
  playing: boolean
  playhead: number
  muted: boolean
  selected: boolean
  locked: boolean
  tool: PreviewTool
  onContextMenu: (event: MouseEvent<HTMLDivElement>, clip: Clip) => void
}

function syncMedia(element: HTMLMediaElement | null, clip: Clip, playhead: number, playing: boolean, muted: boolean) {
  if (!element) return
  const relative = clamp(playhead - clip.start, 0, clip.duration)
  const target = Math.max(0, clip.source_offset + (clip.props?.reversed ? Math.max(0, clip.duration - relative) : relative))
  if (Number.isFinite(target) && Math.abs(element.currentTime - target) > 0.2) {
    try { element.currentTime = target } catch { /* Wait for media metadata */ }
  }
  element.muted = muted || !!clip.props?.audio_muted || !!clip.props?.reversed
  element.volume = clamp(clip.props?.volume ?? 1, 0, 1)
  if (playing && !clip.props?.reversed) void element.play().catch(() => {})
  else element.pause()
}

export function useMediaClock(ref: RefObject<HTMLMediaElement | null>, clip: Clip, playhead: number, playing: boolean, muted: boolean) {
  // Media elements are driven by the editor playhead, not by independent clocks.
  useEffect(() => {
    syncMedia(ref.current, clip, playhead, playing, muted)
  }, [ref, clip, playhead, playing, muted])
}

export function VideoSource({ clip, playhead, playing, muted }: { clip: Clip; playhead: number; playing: boolean; muted: boolean }) {
  const ref = useRef<HTMLVideoElement>(null)
  useMediaClock(ref, clip, playhead, playing, muted)
  return clip.media_id ? <video
    ref={ref}
    src={fileUrl(clip.media_id)}
    playsInline
    preload="metadata"
    draggable={false}
    className="pointer-events-none h-full w-full object-contain"
    onLoadedMetadata={() => syncMedia(ref.current, clip, playhead, playing, muted)}
  /> : null
}

export function AudioSource({ clip, playhead, playing, muted }: { clip: Clip; playhead: number; playing: boolean; muted: boolean }) {
  const ref = useRef<HTMLAudioElement>(null)
  useMediaClock(ref, clip, playhead, playing, muted)
  return clip.media_id ? <audio
    ref={ref}
    src={fileUrl(clip.media_id)}
    preload="metadata"
    onLoadedMetadata={() => syncMedia(ref.current, clip, playhead, playing, muted)}
  /> : null
}

const commonHandle = 'absolute z-30 flex h-[19px] w-[19px] items-center justify-center rounded-[5px] border border-[#51247e] bg-white text-[#51247e] shadow-[0_1px_7px_#0009] hover:scale-110'

export function PreviewObject({ clip, playing, playhead, muted, selected, locked, tool, onContextMenu }: Props) {
  const selectClip = useEditor(s => s.selectClip)
  const selectTrack = useEditor(s => s.selectTrack)
  const setPlaying = useEditor(s => s.setPlaying)
  const patchProps = useEditor(s => s.patchProps)
  const holder = useRef<HTMLDivElement>(null)
  const drag = useRef<PointerGesture | null>(null)
  const draftRef = useRef<Partial<ClipProperties> | null>(null)
  const [draft, setDraft] = useState<Partial<ClipProperties> | null>(null)
  const transform = getObjectTransform(clip, draft)
  const activeTool = tool === 'select' ? 'move' : tool
  const cursor = locked ? 'cursor-not-allowed' : activeTool === 'rotate' ? 'cursor-crosshair' : activeTool === 'resize' ? 'cursor-nwse-resize' : activeTool === 'scale' ? 'cursor-nesw-resize' : 'cursor-move'
  const style: CSSProperties = {
    left: `${transform.x}%`, top: `${transform.y}%`,
    width: `${transform.width}%`, height: `${transform.height}%`,
    opacity: transform.opacity,
    transform: `rotate(${transform.rotation}deg) scale(${transform.scale * (transform.flip_x ? -1 : 1)}, ${transform.scale * (transform.flip_y ? -1 : 1)})`,
    transformOrigin: 'center center',
  }

  function begin(event: PointerEvent<HTMLDivElement>) {
    event.stopPropagation()
    selectClip(clip.client_id)
    event.currentTarget.focus({ preventScroll: true })
    const layer = useEditor.getState().tracks.find(track => track.clips.some(item => item.client_id === clip.client_id))
    if (layer) selectTrack(layer.client_id)
    if (locked || event.button !== 0) return
    setPlaying(false)
    const stage = holder.current?.closest<HTMLElement>('[data-preview-canvas]')
    if (!stage) return
    const rect = stage.getBoundingClientRect()
    const handle = (event.target as HTMLElement).closest<HTMLElement>('[data-preview-handle]')?.dataset.previewHandle
    const selectedTool = handle === 'resize' || handle === 'rotate' || handle === 'scale' || handle === 'move' ? handle : activeTool
    const centerX = rect.left + (transform.x + transform.width / 2) / 100 * rect.width
    const centerY = rect.top + (transform.y + transform.height / 2) / 100 * rect.height
    drag.current = {
      tool: selectedTool,
      startX: event.clientX, startY: event.clientY,
      centerX, centerY,
      initialAngle: Math.atan2(event.clientY - centerY, event.clientX - centerX),
      initial: transform,
    }
    draftRef.current = null
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  function move(event: PointerEvent<HTMLDivElement>) {
    const gesture = drag.current
    const stage = holder.current?.closest<HTMLElement>('[data-preview-canvas]')
    if (!gesture || !stage) return
    const rect = stage.getBoundingClientRect()
    const patch = getTransformDelta(gesture, event.clientX, event.clientY, rect.width, rect.height)
    draftRef.current = patch
    setDraft(patch)
  }

  function finish(event: PointerEvent<HTMLDivElement>) {
    if (!drag.current) return
    const patch = draftRef.current
    drag.current = null
    draftRef.current = null
    if (patch) patchProps(clip.client_id, patch)
    setDraft(null)
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }

  const stop = () => { drag.current = null; draftRef.current = null; setDraft(null) }
  const label = `${clip.type} · ${clip.name}`
  return <div
    ref={holder}
    data-preview-object={clip.client_id}
    role="button"
    tabIndex={selected ? 0 : -1}
    aria-label={`Select ${label}`}
    title={locked ? `${clip.name} (locked)` : `${clip.name} — click to select, drag to ${activeTool}`}
    style={style}
    className={`group absolute touch-none select-none outline-none ${cursor} ${selected ? 'z-30' : 'z-10'}`}
    onPointerDown={begin}
    onPointerMove={move}
    onPointerUp={finish}
    onPointerCancel={stop}
    onLostPointerCapture={stop}
    onClick={event => event.stopPropagation()}
    onContextMenu={event => { event.preventDefault(); event.stopPropagation(); selectClip(clip.client_id); onContextMenu(event, clip) }}
    onKeyDown={event => { if (event.key === 'Enter') { selectClip(clip.client_id); event.stopPropagation() } }}
  >
    <div className="pointer-events-none h-full w-full overflow-hidden">
      {clip.type === 'video' ? <VideoSource clip={clip} playhead={playhead} playing={playing} muted={muted} />
        : clip.type === 'image' && clip.media_id ? <img className="h-full w-full object-contain" src={fileUrl(clip.media_id)} alt={clip.name} draggable={false} />
        : clip.type === 'text' ? <div className="flex h-full w-full items-center justify-center whitespace-pre-wrap px-2 text-center font-display text-[clamp(10px,2vw,32px)] font-extrabold leading-snug" style={{ color: clip.color }}>{clip.text || clip.name}</div> : null}
    </div>
    {selected && <>
      <div aria-hidden className="pointer-events-none absolute inset-[3px] rounded-[2px] border-2 border-[#b78cff] ring-1 ring-white/90 shadow-[0_0_0_1px_#713cca,0_0_16px_#945ff055]" />
      <div className="pointer-events-none absolute inset-x-2 top-1/2 h-px border-t border-dashed border-white/40" />
      <div className="pointer-events-none absolute inset-y-2 left-1/2 w-px border-l border-dashed border-white/40" />
      <span aria-hidden className="pointer-events-none absolute top-2 left-2 max-w-[calc(100%-16px)] truncate rounded-md bg-[#21162e]/95 px-2 py-1 text-[10px] font-semibold text-[#eedcff] shadow-lg">{locked ? '🔒 ' : ''}{clip.name}</span>
      {!locked && <>
        <span data-preview-handle="scale" title="SCALE: drag to change size proportionally" aria-label="Scale object" className={`${commonHandle} bottom-[7px] left-[7px] cursor-nesw-resize`}><Scaling size={11}/></span>
        <span data-preview-handle="resize" title="RESIZE: drag to change width and height" aria-label="Resize object" className={`${commonHandle} bottom-[7px] right-[7px] cursor-nwse-resize`}><Maximize2 size={11}/></span>
        <span data-preview-handle="rotate" title="ROTATE: drag around center" aria-label="Rotate object" className={`${commonHandle} top-[7px] right-[7px] cursor-crosshair rounded-full`}><RotateCw size={11}/></span>
        <span data-preview-handle="move" title="MOVE: drag object" aria-label="Move object" className={`${commonHandle} left-1/2 bottom-[7px] -translate-x-1/2 cursor-move`}><Move size={11}/></span>
      </>}
      {locked && <span className="pointer-events-none absolute right-2 bottom-2 rounded bg-[#201b2d] p-1 text-white"><LockKeyhole size={15}/></span>}
    </>}
  </div>
}
