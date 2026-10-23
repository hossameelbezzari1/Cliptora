import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertCircle, CheckCircle2, ChevronDown, Clock3, Link2, Play, Plus, RefreshCw, TerminalSquare, Trash2 } from 'lucide-react'
import { api } from '../../../lib/api'
import { useEditor } from '../../../stores/editorStore'

type CommandKind = 'http_json' | 'json_extract' | 'selenium_youtube_comments'
type Trigger = 'manual' | 'on_start' | 'on_end' | 'on_repeat'
type Command = { id: number; name: string; kind: CommandKind; config: Record<string, unknown> }
type Binding = {
  id: number; project_id: number; clip_id: string; command_id: number
  trigger: Trigger; enabled: boolean; inputs: Record<string, unknown>; output_mapping: Record<string, string>
}
type Run = { id: number; binding_id: number; state: 'queued'|'running'|'completed'|'failed'; output: unknown; error: string | null }

const inputClass = 'w-full min-w-0 rounded-lg border border-white/10 bg-[#25272f] px-2.5 py-2 text-xs text-white outline-none focus:border-[#aa82ef]'
const btn = 'rounded-lg border border-[#474154] bg-[#24232d] px-2.5 py-2 text-[11px] text-[#e7def6] hover:border-[#926ce4] disabled:opacity-40'
const example: Record<CommandKind, { config: Record<string, unknown>; inputs: Record<string, unknown>; description: string }> = {
  json_extract: {
    config: { path: 'comments.0.text' },
    inputs: { data: { comments: [{ author: 'Example', text: 'Sample comment' }] } },
    description: 'Extract a single field from JSON input; safe, offline, without arbitrary code.'
  },
  http_json: {
    config: { method: 'GET', url: 'https://api.example.com/example' },
    inputs: {},
    description: 'Request an HTTPS JSON API on the backend allowlist (CLIPTORA_COMMAND_ALLOWED_HOSTS).'
  },
  selenium_youtube_comments: {
    config: { max_comments: 20 },
    inputs: { video_url: 'https://www.youtube.com/watch?v=VIDEO_ID' },
    description: 'Use a dedicated authorized local Chrome profile. Login, CAPTCHA bypass and unsafe .pkl loading are not performed.'
  },
}

const safeJson = (raw: string): Record<string, unknown> => {
  const data: unknown = JSON.parse(raw)
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Enter a JSON object, e.g. {"key": "value"}')
  return data as Record<string, unknown>
}
const showJson = (obj: unknown) => JSON.stringify(obj, null, 2)

/** Put inside Clip Settings. The library is global; each binding is specific to this clip. */
export function ClipCommandsSection({clipId}: {clipId: string}) {
  const projectId = useEditor(s => s.projectId)
  const [commands, setCommands] = useState<Command[]>([])
  const [bindings, setBindings] = useState<Binding[]>([])
  const [runs, setRuns] = useState<Run[]>([])
  const [kind, setKind] = useState<CommandKind>('selenium_youtube_comments')
  const [name, setName] = useState('YouTube Comments Scraper')
  const [configuration, setConfiguration] = useState(showJson(example.selenium_youtube_comments.config))
  const [selectedCommandId, setSelectedCommandId] = useState<number | ''>('')
  const [trigger, setTrigger] = useState<Trigger>('manual')
  const [inputs, setInputs] = useState(showJson(example.selenium_youtube_comments.inputs))
  const [mapping, setMapping] = useState('{"comments.0.text": "youtube_comment"}')
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [open, setOpen] = useState(true)

  const base = useMemo(() => `/commands/bindings?project_id=${projectId}&clip_id=${encodeURIComponent(clipId)}`, [clipId, projectId])
  const runsUrl = useMemo(() => `/commands/runs?project_id=${projectId}&clip_id=${encodeURIComponent(clipId)}`, [clipId, projectId])
  const refresh = useCallback(async (withFeedback = false) => {
    if (!projectId || !clipId) return
    try {
      const [c, b, r] = await Promise.all([
        api<Command[]>('/commands/library'), api<Binding[]>(base), api<Run[]>(runsUrl)
      ])
      setCommands(c); setBindings(b); setRuns(r)
      if (withFeedback) setMessage('Commands refreshed')
      setError('')
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : 'Could not load commands from FastAPI')
    }
  }, [projectId, clipId, base, runsUrl])
  useEffect(() => { void refresh() }, [refresh])
  const isRunning = runs.some(run => run.state === 'queued' || run.state === 'running')
  useEffect(() => {
    if (!isRunning) return
    const poll = window.setInterval(() => { void refresh() }, 1500)
    return () => window.clearInterval(poll)
  }, [isRunning, refresh])

  const selectKind = (next: CommandKind) => {
    setKind(next); setConfiguration(showJson(example[next].config)); setInputs(showJson(example[next].inputs))
    setName(next === 'selenium_youtube_comments' ? 'YouTube Comments Scraper' : next === 'http_json' ? 'Fetch JSON API' : 'Extract JSON Field')
    setMapping(next === 'selenium_youtube_comments' ? '{"comments.0.text": "youtube_comment"}' : '{}')
  }
  const action = async (job: () => Promise<void>) => {
    setBusy(true); setError(''); setMessage('')
    try { await job(); await refresh() } catch (exc) { setError(exc instanceof Error ? exc.message : 'Request failed') } finally { setBusy(false) }
  }
  const saveCommand = () => action(async () => {
    const created = await api<Command>('/commands/library', { method: 'POST', body: JSON.stringify({ name: name.trim(), kind, config: safeJson(configuration) }) })
    setSelectedCommandId(created.id)
    setMessage('Reusable command saved in MySQL')
  })
  const addBinding = () => action(async () => {
    if (selectedCommandId === '') throw new Error('Choose a saved command first')
    const map = safeJson(mapping)
    if (!Object.values(map).every(value => typeof value === 'string')) throw new Error('Output mapping values must be variable names')
    await api('/commands/bindings', { method: 'POST', body: JSON.stringify({
      project_id: projectId, clip_id: clipId, command_id: selectedCommandId,
      trigger, enabled: true, inputs: safeJson(inputs), output_mapping: map
    }) })
    setMessage('Command attached to the selected timeline element')
  })
  const runBinding = (binding: Binding) => action(async () => {
    const run = await api<Run>(`/commands/bindings/${binding.id}/run`, { method: 'POST' })
    setRuns(prev => [run, ...prev])
    setMessage(`Command queued (#${run.id}); results will appear below`)
  })
  const removeBinding = (bindingId: number) => action(async () => {
    await api(`/commands/bindings/${bindingId}`, { method: 'DELETE' })
    setMessage('Command detached from this clip; global definition preserved')
  })
  const removeCommand = (commandId: number) => action(async () => {
    if (bindings.some(b => b.command_id === commandId)) throw new Error('Detach this command first')
    if (!window.confirm('Delete this saved command from your global library?')) return
    await api(`/commands/library/${commandId}`, { method: 'DELETE' })
    if (selectedCommandId === commandId) setSelectedCommandId('')
  })

  return <section className="grid gap-3 border-t border-white/10 pt-3" data-clip-commands>
    <button type="button" onClick={() => setOpen(v => !v)} aria-expanded={open} className="flex items-center justify-between gap-2 text-left text-xs font-semibold text-white">
      <span className="flex items-center gap-2"><TerminalSquare size={15} className="text-[#bc8aff]"/> Commands / Automation</span>
      <ChevronDown size={15} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
    </button>
    {open && <>
      <p className="text-[11px] leading-5 text-[#999fad]">Attach reusable Python/Selenium/API workflows to this clip. Commands are saved in MySQL and can be attached to other clips or projects.</p>
      <div className="flex items-center justify-between gap-2"><h4 className="text-[11px] font-semibold text-[#d7c5fa]">Attached commands ({bindings.length})</h4><button className={btn} title="Reload command history" type="button" onClick={() => { void refresh(true) }}><RefreshCw size={13}/></button></div>
      {bindings.length === 0 && <p className="rounded-md border border-dashed border-[#3c354b] p-3 text-[11px] text-[#929aaa]">No command attached yet.</p>}
      {bindings.map(binding => {
        const definition = commands.find(c => c.id === binding.command_id)
        const latest = runs.find(r => r.binding_id === binding.id)
        return <div className="grid gap-2 rounded-lg border border-[#494154] bg-[#23222b] p-2.5" key={binding.id}>
          <div className="flex items-start justify-between gap-2"><div className="min-w-0"><p className="truncate text-xs font-semibold text-white">{definition?.name ?? 'Missing saved command'}</p><p className="text-[10px] text-[#a1a4af]">{definition?.kind ?? 'unknown'} · {binding.trigger}</p></div><label className="flex items-center gap-1 text-[10px] text-[#babfc9]"><input type="checkbox" checked={binding.enabled} disabled={busy} onChange={e => { void action(async () => { await api(`/commands/bindings/${binding.id}`, { method: 'PATCH', body: JSON.stringify({ enabled: e.target.checked }) }) }) }}/>Enabled</label></div>
          <div className="flex items-center gap-1.5"><button className={`${btn} flex items-center gap-1`} disabled={busy || !binding.enabled || isRunning} onClick={() => { void runBinding(binding) }}><Play size={13}/> Run</button><button className={`${btn} ml-auto`} title="Detach from element" disabled={busy} onClick={() => { void removeBinding(binding.id) }}><Trash2 size={13}/></button></div>
          {latest && <div className="text-[10px] text-[#c9c1d9]">{latest.state === 'completed' ? <CheckCircle2 size={12} className="mr-1 inline text-green-400"/> : <Clock3 size={12} className="mr-1 inline text-[#bd9cea]"/>}#{latest.id} · {latest.state}{latest.error && <p className="mt-1 break-words text-red-300">{latest.error}</p>}{latest.state === 'completed' && <details className="mt-1"><summary className="cursor-pointer">View JSON output</summary><pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-all rounded bg-[#18191f] p-2">{showJson(latest.output)}</pre></details>}</div>}
        </div>
      })}
      <h4 className="pt-1 text-[11px] font-semibold text-[#d7c5fa]">Attach a saved command</h4>
      <select aria-label="Saved commands" className={inputClass} value={selectedCommandId} onChange={e => setSelectedCommandId(e.target.value ? Number(e.target.value) : '')}>
        <option value="">Choose command…</option>{commands.map(c => <option key={c.id} value={c.id}>{c.name} ({c.kind})</option>)}
      </select>
      <label className="grid gap-1 text-[11px] text-[#9ba1ab]">Trigger
        <select className={inputClass} value={trigger} onChange={e => setTrigger(e.target.value as Trigger)}><option value="manual">Manual</option><option value="on_start">On clip start (external event)</option><option value="on_end">On clip end (external event)</option><option value="on_repeat">On repeat (external event)</option></select>
      </label>
      <label className="grid gap-1 text-[11px] text-[#9ba1ab]">Input JSON<textarea className={`${inputClass} resize-y font-mono`} rows={3} value={inputs} onChange={e => setInputs(e.target.value)}/></label>
      <label className="grid gap-1 text-[11px] text-[#9ba1ab]">Result path → Global Variable name (JSON)<textarea className={`${inputClass} resize-y font-mono`} rows={2} value={mapping} onChange={e => setMapping(e.target.value)}/></label>
      <button className={`${btn} flex items-center justify-center gap-1`} disabled={busy || selectedCommandId === ''} onClick={() => { void addBinding() }}><Link2 size={14}/> Link command to this clip</button>
      <button className="mt-1 flex items-center gap-1 text-[11px] text-[#c9b2f0]" onClick={() => setShowAdvanced(v => !v)}><Plus size={14}/>{showAdvanced ? 'Close builder' : 'Create reusable command'}</button>
      {showAdvanced && <div className="grid gap-2 rounded-xl border border-[#40394d] bg-[#1d1e24] p-3">
        <input aria-label="Command name" className={inputClass} value={name} onChange={e => setName(e.target.value)} placeholder="Command name"/>
        <select aria-label="Command type" className={inputClass} value={kind} onChange={e => selectKind(e.target.value as CommandKind)}><option value="selenium_youtube_comments">Selenium — YouTube comments</option><option value="http_json">HTTPS JSON API</option><option value="json_extract">JSON Extract / Transform</option></select>
        <p className="text-[10px] leading-4 text-[#9299a6]">{example[kind].description}</p>
        <label className="grid gap-1 text-[11px] text-[#a8a0b4]">Configuration JSON<textarea className={`${inputClass} resize-y font-mono`} rows={4} value={configuration} onChange={e => setConfiguration(e.target.value)} /></label>
        <button className={btn} disabled={busy || !name.trim()} onClick={() => { void saveCommand() }}>Save command to MySQL</button>
        {selectedCommandId !== '' && <button className={`${btn} flex items-center justify-center gap-1 text-red-300`} disabled={busy} onClick={() => { void removeCommand(Number(selectedCommandId)) }}><Trash2 size={13}/> Delete selected saved command</button>}
      </div>}
      {(error || message) && <p role={error ? 'alert' : 'status'} className={`flex gap-1.5 rounded-lg p-2 text-[11px] ${error ? 'bg-red-900/25 text-red-300' : 'bg-[#313044] text-[#d6c7ef]'}`}>{error && <AlertCircle size={14} className="shrink-0"/>}{error || message}</p>}
      <p className="text-[10px] leading-4 text-[#838997]">For security, automatic triggers run only when an authorized caller dispatches an event. Simply scrubbing Preview will not launch Selenium. Credentials remain server-side.</p>
    </>}
  </section>
}
