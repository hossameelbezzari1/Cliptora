import { useEffect, useMemo, useRef } from 'react'
import { Aperture, Pause, Play, Volume2 } from 'lucide-react'
import { useEditor } from '../../../stores/editorStore'
import { fileUrl, formatTime } from '../../../lib/api'
import type { Clip, Project } from '../../../types'

function ActiveAudio({ clip, playhead, playing }: { clip: Clip; playhead: number; playing: boolean }) {
  const element = useRef<HTMLAudioElement>(null)
  useEffect(() => {
    const el = element.current
    if (!el) return
    const target = Math.max(0, playhead - clip.start + clip.source_offset)
    if (Number.isFinite(target) && Math.abs(el.currentTime - target) > 0.35) el.currentTime = target
    if (playing) void el.play().catch(() => {})
    else el.pause()
  }, [clip, playhead, playing])
  return clip.media_id ? <audio ref={element} src={fileUrl(clip.media_id)} preload="auto"/> : null
}

function ActiveVideo({ clip, playhead, playing, muted }: { clip: Clip; playhead: number; playing: boolean; muted: boolean }) {
  const element = useRef<HTMLVideoElement>(null)
  useEffect(() => {
    const el = element.current
    if (!el) return
    const target = Math.max(0, playhead - clip.start + clip.source_offset)
    if (Number.isFinite(target) && Math.abs(el.currentTime - target) > 0.35) el.currentTime = target
    if (playing) void el.play().catch(() => {})
    else el.pause()
  }, [clip, playhead, playing])
  return clip.media_id ? <video ref={element} src={fileUrl(clip.media_id)} className="absolute inset-0 h-full w-full object-contain" muted={muted} playsInline preload="auto"/> : null
}

export function PreviewPanel({ project }: { project: Project }) {
  const tracks = useEditor(s => s.tracks)
  const playhead = useEditor(s => s.playhead)
  const setPlayhead = useEditor(s => s.setPlayhead)
  const playing = useEditor(s => s.playing)
  const setPlaying = useEditor(s => s.setPlaying)
  const active = useMemo(() => {
    const atTime = (clip: Clip) => clip.start <= playhead && clip.start + clip.duration > playhead
    const visuals = tracks.filter(t => !t.hidden).flatMap(t => t.clips.filter(c => c.type !== 'audio' && atTime(c)).map(clip => ({ clip, muted: t.muted })))
    const audio = tracks.filter(t => !t.muted).flatMap(t => t.clips.filter(c => c.type === 'audio' && atTime(c)))
    return { visuals, audio }
  }, [tracks, playhead])
  const total = Math.max(30, ...tracks.flatMap(t => t.clips.map(c => c.start + c.duration)))
  return <section className="flex min-h-0 min-w-0 flex-col items-center justify-center gap-4 overflow-hidden rounded-3xl bg-[#141618] px-4 py-5">
    <div className="relative flex min-h-0 w-full flex-1 items-center justify-center">
      <div className="relative flex max-h-full w-auto max-w-full items-center justify-center overflow-hidden rounded-2xl bg-[#08090a] shadow-[0_16px_65px_#0009]" style={{ aspectRatio: `${project.width} / ${project.height}`, height: '100%', maxHeight: '100%' }}>
        {!active.visuals.length && <div className="grid h-full w-full place-items-center text-[#4e5358]"><div className="grid justify-items-center gap-2"><Aperture size={36}/><p className="text-xs">Preview canvas</p></div></div>}
        {active.visuals.map(({ clip, muted }) => clip.type === 'video'
          ? <ActiveVideo key={clip.client_id} clip={clip} playhead={playhead} playing={playing} muted={muted}/>
          : clip.type === 'image' && clip.media_id
            ? <img key={clip.client_id} className="absolute inset-0 h-full w-full object-contain" src={fileUrl(clip.media_id)} alt={clip.name}/>
            : clip.type === 'text'
              ? <div key={clip.client_id} className="pointer-events-none absolute inset-x-[8%] top-[27%] whitespace-pre-wrap rounded-lg bg-black/40 p-3 text-center font-display text-[clamp(14px,2.3vw,32px)] font-extrabold leading-tight" style={{ color: clip.color }}>{clip.text || clip.name}</div>
              : null)}
      </div>
      {active.audio.map(clip => <ActiveAudio key={clip.client_id} clip={clip} playhead={playhead} playing={playing}/>)}
    </div>
    <div className="flex w-full max-w-190 items-center gap-4 rounded-2xl bg-[#24272a] px-4 py-3">
      <span className="shrink-0 rounded-xl bg-[#303336] px-3 py-2 text-[11px] font-bold">{project.width}:{project.height}</span>
      <button aria-label={playing ? 'Pause' : 'Play'} onClick={() => setPlaying(!playing)} className="text-white">{playing ? <Pause size={20}/> : <Play size={20}/>}</button>
      <span className="min-w-18 text-[10px] text-[#afb4b9]">{formatTime(playhead)} / {formatTime(total)}</span>
      <input className="min-w-0 flex-1" type="range" min={0} max={total} step={.1} value={Math.min(total, playhead)} onChange={e => setPlayhead(Number(e.target.value))}/>
      <Volume2 size={17} className="text-cl-muted"/>
    </div>
  </section>
}
