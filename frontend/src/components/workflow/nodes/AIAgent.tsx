import { useState } from 'react'
import { Bot, CircleAlert, Plus } from 'lucide-react'
import type { WorkflowNodeParametersProps, WorkflowNodeUI } from '../nodeTypes'
import { DynamicField, SectionLabel, getObject, inputClass, type FieldSchema } from '../editor/WorkflowNodeFields'

function Parameters({ node, catalog, onChange, hasAgentModel }: WorkflowNodeParametersProps) {
  const [optionsOpen, setOptionsOpen] = useState(false)
  const settings = node.settings
  const properties = getObject(getObject(catalog?.parameters_schema).properties) as Record<string, FieldSchema>
  return <div className="space-y-5" data-ai-agent-parameters>
    {hasAgentModel === false && <div role="alert" className="flex gap-2 border-l-2 border-red-400 bg-red-50 dark:bg-red-950/40 p-3 text-[12px] leading-5 text-red-700 dark:text-red-300">
      <CircleAlert size={17} className="mt-0.5 shrink-0" />
      <span><strong className="block">Chat Model is required</strong>Connect an OpenAI Chat Model through the bottom port of the node.</span>
    </div>}
    <label className="block"><SectionLabel>Source for Prompt (User Message)</SectionLabel>
      <select className={inputClass} value={String(settings.prompt_source ?? 'connected_chat_trigger')}
        onChange={event => onChange('prompt_source', event.target.value)}>
        <option value="connected_chat_trigger">Connected Chat Trigger Node</option>
        <option value="define_below">Define below</option>
      </select>
    </label>
    <label className="block"><SectionLabel>Prompt (User Message)</SectionLabel>
      <textarea rows={3} className={`${inputClass} resize-y font-mono`} value={String(settings.prompt ?? '')}
        onChange={event => onChange('prompt', event.target.value)} placeholder="{{ $json.chatInput }}" />
      <span className="mt-1 block text-[11px] text-[#888] dark:text-[#b8bec7]">Connected mode reads <code>chatInput</code> from upstream data. Define below uses this text directly.</span>
    </label>
    <DynamicField name="require_specific_output" schema={properties.require_specific_output} value={settings.require_specific_output ?? false} onChange={value => onChange('require_specific_output', value)} />
    <DynamicField name="enable_fallback_model" schema={properties.enable_fallback_model} value={settings.enable_fallback_model ?? false} onChange={value => onChange('enable_fallback_model', value)} />
    <div>
      <div className="flex items-center justify-between border-b border-[#ededed] dark:border-[#374151] pb-2">
        <SectionLabel>Options</SectionLabel>
        <button type="button" onClick={() => setOptionsOpen(value => !value)} aria-expanded={optionsOpen} title="Add options"
          className="grid size-8 place-items-center rounded-md text-[#555] dark:text-[#b8bec7] hover:bg-[#f3f3f3] dark:hover:bg-[#1f2937]"><Plus size={19}/></button>
      </div>
      {optionsOpen && <div className="space-y-4 pt-4">
        <DynamicField name="system_message" schema={properties.system_message} value={settings.system_message} onChange={value => onChange('system_message', value)} />
        {settings.enable_fallback_model === true && <DynamicField name="fallback_model" schema={properties.fallback_model} value={settings.fallback_model} onChange={value => onChange('fallback_model', value)} />}
      </div>}
    </div>
    <p className="border-l-2 border-violet-200 dark:border-violet-900/70 bg-violet-50/50 dark:bg-violet-950/40 px-3 py-2 text-[11px] leading-5 text-[#777] dark:text-[#b8bec7]">Connected Memory and Tool nodes are supplied as bounded JSON context. Secrets should never be stored in workflow settings.</p>
  </div>
}

const node: WorkflowNodeUI = { type: 'ai.agent', Icon: Bot, Parameters }
export default node
