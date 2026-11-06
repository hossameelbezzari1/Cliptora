import { useRef, type ReactNode } from 'react'
import {
  AudioLines, Clapperboard, Clock3, Download, FileAudio, FolderOpen,
  Gauge, Info, SlidersHorizontal, Volume2, WandSparkles,
} from 'lucide-react'
import type { WorkflowNodeParametersProps, WorkflowNodeUI } from '../nodeTypes'
import { InspectVideoSourceParameters } from '../InspectVideoPanels'
import { mediaName } from '../../editor/library/mediaLibraryUtils'

const inputClass = 'min-h-10 w-full rounded-lg border border-[#dedee3] dark:border-[#374151] bg-white dark:bg-cl-dark-panel px-3 py-2.5 text-[13px] text-[#292929] dark:text-[#f3f4f6] outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-100 dark:focus:ring-violet-900/70'
const sub = 'mt-1.5 text-[11px] leading-5 text-[#858585] dark:text-[#b8bec7]'

type Choice = { value: string; label: string }

function Section({ title, icon: Icon, children }: {
  title: string
  icon: typeof AudioLines
  children: ReactNode
}) {
  return <section className="space-y-4 border-b border-[#e8e8e8] dark:border-[#374151] pb-5 last:border-b-0" data-extract-section={title}>
    <h3 className="flex items-center gap-2 border-b border-[#ededed] dark:border-[#374151] pb-2 text-[13px] font-semibold text-[#303030] dark:text-[#f3f4f6]">
      <Icon size={17} className="text-violet-600 dark:text-violet-300" aria-hidden="true" />{title}
    </h3>
    {children}
  </section>
}

function Select({ label, value, options, onChange, help, disabled }: {
  label: string; value: string; options: Choice[]; onChange: (value: string) => void
  help?: string; disabled?: boolean
}) {
  return <label className="block space-y-1.5">
    <span className="block text-[12px] font-medium text-[#333] dark:text-[#f3f4f6]">{label}</span>
    <select className={`${inputClass} cursor-pointer disabled:cursor-not-allowed disabled:opacity-50`}
      value={value} disabled={disabled} onChange={event => onChange(event.target.value)}>
      {options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
    </select>
    {help && <span className={sub}>{help}</span>}
  </label>
}

function TextInput({ label, value, onChange, placeholder, help, type = 'text', min, max }: {
  label: string; value: string | number; onChange: (value: string) => void
  placeholder?: string; help?: string; type?: 'text' | 'number'; min?: number; max?: number
}) {
  return <label className="block space-y-1.5">
    <span className="block text-[12px] font-medium text-[#333] dark:text-[#f3f4f6]">{label}</span>
    <input className={inputClass} type={type} value={value} placeholder={placeholder}
      min={min} max={max} step={type === 'number' ? 'any' : undefined}
      onChange={event => onChange(event.target.value)} />
    {help && <span className={sub}>{help}</span>}
  </label>
}

function Toggle({ label, description, checked, onChange, disabled }: {
  label: string; description: string; checked: boolean; onChange: (enabled: boolean) => void; disabled?: boolean
}) {
  return <label className={`flex cursor-pointer items-start justify-between gap-3 py-3 ${disabled ? 'opacity-50' : ''}`}>
    <span className="min-w-0 flex-1">
      <span className="block text-[12px] font-medium text-[#333] dark:text-[#f3f4f6]">{label}</span>
      <span className="mt-1 block text-[11px] leading-5 text-[#888] dark:text-[#b8bec7]">{description}</span>
    </span>
    <input type="checkbox" checked={checked} disabled={disabled} onChange={event => onChange(event.target.checked)}
      className="mt-0.5 size-4 shrink-0 cursor-pointer accent-violet-600 disabled:cursor-not-allowed" />
  </label>
}

function Parameters({ node, onChange, studio }: WorkflowNodeParametersProps) {
  const uploadRef = useRef<HTMLInputElement>(null)
  const settings = node.settings
  const value = (key: string, fallback: string) => String(settings[key] ?? fallback)
  const set = (key: string, next: unknown) => onChange(key, next)
  const mode = value('source_mode', 'auto')
  const format = value('output_format', 'wav')
  const trim = settings.trim_enabled === true
  const copy = format === 'copy'
  const hasPrevious = node.depends_on.length > 0
  const selectedSource = studio?.sources.find(item => item.id === studio.sourceId)

  const numberChange = (key: string, raw: string) => {
    if (!raw.trim()) { set(key, key === 'end_seconds' ? null : 0); return }
    const number = Number(raw)
    if (Number.isFinite(number) && number >= 0) set(key, number)
  }

  return <div className="space-y-5" data-extract-audio-node>
    <Section title="Video input" icon={Clapperboard}>
      <Select label="Video source" value={mode}
        options={[
          { value: 'auto', label: 'From previous node (Auto)' },
          { value: 'workflow', label: 'Choose from workflow / Media Library' },
        ]}
        onChange={next => set('source_mode', next)} />

      {mode === 'auto' && <p className="flex items-start gap-2 text-[11px] leading-5 text-[#747474] dark:text-[#b8bec7]">
        <Info size={15} className="mt-0.5 shrink-0 text-violet-600 dark:text-violet-300" />
        {hasPrevious
          ? `Uses the video selected in this workflow${selectedSource ? `: ${selectedSource.filename}` : ''}. Connected upstream nodes provide their metadata without another upload.`
          : 'No previous node connected. Select a workflow video below, or connect Inspect Video.'}
      </p>}

      {(mode === 'workflow' || !hasPrevious || !selectedSource) && studio && <InspectVideoSourceParameters
        sourceId={studio.sourceId}
        sources={studio.sources}
        mediaOptions={studio.editorMedia.filter(item => item.kind === 'video').map(item => ({ id: item.id, label: mediaName(item) }))}
        onSourceChange={studio.setSourceId}
        onMediaChange={id => { void studio.useMediaSource(id) }}
        onUpload={event => { void studio.upload(event) }}
        uploadRef={uploadRef}
        working={studio.working}
      />}
      {mode === 'auto' && hasPrevious && selectedSource && <div className="flex items-center gap-2 text-[12px] text-[#666] dark:text-[#b8bec7]">
        <FolderOpen size={15} className="text-violet-600 dark:text-violet-300" />
        <span className="truncate" title={selectedSource.filename}>{selectedSource.filename}</span>
      </div>}
    </Section>

    <Section title="Audio extraction" icon={AudioLines}>
      <Select label="Audio track" value={value('audio_track', 'auto')}
        options={[
          { value: 'auto', label: 'Auto — First audio track' },
          { value: 'all', label: 'All tracks — Separate files' },
          ...Array.from({ length: 8 }, (_, index) => ({ value: String(index), label: `Track ${index}` })),
        ]}
        help="Track numbering is relative to audio streams (0 = first audio track)." onChange={next => set('audio_track', next)} />
      <Select label="Output format" value={format}
        options={[
          { value: 'wav', label: 'WAV — Recommended for transcription' },
          { value: 'mp3', label: 'MP3 — Smaller files' },
          { value: 'aac', label: 'AAC — M4A audio' },
          { value: 'flac', label: 'FLAC — Lossless' },
          { value: 'copy', label: 'Copy original audio — No re-encoding' },
        ]}
        onChange={next => {
          set('output_format', next)
          if (next === 'copy') {
            set('sample_rate', 'auto')
            set('channels', 'original')
            set('normalize', false)
          }
        }} />
      {!copy && <>
        <Select label="Sample rate" value={value('sample_rate', '16000')}
          options={[
            { value: 'auto', label: 'Auto — Keep original' },
            { value: '16000', label: '16000 Hz — Speech / AI' },
            { value: '44100', label: '44100 Hz — Standard audio' },
            { value: '48000', label: '48000 Hz — Video audio' },
          ]} onChange={next => set('sample_rate', next)} />
        <Select label="Audio channels" value={value('channels', 'mono')}
          options={[
            { value: 'original', label: 'Keep original' },
            { value: 'mono', label: 'Mono — Recommended for transcription' },
            { value: 'stereo', label: 'Stereo' },
          ]} onChange={next => set('channels', next)} />
      </>}
      {copy && <p className="flex items-start gap-2 text-[11px] leading-5 text-[#777] dark:text-[#b8bec7]"><Info size={15}/>
        Copy preserves the original audio codec in a Matroska audio file (.mka). Sample rate, channels and normalization are unavailable.
      </p>}
    </Section>

    <Section title="Additional options" icon={SlidersHorizontal}>
      <div className="divide-y divide-[#ededed]">
        <Toggle label="Trim audio" description="Extract only a time range." checked={trim} onChange={next => set('trim_enabled', next)} />
        {trim && <div className="space-y-4 py-4">
          <TextInput label="Start (seconds)" value={String(settings.start_seconds ?? 0)}
            onChange={raw => numberChange('start_seconds', raw)} type="number" min={0} />
          <TextInput label="End (seconds)" value={settings.end_seconds == null ? '' : String(settings.end_seconds)}
            onChange={raw => numberChange('end_seconds', raw)} type="number" min={0}
            placeholder="End of video" help="Leave empty to extract to the end." />
        </div>}
        <Toggle label="Normalize audio volume" description="Use FFmpeg loudnorm for consistent loudness."
          checked={settings.normalize === true && !copy} disabled={copy} onChange={next => set('normalize', next)} />
      </div>
      <TextInput label="Output filename" value={value('output_filename', '{{video_name}}_audio')}
        onChange={next => set('output_filename', next)} help="Use {{video_name}} to insert the source filename. Extension is added automatically." />
    </Section>

    <p className="flex items-start gap-2 text-[11px] leading-5 text-[#888] dark:text-[#b8bec7]">
      <Gauge size={14} className="mt-0.5 shrink-0" />
      Extract Audio creates a new file without modifying the source. Outputs are passed to following nodes automatically.
    </p>
  </div>
}

type AudioEntry = {
  filename?: string
  format?: string
  codec?: string
  duration?: number
  size_bytes?: number
  channels?: number
  sample_rate?: number
  track?: number
  url?: string
  download_url?: string
}

function Output({ value }: { value: unknown }) {
  const raw = Array.isArray(value) ? value[0] : value
  const payload = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {}
  const entries = Array.isArray(payload.audio_files) ? payload.audio_files.filter((item): item is AudioEntry => Boolean(item) && typeof item === 'object') : []
  if (!entries.length) return <div className="p-4 text-[12px] text-[#777] dark:text-[#b8bec7]">No audio output yet. Execute the node to extract audio.</div>
  return <div className="space-y-4 p-4" data-extract-audio-output>
    <div className="flex items-center gap-2 border-b border-[#e8e8e8] dark:border-[#374151] pb-3">
      <FileAudio size={18} className="text-violet-600 dark:text-violet-300" />
      <div><p className="text-[13px] font-semibold text-[#333] dark:text-[#f3f4f6]">Audio extracted</p><p className="text-[11px] text-[#888] dark:text-[#b8bec7]">{entries.length} {entries.length === 1 ? 'audio file' : 'audio files'} · Ready for next nodes</p></div>
    </div>
    {entries.map((entry, index) => <section key={`${entry.filename ?? index}-${index}`} className="space-y-3 border-b border-[#ededed] dark:border-[#374151] pb-4 last:border-b-0">
      <div className="flex items-start gap-2"><Volume2 size={17} className="mt-0.5 shrink-0 text-violet-600 dark:text-violet-300" />
        <div className="min-w-0 flex-1">
          <p className="break-all text-[12px] font-semibold text-[#333] dark:text-[#f3f4f6]">{entry.filename ?? `Audio track ${index}`}</p>
          <p className="mt-1 text-[11px] text-[#888] dark:text-[#b8bec7]">{String(entry.format ?? 'audio').toUpperCase()} · {entry.codec ?? 'unknown codec'} · Track {entry.track ?? index}</p>
        </div>
      </div>
      {entry.url && entry.format !== 'copy' && <audio controls preload="metadata" className="h-10 w-full" src={entry.url} />}
      <div className="grid grid-cols-2 gap-y-2 text-[11px] text-[#666] dark:text-[#b8bec7]">
        <span className="flex items-center gap-1"><Clock3 size={13}/> Duration: {entry.duration ?? '—'} s</span>
        <span>Size: {typeof entry.size_bytes === 'number' ? `${(entry.size_bytes / 1048576).toFixed(2)} MB` : '—'}</span>
        <span>Sample rate: {entry.sample_rate ?? '—'} Hz</span>
        <span>Channels: {entry.channels ?? '—'}</span>
      </div>
      {entry.download_url && <a href={entry.download_url} className="inline-flex cursor-pointer items-center gap-1.5 text-[12px] font-medium text-violet-700 dark:text-violet-300 hover:underline">
        <Download size={15}/> Download audio
      </a>}
      {!entry.url && <p className="text-[11px] text-[#4b5563] dark:text-[#999]">Audio file is available to downstream workflow nodes. Preview is available for saved executions.</p>}
    </section>)}
    <p className="flex items-start gap-2 text-[11px] leading-5 text-[#888] dark:text-[#b8bec7]"><WandSparkles size={14} className="mt-0.5 shrink-0" />
      Switch to JSON to inspect the output metadata. The legacy audio path remains available for Transcribe Every Word.
    </p>
  </div>
}

// Present a single item like n8n while leaving backend artifacts as dicts.
function formatOutput(value: unknown): unknown {
  if (value === null || Array.isArray(value) || typeof value !== 'object') return value
  const data = value as Record<string, unknown>
  return Array.isArray(data.audio_files) ? [data] : value
}

const node: WorkflowNodeUI = {
  type: 'audio.extract',
  Icon: AudioLines,
  Parameters,
  Output,
  formatOutput,
}

export default node
