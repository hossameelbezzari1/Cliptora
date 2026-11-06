import { useMemo, useState, type ReactNode } from 'react'
import {
  AudioLines, Captions, CheckCheck, ChevronDown, Clock3, Copy,
  Download, FileText, Info, Languages, Search, SlidersHorizontal,
  Sparkles, Timer, WandSparkles,
} from 'lucide-react'
import { Field, SelectField, SwitchField } from '../../ui/Field'
import type { WorkflowNodeParametersProps, WorkflowNodeUI } from '../nodeTypes'

type Word = { id: number; text: string; start: number; end: number; confidence?: number }
type Segment = { start: number; end: number; text: string; start_word_id: number; end_word_id: number }
type Result = {
  status?: string
  text?: string
  language?: string
  language_probability?: number | null
  duration?: number | null
  words?: Word[]
  segments?: Segment[]
  word_count?: number
  segment_count?: number
  source_start_seconds?: number
  model?: string
}

const fieldClass = 'cursor-pointer'

function Section({ icon: Icon, title, children }: {
  icon: typeof AudioLines
  title: string
  children: ReactNode
}) {
  return <section className="space-y-4 border-b border-[#e9e9e9] dark:border-[#374151] pb-5 last:border-0">
    <div className="flex items-center gap-2 border-b border-[#ededed] dark:border-[#374151] pb-2 text-[13px] font-semibold text-[#343434] dark:text-[#f3f4f6]">
      <Icon size={16} className="text-violet-600 dark:text-violet-300" aria-hidden="true" />{title}
    </div>
    {children}
  </section>
}

function Choice({ label, hint, value, options, onChange }: {
  label: string
  hint?: string
  value: string
  options: { value: string; label: string }[]
  onChange: (next: string) => void
}) {
  return <SelectField appearance="light" label={label} hint={hint} value={value}
    onChange={event => onChange(event.target.value)} className={fieldClass}>
    {options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
  </SelectField>
}

function Parameters({ node, onChange, studio }: WorkflowNodeParametersProps) {
  const cfg = node.settings
  const str = (key: string, fallback: string) => String(cfg[key] ?? fallback)
  const set = (key: string, value: unknown) => onChange(key, value)
  const upstream = (studio?.nodes ?? []).filter(n => node.depends_on.includes(n.id))
  const connectedAudio = upstream.some(n => n.type === 'audio.extract')
  const [advanced, setAdvanced] = useState(false)

  return <div className="space-y-5" data-transcribe-every-word>
    <Section title="Audio input" icon={AudioLines}>
      <div className="space-y-1.5">
        <div className="text-[12px] font-medium text-[#444] dark:text-[#b8bec7]">Audio source</div>
        <div className="flex min-h-10 items-center gap-2 rounded-lg border border-[#dedede] dark:border-[#374151] bg-[#fafafa] dark:bg-[#1f2937] px-3 text-[13px] text-[#333] dark:text-[#f3f4f6]">
          <AudioLines size={15} className="text-violet-600 dark:text-violet-300" /> From previous node (Auto)
        </div>
        <p className="text-[11px] leading-5 text-[#858585] dark:text-[#b8bec7]">Reads audio from the connected Extract Audio node. No duplicate upload.</p>
      </div>
      {connectedAudio ? <div className="flex items-center gap-2 text-[12px] text-[#555] dark:text-[#b8bec7]">
        <CheckCheck size={15} className="text-emerald-600 dark:text-emerald-300" /> Extract Audio connected
      </div> : <p className="flex gap-2 text-[12px] leading-5 text-amber-700 dark:text-amber-300">
        <Info size={15} className="mt-0.5 shrink-0" />Connect Extract Audio to this node before executing.
      </p>}
      <Choice label="Audio track" value={str('audio_track', 'auto')}
        onChange={value => set('audio_track', value)}
        options={[{ value: 'auto', label: 'Auto — First extracted track' },
          ...Array.from({ length: 8 }, (_, i) => ({ value: String(i), label: `Track ${i}` }))]}
        hint="Select a track if Extract Audio produced separate files." />
    </Section>

    <Section title="Speech recognition" icon={Languages}>
      <Choice label="Transcription language" value={str('language', 'auto')}
        onChange={value => set('language', value)} options={[
          { value: 'auto', label: 'Auto-detect language' },
          { value: 'en', label: 'English' }, { value: 'fr', label: 'French' },
          { value: 'ar', label: 'Arabic / Darija' }, { value: 'es', label: 'Spanish' },
          { value: 'de', label: 'German' }, { value: 'pt', label: 'Portuguese' },
          { value: 'it', label: 'Italian' }, { value: 'tr', label: 'Turkish' },
          { value: 'hi', label: 'Hindi' }, { value: 'ru', label: 'Russian' },
          { value: 'zh', label: 'Chinese' }, { value: 'ja', label: 'Japanese' },
          { value: 'ko', label: 'Korean' },
        ]} />
      <Choice label="Whisper model" value={str('model', 'small')}
        onChange={value => set('model', value)} options={[
          { value: 'tiny', label: 'Tiny — Fastest' },
          { value: 'base', label: 'Base — Fast' },
          { value: 'small', label: 'Small — Balanced (recommended CPU)' },
          { value: 'medium', label: 'Medium — More accurate' },
          { value: 'large-v3', label: 'Large v3 — Most demanding' },
          { value: 'turbo', label: 'Turbo — Fast large model' },
        ]} hint="Local faster-whisper. Model downloads on first use; no transcript API tokens." />
    </Section>

    <Section title="Word-level timestamps" icon={Timer}>
      <div className="flex items-start gap-2 text-[12px] leading-5 text-[#5f5f5f] dark:text-[#b8bec7]">
        <Clock3 size={16} className="mt-0.5 shrink-0 text-violet-600 dark:text-violet-300" />
        Every recognized word includes start and end times in seconds. Word IDs are preserved for AI Highlights, captions and timeline cuts.
      </div>
      <div className="divide-y divide-[#ededed]">
        <div className="py-3">
          <SwitchField label="Voice activity detection" description="Skip silence for better speech detection."
            checked={cfg.vad_filter !== false} onChange={value => set('vad_filter', value)} />
        </div>
        {cfg.vad_filter !== false && <div className="py-3">
          <Field appearance="light" label="Minimum silence (ms)" inputMode="numeric"
            type="number" min={100} max={5000} step={100} value={str('vad_min_silence_ms', '500')}
            onChange={event => set('vad_min_silence_ms', event.target.value)}
            hint="How long a pause must be before VAD treats it as silence." />
        </div>}
        <div className="py-3">
          <SwitchField label="Include word confidence" description="Include Whisper word probabilities when available."
            checked={cfg.include_confidence !== false} onChange={value => set('include_confidence', value)} />
        </div>
      </div>
    </Section>

    <Section title="Additional options" icon={SlidersHorizontal}>
      <button type="button" onClick={() => setAdvanced(value => !value)} aria-expanded={advanced}
        className="flex w-full cursor-pointer items-center justify-between border-b border-[#ededed] dark:border-[#374151] pb-2 text-left text-[12px] font-medium text-[#404040] dark:text-[#f3f4f6]">
        Advanced recognition settings
        <ChevronDown size={16} className={`text-[#888] dark:text-[#b8bec7] transition-transform ${advanced ? 'rotate-180' : ''}`} />
      </button>
      {advanced && <div className="space-y-4">
        <Field appearance="light" label="Beam size" type="number" min={1} max={10} step={1}
          value={str('beam_size', '5')} onChange={event => set('beam_size', event.target.value)}
          hint="Higher values may improve accuracy but increase processing time." />
        <Choice label="Processing device" value={str('device', 'cpu')} onChange={value => {
          set('device', value)
          if (value === 'cpu' && cfg.compute_type === 'float16') set('compute_type', 'int8')
        }} options={[{ value: 'cpu', label: 'CPU' }, { value: 'auto', label: 'Auto' }, { value: 'cuda', label: 'CUDA GPU' }]} />
        <Choice label="Compute type" value={str('compute_type', 'int8')} onChange={value => set('compute_type', value)}
          options={[{ value: 'int8', label: 'INT8 — Best for CPU' }, { value: 'auto', label: 'Auto' },
            { value: 'float32', label: 'Float32' }, ...(cfg.device === 'cuda' ? [{ value: 'float16', label: 'Float16 — GPU' }] : [])]} />
        <label className="grid gap-2 text-[12px] font-semibold text-[#444] dark:text-[#b8bec7]">
          Vocabulary hints (optional)
          <textarea rows={3} maxLength={1000} value={str('initial_prompt', '')}
            placeholder="Names, acronyms, technical vocabulary…"
            onChange={event => set('initial_prompt', event.target.value)}
            className="w-full resize-y rounded-lg border border-[#dedede] dark:border-[#374151] bg-white dark:bg-cl-dark-panel px-3 py-2.5 text-[13px] font-normal text-[#292929] dark:text-[#f3f4f6] outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-100 dark:focus:ring-violet-900/70" />
          <span className="text-[11px] font-normal text-[#888] dark:text-[#b8bec7]">Hint only. This does not translate the audio.</span>
        </label>
      </div>}
    </Section>
    <div className="flex items-start gap-2 text-[11px] leading-5 text-[#888] dark:text-[#b8bec7]">
      <Sparkles size={15} className="mt-0.5 shrink-0" />
      Transcribes spoken audio only. Speaker diarization is not included. Word timings are estimates and should be reviewed before frame-accurate editing.
    </div>
  </div>
}

function timestamp(seconds: number, srt = false): string {
  const milliseconds = Math.max(0, Math.round(seconds * 1000))
  const h = Math.floor(milliseconds / 3_600_000)
  const m = Math.floor(milliseconds / 60_000) % 60
  const s = Math.floor(milliseconds / 1000) % 60
  const ms = milliseconds % 1000
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}${srt ? ',' : '.'}${String(ms).padStart(3, '0')}`
}

function download(filename: string, content: string, mime: string) {
  const url = URL.createObjectURL(new Blob([content], { type: mime }))
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function Output({ value }: { value: unknown }) {
  const output = Array.isArray(value) ? value[0] : value
  const data: Result = output && typeof output === 'object' ? output as Result : {}
  const words = Array.isArray(data.words) ? data.words : []
  const segments = Array.isArray(data.segments) ? data.segments : []
  const [query, setQuery] = useState('')
  const [limit, setLimit] = useState(100)
  const [view, setView] = useState<'words' | 'segments'>('words')
  const filteredWords = useMemo(() => words.filter(w => w.text.toLowerCase().includes(query.toLowerCase())), [words, query])
  const filteredSegments = useMemo(() => segments.filter(s => s.text.toLowerCase().includes(query.toLowerCase())), [segments, query])

  if (!data.status && !words.length && !data.text) return <p className="p-4 text-[12px] text-[#777] dark:text-[#b8bec7]">No transcription yet. Execute Extract Audio, then this node.</p>

  const subtitle = (vtt: boolean) => [vtt ? 'WEBVTT\n' : '', ...segments.map((s, i) =>
    `${vtt ? '' : `${i + 1}\n`}${timestamp(s.start, !vtt)} ${vtt ? '-->' : '-->'} ${timestamp(s.end, !vtt)}\n${s.text}\n`)].join('\n')

  return <div className="space-y-4 p-4" data-transcribe-every-word-output>
    <div className="flex items-center gap-2 border-b border-[#ededed] dark:border-[#374151] pb-3">
      <Captions size={18} className="text-violet-600 dark:text-violet-300" />
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-semibold text-[#333] dark:text-[#f3f4f6]">Transcription complete</div>
        <div className="text-[11px] text-[#888] dark:text-[#b8bec7]">{words.length} words · {segments.length} segments · {data.language ?? 'Unknown language'}</div>
      </div>
    </div>
    <section className="space-y-2">
      <h4 className="flex items-center gap-1.5 text-[12px] font-semibold text-[#444] dark:text-[#b8bec7]"><FileText size={14} /> Full transcript</h4>
      <p className="max-h-44 overflow-y-auto whitespace-pre-wrap break-words rounded-md bg-[#f7f7f8] dark:bg-[#1f2937] p-3 text-[12px] leading-[1.8] text-[#333] dark:text-[#f3f4f6]">{data.text || 'No spoken words detected.'}</p>
    </section>
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-[#e2e2e2] dark:border-[#374151] px-2.5 py-1.5 text-[11px] text-[#555] dark:text-[#b8bec7] hover:bg-[#f6f6f6] dark:hover:bg-[#1f2937]"
        onClick={() => void navigator.clipboard?.writeText(data.text ?? '')}><Copy size={13} /> Copy text</button>
      <button type="button" className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-[#e2e2e2] dark:border-[#374151] px-2.5 py-1.5 text-[11px] text-[#555] dark:text-[#b8bec7] hover:bg-[#f6f6f6] dark:hover:bg-[#1f2937]"
        onClick={() => download('transcript.txt', data.text ?? '', 'text/plain;charset=utf-8')}><Download size={13} /> TXT</button>
      <button type="button" className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-[#e2e2e2] dark:border-[#374151] px-2.5 py-1.5 text-[11px] text-[#555] dark:text-[#b8bec7] hover:bg-[#f6f6f6] dark:hover:bg-[#1f2937]"
        onClick={() => download('transcript.json', JSON.stringify(data, null, 2), 'application/json')}><Download size={13} /> JSON</button>
      {segments.length > 0 && <>
        <button type="button" className="cursor-pointer rounded-md border border-[#e2e2e2] dark:border-[#374151] px-2.5 py-1.5 text-[11px] text-[#555] dark:text-[#b8bec7] hover:bg-[#f6f6f6] dark:hover:bg-[#1f2937]"
          onClick={() => download('transcript.srt', subtitle(false), 'text/plain;charset=utf-8')}>SRT</button>
        <button type="button" className="cursor-pointer rounded-md border border-[#e2e2e2] dark:border-[#374151] px-2.5 py-1.5 text-[11px] text-[#555] dark:text-[#b8bec7] hover:bg-[#f6f6f6] dark:hover:bg-[#1f2937]"
          onClick={() => download('transcript.vtt', subtitle(true), 'text/vtt;charset=utf-8')}>VTT</button>
      </>}
    </div>
    <div className="flex items-center justify-between gap-2 border-b border-[#ededed] dark:border-[#374151] pb-2">
      <div className="flex items-center gap-2">
        {(['words', 'segments'] as const).map(mode => <button key={mode} type="button" onClick={() => { setView(mode); setLimit(100) }}
          className={`cursor-pointer border-b-2 pb-2 text-[12px] font-medium capitalize ${view === mode ? 'border-violet-200 dark:border-violet-600 text-[#333] dark:text-[#f3f4f6]' : 'border-transparent text-[#888] dark:text-[#b8bec7]'}`}>{mode}</button>)}
      </div>
      <span className="text-[11px] text-[#888] dark:text-[#b8bec7]">{view === 'words' ? filteredWords.length : filteredSegments.length} results</span>
    </div>
    <label className="flex items-center gap-2 rounded-lg border border-[#dedede] dark:border-[#374151] bg-white dark:bg-cl-dark-panel px-3 py-2">
      <Search size={15} className="text-[#888] dark:text-[#b8bec7]" />
      <input value={query} onChange={event => { setQuery(event.target.value); setLimit(100) }} placeholder="Search transcript…"
        className="min-w-0 flex-1 bg-transparent text-[12px] outline-none" />
    </label>
    <div className="divide-y divide-[#ededed]">
      {view === 'words' ? filteredWords.slice(0, limit).map(w => <div key={`${w.id}-${w.start}`} className="flex items-start gap-3 py-2.5 text-[12px]">
        <span className="w-[105px] shrink-0 font-mono text-[10px] tabular-nums text-[#888] dark:text-[#b8bec7]">{timestamp(w.start)} – {timestamp(w.end)}</span>
        <span className="min-w-0 flex-1 break-words text-[#333] dark:text-[#f3f4f6]">{w.text}</span>
        {typeof w.confidence === 'number' && <span className="shrink-0 text-[10px] text-[#888] dark:text-[#b8bec7]" title="Whisper word probability">{Math.round(w.confidence * 100)}%</span>}
      </div>) : filteredSegments.slice(0, limit).map((s, index) => <div key={`${index}-${s.start}`} className="space-y-1 py-2.5 text-[12px]">
        <span className="font-mono text-[10px] text-[#888] dark:text-[#b8bec7]">{timestamp(s.start)} – {timestamp(s.end)} · words {s.start_word_id}–{s.end_word_id}</span>
        <p className="break-words text-[#333] dark:text-[#f3f4f6]">{s.text}</p>
      </div>)}
    </div>
    {(view === 'words' ? filteredWords.length : filteredSegments.length) > limit && <button type="button" onClick={() => setLimit(n => n + 100)}
      className="w-full cursor-pointer rounded-md border border-[#e0e0e0] dark:border-[#374151] py-2 text-[12px] text-[#555] dark:text-[#b8bec7] hover:bg-[#f7f7f7] dark:hover:bg-[#1f2937]">Show 100 more</button>}
    <p className="flex items-start gap-2 text-[11px] leading-5 text-[#888] dark:text-[#b8bec7]"><WandSparkles size={14} className="mt-0.5 shrink-0" />
      Word timestamps are speech-recognition estimates. They are not guaranteed frame-exact; review important cuts on the timeline.
    </p>
  </div>
}

function formatOutput(value: unknown): unknown {
  if (value == null || Array.isArray(value) || typeof value !== 'object') return value
  const data = value as Record<string, unknown>
  return Array.isArray(data.words) && Array.isArray(data.segments) ? [data] : value
}

const node: WorkflowNodeUI = {
  type: 'audio.transcribe',
  Icon: Captions,
  Parameters,
  Output,
  formatOutput,
}

export default node
