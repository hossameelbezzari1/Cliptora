import { useEffect, useRef, useState, type CSSProperties, type PointerEvent, type RefObject, type MouseEvent } from 'react'
import { Move, RotateCw, Scaling, Maximize2, LockKeyhole } from 'lucide-react'
import { useEditor } from '../../../stores/editorStore'
import { fileUrl } from '../../../lib/api'
import type { Clip, ClipProperties } from '../../../types'
import {
  clamp, calculateCropMargin, getObjectTransform, getTransformDelta,
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
  if (Number.isFinite(target) && Math.abs(element.currentTime - target) > (playing ? 0.18 : 0.025)) {
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
  const cropDrag = useRef<{ edge:'left'|'right'|'top'|'bottom'; initial:number; opposite:number; x:number; y:number } | null>(null)
  const draftRef = useRef<Partial<ClipProperties> | null>(null)
  const [draft, setDraft] = useState<Partial<ClipProperties> | null>(null)
  const transform = getObjectTransform(clip, draft)
  const crop = {left: draft?.crop_left ?? clip.props?.crop_left ?? 0, right: draft?.crop_right ?? clip.props?.crop_right ?? 0, top: draft?.crop_top ?? clip.props?.crop_top ?? 0, bottom: draft?.crop_bottom ?? clip.props?.crop_bottom ?? 0}
  const canCrop = (clip.type === 'image' || clip.type === 'video') && tool === 'crop'
  const activeTool: PointerGesture['tool'] = tool === 'resize' || tool === 'rotate' || tool === 'scale' ? tool : 'move'
  const cursor = locked ? 'cursor-not-allowed' : canCrop ? 'cursor-default' : activeTool === 'rotate' ? 'cursor-crosshair' : activeTool === 'resize' ? 'cursor-nwse-resize' : activeTool === 'scale' ? 'cursor-nesw-resize' : 'cursor-move'
  const activeEffects=clip.props?.effect_stack??[]
  const fx=(key:string,fallback:number)=>{
    const effect=activeEffects.find(item=>item.name===key)
    return effect ? Number((effect.parameters as Record<string,unknown> | undefined)?.amount ?? fallback) : fallback
  }
  const effectFilter=[
    activeEffects.some(item=>item.name==='Brightness') ? `brightness(${0.5+fx('Brightness',0.5)})`: '',
    activeEffects.some(item=>item.name==='Contrast') ? `contrast(${0.5+fx('Contrast',0.5)})`: '',
    activeEffects.some(item=>item.name==='Saturation') ? `saturate(${fx('Saturation',1)})`: '',
    activeEffects.some(item=>item.name==='Gaussian Blur') ? `blur(${Math.max(0,fx('Gaussian Blur',0.5))*15}px)`: '',
    activeEffects.some(item=>item.name==='Black & White') ? 'grayscale(1)': '',
    activeEffects.some(item=>item.name==='Sepia') ? 'sepia(1)': '',
    activeEffects.some(item=>item.name==='Hue') ? `hue-rotate(${fx('Hue',0.5)*360}deg)`: '',
  ].filter(Boolean).join(' ')
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
    if (canCrop) {
      if (!handle?.startsWith('crop-')) return
      const edge = handle.slice(5) as 'left'|'right'|'top'|'bottom'
      const opposite = edge === 'left' ? crop.right : edge === 'right' ? crop.left : edge === 'top' ? crop.bottom : crop.top
      cropDrag.current = {edge, initial: crop[edge], opposite, x:event.clientX, y:event.clientY}
      draftRef.current = null
      event.currentTarget.setPointerCapture(event.pointerId)
      return
    }
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
    const cropGesture = cropDrag.current
    const stage = holder.current?.closest<HTMLElement>('[data-preview-canvas]')
    if (!stage || (!gesture && !cropGesture)) return
    const rect = stage.getBoundingClientRect()
    if (cropGesture) {
      const horizontal = cropGesture.edge === 'left' || cropGesture.edge === 'right'
      const pixels = horizontal ? rect.width * transform.width / 100 : rect.height * transform.height / 100
      const value = calculateCropMargin(cropGesture.edge,cropGesture.initial,cropGesture.opposite,
        horizontal?event.clientX-cropGesture.x:event.clientY-cropGesture.y,
        pixels*Math.abs(transform.scale))
      const patch = {[`crop_${cropGesture.edge}`]:value} as Partial<ClipProperties>
      draftRef.current = patch
      setDraft(patch)
      return
    }
    if (!gesture) return
    const patch = getTransformDelta(gesture, event.clientX, event.clientY, rect.width, rect.height)
    draftRef.current = patch
    setDraft(patch)
  }

  function finish(event: PointerEvent<HTMLDivElement>) {
    if (!drag.current && !cropDrag.current) return
    const patch = draftRef.current
    drag.current = null
    cropDrag.current = null
    draftRef.current = null
    if (patch) patchProps(clip.client_id, patch)
    setDraft(null)
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }

  const stop = () => { drag.current = null; cropDrag.current = null; draftRef.current = null; setDraft(null) }
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
    <div className="pointer-events-none h-full w-full overflow-hidden" style={{filter:effectFilter||undefined,clipPath: `inset(${crop.top}% ${crop.right}% ${crop.bottom}% ${crop.left}%)`}}>
      {clip.type === 'video' ? <VideoSource clip={clip} playhead={playhead} playing={playing} muted={muted} />
        : clip.type === 'image' && clip.media_id ? <img className="h-full w-full object-contain" src={fileUrl(clip.media_id)} alt={clip.name} draggable={false} />
        : clip.type === 'text' && clip.props?.shape_kind ? <div className="grid h-full w-full place-items-center"><div style={{backdropFilter:clip.props.shape_kind.includes('Blur Box')?'blur(12px)':undefined,backgroundColor:clip.props.shape_kind.includes('Blur Box')?'#ffffff10':clip.color,width:'100%',height:'100%',borderRadius:clip.props.shape_kind==='Circle'||clip.props.shape_kind==='Ellipse'?'50%':clip.props.shape_kind==='Rectangle'||clip.props.shape_kind==='Square'?'0%':'10%',clipPath:clip.props.shape_kind==='Triangle'?'polygon(50% 0, 100% 100%, 0 100%)':clip.props.shape_kind==='Star'?'polygon(50% 0%,61% 35%,98% 35%,68% 57%,79% 91%,50% 70%,21% 91%,32% 57%,2% 35%,39% 35%)':undefined}} /></div>
        : clip.type === 'text' ? <div className="flex h-full w-full items-center justify-center whitespace-pre-wrap px-2 text-center font-display text-[clamp(10px,2vw,32px)] font-extrabold leading-snug" style={{ color: clip.color }}>{clip.text || clip.name}</div> : null}
    </div>
    {selected && <>
      <div aria-hidden className="pointer-events-none absolute inset-[3px] rounded-[2px] border-2 border-[#b78cff] ring-1 ring-white/90 shadow-[0_0_0_1px_#713cca,0_0_16px_#945ff055]" />
      <div className="pointer-events-none absolute inset-x-2 top-1/2 h-px border-t border-dashed border-white/40" />
      <div className="pointer-events-none absolute inset-y-2 left-1/2 w-px border-l border-dashed border-white/40" />
      <span aria-hidden className="pointer-events-none absolute top-2 left-2 max-w-[calc(100%-16px)] truncate rounded-md bg-[#21162e]/95 px-2 py-1 text-[10px] font-semibold text-[#eedcff] shadow-lg">{locked ? '🔒 ' : ''}{clip.name}</span>
      {!locked && canCrop && <>
        <div aria-hidden className="pointer-events-none absolute border-2 border-dashed border-[#5bff93] bg-[#5bff93]/5" style={{left:`${crop.left}%`,right:`${crop.right}%`,top:`${crop.top}%`,bottom:`${crop.bottom}%`}} />
        {(['left','right','top','bottom'] as const).map(edge=><span key={edge} data-preview-handle={`crop-${edge}`} title={`Crop ${edge} edge — drag`} aria-label={`Crop ${edge} edge`} style={edge==='left'?{left:`${Math.max(2,crop.left)}%`,top:'50%'}:edge==='right'?{left:`${Math.min(98,100-crop.right)}%`,top:'50%'}:edge==='top'?{top:`${Math.max(2,crop.top)}%`,left:'50%'}:{top:`${Math.min(98,100-crop.bottom)}%`,left:'50%'}} className={`absolute z-40 grid h-5 w-5 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-sm ${edge==='top'||edge==='bottom'?'cursor-ns-resize':'cursor-ew-resize'} border border-[#1d5336] bg-[#5bff93] text-[8px] font-bold text-black`}>{edge[0].toUpperCase()}</span>)}
      </>}
      {!locked && !canCrop && <>
        <span data-preview-handle="scale" title="SCALE: drag to change size proportionally" aria-label="Scale object" className={`${commonHandle} bottom-[7px] left-[7px] cursor-nesw-resize`}><Scaling size={11}/></span>
        <span data-preview-handle="resize" title="RESIZE: drag to change width and height" aria-label="Resize object" className={`${commonHandle} bottom-[7px] right-[7px] cursor-nwse-resize`}><Maximize2 size={11}/></span>
        <span data-preview-handle="rotate" title="ROTATE: drag around center" aria-label="Rotate object" className={`${commonHandle} top-[7px] right-[7px] cursor-crosshair rounded-full`}><RotateCw size={11}/></span>
        <span data-preview-handle="move" title="MOVE: drag object" aria-label="Move object" className={`${commonHandle} left-1/2 bottom-[7px] -translate-x-1/2 cursor-move`}><Move size={11}/></span>
      </>}
      {locked && <span className="pointer-events-none absolute right-2 bottom-2 rounded bg-[#201b2d] p-1 text-white"><LockKeyhole size={15}/></span>}
    </>}
  </div>
}
