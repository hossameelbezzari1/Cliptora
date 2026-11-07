import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { KeyRound, LoaderCircle, Plus, RefreshCw, Trash2 } from 'lucide-react'
import { api } from '../../../lib/api'
import { mediaName } from '../../editor/library/mediaLibraryUtils'
import { InspectVideoSourceParameters } from '../InspectVideoPanels'
import type { WorkflowNodeParametersProps } from '../nodeTypes'
import { DynamicField, JsonField, SectionLabel, getObject, inputClass, titleize, type FieldSchema } from './WorkflowNodeFields'
import { WorkflowInputSelector } from './WorkflowInputSelector'

type SchemaField = FieldSchema & {
  widget?: 'textarea' | 'model' | 'messages' | 'upstream' | 'json'
  accepts?: string[]
  group?: string
  placeholder?: string
  options?: Array<{ value: string; label: string }>
  visible_if?: Record<string, unknown>
}
type Action = { id: string; label: string; resource?: string; icon?: string }
type Credential = { id: number; name: string; provider: string }
const blocked = new Set(['credential_id', 'credential', 'action', 'operation', 'source_id', 'api_key', 'password', 'secret'])
const safeFields = (value: unknown): Record<string, SchemaField> => getObject(value) as Record<string, SchemaField>

function Widget({ name, field, value, onChange, node, studio, inputValue }: {
  name: string; field: SchemaField; value: unknown; onChange: (value: unknown) => void
  node: WorkflowNodeParametersProps['node']; studio: WorkflowNodeParametersProps['studio']; inputValue: unknown
}) {
  const title = field.title ?? titleize(name)
  if (field.widget === 'upstream') return <WorkflowInputSelector
    node={node} studio={studio} inputValue={inputValue}
    kind={field.accepts?.includes('media') ? 'media' : 'text'}
    value={typeof value === 'string' ? value : ''}
    onChange={onChange} />
  if (field.widget === 'textarea') return <label className="block space-y-1.5">
    <SectionLabel>{title}</SectionLabel>
    <textarea className={`${inputClass} min-h-24 resize-y`} rows={4}
      placeholder={field.placeholder ?? ''} value={String(value ?? '')}
      onChange={event => onChange(event.target.value)} />
    {field.description && <p className="text-xs text-[#858585]">{field.description}</p>}
  </label>
  if (field.widget === 'messages') {
    const messages = Array.isArray(value) ? value.filter(item => typeof item === 'object' && item !== null) as Array<Record<string, unknown>> : []
    return <div className="space-y-3">
      <div className="flex items-center justify-between"><SectionLabel>{title}</SectionLabel><span className="text-xs text-[#888]">{messages.length}/30</span></div>
      {messages.map((message, index) => <div key={index} className="space-y-2 rounded-xl border border-[#e4e4e8] dark:border-[#374151] p-3">
        <div className="flex justify-between"><span className="text-xs">Message {index + 1}</span>
          <button type="button" aria-label={`Remove message ${index + 1}`} onClick={() => onChange(messages.filter((_, i) => i !== index))}><Trash2 size={15}/></button></div>
        <select aria-label={`Message ${index + 1} role`} className={inputClass} value={String(message.role ?? 'user')}
          onChange={event => onChange(messages.map((v, i) => i === index ? { ...v, role: event.target.value } : v))}>
          <option value="user">User</option><option value="model">Model</option><option value="system">System</option>
        </select>
        <textarea aria-label={`Message ${index + 1} text`} className={`${inputClass} resize-y`} rows={3} value={String(message.text ?? '')}
          onChange={event => onChange(messages.map((v, i) => i === index ? { ...v, text: event.target.value } : v))}/>
      </div>)}
      <button type="button" disabled={messages.length >= 30} className="flex items-center gap-1 text-xs text-violet-700 dark:text-violet-300"
        onClick={() => onChange([...messages, { role: 'user', text: '' }])}><Plus size={14}/> Add Message</button>
    </div>
  }
  if (field.options?.length) return <label className="block space-y-1.5"><SectionLabel>{title}</SectionLabel>
    <select className={inputClass} value={String(value ?? field.default ?? '')} onChange={event => onChange(event.target.value)}>
      {field.options.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}
    </select></label>
  if (field.widget === 'json') return <JsonField label={title} value={value ?? field.default ?? {}} onChange={onChange} />
  return <DynamicField name={name} schema={field} value={value} onChange={onChange} />
}

export function WorkflowSchemaParameters({ node, catalog, onChange, studio, inputValue, onManageCredentials, hasAgentModel }: WorkflowNodeParametersProps) {
  const [credentials, setCredentials] = useState<Credential[]>([])
  const [credentialsError, setCredentialsError] = useState('')
  const [credentialNotice, setCredentialNotice] = useState('')
  const [key, setKey] = useState('')
  const [credentialName, setCredentialName] = useState('My AI Connection')
  const [connecting, setConnecting] = useState(false)
  const [showConnect, setShowConnect] = useState(false)
  const [models, setModels] = useState<string[]>([])
  const [modelsError, setModelsError] = useState('')
  const [modelMode, setModelMode] = useState<'list' | 'id'>('list')
  const uploadRef = useRef<HTMLInputElement>(null)
  const settings = node.settings
  const provider = catalog?.credentials?.[0] ?? ''
  const credentialId = typeof settings.credential_id === 'number' ? settings.credential_id : null
  const schemas = safeFields(getObject(catalog?.parameters_schema).properties)
  const actionSchemas = getObject(catalog?.action_parameters)
  const actions: Action[] = (catalog?.actions ?? []).map(entry => typeof entry === 'string' ? { id: entry, label: titleize(entry) } : entry)
  const action = String(settings.action ?? actions[0]?.id ?? '')
  const actionProperties = safeFields(getObject(actionSchemas[action]))
  const fields = useMemo(() => ({ ...schemas, ...actionProperties }), [catalog, action])
  const isSource = catalog?.source_picker === true
  const hasInput = node.depends_on.length > 0

  const refreshCredentials = useCallback(async () => {
    if (!provider) return
    try {
      const all = await api<Credential[]>('/credentials')
      setCredentials(all.filter(item => item.provider === provider))
      setCredentialsError('')
    } catch (error) {
      setCredentialsError(error instanceof Error ? error.message : String(error))
    }
  }, [provider])

  useEffect(() => { void refreshCredentials() }, [refreshCredentials])
  useEffect(() => {
    let active = true
    setModels([])
    setModelsError('')
    if (credentialId !== null && provider) {
      void api<{ models: string[] }>(`/credentials/${credentialId}/models`)
        .then(result => { if (active) setModels(Array.isArray(result.models) ? result.models : []) })
        .catch(error => { if (active) setModelsError(error instanceof Error ? error.message : String(error)) })
    }
    return () => { active = false }
  }, [credentialId, provider])

  const connect = async () => {
    if (connecting || !provider || key.trim().length < 8 || credentialName.trim().length < 2) return
    setConnecting(true)
    setCredentialsError('')
    try {
      const data = provider === 'ollama' ? { base_url: key.trim() } : { api_key: key.trim() }
      const created = await api<Credential>('/credentials', { method: 'POST', body: JSON.stringify({ provider, name: credentialName.trim(), data }) })
      setCredentials(previous => [created, ...previous])
      onChange('credential_id', created.id)
      setCredentialNotice('Credential saved. Save the workflow to persist this selection.')
      try {
        await api<{ connected: boolean }>(`/credentials/${created.id}/test`, { method: 'POST' })
        setCredentialNotice('Connection verified. Save the workflow to persist this selection.')
      } catch {
        setCredentialNotice('Credential saved, but the provider connection test failed.')
      }
      setKey('')
      setShowConnect(false)
    } catch (error) { setCredentialsError(error instanceof Error ? error.message : String(error)) }
    finally { setConnecting(false) }
  }

  const setModel = (next: string) => {
    if (studio && node.type === 'ai.gemini') {
      studio.updateNode(node.id, { settings: { ...settings, model: next, model_by_id: '' } })
    } else onChange('model', next)
  }
  const visible = (field: SchemaField): boolean => !field.visible_if || Object.entries(field.visible_if).every(([key, expected]) =>
    Array.isArray(expected) ? expected.includes(settings[key]) : settings[key] === expected)
  const names = [...new Set([...Object.keys(fields), ...(!actions.length ? Object.keys(settings) : [])])]
    .filter(name => !blocked.has(name) && !name.startsWith('__') && name !== 'model' && name !== 'resource' && name !== 'filters')
    .filter(name => !actions.length || name in actionProperties || (name in schemas && name !== 'prompt'))
    .filter(name => visible(fields[name] ?? {}))
  const normal = names.filter(name => (fields[name]?.group ?? 'Parameters') !== 'Advanced')
  const advanced = names.filter(name => fields[name]?.group === 'Advanced')
  const actionOptions = [...new Set(actions.map(item => item.resource || 'General'))]
  const currentResource = actions.find(item => item.id === action)?.resource ?? 'General'

  return <div className="space-y-5" data-schema-generated-parameters>
    {isSource && studio && <InspectVideoSourceParameters
      sourceId={studio.sourceId} sources={studio.sources}
      mediaOptions={studio.editorMedia.filter(media => media.kind === 'video').map(media => ({ id: media.id, label: mediaName(media) }))}
      onSourceChange={studio.setSourceId} onMediaChange={id => { void studio.useMediaSource(id) }}
      onUpload={event => { void studio.upload(event) }} uploadRef={uploadRef} working={studio.working}
      isSourceNode={node.type === 'core.video_source'} />}

    {provider && <section className="space-y-3">
      <div className="flex items-center gap-2"><KeyRound size={16}/><SectionLabel>{provider} Credential</SectionLabel></div>
      <div className="flex gap-2">
        <select className={inputClass} aria-label={`${provider} credential`} value={credentialId ?? ''}
          onChange={event => onChange('credential_id', event.target.value ? Number(event.target.value) : null)}>
          <option value="">Select a credential...</option>
          {credentialId && !credentials.some(item => item.id === credentialId) && <option value={credentialId}>Credential #{credentialId} (not loaded)</option>}
          {credentials.map(item => <option value={item.id} key={item.id}>{item.name}</option>)}
        </select>
        <button type="button" title="Refresh credentials" onClick={() => void refreshCredentials()}><RefreshCw size={16}/></button>
      </div>
      <div className="flex gap-3 text-xs">
        <button type="button" onClick={() => setShowConnect(value => !value)}>Connect</button>
        {onManageCredentials && <button type="button" onClick={onManageCredentials}>Manage Credentials</button>}
      </div>
      {showConnect && <div className="space-y-2 rounded-xl border p-3">
        <input className={inputClass} aria-label="Connection name" value={credentialName} onChange={e => setCredentialName(e.target.value)} />
        <input className={inputClass} type={provider === 'ollama' ? 'url' : 'password'} aria-label={provider === 'ollama' ? 'Ollama base URL' : 'API key'}
          placeholder={provider === 'ollama' ? 'http://host.docker.internal:11434' : 'API key'} value={key} onChange={e => setKey(e.target.value)} />
        <button className="flex items-center gap-1 text-xs" disabled={connecting} type="button" onClick={() => void connect()}>
          {connecting && <LoaderCircle size={13} className="animate-spin"/>} Save & Connect
        </button>
      </div>}
      {credentialsError && <p role="alert" className="text-xs text-red-600">{credentialsError}</p>}
      {credentialNotice && <p role="status" className="text-xs text-violet-700">{credentialNotice}</p>}
    </section>}

    {actions.length > 1 && <section className="space-y-3">
      {actionOptions.length > 1 && <label className="block"><SectionLabel>Resource</SectionLabel><select className={inputClass}
        value={currentResource} onChange={e => { const next = actions.find(item => (item.resource || 'General') === e.target.value); if (next) onChange('action', next.id) }}>
        {actionOptions.map(item => <option key={item} value={item}>{item}</option>)}
      </select></label>}
      <label className="block"><SectionLabel>Operation</SectionLabel><select className={inputClass} value={action}
        onChange={e => onChange('action', e.target.value)}>
        {actions.filter(item => (item.resource || 'General') === currentResource).map(item => <option value={item.id} key={item.id}>{item.label}</option>)}
      </select></label>
    </section>}

    {catalog?.credentials?.includes('openai') && node.type === 'ai.agent' && !hasAgentModel && <p role="alert" className="text-xs text-amber-700">Connect a Chat Model to the required port.</p>}
    {fields.model && visible(fields.model) && (fields.model.options?.length ? <Widget name="model" field={fields.model} value={settings.model} onChange={value => setModel(String(value ?? ''))}
      node={node} studio={studio} inputValue={inputValue}/> : <section className="space-y-2"><SectionLabel>Model</SectionLabel>
      <div className="flex gap-2">
        <select aria-label="Model selection mode" className={`${inputClass} max-w-[120px]`} value={modelMode} onChange={e => setModelMode(e.target.value as 'list' | 'id')}>
          <option value="list">From list</option><option value="id">By ID</option>
        </select>
        {modelMode === 'list' && models.length > 0
          ? <select aria-label="Model" className={inputClass} value={String(settings.model ?? '')}
              onChange={e => setModel(e.target.value)}>
              {!models.includes(String(settings.model ?? '')) && <option value={String(settings.model ?? '')}>{String(settings.model ?? '')} (saved)</option>}
              {models.map(item => <option key={item} value={item}>{item}</option>)}
            </select>
          : <input aria-label="Model ID" className={inputClass} value={String(settings.model ?? fields.model.default ?? '')} onChange={e => setModel(e.target.value)}/>
        }
      </div>
      {modelsError && <p className="text-xs text-amber-700">Model discovery failed: {modelsError}. You can enter a model ID manually.</p>}
    </section>)}
    {normal.map(name => <Widget key={`${node.id}:${action}:${name}`} node={node} studio={studio} inputValue={inputValue}
      name={name} field={fields[name] ?? { type: typeof settings[name] === 'number' ? 'number' : 'string' }}
      value={settings[name]} onChange={value => onChange(name, value)} />)}
    {advanced.length > 0 && <details className="border-t border-[#e5e5e5] pt-3"><summary className="cursor-pointer text-sm">Advanced Options</summary>
      <div className="space-y-4 pt-4">{advanced.map(name => <Widget key={`${node.id}:${action}:${name}`} node={node} studio={studio} inputValue={inputValue}
        name={name} field={fields[name] ?? {}} value={settings[name]} onChange={value => onChange(name, value)} />)}</div>
    </details>}
    {hasInput && !names.some(name => fields[name]?.widget === 'upstream') && <p className="text-xs text-[#888]">Connected upstream outputs are passed to this node by the workflow engine.</p>}
  </div>
}
