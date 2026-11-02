import { KeyRound, Sparkles } from 'lucide-react'
import type { WorkflowNodeParametersProps } from '../nodeTypes'
import { defaultModelForGeminiAction } from '../geminiModels'
import { defaultModelForOpenAIAction } from '../openAIModels'
import { DynamicField, ProviderModelField, SectionLabel, getObject, inputClass, titleize, type FieldSchema } from './WorkflowNodeFields'

const OPENAI_FIELDS: Record<string, string[]> = {
  message_model: ['reasoning_effort', 'system_prompt', 'prompt', 'input_path', 'max_output_tokens'],
  classify_violations: ['prompt', 'input_path', 'simplify_output'],
  analyze_image: ['reasoning_effort', 'prompt', 'image_urls', 'max_output_tokens', 'simplify_output'],
  generate_image: ['prompt', 'image_size', 'simplify_output'],
}
const GEMINI_FIELDS: Record<string, string[]> = {
  message_model: ['system_prompt', 'prompt', 'input_path', 'max_output_tokens', 'simplify_output'],
  generate_image: ['prompt', 'input_path', 'image_aspect_ratio', 'simplify_output'],
  create_file_search_store: ['display_name'],
  delete_file_search_store: ['store_name'],
  list_file_search_stores: [],
}

/** Shared provider-specific form, explicitly chosen by OpenAI.tsx / Gemini.tsx plugins. */
export function WorkflowProviderParameters({ provider, node, catalog, onChange, studio, onManageCredentials }:
  WorkflowNodeParametersProps & { provider: 'OpenAI' | 'Gemini' }) {
  const isGemini = provider === 'Gemini'
  const settings = node.settings
  const action = String(settings.action ?? 'message_model')
  const actions = catalog?.actions ?? []
  const fields = getObject(getObject(catalog?.parameters_schema).properties) as Record<string, FieldSchema>
  const selected = catalog?.action_capabilities?.[action]
  const resource = action.includes('image') ? 'Image'
    : action.includes('audio') || action.includes('recording') ? 'Audio'
    : action.includes('file_search') ? 'File Search'
    : action.includes('file') || action.includes('document') ? 'File'
    : action.includes('conversation') ? 'Conversation'
    : action.includes('video') ? 'Video' : 'Text'
  const defaultModel = isGemini ? defaultModelForGeminiAction : defaultModelForOpenAIAction
  const changeAction = (next: string) => {
    if (studio) studio.updateNode(node.id, { settings: {
      ...settings,
      action: next,
      model: defaultModel(next),
      ...(!isGemini && (next === 'message_model' || next === 'analyze_image') ? { reasoning_effort: 'none' } : {}),
    } })
    else onChange('action', next)
  }
  const names = (isGemini ? GEMINI_FIELDS : OPENAI_FIELDS)[action] ??
    Object.keys(fields).filter(key => !['action', 'model', 'resource', 'credential_id'].includes(key))

  return <div className="space-y-5" data-provider-node-parameters>
    <section className="space-y-2 border-b border-[#ededed] pb-4">
      <div className="flex items-center gap-2"><KeyRound size={16} className="text-violet-600"/><SectionLabel>Credential</SectionLabel></div>
      {onManageCredentials
        ? <button type="button" onClick={onManageCredentials} className="min-h-9 rounded-lg border border-[#dedede] bg-white px-3 text-[12px] hover:bg-[#f7f7f7]">Manage {provider} credentials</button>
        : <p className="text-[12px] leading-5 text-[#777]">Uses {isGemini ? 'GEMINI_API_KEY' : 'OPENAI_API_KEY'} configured securely in the backend environment.</p>}
    </section>
    {actions.length > 1 && <label className="block"><SectionLabel>Operation</SectionLabel>
      <select className={inputClass} value={action} onChange={event => changeAction(event.target.value)}>
        {actions.map(value => <option key={value} value={value}
          disabled={catalog?.action_capabilities?.[value]?.status === 'unavailable'}>
          {catalog?.action_capabilities?.[value]?.label ?? titleize(value)}
        </option>)}
      </select>
    </label>}
    {selected?.status === 'unavailable' && <p className="border-l-2 border-amber-400 bg-amber-50 px-3 py-2 text-[12px] text-amber-900">{selected.reason ?? 'This operation is currently unavailable.'}</p>}
    <div className="space-y-2"><div className="flex items-center gap-2"><Sparkles size={16} className="text-violet-600"/><SectionLabel>Resource</SectionLabel></div>
      <input className={`${inputClass} bg-[#fafafa]`} value={resource} readOnly aria-label="Resource" />
    </div>
    {(!isGemini || ['message_model', 'generate_image'].includes(action)) && <ProviderModelField
      provider={provider} action={action} value={String(settings.model ?? defaultModel(action))}
      onChange={value => onChange('model', value)} />}
    {names.map(name => <DynamicField key={`${node.id}:${action}:${name}`} name={name} schema={fields[name]}
      value={settings[name]} onChange={value => onChange(name, value)} />)}
  </div>
}
