import { useMemo } from 'react'
import { AlertTriangle, ChevronDown, CircleHelp, KeyRound, Plus, Trash2 } from 'lucide-react'
import type { WorkflowNodeParametersProps } from '../nodeTypes'

type Props = WorkflowNodeParametersProps & {
  onManageCredentials?: () => void
}
type Action = { id: string; label: string; resource: string; implemented: boolean; reason?: string }
type GeminiMessage = { role: 'user' | 'model' | 'system'; text: string }

const ACTIONS: Action[] = [
  { resource: 'Audio', id: 'analyze_audio', label: 'Analyze audio', implemented: true },
  { resource: 'Audio', id: 'transcribe_recording', label: 'Transcribe a recording', implemented: true },
  { resource: 'Document', id: 'analyze_document', label: 'Analyze document', implemented: true },
  { resource: 'File Search', id: 'create_file_search_store', label: 'Create a File Search store', implemented: true },
  { resource: 'File Search', id: 'delete_file_search_store', label: 'Delete a File Search store', implemented: true },
  { resource: 'File Search', id: 'list_file_search_stores', label: 'List all File Search stores', implemented: true },
  { resource: 'File Search', id: 'upload_file_to_search_store', label: 'Upload a file to a File Search store', implemented: true },
  { resource: 'Image', id: 'analyze_image', label: 'Analyze an image', implemented: true },
  { resource: 'Image', id: 'generate_image', label: 'Generate an image', implemented: true },
  { resource: 'Image', id: 'edit_image', label: 'Edit an image', implemented: true },
  { resource: 'Media File', id: 'upload_media_file', label: 'Upload a media file', implemented: true },
  { resource: 'Text', id: 'message_model', label: 'Message a model', implemented: true },
  { resource: 'Video', id: 'analyze_video', label: 'Analyze video', implemented: true },
  { resource: 'Video', id: 'generate_video', label: 'Generate a video', implemented: true },
  { resource: 'Video', id: 'download_video', label: 'Download a video', implemented: true },
]

const RESOURCES = ['Audio', 'Document', 'File Search', 'Image', 'Media File', 'Text', 'Video'] as const
const TEXT_MODELS = [
  { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
  { id: 'gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash-Lite' },
  { id: 'gemini-3.5-flash-lite', label: 'Gemini 3.5 Flash-Lite (if available)' },
]
const FIELD = 'block w-full rounded-lg border border-[#dedee3] bg-white px-3 py-2.5 text-[12px] text-[#303030] outline-none transition-colors focus:border-[#8a5cf4] focus:ring-2 focus:ring-violet-100 disabled:bg-[#f2f2f2] disabled:text-[#999]'
const LABEL = 'mb-1.5 block text-[12px] font-medium text-[#3c3c3c]'

function stringSetting(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}
function numberSetting(value: unknown, fallback: number): number {
  const n = Number(value)
  return value === '' || value === null || value === undefined || !Number.isFinite(n) ? fallback : n
}
function Checkbox({ checked, onChange, label, description }: {
  checked: boolean
  onChange: (checked: boolean) => void
  label: string
  description?: string
}) {
  return <label className="flex cursor-pointer items-start justify-between gap-3 py-1.5">
    <span className="min-w-0">
      <span className="block text-[12px] font-medium text-[#3c3c3c]">{label}</span>
      {description && <span className="mt-0.5 block text-[11px] leading-4 text-[#888]">{description}</span>}
    </span>
    <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} className="mt-0.5 size-4 shrink-0 accent-violet-600" />
  </label>
}
function NumberField({ name, value, onChange, min, max, step = 1, hint }: {
  name: string
  value: number
  onChange: (value: number) => void
  min: number
  max: number
  step?: number
  hint?: string
}) {
  return <label className="block">
    <span className={LABEL}>{name}</span>
    <input type="number" min={min} max={max} step={step} value={value} onChange={event => {
      if (event.target.value !== '') onChange(Number(event.target.value))
    }} className={FIELD} />
    {hint && <span className="mt-1 block text-[11px] text-[#858585]">{hint}</span>}
  </label>
}

/** n8n-like view for the existing native ai.gemini node, registered by nodes/Gemini.tsx.
 * All changes go through the studio's updateSelectedSetting callback. No duplicate local node state.
 */
export function GeminiParameters({ node, catalog, onChange, onManageCredentials }: Props) {
  const cfg = node.settings ?? {}
  const actionId = stringSetting(cfg.action, 'message_model')
  const currentAction = ACTIONS.find(item => item.id === actionId) ?? ACTIONS.find(item => item.id === 'message_model')!
  // Resource is derived from the current action. When switching resources, persist only
  // `action` because studio.updateSelectedSetting creates a new settings snapshot per call.
  const resource = currentAction.resource
  const availableActions = useMemo(() => ACTIONS.filter(item => item.resource === resource), [resource])
  const changeResource = (next: string) => {
    const first = ACTIONS.find(item => item.resource === next)
    if (!first) return
    onChange('action', first.id)
  }
  const updateMessage = (index: number, patch: Partial<GeminiMessage>) => {
    const next = messages.map((item, i) => i === index ? { ...item, ...patch } : item)
    onChange('messages', next)
  }
  const addMessage = () => { if (messages.length < 30) onChange('messages', [...messages, { role: 'user', text: '' }]) }
  const removeMessage = (index: number) => onChange('messages', messages.filter((_, i) => i !== index))
  const messages: GeminiMessage[] = Array.isArray(cfg.messages)
    ? cfg.messages.filter((item): item is GeminiMessage => Boolean(item && typeof item === 'object' && 'role' in item && 'text' in item))
    : []
  const mode = stringSetting(cfg.output_mode, 'text')
  const highlights = mode === 'highlights' && actionId === 'message_model'
  const freeCandidate = actionId === 'message_model'
  const catalogCapability = catalog?.action_capabilities?.[actionId]
  const unavailable = !currentAction.implemented || catalogCapability?.status === 'unavailable'

  return <div className="space-y-5" data-gemini-parameters>
    <section>
      <span className={LABEL}>Credential</span>
      <button type="button" onClick={onManageCredentials} disabled={!onManageCredentials}
        className="inline-flex max-w-full items-center gap-2 rounded-lg border border-[#dedee3] bg-white px-3 py-2 text-left text-[12px] text-[#333] hover:bg-[#f7f7fa] disabled:cursor-default disabled:opacity-80">
        <KeyRound size={15} className="shrink-0 text-[#6c48c7]" />
        <span className="truncate">Google Gemini API credential</span>
      </button>
      <p className="mt-1 text-[11px] leading-4 text-[#818181]">The executor reads <code>GEMINI_API_KEY</code> from the backend environment. Never paste the key into this node.</p>
    </section>

    <section>
      <label htmlFor={`gemini-resource-${node.id}`} className={LABEL}>Resource</label>
      <div className="relative">
        <select id={`gemini-resource-${node.id}`} value={resource} onChange={e => changeResource(e.target.value)} className={`${FIELD} appearance-none pr-9`}>
          {RESOURCES.map(item => <option key={item} value={item}>{item}</option>)}
        </select>
        <ChevronDown size={15} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[#888]" />
      </div>
    </section>

    <section>
      <label htmlFor={`gemini-action-${node.id}`} className={LABEL}>Operation</label>
      <div className="relative">
        <select id={`gemini-action-${node.id}`} value={actionId} onChange={e => onChange('action', e.target.value)} className={`${FIELD} appearance-none pr-9`}>
          {availableActions.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
        </select>
        <ChevronDown size={15} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[#888]" />
      </div>
      {unavailable && <p role="alert" className="mt-2 flex gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] leading-4 text-amber-800"><AlertTriangle size={15} className="shrink-0" />{currentAction.reason ?? 'This action is unavailable in the backend.'}</p>}
    </section>

    {freeCandidate && <>
      <section>
        <span className={LABEL}>Model</span>
        <div className="flex items-center gap-2">
          <select value={stringSetting(cfg.model_by_id).trim() ? 'id' : 'list'} onChange={e => onChange('model_by_id', e.target.value === 'id' ? stringSetting(cfg.model, 'gemini-2.5-flash') : '')} className="min-w-[112px] rounded-lg border border-[#dedee3] bg-white px-2 py-2.5 text-[12px] text-[#333]">
            <option value="list">From list</option>
            <option value="id">By ID</option>
          </select>
          {stringSetting(cfg.model_by_id).trim()
            ? <input value={stringSetting(cfg.model_by_id)} onChange={e => onChange('model_by_id', e.target.value)} placeholder="gemini-2.5-flash" aria-label="Gemini model ID" className={`${FIELD} min-w-0 flex-1`} />
            : <select value={stringSetting(cfg.model, 'gemini-2.5-flash')} onChange={e => onChange('model', e.target.value)} aria-label="Gemini model" className={`${FIELD} min-w-0 flex-1`}>
              {TEXT_MODELS.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
            </select>}
        </div>
        <p className="mt-1 text-[11px] leading-4 text-[#858585]">Free-tier candidate list, not a billing guarantee. Availability depends on your Google project.</p>
      </section>

      <section>
        <label htmlFor={`gemini-prompt-${node.id}`} className={LABEL}>{highlights ? 'Editing goal' : 'Prompt'}</label>
        <textarea id={`gemini-prompt-${node.id}`} rows={4} value={stringSetting(cfg.prompt)} onChange={e => onChange('prompt', e.target.value)} className={`${FIELD} min-h-[96px] resize-y`} placeholder={highlights ? 'Create an engaging, coherent 2-minute film summary using only transcript passages.' : 'Write your instructions here...'} />
      </section>

      {!highlights && <section>
        <label htmlFor={`gemini-input-${node.id}`} className={LABEL}>Input Path (optional)</label>
        <input id={`gemini-input-${node.id}`} value={stringSetting(cfg.input_path)} onChange={e => onChange('input_path', e.target.value)} className={FIELD} placeholder="audio_transcribe.text" />
        <p className="mt-1 text-[11px] leading-4 text-[#858585]">Reference a connected node output. Example: <code>audio_transcribe.text</code>.</p>
      </section>}

      <section>
        <label htmlFor={`gemini-mode-${node.id}`} className={LABEL}>Output Mode</label>
        <select id={`gemini-mode-${node.id}`} value={mode} onChange={e => onChange('output_mode', e.target.value)} className={FIELD}>
          <option value="text">Text</option><option value="json">JSON</option><option value="highlights">Highlights (word-timed clips)</option>
        </select>
        {highlights && <p className="mt-1 text-[11px] leading-4 text-[#858585]">Automatically reads the <code>words</code> array from exactly one connected transcription node, then validates word IDs and timestamps.</p>}
      </section>

      {highlights && <section className="space-y-3 rounded-xl border border-[#e9e4f5] bg-[#fbfaff] p-3">
        <p className="text-[12px] font-semibold text-[#4f397d]">Highlights & Cuts</p>
        <div className="grid grid-cols-2 gap-3">
          <NumberField name="Target duration (sec)" value={numberSetting(cfg.target_duration, 120)} min={10} max={7200} onChange={n => onChange('target_duration', n)} />
          <NumberField name="Max highlights" value={numberSetting(cfg.max_highlights, 12)} min={1} max={100} onChange={n => onChange('max_highlights', n)} />
          <NumberField name="Min clip (sec)" value={numberSetting(cfg.min_clip_seconds, 3)} min={0.1} max={300} step={0.5} onChange={n => onChange('min_clip_seconds', n)} />
          <NumberField name="Max clip (sec)" value={numberSetting(cfg.max_clip_seconds, 35)} min={1} max={900} step={0.5} onChange={n => onChange('max_clip_seconds', n)} />
        </div>
        <NumberField name="Transcript chunk size (characters)" value={numberSetting(cfg.chunk_chars, 14000)} min={2000} max={50000} step={500} onChange={n => onChange('chunk_chars', n)} />
        <p className="text-[11px] leading-4 text-[#80738e]">Long transcripts are split into chunks. Every chunk uses an API request; actual usage depends on the model and available quota.</p>
      </section>}

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-[12px] font-semibold text-[#3c3c3c]">Messages</span>
          <span className="text-[11px] text-[#888]">{messages.length} / 30</span>
        </div>
        {messages.map((message, index) => <div key={index} className="space-y-2 rounded-lg border border-[#e5e5e9] bg-white p-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-semibold text-[#555]">Message {index + 1}</span>
            <button type="button" onClick={() => removeMessage(index)} title="Remove message" aria-label={`Remove message ${index + 1}`} className="rounded-md p-1.5 text-[#888] hover:bg-red-50 hover:text-red-600"><Trash2 size={15} /></button>
          </div>
          <label className="block"><span className={LABEL}>Role</span>
            <select value={message.role} onChange={e => updateMessage(index, { role: e.target.value as GeminiMessage['role'] })} className={FIELD}>
              <option value="user">User</option><option value="model">Model</option><option value="system">System</option>
            </select></label>
          <label className="block"><span className={LABEL}>Text</span>
            <textarea rows={3} value={message.text} onChange={e => updateMessage(index, { text: e.target.value })} className={`${FIELD} resize-y`} placeholder="Enter message..." /></label>
        </div>)}
        <button type="button" onClick={addMessage} disabled={messages.length >= 30} className="flex w-full items-center justify-center gap-2 rounded-lg border border-[#e2e2e7] bg-[#f6f6f8] px-3 py-2 text-[12px] font-medium text-[#555] hover:bg-[#ededf2] disabled:opacity-50"><Plus size={14} /> Add Message</button>
      </section>

      <section className="space-y-2">
        {mode === 'text'
          ? <Checkbox checked={Boolean(cfg.output_content_as_json)} onChange={value => onChange('output_content_as_json', value)} label="Output Content as JSON" description="Parse a JSON-formatted response from Gemini." />
          : <p className="text-[11px] text-[#858585]">JSON output is enabled automatically in {mode} mode.</p>}
      </section>

      <details className="group border-t border-[#e6e6ea] pt-3">
        <summary className="flex cursor-pointer list-none items-center justify-between py-2 text-[12px] font-semibold text-[#444] [&::-webkit-details-marker]:hidden">Advanced Options <ChevronDown size={16} className="transition-transform group-open:rotate-180" /></summary>
        <div className="space-y-4 pt-3">
          <label className="block"><span className={LABEL}>System instruction</span>
            <textarea rows={3} value={stringSetting(cfg.system_prompt)} onChange={e => onChange('system_prompt', e.target.value)} className={`${FIELD} resize-y`} placeholder="You are a careful assistant..." /></label>
          <NumberField name="Temperature" value={numberSetting(cfg.temperature, 0.2)} min={0} max={2} step={0.1} onChange={n => onChange('temperature', n)} />
          <NumberField name="Max output tokens" value={numberSetting(cfg.max_output_tokens, 2048)} min={128} max={32768} onChange={n => onChange('max_output_tokens', n)} />
          <NumberField name="Request timeout (sec)" value={numberSetting(cfg.timeout_seconds, 120)} min={15} max={300} onChange={n => onChange('timeout_seconds', n)} />
        </div>
      </details>
    </>}

    {actionId === 'generate_image' && <>
      <label className="block"><span className={LABEL}>Image Model ID</span><input value={stringSetting(cfg.model)} onChange={e => onChange('model', e.target.value)} placeholder="gemini-3.1-flash-image-preview" className={FIELD} /></label>
      <label className="block"><span className={LABEL}>Prompt</span><textarea rows={4} value={stringSetting(cfg.prompt)} onChange={e => onChange('prompt', e.target.value)} className={`${FIELD} resize-y`} placeholder="Describe the image..." /></label>
      <label className="block"><span className={LABEL}>Aspect Ratio</span><select value={stringSetting(cfg.image_aspect_ratio, '1:1')} onChange={e => onChange('image_aspect_ratio', e.target.value)} className={FIELD}>{['1:1','3:2','2:3','4:3','3:4','16:9','9:16'].map(v => <option key={v}>{v}</option>)}</select></label>
      <p className="flex gap-2 rounded-lg bg-amber-50 p-3 text-[11px] text-amber-800"><CircleHelp size={15} className="shrink-0" />Image generation may require paid Gemini billing. Check your project permissions and model availability.</p>
    </>}

    {actionId === 'create_file_search_store' && <label className="block"><span className={LABEL}>Display Name</span><input value={stringSetting(cfg.display_name)} onChange={e => onChange('display_name', e.target.value)} className={FIELD} placeholder="e.g. My File Search Store" /></label>}
    {actionId === 'delete_file_search_store' && <label className="block"><span className={LABEL}>File Search Store Name</span><input value={stringSetting(cfg.store_name)} onChange={e => onChange('store_name', e.target.value)} className={FIELD} placeholder="fileSearchStores/abc123" /></label>}
    {actionId === 'list_file_search_stores' && <p className="rounded-lg border border-[#e8e8e8] bg-white px-3 py-2.5 text-[12px] text-[#777]">Lists stores available to the configured Gemini API credential.</p>}

    {/* Native Gemini Files API: choose one upstream node output, workspace file, or Gemini Files URI. */}
    {(['analyze_audio', 'transcribe_recording', 'analyze_document', 'analyze_image', 'analyze_video', 'upload_media_file', 'upload_file_to_search_store', 'edit_image'] as string[]).includes(actionId) && <>
      <section className="space-y-3 rounded-xl border border-[#e9e9ed] bg-[#fafafa] p-3">
        <p className="text-[12px] font-semibold text-[#393939]">Media input</p>
        <p className="text-[11px] leading-5 text-[#777]">Connect a media node or supply a path under CLIPTORA backend storage. Fill only one source. Uploaded Gemini Files URIs can be reused, except for File Search indexing.</p>
        <label className="block"><span className={LABEL}>Upstream input path (optional)</span>
          <input className={FIELD} value={stringSetting(cfg.media_input_path)} onChange={e => onChange('media_input_path', e.target.value)} placeholder="extract_audio.audio or uploaded.file_uri" />
        </label>
        <label className="block"><span className={LABEL}>Local CLIPTORA file path (optional)</span>
          <input className={FIELD} value={stringSetting(cfg.file_path)} onChange={e => onChange('file_path', e.target.value)} placeholder="/workspace/storage/workflows/.../audio.wav" />
        </label>
        {actionId !== 'upload_file_to_search_store' && <label className="block"><span className={LABEL}>Gemini Files URI (optional)</span>
          <input className={FIELD} value={stringSetting(cfg.file_uri)} onChange={e => onChange('file_uri', e.target.value)} placeholder="https://generativelanguage.googleapis.com/v1beta/files/..." />
        </label>}
        <label className="block"><span className={LABEL}>MIME type (if reusing a Files URI)</span>
          <input className={FIELD} value={stringSetting(cfg.mime_type)} onChange={e => onChange('mime_type', e.target.value)} placeholder="audio/mpeg, image/png, video/mp4, application/pdf" />
        </label>
        <label className="block"><span className={LABEL}>Display name (optional)</span>
          <input className={FIELD} value={stringSetting(cfg.file_display_name)} onChange={e => onChange('file_display_name', e.target.value)} placeholder="document.pdf" />
        </label>
      </section>
    </>}

    {(['analyze_audio', 'transcribe_recording', 'analyze_document', 'analyze_image', 'analyze_video'] as string[]).includes(actionId) && <>
      <label className="block"><span className={LABEL}>Model</span>
        <input className={FIELD} value={stringSetting(cfg.model, 'gemini-2.5-flash')} onChange={e => onChange('model', e.target.value)} placeholder="gemini-2.5-flash" />
      </label>
      <label className="block"><span className={LABEL}>{actionId === 'transcribe_recording' ? 'Transcription instructions (optional)' : 'Prompt (optional)'}</span>
        <textarea rows={4} className={`${FIELD} resize-y`} value={stringSetting(cfg.prompt)} onChange={e => onChange('prompt', e.target.value)} placeholder={actionId === 'transcribe_recording' ? 'Transcribe all the words in their original language...' : 'Describe and analyze this file...'} />
      </label>
      <Checkbox checked={Boolean(cfg.output_content_as_json)} onChange={v => onChange('output_content_as_json', v)} label="Output Content as JSON" description="Ask the model to return structured JSON. This does not produce word-level timestamps." />
    </>}

    {actionId === 'upload_file_to_search_store' && <>
      <label className="block"><span className={LABEL}>File Search Store Name</span>
        <input className={FIELD} value={stringSetting(cfg.store_name)} onChange={e => onChange('store_name', e.target.value)} placeholder="fileSearchStores/your-store-id" />
      </label>
      <p className="text-[11px] leading-5 text-[#7b5c2f]">Google may bill for creating embeddings while indexing. Audio and video are not supported by File Search.</p>
    </>}

    {actionId === 'edit_image' && <>
      <label className="block"><span className={LABEL}>Image editing model</span>
        <input className={FIELD} value={stringSetting(cfg.image_model, 'gemini-3.1-flash-image-preview')} onChange={e => onChange('image_model', e.target.value)} placeholder="gemini-3.1-flash-image-preview" />
      </label>
      <label className="block"><span className={LABEL}>Editing prompt</span>
        <textarea rows={4} className={`${FIELD} resize-y`} value={stringSetting(cfg.prompt)} onChange={e => onChange('prompt', e.target.value)} placeholder="Change the background to a clean white studio..." />
      </label>
      <label className="block"><span className={LABEL}>Aspect ratio</span>
        <select className={FIELD} value={stringSetting(cfg.image_aspect_ratio, '1:1')} onChange={e => onChange('image_aspect_ratio', e.target.value)}>
          {['1:1','3:2','2:3','4:3','3:4','16:9','9:16'].map(r => <option key={r} value={r}>{r}</option>)}
        </select>
      </label>
    </>}

    {actionId === 'generate_video' && <>
      <label className="block"><span className={LABEL}>Video model</span>
        <input className={FIELD} value={stringSetting(cfg.video_model, 'gemini-omni-1.1-flash')} onChange={e => onChange('video_model', e.target.value)} placeholder="gemini-omni-1.1-flash" />
      </label>
      <label className="block"><span className={LABEL}>Video prompt</span>
        <textarea rows={4} className={`${FIELD} resize-y`} value={stringSetting(cfg.prompt)} onChange={e => onChange('prompt', e.target.value)} placeholder="A cinematic shot of a city at sunrise..." />
      </label>
      <label className="block"><span className={LABEL}>Aspect ratio</span>
        <select className={FIELD} value={stringSetting(cfg.video_aspect_ratio, '16:9')} onChange={e => onChange('video_aspect_ratio', e.target.value)}><option value="16:9">16:9 Landscape</option><option value="9:16">9:16 Portrait</option></select>
      </label>
      <label className="block"><span className={LABEL}>Previous interaction ID (optional)</span>
        <input className={FIELD} value={stringSetting(cfg.previous_interaction_id)} onChange={e => onChange('previous_interaction_id', e.target.value)} placeholder="interactions/your-id" />
      </label>
      <p className="text-[11px] leading-5 text-[#777]">Generates via Gemini Omni Interactions API. If video is not ready, the output provides an interaction ID for Download a video.</p>
    </>}

    {actionId === 'download_video' && <>
      <p className="text-[11px] leading-5 text-[#777]">Connect a Generate a video node (preferred), or enter its interaction ID / generated video URI.</p>
      <label className="block"><span className={LABEL}>Interaction ID (optional)</span>
        <input className={FIELD} value={stringSetting(cfg.interaction_id)} onChange={e => onChange('interaction_id', e.target.value)} placeholder="v1_... or interactions/..." />
      </label>
      <label className="block"><span className={LABEL}>Google generated video URI (optional)</span>
        <input className={FIELD} value={stringSetting(cfg.generated_video_uri)} onChange={e => onChange('generated_video_uri', e.target.value)} placeholder="https://generativelanguage.googleapis.com/v1beta/files/...:download" />
      </label>
    </>}

    {(['upload_file_to_search_store', 'generate_video', 'edit_image'] as string[]).includes(actionId) &&
      <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
        <Checkbox checked={Boolean(cfg.allow_paid_action)} onChange={v => onChange('allow_paid_action', v)}
          label="Allow paid operation" description="Requires GEMINI_ENABLE_PAID_ACTIONS=1 on the backend. Google may charge your project." />
      </div>}

    {(['analyze_audio', 'transcribe_recording', 'analyze_document', 'analyze_image', 'analyze_video', 'upload_media_file', 'upload_file_to_search_store', 'edit_image', 'generate_video', 'download_video'] as string[]).includes(actionId) &&
      <details className="border-t border-[#e6e6ea] pt-3"><summary className="cursor-pointer py-2 text-[12px] font-semibold text-[#444]">Request & processing</summary>
        <div className="space-y-3 pt-3">
          <NumberField name="Request timeout (seconds)" value={numberSetting(cfg.timeout_seconds, 120)} min={15} max={300} onChange={n => onChange('timeout_seconds', n)} />
          <NumberField name="Media processing wait (seconds)" value={numberSetting(cfg.poll_seconds, 180)} min={30} max={900} onChange={n => onChange('poll_seconds', n)} />
        </div>
      </details>}


    <div className="border-t border-[#ececf0] pt-3 text-[11px] leading-5 text-[#999]">
      <p>Native CLIPTORA · Google Gemini</p>
      <p>Execution and results are handled by the FastAPI workflow engine.</p>
    </div>
  </div>
}

export default GeminiParameters
