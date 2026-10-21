import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react'
import {
  Aperture, ArrowLeftToLine, ArrowRightToLine, Check, ChevronDown, Copy,
  FlipHorizontal, FlipVertical, Lock, Maximize2, Move, MousePointer2, Pause,
  Play, RotateCcw, RotateCw, Scaling, Scissors, Trash2, Type, Unlock,
  Volume2, VolumeX,
} from 'lucide-react'
import { useEditor, MIN_CLIP } from '../../../stores/editorStore'
import { formatTime } from '../../../lib/api'
import { ContextMenu, type ContextAction, type MenuState } from '../../ui/ContextMenu'
import type { Clip, Project, Track } from '../../../types'
import { AudioSource, PreviewObject } from './PreviewObject'
import { clamp, getObjectTransform, resetTransform, round, type PreviewTool } from './previewGeometry'

const tools: { id: PreviewTool; label: string; description: string; icon: typeof MousePointer2 }[] = [
  { id: 'select', label: 'Select', description: 'Click an object, then drag to move it', icon: MousePointer2 },
  { id: 'move', label: 'Move', description: 'Drag an object to change X / Y', icon: Move },
  { id: 'resize', label: 'Resize', description: 'Drag an object to change width / height', icon: Maximize2 },
  { id: 'rotate', label: 'Rotate', description: 'Drag an object around its center', icon: RotateCw },
  { id: 'scale', label: 'Scale', description: 'Drag an object to scale proportionally', icon: Scaling },
]

type VisibleObject = { clip: Clip; track: Track }

const prettyKind: Record<Clip['type'], string> = { video: 'Video', image: 'Image', text: 'Text', audio: 'Audio' }

export function PreviewPanel({ project }: { project: Project }) {
  const tracks = useEditor(s => s.tracks)
  const playhead = useEditor(s => s.playhead)
  const setPlayhead = useEditor(s => s.setPlayhead)
  const playing = useEditor(s => s.playing)
  const setPlaying = useEditor(s => s.setPlaying)
  const selectedClipId = useEditor(s => s.selectedClipId)
  const selectClip = useEditor(s => s.selectClip)
  const selectTrack = useEditor(s => s.selectTrack)
  const [tool, setTool] = useState<PreviewTool>('select')
  const [muted, setMuted] = useState(false)
  const [menu, setMenu] = useState<MenuState>(null)
  const [showObjectList, setShowObjectList] = useState(false)
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
    const present = (clip: Clip) => playhead >= clip.start - 0.0001 && playhead < clip.start + clip.duration - 0.0001
    const visible: VisibleObject[] = [...tracks].reverse()
      .filter(track => !track.hidden)
      .flatMap(track => track.clips.filter(clip => clip.type !== 'audio' && present(clip)).map(clip => ({ clip, track })))
    const audio = tracks.filter(track => !track.hidden)
      .flatMap(track => track.clips.filter(clip => clip.type === 'audio' && present(clip)).map(clip => ({ clip, muted: muted || track.muted })))
    const background = [...tracks].reverse().find(track => !track.hidden && track.background_color && track.background_color !== '#101214')?.background_color ?? '#08090a'
    return { visible, audio, background }
  }, [tracks, playhead, muted])

  const selected = tracks.flatMap(track => track.clips.map(clip => ({ track, clip })))
    .find(item => item.clip.client_id === selectedClipId)
  const selectionIsOnCanvas = active.visible.some(item => item.clip.client_id === selectedClipId)
  const total = Math.max(30, ...tracks.flatMap(track => track.clips.map(clip => clip.start + clip.duration)))
  const editable = !!selected && !selected.track.locked && !selected.clip.locked

  const choose = (clip: Clip) => {
    const track = useEditor.getState().tracks.find(item => item.clips.some(candidate => candidate.client_id === clip.client_id))
    selectClip(clip.client_id)
    if (track) selectTrack(track.client_id)
    setShowObjectList(false)
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
    setShowObjectList(false)
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

  return <section data-preview-root onKeyDown={keyDown} className="flex h-full min-h-0 min-w-0 flex-col gap-2 overflow-hidden bg-[#141618] p-2.5" aria-label="Interactive video preview">
    <header className="flex shrink-0 flex-wrap items-center justify-between gap-1.5 border-b border-white/5 pb-2">
      <div className="flex min-w-0 flex-1 items-center gap-1.5">
        <span className="mr-1 shrink-0 text-[10px] font-extrabold uppercase tracking-wide text-[#b2b7bf]">Preview</span>
        <div className="relative min-w-0">
          <button type="button" onClick={() => setShowObjectList(value => !value)} aria-expanded={showObjectList} title="Choose an object, including objects covered by another layer" className="flex max-w-[180px] min-w-0 items-center gap-1 rounded-md bg-[#272a2e] px-2 py-1.5 text-[10px] text-white hover:bg-[#34383d]">
            <MousePointer2 size={12} className="shrink-0 text-[#cda4ff]" />
            <span className="truncate">{selected?.clip.name ?? 'Select object'}</span>
            <ChevronDown size={12} className="shrink-0" />
          </button>
          {showObjectList && <div className="absolute top-full left-0 z-50 mt-1 max-h-56 w-64 overflow-y-auto rounded-lg border border-white/15 bg-[#26282d] p-1 shadow-xl">
            <div className="px-2 py-1.5 text-[10px] font-medium text-cl-muted">Objects at {formatTime(playhead)} (top to bottom)</div>
            {[...active.visible].reverse().map(({ clip }) => <button key={clip.client_id} type="button" onClick={() => choose(clip)} className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-[11px] hover:bg-white/10">
              {selectedClipId === clip.client_id ? <Check size={13} className="text-[#cda4ff]" /> : <span className="w-[13px]" />}
              <span className="min-w-0 flex-1 truncate">{clip.name}</span>
              <span className="text-[10px] text-cl-muted">{prettyKind[clip.type]}</span>
            </button>)}
            {!active.visible.length && <div className="px-2 py-3 text-xs text-cl-muted">No visual objects at playhead.</div>}
            <button type="button" onClick={() => { selectClip(null); setShowObjectList(false) }} className="mt-1 w-full rounded-md border-t border-white/10 px-2 py-2 text-left text-[11px] hover:bg-white/10">Clear selection</button>
          </div>}
        </div>
        {selected && !selectionIsOnCanvas && selected.clip.type !== 'audio' && <button type="button" onClick={() => jumpTo(selected.clip)} className="shrink-0 rounded-md border border-[#ac7af7]/50 bg-[#382443] px-2 py-1.5 text-[10px] text-[#ead9ff] hover:bg-[#473056]" title="The selected clip is outside the current time or its layer is hidden">Go to clip</button>}
      </div>
      <span className="hidden text-[10px] text-[#7d838b] 2xl:block">Right-click for actions</span>
    </header>

    <div role="toolbar" aria-label="Preview transform tools" className="flex shrink-0 flex-wrap items-center gap-1.5">
      {tools.map(item => <button type="button" key={item.id} onClick={() => setTool(item.id)} title={item.description} aria-label={`${item.label} tool`} aria-pressed={tool === item.id}
        className={`flex items-center gap-1 rounded-md px-2 py-1.5 text-[10px] font-semibold ${tool === item.id ? 'bg-[#603296] text-white ring-1 ring-[#ac7af7]' : 'bg-[#22252a] text-[#aeb2bb] hover:text-white'}`}>
        <item.icon size={13} /><span className="hidden xl:inline">{item.label}</span>
      </button>)}
      <span className="ml-auto truncate text-[10px] text-cl-muted">{project.width}×{project.height}</span>
    </div>

    <div ref={viewport} className="relative flex min-h-0 min-w-0 flex-1 items-center justify-center overflow-hidden rounded-md bg-[#0d0f12]">
      <div data-preview-canvas tabIndex={0} role="application" aria-label="Canvas, click an object to select or right-click for options" className="relative shrink-0 select-none overflow-hidden shadow-[0_0_0_1px_#ffffff25] outline-none focus-visible:ring-2 focus-visible:ring-[#bb98ff]" style={{ width: canvasWidth, height: canvasHeight, background: active.background }}
        onClick={() => { selectClip(null); setShowObjectList(false) }} onContextMenu={event => showMenu(event)}>
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

    <div className="flex min-h-[24px] shrink-0 items-center gap-1 overflow-hidden text-[10px] text-[#aeb3bb]" aria-live="polite">
      {selected?.clip && selectionIsOnCanvas ? <>
        <span className="shrink-0 rounded bg-[#362445] px-1.5 py-1 font-medium text-[#e5cbff]">Selected</span>
        <span className="min-w-0 flex-1 truncate">{selected.clip.name} · {prettyKind[selected.clip.type]} · {tool === 'select' ? 'Drag to move' : tools.find(item => item.id === tool)?.description}</span>
      </> : selected?.clip ? <span className="truncate text-[#d9b8ff]">{selected.clip.type === 'audio' ? `${selected.clip.name} — audio only; edit its properties in Clip Settings.` : `${selected.clip.name} — not visible at this playhead. Use “Go to clip”.`}</span>
        : <span className="truncate">Select an object from the canvas or dropdown. Purple outline = selected · corner square = resize · top circle = rotate · right-click = actions.</span>}
    </div>

    <div className="flex w-full shrink-0 items-center gap-2 rounded-lg bg-[#25282c] px-2.5 py-2">
      <button type="button" aria-label={playing ? 'Pause preview' : 'Play preview'} title={playing ? 'Pause' : 'Play'} onClick={() => setPlaying(!playing)} className="shrink-0 text-white hover:text-[#cfaaff]">{playing ? <Pause size={19} /> : <Play size={19} />}</button>
      <span className="shrink-0 text-[10px] tabular-nums text-[#d1d4da]">{formatTime(playhead)} / {formatTime(total)}</span>
      <input aria-label="Preview playhead" className="min-w-0 flex-1" type="range" min={0} max={total} step={0.01} value={Math.min(playhead, total)} onChange={event => { setPlaying(false); setPlayhead(Number(event.target.value)) }} />
      <button type="button" aria-label={muted ? 'Unmute preview' : 'Mute preview'} title={muted ? 'Unmute preview' : 'Mute preview'} onClick={() => setMuted(value => !value)} className="shrink-0 text-[#c7cbd2] hover:text-white">{muted ? <VolumeX size={17}/> : <Volume2 size={17}/>}</button>
    </div>
    <ContextMenu menu={menu} onClose={() => setMenu(null)} />
  </section>
}
