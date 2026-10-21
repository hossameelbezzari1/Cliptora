import { api } from '../../../lib/api'
import { interpolateVariables, type VariableMap } from '../../../lib/variables'
import { effectiveTimelineEnd, repeatOccurrences } from '../../../lib/repeat'
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react'
import { Aperture, ArrowLeftToLine, ArrowRightToLine, Copy, Crop, FlipHorizontal, FlipVertical, Lock, Maximize2, Move, MousePointer2, Pause, Play, RotateCcw, RotateCw, Scaling, Scissors, Trash2, Type, Unlock, Volume2, VolumeX } from 'lucide-react'
import { useEditor, MIN_CLIP } from '../../../stores/editorStore'
import { formatTime } from '../../../lib/api'
import { ContextMenu, type ContextAction, type MenuState } from '../../ui/ContextMenu'
import type { Clip, Project, Track } from '../../../types'
import { AudioSource, PreviewObject } from './PreviewObject'
import { clamp, getObjectTransform, resetTransform, round } from './previewGeometry'

type VisibleObject = { clip: Clip; track: Track }

export function PreviewPanel({ project }: { project: Project }) {
  const tracks = useEditor(s => s.tracks)
  const playhead = useEditor(s => s.playhead)
  const setPlayhead = useEditor(s => s.setPlayhead)
  const playing = useEditor(s => s.playing)
  const setPlaying = useEditor(s => s.setPlaying)
  const selectedClipId = useEditor(s => s.selectedClipId)
  const selectClip = useEditor(s => s.selectClip)
  const selectTrack = useEditor(s => s.selectTrack)
  const tool = useEditor(s => s.previewTool)
  const setTool = useEditor(s => s.setPreviewTool)
  const [muted, setMuted] = useState(false)
  const [globalVars,setGlobalVars] = useState<VariableMap>({})
  const [clock,setClock] = useState(() => new Date())
  useEffect(() => {
    let mounted=true
    void api<Array<{kind:string;name:string;payload:{type:string;value:unknown}}>>('/library?kind=variable')
      .then(rows => { if(mounted) setGlobalVars(Object.fromEntries(rows.map(row=>[row.name,{type:row.payload.type as import('../../../lib/variables').VariableType,value:row.payload.value}]))) })
      .catch(() => {})
    const timer=window.setInterval(()=>setClock(new Date()),1000)
    return ()=>{mounted=false;window.clearInterval(timer)}
  },[])

  const [menu, setMenu] = useState<MenuState>(null)
  const viewport = useRef<HTMLDivElement>(null)
  const [space, setSpace] = useState({ width: 640, height: 360 })

  useEffect(() => {
    const target = viewport.current
    if (!target) return
    const resize = () => {
      const rect = target.getBoundingClientRect()
      setSpace({ width: Math.max(1, rect.width), height: Math.max(1, rect.height) })
    }
    resize()
    const observer = new ResizeObserver(resize)
    observer.observe(target)
    return () => observer.disconnect()
  }, [])

  const ratio = clamp(project.width / Math.max(1, project.height), 0.2, 5)
  const canvasWidth = Math.max(1, Math.min(Math.max(1, space.width - 12), Math.max(1, space.height - 12) * ratio))
  const canvasHeight = canvasWidth / ratio
  const active = useMemo(() => {
    const allClips=tracks.flatMap(track=>track.clips)
    const duration=effectiveTimelineEnd(allClips)
    const timings=allClips.map(clip=>({id:clip.client_id,start:clip.start,duration:clip.duration}))
    const liveContext:Record<string,unknown> = {
      'project.id':project.id,'project.title':project.name,'project.name':project.name,
      'project.created_at':project.created_at,'project.updated_at':project.updated_at,
      'project.width':project.width,'project.height':project.height,
      'project.resolution':`${project.width}×${project.height}`,'project.fps':project.fps,
      'project.duration':duration,'project.layers_count':tracks.length,'project.clips_count':allClips.length,
    }
    const atPlayhead=(clip: Clip): Clip | null => {
      const rules=clip.props?.repeat
      const occurrences=repeatOccurrences({id:clip.client_id,start:clip.start,duration:clip.duration},rules,timings,duration,1000)
      const instance=[...occurrences].reverse().find(item=>playhead>=item.start-0.0001 && playhead<item.start+item.duration-0.0001)
      if(!instance) return null
      const rendered={...clip,start:instance.start,duration:instance.duration}
      if(rendered.type==='text')rendered.text=interpolateVariables(rendered.text||rendered.name,globalVars,liveContext,clock)
      return rendered
    }
    // Tracks are stored bottom -> top; later DOM objects are painted above earlier ones.
    const visible:VisibleObject[]=tracks.filter(track=>!track.hidden)
      .flatMap(track=>track.clips.filter(clip=>clip.type!=='audio').map(clip=>({clip:atPlayhead(clip),track})).filter((item):item is VisibleObject=>item.clip!==null))
    const audio=tracks.filter(track=>!track.hidden).flatMap(track=>track.clips.filter(clip=>clip.type==='audio').map(clip=>({clip:atPlayhead(clip),muted:muted||track.muted})).filter((item):item is {clip:Clip;muted:boolean}=>item.clip!==null))
    const background=[...tracks].reverse().find(track=>!track.hidden && track.background_color && track.background_color!=='#101214')?.background_color??'#08090a'
    return {visible,audio,background}
  },[tracks,playhead,muted,globalVars,clock,project])

  const selected = tracks.flatMap(track => track.clips.map(clip => ({ track, clip })))
    .find(item => item.clip.client_id === selectedClipId)
  const selectionIsOnCanvas = active.visible.some(item => item.clip.client_id === selectedClipId)
  const total = effectiveTimelineEnd(tracks.flatMap(track=>track.clips))
  const editable = !!selected && !selected.track.locked && !selected.clip.locked

  const choose = (clip: Clip) => {
    const track = useEditor.getState().tracks.find(item => item.clips.some(candidate => candidate.client_id === clip.client_id))
    selectClip(clip.client_id)
    if (track) selectTrack(track.client_id)
  }

  const jumpTo = (clip: Clip) => {
    setPlaying(false)
    const track = useEditor.getState().tracks.find(item => item.clips.some(candidate => candidate.client_id === clip.client_id))
    if (track?.hidden) useEditor.getState().toggleTrack(track.client_id, 'hidden')
    // A very small offset avoids selecting a frame exactly on a clip boundary.
    setPlayhead(Math.min(clip.start + Math.min(0.02, clip.duration / 4), clip.start + clip.duration - 0.001))
    choose(clip)
  }

  const focusInspector = (field = 'name') => {
    requestAnimationFrame(() => {
      const input = document.querySelector<HTMLInputElement>(`[data-clip-field="${field}"]`)
      input?.focus()
      input?.select()
    })
  }

  function showMenu(event: MouseEvent<HTMLDivElement>, requested?: Clip) {
    event.preventDefault()
    event.stopPropagation()
    if (!requested) {
      const state = useEditor.getState()
      const actions: ContextAction[] = [
        { label: 'Add text at playhead', icon: <Type size={15} />, onClick: () => state.addTextClip() },
        { label: 'Paste clip at playhead', icon: <Copy size={15} />, disabled: !state.clipboard, onClick: () => state.pasteClip() },
        { divider: true, label: '' },
        { label: '', content: <label className="flex items-center justify-between gap-2 text-xs">Layer background <input type="color" aria-label="Layer background color" defaultValue={state.tracks.find(item => item.client_id === state.selectedTrackId)?.background_color ?? '#101214'} onChange={change => { const selectedLayer = useEditor.getState().selectedTrackId; if (selectedLayer) useEditor.getState().patchTrack(selectedLayer, { background_color: change.target.value }) }}/></label> },
        { divider: true, label: '' },
        { label: 'Deselect object', icon: <MousePointer2 size={15} />, onClick: () => selectClip(null) },
      ]
      setMenu({ x: event.clientX, y: event.clientY, actions })
      return
    }
    choose(requested)
    const store = useEditor.getState()
    const track = store.tracks.find(item => item.clips.some(candidate => candidate.client_id === requested.client_id))
    const clip = track?.clips.find(candidate => candidate.client_id === requested.client_id)
    if (!clip || !track) return
    const locked = !!clip.locked || track.locked
    const transform = getObjectTransform(clip)
    const actions: ContextAction[] = [
      { label: 'Clip settings / Rename', icon: <MousePointer2 size={15} />, onClick: () => focusInspector('name') },
      { label: 'Duplicate object', icon: <Copy size={15} />, disabled: locked, onClick: () => store.duplicateClip(clip.client_id) },
      { label: 'Cut object', icon: <Scissors size={15} />, disabled: locked, onClick: () => store.cutClip(clip.client_id) },
      { label: 'Paste at playhead', icon: <Copy size={15} />, disabled: !store.clipboard, onClick: () => store.pasteClip() },
      { label: clip.locked ? 'Unlock object' : 'Lock object', icon: clip.locked ? <Unlock size={15} /> : <Lock size={15} />, disabled: track.locked, onClick: () => store.patchClip(clip.client_id, { locked: !clip.locked }) },
      { divider: true, label: '' },
      { label: 'Center object', icon: <Move size={15} />, disabled: locked, onClick: () => store.patchProps(clip.client_id, { x: round((100 - transform.width) / 2), y: round((100 - transform.height) / 2) }) },
      { label: 'Fit object to canvas', icon: <Maximize2 size={15} />, disabled: locked, onClick: () => store.patchProps(clip.client_id, resetTransform) },
      { label: 'Crop source in Preview', icon: <Crop size={15} />, disabled: locked || (clip.type !== 'image' && clip.type !== 'video'), onClick: () => setTool('crop') },
      { label: 'Reset crop', disabled: locked || (clip.type !== 'image' && clip.type !== 'video'), onClick: () => store.patchProps(clip.client_id, { crop_left:0, crop_right:0, crop_top:0, crop_bottom:0 }) },
      { label: 'Set width / height', icon: <Maximize2 size={15} />, onClick: () => focusInspector('width') },
      { label: 'Set position X / Y', icon: <Move size={15} />, onClick: () => focusInspector('x') },
      { label: 'Set rotation / scale', icon: <Scaling size={15} />, onClick: () => focusInspector('rotation') },
      { label: 'Reset transform', icon: <RotateCcw size={15} />, disabled: locked, onClick: () => store.patchProps(clip.client_id, resetTransform) },
      { label: 'Rotate 90° clockwise', icon: <RotateCw size={15} />, disabled: locked, onClick: () => store.patchProps(clip.client_id, { rotation: round(transform.rotation + 90, 1) }) },
      { label: 'Flip horizontal', icon: <FlipHorizontal size={15} />, disabled: locked, onClick: () => store.patchProps(clip.client_id, { flip_x: !transform.flip_x }) },
      { label: 'Flip vertical', icon: <FlipVertical size={15} />, disabled: locked, onClick: () => store.patchProps(clip.client_id, { flip_y: !transform.flip_y }) },
      { divider: true, label: '' },
      { label: `Go to start (${formatTime(clip.start)})`, icon: <ArrowLeftToLine size={15} />, onClick: () => jumpTo(clip) },
      { label: `Go to end (${formatTime(clip.start + clip.duration)})`, icon: <ArrowRightToLine size={15} />, onClick: () => setPlayhead(Math.max(clip.start, clip.start + clip.duration - 0.02)) },
      { label: 'Set start / end / duration', onClick: () => focusInspector('duration') },
      { label: 'Split at playhead', icon: <Scissors size={15} />, disabled: locked || playhead <= clip.start + MIN_CLIP || playhead >= clip.start + clip.duration - MIN_CLIP, onClick: () => store.splitClip(clip.client_id, playhead) },
      ...(clip.type === 'video' ? [
        { label: clip.props?.audio_muted ? 'Unmute video audio' : 'Mute video audio', icon: <VolumeX size={15} />, disabled: locked, onClick: () => store.patchProps(clip.client_id, { audio_muted: !clip.props?.audio_muted }) },
        { label: 'Detach audio', disabled: locked || !!clip.props?.audio_muted, onClick: () => store.detachAudio(clip.client_id) },
        { label: 'Merge detached audio', disabled: locked || !store.tracks.some(t => t.clips.some(c => c.props?.attached_to === clip.client_id)), onClick: () => store.mergeAudio(clip.client_id) },
        { label: clip.props?.reversed ? 'Normal playback' : 'Reverse frames in preview (silent)', disabled: locked, onClick: () => store.patchProps(clip.client_id, { reversed: !clip.props?.reversed }) },
      ] satisfies ContextAction[] : []),
      { divider: true, label: '' },
      { label: 'Remove object', icon: <Trash2 size={15} />, danger: true, disabled: locked, onClick: () => store.removeClip(clip.client_id) },
    ]
    setMenu({ x: event.clientX, y: event.clientY, actions })
  }

  function keyDown(event: KeyboardEvent<HTMLElement>) {
    if (!(event.target instanceof HTMLElement) || event.target.closest('input,textarea,select,[contenteditable="true"]')) return
    if (event.key === 'Escape') { selectClip(null); setMenu(null); return }
    if (!selected || !editable || selected.clip.type === 'audio' || event.ctrlKey || event.metaKey || event.altKey) return
    const amount = event.shiftKey ? 5 : 1
    const deltas: Record<string, [number, number]> = { ArrowLeft: [-amount, 0], ArrowRight: [amount, 0], ArrowUp: [0, -amount], ArrowDown: [0, amount] }
    const delta = deltas[event.key]
    if (!delta) return
    event.preventDefault()
    event.stopPropagation()
    const transform = getObjectTransform(selected.clip)
    useEditor.getState().patchProps(selected.clip.client_id, {
      x: round(clamp(transform.x + delta[0], -400, 400), 1),
      y: round(clamp(transform.y + delta[1], -400, 400), 1),
    })
  }

  return <section data-preview-root onKeyDown={keyDown} className="flex h-full min-h-0 min-w-0 flex-col gap-1.5 overflow-hidden bg-[#141618] p-1.5" aria-label="Interactive video preview">
    <div ref={viewport} className="relative flex min-h-0 min-w-0 flex-1 items-center justify-center overflow-hidden rounded-md bg-[#0d0f12]">
      <div data-preview-canvas tabIndex={0} role="application" aria-label="Canvas, click an object to select or right-click for options" className="relative shrink-0 select-none overflow-hidden shadow-[0_0_0_1px_#ffffff25] outline-none focus-visible:ring-2 focus-visible:ring-[#bb98ff]" style={{ width: canvasWidth, height: canvasHeight, background: active.background }}
        onClick={() => selectClip(null)} onContextMenu={event => showMenu(event)}>
        {!active.visible.length && <div className="pointer-events-none grid h-full w-full place-items-center text-[#757a82]"><div className="grid justify-items-center gap-2"><Aperture size={32}/><p className="text-center text-xs">No visual clip at {formatTime(playhead)}<br/><span className="text-[10px]">Drag media onto Timeline to begin.</span></p></div></div>}
        {active.visible.map(({ clip, track }) => <PreviewObject
          key={clip.client_id}
          clip={clip}
          playhead={playhead}
          playing={playing}
          selected={selectedClipId === clip.client_id}
          locked={track.locked || !!clip.locked}
          muted={muted || track.muted}
          tool={tool}
          onContextMenu={showMenu}
        />)}
      </div>
      <div className="pointer-events-none absolute h-0 w-0 overflow-hidden" aria-hidden="true">{active.audio.map(({ clip, muted: trackMuted }) => <AudioSource key={clip.client_id} clip={clip} playhead={playhead} playing={playing} muted={trackMuted}/>)}</div>
    </div>

    <div className="flex w-full shrink-0 items-center gap-2 rounded-md bg-[#25282c] px-2 py-1.5">
      {selected && !selectionIsOnCanvas && selected.clip.type!=='audio' && <button type="button" onClick={()=>jumpTo(selected.clip)} title="Jump to selected clip" className="shrink-0 rounded bg-[#4d3467] px-2 py-1 text-[10px] text-white">Go to clip</button>}
      <button type="button" onClick={()=>{if(selected)useEditor.getState().splitClip(selected.clip.client_id,playhead)}} disabled={!editable||!selected||playhead<=selected.clip.start+MIN_CLIP||playhead>=selected.clip.start+selected.clip.duration-MIN_CLIP} className="flex shrink-0 items-center gap-1 rounded px-2 py-1 text-[11px] text-[#e7d9ff] hover:bg-white/10" aria-label="Cut selected clip at playhead" title="Cut / split selected clip at playhead"><Scissors size={14}/><span className="hidden sm:inline">Cut</span></button>
      <button type="button" aria-label={playing ? 'Pause preview' : 'Play preview'} title={playing ? 'Pause' : 'Play'} onClick={() => setPlaying(!playing)} className="shrink-0 text-white hover:text-[#cfaaff]">{playing ? <Pause size={19} /> : <Play size={19} />}</button>
      <span className="shrink-0 text-[10px] tabular-nums text-[#d1d4da]">{formatTime(playhead)} / {formatTime(total)}</span>
      <input aria-label="Preview playhead" className="min-w-0 flex-1" type="range" min={0} max={total} step={0.01} value={Math.min(playhead, total)} onChange={event => { setPlaying(false); setPlayhead(Number(event.target.value)) }} />
      <button type="button" aria-label={muted ? 'Unmute preview' : 'Mute preview'} title={muted ? 'Unmute preview' : 'Mute preview'} onClick={() => setMuted(value => !value)} className="shrink-0 text-[#c7cbd2] hover:text-white">{muted ? <VolumeX size={17}/> : <Volume2 size={17}/>}</button>
    </div>
    <ContextMenu menu={menu} onClose={() => setMenu(null)} />
  </section>
}
