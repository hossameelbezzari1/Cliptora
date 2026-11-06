import { useCallback, useEffect, useRef, useState, type ChangeEvent, type RefObject } from 'react'
import {
  AlertTriangle, AudioLines, Bookmark, CheckCircle2, ChevronLeft, ChevronRight, Clock3, Clapperboard,
  FileJson, FileVideo, Film, FolderOpen, Gauge, Info, Layers3,
  ListChecks, SlidersHorizontal, Upload, Video, Zap,
} from 'lucide-react'
import { Button } from '../ui/Button'
import { Field, SelectField, SwitchField } from '../ui/Field'
import type { WorkflowSource } from './workflowTypes'

type Json = Record<string, unknown>
const object = (value: unknown): Json => value && typeof value === 'object' && !Array.isArray(value) ? value as Json : {}
const array = (value: unknown): Json[] => Array.isArray(value) ? value.map(object) : []
const show = (value: unknown): string => value == null || value === '' ? '—' : typeof value === 'boolean' ? (value ? 'Yes' : 'No') : String(value)
const duration = (seconds: unknown) => typeof seconds === 'number' && Number.isFinite(seconds) ? `${seconds.toFixed(2)} s` : '—'
const size = (bytes: unknown) => typeof bytes === 'number' && bytes >= 0 ? `${(bytes / 1024 / 1024).toFixed(2)} MB` : '—'

const sections = [
  { id: 'general', label: 'File and container', help: 'Format, file size, duration and bitrate', icon: FileJson },
  { id: 'video', label: 'Video streams', help: 'Codec, FPS, resolution, color and HDR', icon: Video },
  { id: 'audio', label: 'Audio streams', help: 'Codec, channels, sample rate and languages', icon: AudioLines },
  { id: 'subtitles', label: 'Subtitles', help: 'Subtitle tracks, languages and dispositions', icon: ListChecks },
  { id: 'chapters', label: 'Chapters', help: 'Start/end timings and titles', icon: Bookmark },
] as const

type SourceProps = {
  sourceId: number | null
  sources: WorkflowSource[]
  mediaOptions: Array<{ id: number; label: string }>
  onSourceChange: (id: number | null) => void
  onMediaChange: (id: number) => void
  onUpload: (event: ChangeEvent<HTMLInputElement>) => void
  uploadRef: RefObject<HTMLInputElement | null>
  working: boolean
  isSourceNode?: boolean
}

/** Same source controls for core.video_source and media.probe; no duplicated upload UI. */
export function InspectVideoSourceParameters({
  sourceId, sources, mediaOptions, onSourceChange, onMediaChange, onUpload,
  uploadRef, working, isSourceNode = false,
}: SourceProps) {
  return <section className="space-y-4 border-b border-[#e9e9e9] pb-5" data-video-source-parameters>
    <div className="flex items-center gap-2 border-b border-[#ededed] pb-2">
      <Film size={17} className="shrink-0 text-violet-600" aria-hidden="true" />
      <h3 className="text-[13px] font-semibold text-[#303030]">{isSourceNode ? 'Source video' : 'Workflow video input'}</h3>
    </div>
    <SelectField
      label={isSourceNode ? 'Workflow source' : 'Video source'}
      appearance="light"
      value={sourceId ?? ''}
      onChange={event => onSourceChange(event.target.value ? Number(event.target.value) : null)}
    >
      <option value="">Select a video...</option>
      {sources.map(source => <option key={source.id} value={source.id}>{source.filename}</option>)}
    </SelectField>
    <SelectField
      label="Use from Media Library"
      appearance="light"
      value=""
      disabled={working}
      onChange={event => { const id = Number(event.target.value); if (id > 0) onMediaChange(id) }}
    >
      <option value="">Choose a video...</option>
      {mediaOptions.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
    </SelectField>
    <div className="space-y-2">
      <span className="block text-[12px] font-semibold text-[#444]">Upload video</span>
      <input ref={uploadRef} type="file" accept=".mp4,.mov,.mkv,.webm,.m4v" className="sr-only" tabIndex={-1} onChange={onUpload} />
      <Button appearance="light" variant="primary" icon={<Upload size={16} />} disabled={working}
        onClick={() => uploadRef.current?.click()} className="min-h-9 rounded-full text-[12px]">
        Upload video
      </Button>
    </div>
    <p className="flex items-start gap-2 text-[11px] leading-5 text-[#777]">
      {isSourceNode ? <FolderOpen size={14} className="mt-0.5 shrink-0" aria-hidden="true" /> : <Info size={14} className="mt-0.5 shrink-0" aria-hidden="true" />}
      {isSourceNode
        ? 'The selected video is shared with this workflow. Original media files are not modified.'
        : "This selects the workflow's shared source video, not just this node. Nothing is copied or modified during inspection."}
    </p>
  </section>
}

/** n8n-style: a single vertical stack, labels above controls, no cards around every option. */
export function InspectVideoParameters({ settings, onChange }: { settings: Record<string, unknown>; onChange: (name: string, value: unknown) => void }) {
  const mode = settings.mode === 'quick' ? 'quick' : 'standard'
  const selected = new Set(Array.isArray(settings.sections)
    ? settings.sections.filter((value): value is string => typeof value === 'string')
    : sections.map(item => item.id))
  const setSection = (name: string, checked: boolean) => {
    const next = checked ? [...selected, name] : [...selected].filter(section => section !== name)
    if (next.length > 0) onChange('sections', next)
  }
  const numberValue = (name: string, fallback: number) => {
    const value = Number(settings[name] ?? fallback)
    return Number.isFinite(value) ? value : fallback
  }
  const changeNumber = (name: string, fallback: number, min: number, max: number, raw: string) => {
    const parsed = raw.trim() === '' ? fallback : Number(raw)
    if (Number.isFinite(parsed)) onChange(name, Math.max(min, Math.min(max, Math.trunc(parsed))))
  }

  return <div className="space-y-5" data-inspect-video-parameters>
    <fieldset className="border-b border-[#e9e9e9] pb-5">
      <legend className="mb-2 flex items-center gap-2 text-[13px] font-semibold text-[#303030]">
        <Gauge size={17} className="text-violet-600" aria-hidden="true" /> Inspection mode
      </legend>
      <div className="divide-y divide-[#ededed]">
        {([
          { value: 'quick', label: 'Quick', description: 'Essential technical data', icon: Zap },
          { value: 'standard', label: 'Standard', description: 'Detailed stream metadata', icon: Layers3 },
        ] as const).map(item => {
          const Icon = item.icon
          return <label key={item.value} className="flex cursor-pointer items-center gap-3 py-3 hover:bg-[#fafafa]">
            <input type="radio" name="inspect-video-mode" value={item.value}
              className="size-4 shrink-0 accent-violet-600" checked={mode === item.value}
              onChange={() => onChange('mode', item.value)} />
            <Icon size={17} className="shrink-0 text-[#7563a6]" aria-hidden="true" />
            <span className="min-w-0">
              <span className="block text-[13px] font-medium text-[#292929]">{item.label}</span>
              <span className="block text-[11px] leading-5 text-[#808080]">{item.description}</span>
            </span>
          </label>
        })}
      </div>
    </fieldset>

    <fieldset className="border-b border-[#e9e9e9] pb-5">
      <legend className="mb-1 flex items-center gap-2 text-[13px] font-semibold text-[#303030]">
        <Layers3 size={17} className="text-violet-600" aria-hidden="true" /> Metadata to extract
      </legend>
      <div className="divide-y divide-[#ededed]">
        {sections.map(item => {
          const Icon = item.icon
          return <label key={item.id} className="flex cursor-pointer items-center gap-3 py-3 hover:bg-[#fafafa]">
            <input type="checkbox" className="size-4 shrink-0 accent-violet-600"
              checked={selected.has(item.id)} disabled={selected.size === 1 && selected.has(item.id)}
              onChange={event => setSection(item.id, event.target.checked)} />
            <Icon size={17} className="shrink-0 text-[#7665a7]" aria-hidden="true" />
            <span className="min-w-0">
              <span className="block text-[13px] font-medium text-[#313131]">{item.label}</span>
              <span className="block text-[11px] leading-5 text-[#858585]">{item.help}</span>
            </span>
          </label>
        })}
      </div>
      <p className="mt-2 flex items-start gap-2 text-[11px] leading-5 text-[#858585]">
        <Info size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
        At least one section must remain selected. The five legacy fields are always included.
      </p>
    </fieldset>

    <div className="space-y-4 border-b border-[#e9e9e9] pb-5">
      <div>
        <div className="mb-2 flex items-center gap-2 text-[12px] font-semibold text-[#444]">
          <Video size={16} className="text-violet-600" aria-hidden="true" /> Video stream index
        </div>
        <Field label="Video stream index" hideLabel appearance="light" type="number" min={-1} max={256} step={1}
          value={numberValue('video_stream_index', -1)}
          onChange={event => changeNumber('video_stream_index', -1, -1, 256, event.target.value)}
          hint="-1 = auto" />
      </div>
      <div>
        <div className="mb-2 flex items-center gap-2 text-[12px] font-semibold text-[#444]">
          <AudioLines size={16} className="text-violet-600" aria-hidden="true" /> Audio stream index
        </div>
        <Field label="Audio stream index" hideLabel appearance="light" type="number" min={-1} max={256} step={1}
          value={numberValue('audio_stream_index', -1)}
          onChange={event => changeNumber('audio_stream_index', -1, -1, 256, event.target.value)}
          hint="-1 = auto" />
      </div>
    </div>

    <fieldset className="border-b border-[#e9e9e9] pb-5">
      <legend className="mb-2 flex items-center gap-2 text-[13px] font-semibold text-[#303030]">
        <SlidersHorizontal size={17} className="text-violet-600" aria-hidden="true" /> Additional options
      </legend>
      <div className="divide-y divide-[#ededed]">
        <div className="py-3"><SwitchField label="Include container and stream metadata tags"
          checked={settings.include_tags === true} onChange={value => onChange('include_tags', value)} /></div>
        <div className="py-3"><SwitchField label="Attach complete FFprobe JSON (standard only)"
          checked={mode === 'standard' && settings.include_raw === true} disabled={mode === 'quick'}
          onChange={value => onChange('include_raw', value)} /></div>
        <div className="py-3"><SwitchField label="Preserve missing/null fields"
          checked={settings.include_empty === true} onChange={value => onChange('include_empty', value)} /></div>
      </div>
    </fieldset>

    <div className="border-b border-[#e9e9e9] pb-5">
      <div className="mb-2 flex items-center gap-2 text-[12px] font-semibold text-[#444]">
        <Clock3 size={16} className="text-violet-600" aria-hidden="true" /> FFprobe timeout (5–300 seconds)
      </div>
      <Field label="FFprobe timeout" hideLabel appearance="light" type="number" min={5} max={300} step={1}
        value={numberValue('timeout_seconds', 120)}
        onChange={event => changeNumber('timeout_seconds', 120, 5, 300, event.target.value)} />
    </div>

    <p className="flex items-start gap-2 border-l-2 border-violet-300 bg-violet-50/50 px-3 py-2.5 text-[11px] leading-5 text-[#6b627b]">
      <Info size={15} className="mt-0.5 shrink-0 text-violet-600" aria-hidden="true" />
      This node reads metadata only. Silence, scene, freeze and black-frame scanning require separate analysis nodes.
    </p>
  </div>
}

/** Left input panel uses the same flat divider-list treatment as the settings. */
export function InspectVideoInput({ source, hasUpstream }: { source: WorkflowSource | null; hasUpstream: boolean }) {
  return <div className="divide-y divide-[#eaeaea] border-b border-[#eaeaea] bg-white" data-inspect-video-input>
    <div className="flex items-start gap-3 px-4 py-4">
      <FileVideo size={20} className="mt-0.5 shrink-0 text-violet-600" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <span className="block text-[12px] font-semibold text-[#303030]">Video source</span>
        {source ? <>
          <span className="mt-1 block break-all text-[13px] text-[#303030]">{source.filename}</span>
          <span className="mt-1 block text-[11px] text-[#898989]">{size(source.size_bytes)} · Source #{source.id}</span>
        </> : <span className="mt-1 block text-[12px] text-amber-700">No video selected. Choose a source in Parameters.</span>}
      </div>
    </div>
    {source && <div className="flex items-center gap-2 px-4 py-3 text-[12px] font-medium text-emerald-700">
      <CheckCircle2 size={17} className="shrink-0" aria-hidden="true" /> Selected for workflow execution
    </div>}
    <div className="flex items-start gap-2 px-4 py-3 text-[11px] leading-5 text-[#777]">
      <Info size={15} className="mt-0.5 shrink-0" aria-hidden="true" />
      <p>The original file is not modified. {hasUpstream ? 'Connected nodes also supply their JSON output below.' : 'No upstream JSON is required to inspect a workflow source.'}</p>
    </div>
  </div>
}

function Metric({ name, value }: { name: string; value: unknown }) {
  return <div className="px-1 py-3">
    <span className="block text-[11px] font-medium text-[#888]">{name}</span>
    <span className="mt-1 block break-words text-[13px] font-semibold text-[#292929]">{show(value)}</span>
  </div>
}

function DetailList({ data }: { data: Json }) {
  const entries = Object.entries(data).filter(([key]) => key !== 'tags')
  return <div className="divide-y divide-[#eaeaea]">
    {entries.length ? entries.map(([key, value]) => <div key={key} className="px-1 py-3 text-[12px]">
      <span className="block font-medium text-[#777]">{key.replace(/_/g, ' ')}</span>
      <span className="mt-1 block break-all text-[#333]">{typeof value === 'object' ? JSON.stringify(value) : show(value)}</span>
    </div>) : <p className="py-3 text-xs text-[#888]">No values available.</p>}
    {Object.keys(object(data.tags)).length > 0 && <details className="py-3"><summary className="cursor-pointer text-xs text-[#555]">Tags</summary><pre className="mt-2 overflow-auto whitespace-pre-wrap text-[11px]">{JSON.stringify(data.tags, null, 2)}</pre></details>}
  </div>
}

export function InspectVideoOutput({ value }: { value: unknown }) {
  const probe = object(object(value).probe)
  const hasProbe = Object.keys(probe).length > 0
  const [tab, setTab] = useState<'overview' | 'video' | 'audio' | 'subtitles' | 'chapters'>('overview')
  const tabScrollRef = useRef<HTMLDivElement>(null)
  const tabContentRef = useRef<HTMLDivElement>(null)
  const [canScrollBack, setCanScrollBack] = useState(false)
  const [canScrollNext, setCanScrollNext] = useState(false)

  const videos = array(probe.videos)
  const audio = array(probe.audio)
  const subtitles = array(probe.subtitles)
  const chapters = array(probe.chapters)
  const video = object(probe.video)
  const format = object(probe.format)
  const warnings = Array.isArray(probe.warnings) ? probe.warnings.map(String) : []
  const tabs = [
    { id: 'overview', label: 'Overview' }, { id: 'video', label: `Video (${videos.length})` },
    { id: 'audio', label: `Audio (${audio.length})` }, { id: 'subtitles', label: `Subtitles (${subtitles.length})` },
    { id: 'chapters', label: `Chapters (${chapters.length})` },
  ] as const
  const collection = tab === 'video' ? videos : tab === 'audio' ? audio : tab === 'subtitles' ? subtitles : chapters

  const updateScrollButtons = useCallback(() => {
    const container = tabScrollRef.current
    if (!container) return
    const maxScrollLeft = Math.max(0, container.scrollWidth - container.clientWidth)
    setCanScrollBack(container.scrollLeft > 1)
    setCanScrollNext(container.scrollLeft < maxScrollLeft - 1)
  }, [])

  useEffect(() => {
    if (!hasProbe) return
    const container = tabScrollRef.current
    if (!container) return

    updateScrollButtons()
    const observer = typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(updateScrollButtons)
      : null
    observer?.observe(container)
    if (tabContentRef.current) observer?.observe(tabContentRef.current)
    window.addEventListener('resize', updateScrollButtons)

    return () => {
      observer?.disconnect()
      window.removeEventListener('resize', updateScrollButtons)
    }
  }, [hasProbe, videos.length, audio.length, subtitles.length, chapters.length, updateScrollButtons])

  const scrollTabs = (direction: -1 | 1) => {
    const container = tabScrollRef.current
    if (!container) return
    container.scrollBy({
      left: direction * Math.max(120, Math.round(container.clientWidth * 0.7)),
      behavior: 'smooth',
    })
  }

  if (!hasProbe) return <p className="p-4 text-xs text-[#888]">No Inspect Video output found. Run the workflow to inspect the source.</p>

  return <div className="space-y-4 p-4" data-inspect-video-output>
    <div className="flex items-center gap-2 border-b border-[#ededed] pb-3">
      <Film size={17} className="text-violet-600" aria-hidden="true" />
      <div className="min-w-0"><p className="text-[13px] font-semibold text-[#303030]">Video inspection</p><p className="text-[11px] text-[#888]">{show(probe.inspection_mode ?? 'legacy')} · Non-destructive FFprobe</p></div>
    </div>

    <div className="flex min-w-0 items-center gap-1 border-b border-[#ededed]" data-inspect-tabs-navigation>
      <button
        type="button"
        onClick={() => scrollTabs(-1)}
        disabled={!canScrollBack}
        aria-label="Scroll tabs back"
        title="Back"
        className="mb-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-[#e6e6e6] bg-white text-[#555] transition-colors hover:border-violet-200 hover:bg-violet-50 hover:text-violet-700 disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:border-[#e6e6e6] disabled:hover:bg-white disabled:hover:text-[#555]"
      >
        <ChevronLeft size={15} aria-hidden="true" />
      </button>

      <div
        ref={tabScrollRef}
        role="tablist"
        aria-label="Video metadata sections"
        onScroll={updateScrollButtons}
        className="min-w-0 flex-1 overflow-x-auto overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        <div ref={tabContentRef} className="flex w-max gap-4">
          {tabs.map(item => <button
            role="tab"
            aria-selected={tab === item.id}
            key={item.id}
            type="button"
            onClick={() => setTab(item.id)}
            className={`shrink-0 whitespace-nowrap border-b-2 px-1 pb-2 pt-1 text-[11px] font-medium ${tab === item.id ? 'border-[#303030] text-[#252525]' : 'border-transparent text-[#888] hover:text-[#333]'}`}
          >{item.label}</button>)}
        </div>
      </div>

      <button
        type="button"
        onClick={() => scrollTabs(1)}
        disabled={!canScrollNext}
        aria-label="Scroll tabs next"
        title="Next"
        className="mb-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-[#e6e6e6] bg-white text-[#555] transition-colors hover:border-violet-200 hover:bg-violet-50 hover:text-violet-700 disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:border-[#e6e6e6] disabled:hover:bg-white disabled:hover:text-[#555]"
      >
        <ChevronRight size={15} aria-hidden="true" />
      </button>
    </div>

    {tab === 'overview' ? <>
      <div className="divide-y divide-[#eaeaea]">
        <Metric name="Duration" value={duration(probe.duration)} />
        <Metric name="Resolution" value={probe.width && probe.height ? `${probe.width} × ${probe.height}` : '—'} />
        <Metric name="FPS" value={video.fps} />
        <Metric name="File size" value={size(probe.bytes)} />
        <Metric name="Video codec" value={video.codec} />
        <Metric name="Audio" value={probe.has_audio ? `${audio.length || '✓'} stream(s)` : 'No audio'} />
      </div>
      {Object.keys(format).length > 0 && <section><h3 className="border-b border-[#eaeaea] pb-2 text-[12px] font-semibold text-[#303030]">Container</h3><DetailList data={format} /></section>}
    </> : collection.length ? collection.map((entry, index) => <section key={`${tab}-${index}`} className="space-y-2 border-b border-[#ededed] pb-3">
      <h3 className="flex items-center gap-2 text-[12px] font-semibold text-[#444]">
        {tab === 'video' ? <Video size={15} /> : tab === 'audio' ? <AudioLines size={15} /> : tab === 'subtitles' ? <ListChecks size={15} /> : <Clapperboard size={15} />}
        {tab === 'chapters' ? `Chapter ${index + 1}` : `Stream #${show(entry.index)}`}
      </h3>
      <DetailList data={entry} />
    </section>) : <p className="py-6 text-center text-[12px] text-[#888]">No {tab} metadata found or this section was disabled.</p>}
    {warnings.length > 0 && <div className="border-l-2 border-amber-400 bg-amber-50 p-3"><p className="mb-1 flex items-center gap-1.5 text-[12px] font-semibold text-amber-800"><AlertTriangle size={15} /> Warnings</p>{warnings.map((item, index) => <p key={index} className="text-[11px] leading-5 text-amber-900">{item}</p>)}</div>}
    <p className="text-[11px] leading-4 text-[#999]">Switch to JSON view to copy the full output for downstream workflow nodes.</p>
  </div>
}
