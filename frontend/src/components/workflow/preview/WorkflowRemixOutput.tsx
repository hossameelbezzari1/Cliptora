import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, Play, Pause, RotateCcw } from 'lucide-react'
import type { WorkflowNodeOutputProps } from '../nodeTypes'

type Clip = {
  clip_id: string
  label?: string
  original_clip_id?: string
  instance_id: string
  duplicate_of?: string | null
  source_start: number
  source_end: number
  transforms?: { zoom?: number }
}
type Group = { group_id: string; label: string; title?: string; clips: Clip[] }
type Manifest = { version: number; groups: Group[] }

type PlayItem = Clip & { group: string; name: string; index: number }

const object = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
const seconds = (value: number) => Number.isFinite(value) ? value.toFixed(2) + 's' : 'â€”'

export function WorkflowRemixOutput({ value, mediaUrl }: WorkflowNodeOutputProps) {
  const result = object(value)
  const manifest = object(result.clip_manifest) as Partial<Manifest>
  const groups = Array.isArray(manifest.groups) ? manifest.groups : []
  const clips = useMemo(() => groups.flatMap(group =>
    (Array.isArray(group.clips) ? group.clips : []).map((clip, index) => ({
      ...clip,
      group: group.label || group.group_id,
      name: clip.label || `${group.label || group.group_id}${index + 1}`,
      index,
    }))), [groups])
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [playing, setPlaying] = useState(false)
  const videoRef = useRef<HTMLVideoElement>(null)
  const sequenceRef = useRef(false)
  const shouldPlay = useRef(false)
  const selectedIndexRef = useRef(0)
  selectedIndexRef.current = selectedIndex
  const selected = clips[selectedIndex] ?? clips[0]
  const total = clips.reduce((sum, clip) => sum + Math.max(0, clip.source_end - clip.source_start), 0)

  useEffect(() => {
    shouldPlay.current = false
    sequenceRef.current = false
    setPlaying(false)
    setSelectedIndex(0)
    if (videoRef.current && clips.length) {
      videoRef.current.pause()
      videoRef.current.currentTime = clips[0].source_start
    }
  }, [mediaUrl, result.clip_manifest])

  const go = (index: number, sequence: boolean, autoplay = true) => {
    if (!clips[index]) return
    const player = videoRef.current
    sequenceRef.current = sequence
    shouldPlay.current = autoplay
    setSelectedIndex(index)
    selectedIndexRef.current = index
    if (!player) return
    player.pause()
    const target = clips[index].source_start
    if (Math.abs(player.currentTime - target) < 0.04 && autoplay) {
      void player.play().catch(() => { shouldPlay.current = false; setPlaying(false) })
    } else {
      player.currentTime = target
    }
    setPlaying(false)
  }

  const advance = () => {
    if (!sequenceRef.current) {
      videoRef.current?.pause()
      shouldPlay.current = false
      setPlaying(false)
      return
    }
    const next = selectedIndexRef.current + 1
    if (next >= clips.length) {
      videoRef.current?.pause()
      shouldPlay.current = false
      sequenceRef.current = false
      setPlaying(false)
      return
    }
    go(next, true)
  }

  if (!clips.length) {
    const count = Array.isArray(result.highlights) ? result.highlights.length : 0
    return <div className="space-y-2 p-4 text-xs text-[#666] dark:text-[#b8bec7]">
      <p className="font-semibold">{count} validated highlights</p>
      <p>{count ? 'Connect Cut Highlights to see the visual clip timeline.' : 'No clips were generated in this run.'}</p>
      {Array.isArray(result.rejected) && result.rejected.length > 0 &&
        <p>{result.rejected.length} items were rejected. Inspect JSON for details.</p>}
    </div>
  }

  return <div className="space-y-3 p-3 text-[#333] dark:text-[#f3f4f6]">
    <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
      <span className="font-semibold">{groups.length} Groups Â· {clips.length} Clips</span>
      <span className="text-[#777] dark:text-[#b8bec7]">{seconds(total)} total</span>
    </div>
    <div className="relative overflow-hidden rounded-lg bg-black aspect-video">
      {mediaUrl ? <video ref={videoRef} src={mediaUrl} playsInline preload="metadata"
        className="h-full w-full object-contain"
        style={{ transform: `scale(${selected?.transforms?.zoom ?? 1})` }}
        onSeeked={() => {
          if (shouldPlay.current) {
            void videoRef.current?.play().catch(() => {
              setPlaying(false)
              shouldPlay.current = false
            })
          }
        }}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onTimeUpdate={() => {
          const index = selectedIndexRef.current
          const active = clips[index]
          if (active && videoRef.current && videoRef.current.currentTime >= active.source_end - 0.04) advance()
        }}
        onEnded={advance}
      /> : <div className="absolute inset-0 grid place-content-center px-3 text-center text-xs text-white/75">
        Select this video from the Media Library to enable playback preview.
      </div>}
    </div>
    <div className="flex items-center justify-between gap-2">
      <button type="button" disabled={!mediaUrl || !clips.length} onClick={() => go(0, true)}
        className="flex items-center gap-1.5 rounded-md bg-violet-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40">
        {playing ? <Pause size={13} /> : <Play size={13} />}
        Play montage
      </button>
      <div className="flex items-center gap-1">
        <button title="Previous clip" type="button" className="rounded-md p-1.5 hover:bg-[#eee] dark:hover:bg-[#374151]" onClick={() => go(Math.max(0, selectedIndex - 1), false)}><ChevronLeft size={17} /></button>
        <span className="text-xs tabular-nums">{selectedIndex + 1}/{clips.length}</span>
        <button title="Next clip" type="button" className="rounded-md p-1.5 hover:bg-[#eee] dark:hover:bg-[#374151]" onClick={() => go(Math.min(clips.length - 1, selectedIndex + 1), false)}><ChevronRight size={17} /></button>
        <button title="Restart clip" type="button" className="rounded-md p-1.5 hover:bg-[#eee] dark:hover:bg-[#374151]" onClick={() => go(selectedIndex, true)}><RotateCcw size={15} /></button>
      </div>
    </div>
    <div className="space-y-2">
      {groups.map(group => {
        const indices = clips.map((clip, i) => ({ clip, i })).filter(({ clip }) => clip.group === (group.label || group.group_id))
        return <section key={group.group_id} className="space-y-1.5">
          <p className="text-xs font-semibold">Group {group.label || group.group_id} Â· {group.title ?? ''}</p>
          <div className="flex flex-wrap gap-1.5">
            {indices.map(({ clip, i }) => <button key={clip.instance_id} type="button" onClick={() => go(i, false)}
              className={`min-w-[68px] rounded-md border px-2 py-1.5 text-left text-[11px] ${i === selectedIndex ? 'border-violet-600 bg-violet-50 text-violet-700 dark:bg-violet-950/30 dark:text-violet-200' : 'border-[#ddd] dark:border-[#4b5563]'}`}>
              <span className="block font-semibold">{clip.name}{clip.duplicate_of ? ' â†»' : ''}</span>
              <span className="block opacity-70">{seconds(clip.source_end - clip.source_start)}</span>
              <span className="block opacity-60">{seconds(clip.source_start)}â€“{seconds(clip.source_end)}</span>
            </button>)}
          </div>
        </section>
      })}
    </div>
    <p className="text-[11px] text-[#888] dark:text-[#aaa]">Browser preview uses the original video, seeks between segments, and applies CSS zoom. Small playback gaps may occur; final MP4 uses FFmpeg.</p>
  </div>
}
