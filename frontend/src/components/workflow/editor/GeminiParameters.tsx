import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, ChevronDown, CircleHelp, KeyRound, LoaderCircle, Plus, RefreshCw, Trash2 } from 'lucide-react'
import { api } from '../../../lib/api'
import type { WorkflowNodeParametersProps } from '../nodeTypes'
import { GEMINI_TEXT_MODELS } from '../geminiModels'

type Props = WorkflowNodeParametersProps & {
  onManageCredentials?: () => void
}
type Action = { id: string; label: string; resource: string; implemented: boolean; reason?: string }
type GeminiMessage = { role: 'user' | 'model' | 'system'; text: string }
type GeminiCredential = { id: number; name: string; provider: string; auth_type: string }

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
const TEXT_MODELS = GEMINI_TEXT_MODELS
const FIELD = 'block w-full rounded-lg border border-[#dedee3] dark:border-[#374151] bg-white dark:bg-cl-dark-panel px-3 py-2.5 text-[12px] text-[#303030] dark:text-[#f3f4f6] outline-none transition-colors focus:border-[#e5dbfd] dark:focus:border-[#8a5cf4] focus:ring-2 focus:ring-violet-100 dark:focus:ring-violet-900/70 disabled:bg-[#f2f2f2] dark:disabled:bg-[#1f2937] disabled:text-[#4b5563] dark:disabled:text-[#999]'
const LABEL = 'mb-1.5 block text-[12px] font-medium text-[#3c3c3c] dark:text-[#f3f4f6]'

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
      <span className="block text-[12px] font-medium text-[#3c3c3c] dark:text-[#f3f4f6]">{label}</span>
      {description && <span className="mt-0.5 block text-[11px] leading-4 text-[#888] dark:text-[#b8bec7]">{description}</span>}
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
    {hint && <span className="mt-1 block text-[11px] text-[#858585] dark:text-[#b8bec7]">{hint}</span>}
  </label>
}

/** n8n-like view for the existing native ai.gemini node, registered by nodes/Gemini.tsx.
 * All changes go through the studio's updateSelectedSetting callback. No duplicate local node state.
 */
export function GeminiParameters({ node, catalog, onChange, onManageCredentials }: Props) {
  const cfg = node.settings ?? {}
  const [credentials, setCredentials] = useState<GeminiCredential[]>([])
  const [credentialLoading, setCredentialLoading] = useState(true)
  const [credentialSaving, setCredentialSaving] = useState(false)
  const [showConnect, setShowConnect] = useState(false)
  const [connectionName, setConnectionName] = useState('My Google Gemini')
  const [connectionKey, setConnectionKey] = useState('')
  const [credentialError, setCredentialError] = useState('')
  const [credentialNotice, setCredentialNotice] = useState('')

  const credentialId = typeof cfg.credential_id === 'number' && Number.isInteger(cfg.credential_id) && cfg.credential_id > 0
    ? cfg.credential_id : null

  const refreshCredentials = useCallback(async () => {
    setCredentialLoading(true)
    try {
      const items = await api<GeminiCredential[]>('/credentials')
      setCredentials(items.filter(item => item.provider === 'gemini'))
      setCredentialError('')
    } catch (error) {
      setCredentialError(error instanceof Error ? error.message : String(error))
    } finally {
      setCredentialLoading(false)
    }
  }, [])

  useEffect(() => { void refreshCredentials() }, [refreshCredentials])

  const connectCredential = async () => {
    if (credentialSaving) return
    if (connectionName.trim().length < 2 || connectionKey.trim().length < 8) {
      setCredentialError('Enter a name and a valid Gemini API key.')
      return
    }
    setCredentialSaving(true)
    setCredentialError('')
    setCredentialNotice('')
    try {
      const created = await api<GeminiCredential>('/credentials', {
        method: 'POST',
        body: JSON.stringify({
          name: connectionName.trim(),
          provider: 'gemini',
          data: { api_key: connectionKey.trim() },
        }),
      })
      setCredentials(previous => [created, ...previous.filter(item => item.id !== created.id)])
      onChange('credential_id', created.id)
      setConnectionKey('')
      setShowConnect(false)
      setCredentialNotice('Credential saved and linked. Save workflow to keep this selection.')
      try {
        await api<{ connected: boolean }>(`/credentials/${created.id}/test`, { method: 'POST' })
        setCredentialNotice('Gemini connection verified. Save workflow to keep this selection.')
      } catch {
        setCredentialNotice('Credential saved, but Google connection test failed. Check the key or quota in Manage Credentials.')
      }
    } catch (error) {
      setCredentialError(error instanceof Error ? error.message : String(error))
    } finally {
      setCredentialSaving(false)
    }
  }
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
    <section className="space-y-2">
      <span className={LABEL}>Google Gemini Credential</span>
      <div className="flex items-center gap-2">
        <select aria-label="Google Gemini Credential" className={`${FIELD} min-w-0 flex-1`}
          value={credentialId === null ? '' : String(credentialId)}
          onChange={event => {
            onChange('credential_id', event.target.value ? Number(event.target.value) : null)
            setCredentialNotice('Save workflow to persist your credential selection.')
          }}>
          <option value="">Select a credential...</option>
          {credentialId !== null && !credentials.some(item => item.id === credentialId) &&
            <option value={credentialId}>Credential #{credentialId} ({credentialError ? 'connection unavailable' : 'not found'})</option>}
          {credentials.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
        <button type="button" title="Refresh credentials" aria-label="Refresh credentials"
          onClick={() => void refreshCredentials()} disabled={credentialLoading}
          className="grid size-9 shrink-0 place-items-center rounded-lg border border-[#dedee3] dark:border-[#374151] hover:bg-[#f7f7fa] dark:hover:bg-[#1f2937] disabled:opacity-50">
          <RefreshCw size={15} className={credentialLoading ? 'animate-spin' : ''} />
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => setShowConnect(value => !value)}
          className="inline-flex items-center gap-1.5 rounded-lg border border-[#dedee3] dark:border-[#374151] bg-white dark:bg-cl-dark-panel px-3 py-2 text-[12px] font-medium text-[#333] dark:text-[#f3f4f6] hover:bg-[#f7f7fa] dark:hover:bg-[#1f2937]">
          <KeyRound size={15} /> Connect
        </button>
        {onManageCredentials && <button type="button" onClick={() => {
          onManageCredentials()
          setCredentialNotice('Refresh the credential list after closing Manage Credentials.')
        }} className="rounded-lg border border-[#dedee3] dark:border-[#374151] px-3 py-2 text-[12px] hover:bg-[#f7f7fa] dark:hover:bg-[#1f2937]">
          Manage Credentials
        </button>}
      </div>
      {showConnect && <div className="space-y-3 rounded-lg border border-[#e4dafa] dark:border-[#56436f] bg-[#faf8ff] dark:bg-[#272037] p-3">
        <label className="block"><span className={LABEL}>Connection name</span>
          <input className={FIELD} value={connectionName} maxLength={160}
            onChange={e => setConnectionName(e.target.value)} placeholder="My Google Gemini" />
        </label>
        <label className="block"><span className={LABEL}>Gemini API key</span>
          <input type="password" autoComplete="off" spellCheck={false} className={FIELD}
            value={connectionKey} onChange={e => setConnectionKey(e.target.value)} placeholder="Paste API key here" />
        </label>
        <div className="flex items-center justify-end gap-2">
          <button type="button" onClick={() => { setShowConnect(false); setConnectionKey('') }}
            className="rounded-lg px-3 py-2 text-[12px]">Cancel</button>
          <button type="button" disabled={credentialSaving} onClick={() => void connectCredential()}
            className="inline-flex items-center gap-2 rounded-lg bg-violet-600 px-3 py-2 text-[12px] font-semibold text-white disabled:opacity-60">
            {credentialSaving && <LoaderCircle size={14} className="animate-spin" />} Save & Connect
          </button>
        </div>
      </div>}
      {credentialError && <p role="alert" className="text-[11px] leading-4 text-red-600 dark:text-red-300">{credentialError}</p>}
      {credentialNotice && <p role="status" className="text-[11px] leading-4 text-[#6c48c7] dark:text-[#c1b2e7]">{credentialNotice}</p>}
      <p className="text-[11px] leading-4 text-[#818181] dark:text-[#b8bec7]">Credentials are encrypted in CLIPTORA MySQL. This node stores only the credential ID.</p>
    </section>

    <section>
      <label htmlFor={`gemini-resource-${node.id}`} className={LABEL}>Resource</label>
      <div className="relative">
        <select id={`gemini-resource-${node.id}`} value={resource} onChange={e => changeResource(e.target.value)} className={`${FIELD} appearance-none pr-9`}>
          {RESOURCES.map(item => <option key={item} value={item}>{item}</option>)}
        </select>
        <ChevronDown size={15} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[#888] dark:text-[#b8bec7]" />
      </div>
    </section>

    <section>
      <label htmlFor={`gemini-action-${node.id}`} className={LABEL}>Operation</label>
      <div className="relative">
        <select id={`gemini-action-${node.id}`} value={actionId} onChange={e => onChange('action', e.target.value)} className={`${FIELD} appearance-none pr-9`}>
          {availableActions.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
        </select>
        <ChevronDown size={15} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[#888] dark:text-[#b8bec7]" />
      </div>
      {unavailable && <p role="alert" className="mt-2 flex gap-2 rounded-lg border border-amber-200 dark:border-amber-900/70 bg-amber-50 dark:bg-amber-950/35 px-3 py-2 text-[11px] leading-4 text-amber-800 dark:text-amber-300"><AlertTriangle size={15} className="shrink-0" />{currentAction.reason ?? 'This action is unavailable in the backend.'}</p>}
    </section>

    {freeCandidate && <>
      <section>
        <span className={LABEL}>Model</span>
        <div className="flex items-center gap-2">
          <select value={stringSetting(cfg.model_by_id).trim() ? 'id' : 'list'} onChange={e => onChange('model_by_id', e.target.value === 'id' ? stringSetting(cfg.model, 'gemini-3.8-flash') : '')} className="min-w-[112px] rounded-lg border border-[#dedee3] dark:border-[#374151] bg-white dark:bg-cl-dark-panel px-2 py-2.5 text-[12px] text-[#333] dark:text-[#f3f4f6]">
            <option value="list">From list</option>
            <option value="id">By ID</option>
          </select>
          {stringSetting(cfg.model_by_id).trim()
            ? <input value={stringSetting(cfg.model_by_id)} onChange={e => onChange('model_by_id', e.target.value)} placeholder="gemini-3.8-flash" aria-label="Gemini model ID" className={`${FIELD} min-w-0 flex-1`} />
            : <select value={stringSetting(cfg.model, 'gemini-3.8-flash')} onChange={e => onChange('model', e.target.value)} aria-label="Gemini model" className={`${FIELD} min-w-0 flex-1`}>
              {stringSetting(cfg.model) && !TEXT_MODELS.some(item => item.id === stringSetting(cfg.model)) &&
                <option value={stringSetting(cfg.model)}>{stringSetting(cfg.model)} (legacy / unavailable)</option>}
              {TEXT_MODELS.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
            </select>}
        </div>
        <p className="mt-1 text-[11px] leading-4 text-[#858585] dark:text-[#b8bec7]">Availability and charges depend on your Google project. Verify model access before running.</p>
      </section>

      <section>
        <label htmlFor={`gemini-prompt-${node.id}`} className={LABEL}>{highlights ? 'Editing goal' : 'Prompt'}</label>
        <textarea id={`gemini-prompt-${node.id}`} rows={4} value={stringSetting(cfg.prompt)} onChange={e => onChange('prompt', e.target.value)} className={`${FIELD} min-h-[96px] resize-y`} placeholder={highlights ? 'Create an engaging, coherent 2-minute film summary using only transcript passages.' : 'Write your instructions here...'} />
      </section>

      {!highlights && <section>
        <label htmlFor={`gemini-input-${node.id}`} className={LABEL}>Input Path (optional)</label>
        <input id={`gemini-input-${node.id}`} value={stringSetting(cfg.input_path)} onChange={e => onChange('input_path', e.target.value)} className={FIELD} placeholder="audio_transcribe.text" />
        <p className="mt-1 text-[11px] leading-4 text-[#858585] dark:text-[#b8bec7]">Reference a connected node output. Example: <code>audio_transcribe.text</code>.</p>
      </section>}

      <section>
        <label htmlFor={`gemini-mode-${node.id}`} className={LABEL}>Output Mode</label>
        <select id={`gemini-mode-${node.id}`} value={mode} onChange={e => onChange('output_mode', e.target.value)} className={FIELD}>
          <option value="text">Text</option><option value="json">JSON</option><option value="highlights">Highlights (word-timed clips)</option>
        </select>
        {highlights && <p className="mt-1 text-[11px] leading-4 text-[#858585] dark:text-[#b8bec7]">Automatically reads the <code>words</code> array from exactly one connected transcription node, then validates word IDs and timestamps.</p>}
      </section>

      {highlights && <section className="space-y-3 rounded-xl border border-[#e9e4f5] dark:border-[#374151] bg-[#fbfaff] dark:bg-[#1f2937] p-3">
        <p className="text-[12px] font-semibold text-[#4f397d] dark:text-[#b5acc8]">Highlights & Cuts</p>
        <div className="grid grid-cols-2 gap-3">
          <NumberField name="Target duration (sec)" value={numberSetting(cfg.target_duration, 120)} min={10} max={7200} onChange={n => onChange('target_duration', n)} />
          <NumberField name="Max highlights" value={numberSetting(cfg.max_highlights, 12)} min={1} max={100} onChange={n => onChange('max_highlights', n)} />
          <NumberField name="Min clip (sec)" value={numberSetting(cfg.min_clip_seconds, 3)} min={0.1} max={300} step={0.5} onChange={n => onChange('min_clip_seconds', n)} />
          <NumberField name="Max clip (sec)" value={numberSetting(cfg.max_clip_seconds, 35)} min={1} max={900} step={0.5} onChange={n => onChange('max_clip_seconds', n)} />
        </div>
        <NumberField name="Transcript chunk size (characters)" value={numberSetting(cfg.chunk_chars, 14000)} min={2000} max={50000} step={500} onChange={n => onChange('chunk_chars', n)} />
        <p className="text-[11px] leading-4 text-[#80738e] dark:text-[#b8bec7]">Long transcripts are split into chunks. Every chunk uses an API request; actual usage depends on the model and available quota.</p>
      </section>}

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-[12px] font-semibold text-[#3c3c3c] dark:text-[#f3f4f6]">Messages</span>
          <span className="text-[11px] text-[#888] dark:text-[#b8bec7]">{messages.length} / 30</span>
        </div>
        {messages.map((message, index) => <div key={index} className="space-y-2 rounded-lg border border-[#e5e5e9] dark:border-[#374151] bg-white dark:bg-cl-dark-panel p-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-semibold text-[#555] dark:text-[#b8bec7]">Message {index + 1}</span>
            <button type="button" onClick={() => removeMessage(index)} title="Remove message" aria-label={`Remove message ${index + 1}`} className="rounded-md p-1.5 text-[#888] dark:text-[#b8bec7] hover:bg-red-50 dark:hover:bg-red-950/40 hover:text-red-600 dark:hover:text-red-300"><Trash2 size={15} /></button>
          </div>
          <label className="block"><span className={LABEL}>Role</span>
            <select value={message.role} onChange={e => updateMessage(index, { role: e.target.value as GeminiMessage['role'] })} className={FIELD}>
              <option value="user">User</option><option value="model">Model</option><option value="system">System</option>
            </select></label>
          <label className="block"><span className={LABEL}>Text</span>
            <textarea rows={3} value={message.text} onChange={e => updateMessage(index, { text: e.target.value })} className={`${FIELD} resize-y`} placeholder="Enter message..." /></label>
        </div>)}
        <button type="button" onClick={addMessage} disabled={messages.length >= 30} className="flex w-full items-center justify-center gap-2 rounded-lg border border-[#e2e2e7] dark:border-[#374151] bg-[#f6f6f8] dark:bg-[#1f2937] px-3 py-2 text-[12px] font-medium text-[#555] dark:text-[#b8bec7] hover:bg-[#ededf2] dark:hover:bg-[#1f2937] disabled:opacity-50"><Plus size={14} /> Add Message</button>
      </section>

      <section className="space-y-2">
        {mode === 'text'
          ? <Checkbox checked={Boolean(cfg.output_content_as_json)} onChange={value => onChange('output_content_as_json', value)} label="Output Content as JSON" description="Parse a JSON-formatted response from Gemini." />
          : <p className="text-[11px] text-[#858585] dark:text-[#b8bec7]">JSON output is enabled automatically in {mode} mode.</p>}
      </section>

      <details className="group border-t border-[#e6e6ea] dark:border-[#374151] pt-3">
        <summary className="flex cursor-pointer list-none items-center justify-between py-2 text-[12px] font-semibold text-[#444] dark:text-[#b8bec7] [&::-webkit-details-marker]:hidden">Advanced Options <ChevronDown size={16} className="transition-transform group-open:rotate-180" /></summary>
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
      <p className="flex gap-2 rounded-lg bg-amber-50 dark:bg-amber-950/35 p-3 text-[11px] text-amber-800 dark:text-amber-300"><CircleHelp size={15} className="shrink-0" />Image generation may require paid Gemini billing. Check your project permissions and model availability.</p>
    </>}

    {actionId === 'create_file_search_store' && <label className="block"><span className={LABEL}>Display Name</span><input value={stringSetting(cfg.display_name)} onChange={e => onChange('display_name', e.target.value)} className={FIELD} placeholder="e.g. My File Search Store" /></label>}
    {actionId === 'delete_file_search_store' && <label className="block"><span className={LABEL}>File Search Store Name</span><input value={stringSetting(cfg.store_name)} onChange={e => onChange('store_name', e.target.value)} className={FIELD} placeholder="fileSearchStores/abc123" /></label>}
    {actionId === 'list_file_search_stores' && <p className="rounded-lg border border-[#e8e8e8] dark:border-[#374151] bg-white dark:bg-cl-dark-panel px-3 py-2.5 text-[12px] text-[#777] dark:text-[#b8bec7]">Lists stores available to the configured Gemini API credential.</p>}

    {/* Native Gemini Files API: choose one upstream node output, workspace file, or Gemini Files URI. */}
    {(['analyze_audio', 'transcribe_recording', 'analyze_document', 'analyze_image', 'analyze_video', 'upload_media_file', 'upload_file_to_search_store', 'edit_image'] as string[]).includes(actionId) && <>
      <section className="space-y-3 rounded-xl border border-[#e9e9ed] dark:border-[#374151] bg-[#fafafa] dark:bg-[#1f2937] p-3">
        <p className="text-[12px] font-semibold text-[#393939] dark:text-[#f3f4f6]">Media input</p>
        <p className="text-[11px] leading-5 text-[#777] dark:text-[#b8bec7]">Connect a media node or supply a path under CLIPTORA backend storage. Fill only one source. Uploaded Gemini Files URIs can be reused, except for File Search indexing.</p>
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
        <input className={FIELD} value={stringSetting(cfg.model, 'gemini-3.8-flash')} onChange={e => onChange('model', e.target.value)} placeholder="gemini-3.8-flash" />
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
      <p className="text-[11px] leading-5 text-[#7b5c2f] dark:text-[#c8bba8]">Google may bill for creating embeddings while indexing. Audio and video are not supported by File Search.</p>
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
      <p className="text-[11px] leading-5 text-[#777] dark:text-[#b8bec7]">Generates via Gemini Omni Interactions API. If video is not ready, the output provides an interaction ID for Download a video.</p>
    </>}

    {actionId === 'download_video' && <>
      <p className="text-[11px] leading-5 text-[#777] dark:text-[#b8bec7]">Connect a Generate a video node (preferred), or enter its interaction ID / generated video URI.</p>
      <label className="block"><span className={LABEL}>Interaction ID (optional)</span>
        <input className={FIELD} value={stringSetting(cfg.interaction_id)} onChange={e => onChange('interaction_id', e.target.value)} placeholder="v1_... or interactions/..." />
      </label>
      <label className="block"><span className={LABEL}>Google generated video URI (optional)</span>
        <input className={FIELD} value={stringSetting(cfg.generated_video_uri)} onChange={e => onChange('generated_video_uri', e.target.value)} placeholder="https://generativelanguage.googleapis.com/v1beta/files/...:download" />
      </label>
    </>}

    {(['upload_file_to_search_store', 'generate_video', 'edit_image'] as string[]).includes(actionId) &&
      <div className="rounded-lg border border-amber-200 dark:border-amber-900/70 bg-amber-50 dark:bg-amber-950/35 px-3 py-2">
        <Checkbox checked={Boolean(cfg.allow_paid_action)} onChange={v => onChange('allow_paid_action', v)}
          label="Allow paid operation" description="Requires GEMINI_ENABLE_PAID_ACTIONS=1 on the backend. Google may charge your project." />
      </div>}

    {(['analyze_audio', 'transcribe_recording', 'analyze_document', 'analyze_image', 'analyze_video', 'upload_media_file', 'upload_file_to_search_store', 'edit_image', 'generate_video', 'download_video'] as string[]).includes(actionId) &&
      <details className="border-t border-[#e6e6ea] dark:border-[#374151] pt-3"><summary className="cursor-pointer py-2 text-[12px] font-semibold text-[#444] dark:text-[#b8bec7]">Request & processing</summary>
        <div className="space-y-3 pt-3">
          <NumberField name="Request timeout (seconds)" value={numberSetting(cfg.timeout_seconds, 120)} min={15} max={300} onChange={n => onChange('timeout_seconds', n)} />
          <NumberField name="Media processing wait (seconds)" value={numberSetting(cfg.poll_seconds, 180)} min={30} max={900} onChange={n => onChange('poll_seconds', n)} />
        </div>
      </details>}


    <div className="border-t border-[#ececf0] dark:border-[#374151] pt-3 text-[11px] leading-5 text-[#4b5563] dark:text-[#999]">
      <p>Native CLIPTORA · Google Gemini</p>
      <p>Execution and results are handled by the FastAPI workflow engine.</p>
    </div>
  </div>
}

export default GeminiParameters
