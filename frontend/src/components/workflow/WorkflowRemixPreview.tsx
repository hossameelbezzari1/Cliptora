
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertCircle, CheckCircle2, Pause, Play, Volume2, VolumeX } from 'lucide-react'

export type RemixVoiceover = {
  instance_id: string
  url: string
  duration: number
  filename: string
  mime_type: string
  playback_mode?: 'clip' | 'group'
  timeline_start?: number
  group_id?: string
}

export type RemixTimelineClip = {
  instance_id: string
  group_id: string
  label: string
  timeline_start: number
  timeline_end: number
  duration: number
  source_start: number
  source_end: number
  selected_text: string
  transforms?: { zoom?: number }
  voiceover: RemixVoiceover | null
  voiceover_status: 'ready' | 'missing' | 'silent' | 'invalid' | string
}

export type RemixPreviewData = {
  mode: 'browser'
  duration: number
  clips: number
  voiced_clips: number
  silent_clips: number
  group_voiceovers?: number
  missing_voiceovers: string[]
  invalid_voiceovers: { instance_id: string; reason: string }[]
  issues: string[]
  ready: boolean
  include_original_audio: boolean
  original_audio_volume: number
  timeline: RemixTimelineClip[]
}

type Props = {
  preview: RemixPreviewData
  sourceUrl: string | null
  className?: string
}

const voiceOffsetForClip = (clip: RemixTimelineClip, clipOffset: number) =>
  Math.max(0, clip.timeline_start + clipOffset - (clip.voiceover?.timeline_start ?? clip.timeline_start))

const formatTime = (seconds: number) => {
  const safe = Math.max(0, Number.isFinite(seconds) ? seconds : 0)
  const minutes = Math.floor(safe / 60)
  const whole = Math.floor(safe % 60)
  return `${String(minutes).padStart(2, '0')}:${String(whole).padStart(2, '0')}`
}

export function WorkflowRemixPreview({ preview, sourceUrl, className = '' }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const voiceRef = useRef<HTMLAudioElement>(null)
  const activeIndexRef = useRef(0)
  const playingRef = useRef(false)
  const awaitingSeekRef = useRef(false)
  const [position, setPosition] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [error, setError] = useState('')
  const [muted, setMuted] = useState(false)
  const timeline = preview.timeline
  const duration = preview.duration
  const hasVoice = useMemo(() => timeline.some(clip => clip.voiceover !== null), [timeline])
  const activeClip = timeline[activeIndexRef.current] ?? null

  const setPlayingState = useCallback((value: boolean) => {
    playingRef.current = value
    setPlaying(value)
  }, [])

  const pause = useCallback(() => {
    setPlayingState(false)
    videoRef.current?.pause()
    voiceRef.current?.pause()
  }, [setPlayingState])

  const selectClip = useCallback((index: number, offset: number, shouldPlay: boolean) => {
    const clip = timeline[index]
    const video = videoRef.current
    const voice = voiceRef.current
    if (!clip || !video || !voice) return

    const nextUrl = clip.voiceover?.url ?? ''
    const keepGroupAudio = Boolean(shouldPlay && playingRef.current && nextUrl &&
      voice.getAttribute('src') === nextUrl && clip.voiceover?.playback_mode === 'group')
    video.pause()
    if (!keepGroupAudio) voice.pause()
    activeIndexRef.current = index
    const safeOffset = Math.max(0, Math.min(offset, Math.max(0, clip.duration - 0.01)))
    setPosition(clip.timeline_start + safeOffset)

    if (voice.getAttribute('src') !== nextUrl) {
      if (nextUrl) voice.setAttribute('src', nextUrl)
      else voice.removeAttribute('src')
      voice.load()
    }
    if (nextUrl && voice.readyState >= 1) {
      const wanted = Math.min(voiceOffsetForClip(clip, safeOffset), clip.voiceover?.duration ?? 0)
      if (!keepGroupAudio || Math.abs(voice.currentTime - wanted) > 0.20) {
        try { voice.currentTime = wanted } catch { /* media not seekable yet */ }
      }
    }

    video.muted = muted || !preview.include_original_audio
    video.volume = hasVoice ? preview.original_audio_volume : 1
    setPlayingState(shouldPlay)
    awaitingSeekRef.current = shouldPlay
    const targetTime = clip.source_start + safeOffset
    if (Math.abs(video.currentTime - targetTime) > 0.025) {
      video.currentTime = targetTime
    } else {
      awaitingSeekRef.current = false
      if (shouldPlay) {
        void video.play().catch(() => { setError('Video playback was blocked'); pause() })
        if (nextUrl && voiceOffsetForClip(clip, safeOffset) < (clip.voiceover?.duration ?? 0)) {
          void voice.play().catch(() => setError('Voice playback was blocked or the MP3 is unavailable'))
        }
      }
    }
  }, [timeline, muted, preview.include_original_audio, preview.original_audio_volume,
      hasVoice, setPlayingState, pause])

  const moveTo = useCallback((requested: number, shouldPlay: boolean) => {
    if (!timeline.length) return
    const t = Math.max(0, Math.min(requested, Math.max(0, duration - 0.01)))
    const index = timeline.findIndex(clip => t >= clip.timeline_start && t < clip.timeline_end)
    const selected = index < 0 ? timeline.length - 1 : index
    selectClip(selected, t - timeline[selected].timeline_start, shouldPlay)
  }, [timeline, duration, selectClip])

  const tick = useCallback(() => {
    const video = videoRef.current
    const voice = voiceRef.current
    const clip = timeline[activeIndexRef.current]
    if (!video || !voice || !clip || !playingRef.current || video.seeking || awaitingSeekRef.current) return

    const offset = Math.max(0, video.currentTime - clip.source_start)
    if (offset >= clip.duration - 0.025) {
      const next = activeIndexRef.current + 1
      if (next >= timeline.length) {
        setPosition(duration)
        pause()
      } else {
        selectClip(next, 0, true)
      }
      return
    }

    setPosition(Math.min(duration, clip.timeline_start + offset))
    const voiceOffset = voiceOffsetForClip(clip, offset)
    if (clip.voiceover && voiceOffset < clip.voiceover.duration) {
      if (voice.readyState >= 1 && Math.abs(voice.currentTime - voiceOffset) > 0.20) {
        try { voice.currentTime = voiceOffset } catch { /* wait for metadata */ }
      }
      if (voice.paused && voice.readyState >= 2) {
        void voice.play().catch(() => setError(`Unable to play voice for ${clip.label}`))
      }
    } else if (!voice.paused) {
      voice.pause()
    }
  }, [timeline, duration, pause, selectClip])

  useEffect(() => {
    if (!playing) return
    const timer = window.setInterval(tick, 40)
    return () => window.clearInterval(timer)
  }, [tick, playing])

  useEffect(() => {
    pause()
    setPosition(0)
    setError('')
    activeIndexRef.current = 0
    awaitingSeekRef.current = false
    const voice = voiceRef.current
    if (voice) { voice.pause(); voice.removeAttribute('src'); voice.load() }
    const video = videoRef.current
    if (video && timeline.length && video.readyState >= 1) {
      video.currentTime = timeline[0].source_start
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preview, sourceUrl])

  const togglePlayback = () => {
    if (playingRef.current) { pause(); return }
    if (!sourceUrl) { setError('Choose the source video to play this montage'); return }
    setError('')
    moveTo(position >= duration - 0.02 ? 0 : position, true)
  }

  const onSeeked = () => {
    if (!awaitingSeekRef.current) return
    awaitingSeekRef.current = false
    if (!playingRef.current) return
    const video = videoRef.current
    const voice = voiceRef.current
    const clip = timeline[activeIndexRef.current]
    if (!video || !voice || !clip) return
    const offset = Math.max(0, video.currentTime - clip.source_start)
    void video.play().catch(() => { setError('Unable to play source video'); pause() })
    const voiceOffset = voiceOffsetForClip(clip, offset)
    if (clip.voiceover && voiceOffset < clip.voiceover.duration) {
      if (voice.readyState >= 1 && Math.abs(voice.currentTime - voiceOffset) > 0.20) {
        voice.currentTime = Math.min(voiceOffset, clip.voiceover.duration)
      }
      void voice.play().catch(() => setError(`Unable to play ${clip.label} MP3`))
    }
  }

  const jumpTo = (index: number) => selectClip(index, 0, playingRef.current)
  const voicedCount = timeline.filter(clip => clip.voiceover !== null).length

  return <div className={`flex h-full min-h-0 flex-col gap-2 ${className}`}>
    <div className="relative min-h-0 flex-1 overflow-hidden rounded-xl bg-slate-950">
      {sourceUrl ? <video
        ref={videoRef}
        src={sourceUrl}
        playsInline
        preload="metadata"
        onLoadedMetadata={() => {
          if (!playingRef.current && timeline.length && videoRef.current)
            videoRef.current.currentTime = timeline[activeIndexRef.current]?.source_start ?? 0
        }}
        onSeeked={onSeeked}
        onTimeUpdate={tick}
        onError={() => setError('Source video failed to load')}
        onEnded={() => { if (playingRef.current) tick() }}
        className="h-full w-full object-contain"
        style={{ transform: `scale(${Math.max(1, Math.min(3, Number(activeClip?.transforms?.zoom ?? 1)))})` }}
      /> : <div className="grid h-full place-items-center text-xs text-slate-300">Select source video</div>}
      <audio ref={voiceRef} preload="auto" aria-hidden="true"
        onLoadedMetadata={() => {
          const clip = timeline[activeIndexRef.current]
          const video = videoRef.current
          const voice = voiceRef.current
          if (clip && video && voice) {
            const offset = Math.max(0, video.currentTime - clip.source_start)
            if (Number.isFinite(voice.duration)) voice.currentTime = Math.min(voiceOffsetForClip(clip, offset), Math.max(0, voice.duration - 0.01))
          }
        }}
        onError={() => {
          const clip = timeline[activeIndexRef.current]
          if (clip?.voiceover) setError(`MP3 could not be loaded for ${clip.label}`)
        }}
      />
      <div className="pointer-events-none absolute bottom-2 left-2 flex items-center gap-1.5 rounded-md bg-black/70 px-2 py-1 text-[11px] text-white">
        <span className="font-semibold">{activeClip?.label ?? 'Preview'}</span>
        <span className="text-white/60">·</span>
        {activeClip?.voiceover ? <><Volume2 size={12} /> Voice</> : <><VolumeX size={12} /> Silent</>}
      </div>
      {!preview.ready && <span className="absolute right-2 top-2 rounded-md bg-amber-100 px-2 py-1 text-[10px] font-semibold text-amber-900">Incomplete voiceovers</span>}
    </div>
    <div className="flex shrink-0 items-center gap-2">
      <button type="button" onClick={togglePlayback} disabled={!sourceUrl || !timeline.length}
        aria-label={playing ? 'Pause montage' : 'Play montage'}
        className="grid size-8 shrink-0 place-items-center rounded-lg bg-violet-700 text-white hover:bg-violet-800 disabled:opacity-40">
        {playing ? <Pause size={15} /> : <Play size={15} />}
      </button>
      <input type="range" min="0" max={duration || 1} step="0.01" value={Math.min(position, duration)}
        onChange={event => moveTo(Number(event.currentTarget.value), playingRef.current)}
        aria-label="Seek montage timeline" className="min-w-0 flex-1 accent-violet-700" />
      <span className="w-20 shrink-0 text-right text-[10px] tabular-nums text-slate-600 dark:text-slate-300">{formatTime(position)} / {formatTime(duration)}</span>
      <button type="button" className="rounded-md p-1 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
        onClick={() => setMuted(value => {
          const next = !value
          if (videoRef.current) videoRef.current.muted = next || !preview.include_original_audio
          return next
        })}
        title={muted ? 'Unmute original audio' : 'Mute original audio'} aria-label="Toggle original audio">
        {muted ? <VolumeX size={15} /> : <Volume2 size={15} />}
      </button>
    </div>
    <div className="flex shrink-0 items-center justify-between gap-2 text-[10px] text-slate-600 dark:text-slate-300">
      <span className="flex items-center gap-1">{preview.ready ? <CheckCircle2 size={12} className="text-emerald-600" /> : <AlertCircle size={12} className="text-amber-600" />}
        {preview.group_voiceovers ? `${preview.group_voiceovers} group voices` : `${voicedCount}/${timeline.length} clip voices`} · {preview.silent_clips} silent
      </span>
      <span className="truncate">{activeClip?.selected_text || 'No narration for this clip'}</span>
    </div>
    <div className="flex max-h-12 shrink-0 gap-1 overflow-x-auto pb-1 [scrollbar-width:thin]">
      {timeline.map((clip, index) => <button key={clip.instance_id} type="button" onClick={() => jumpTo(index)}
        title={`${clip.label} · ${clip.selected_text || 'No text'} · ${clip.voiceover_status}`}
        className={`shrink-0 rounded-md border px-2 py-1 text-[10px] ${index === activeIndexRef.current ? 'border-violet-500 bg-violet-100 text-violet-900' : 'border-slate-200 text-slate-600 dark:border-slate-600 dark:text-slate-300'} ${clip.selected_text && !clip.voiceover ? 'border-amber-400' : ''}`}>
        {clip.label}
      </button>)}
    </div>
    {(error || preview.issues.length > 0) && <p role="alert" className="max-h-14 shrink-0 overflow-auto rounded-md bg-amber-50 p-2 text-[10px] text-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
      {[error, ...preview.issues].filter(Boolean).join(' · ')}
    </p>}
  </div>
}
