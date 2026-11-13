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
      <span><strong className="block">Chat Model is required</strong>Connect a Chat Model through the bottom port of the node.</span>
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
    <div className="space-y-3">
      <div className="flex items-center justify-between border-b border-[#ededed] dark:border-[#374151] pb-2">
        <SectionLabel>Options</SectionLabel>
        <button type="button" onClick={() => setOptionsOpen(v => !v)} aria-expanded={optionsOpen}
          aria-label="Add option" title="Add option" className="grid size-8 place-items-center rounded-lg text-[#555] hover:bg-[#f3f3f3] dark:hover:bg-[#374151]"><Plus size={20}/></button>
      </div>
      {optionsOpen && <div className="rounded-xl border border-[#e2e2e5] bg-white p-1 shadow-lg dark:border-[#374151] dark:bg-[#252b36]">
        {([['system_message', 'System Message'], ['max_iterations','Max Iterations'], ['return_intermediate_steps','Return Intermediate Steps'], ['passthrough_binary_images','Automatically Passthrough Binary Images'], ['passthrough_binary_pdfs','Automatically Passthrough Binary PDFs'], ['tracing_metadata','Tracing Metadata'], ['auto_save_highlighted_data','Auto-save highlighted data'], ['enable_streaming','Enable Streaming'], ['batch_processing','Batch Processing'], ['force_tool_call_first','Force Tool Call on First Iteration']] as const).map(([key,label]) =>
          <button type="button" key={key} className="block w-full rounded-lg px-3 py-2 text-left text-[13px] hover:bg-[#f4f4f6] dark:hover:bg-[#374151]" onClick={() => {
            onChange('__cliptora_ui_agent_options', [...new Set([...(Array.isArray(settings.__cliptora_ui_agent_options) ? settings.__cliptora_ui_agent_options as string[] : []), key])]); setOptionsOpen(false)
          }}>{label}</button>)}
      </div>}
      {(Array.isArray(settings.__cliptora_ui_agent_options) ? settings.__cliptora_ui_agent_options as string[] : []).map(key => {
        const extras: Record<string, FieldSchema> = {
          system_message: properties.system_message ?? {type:'string',title:'System Message'},
          max_iterations: {type:'integer',title:'Max Iterations',default:10,minimum:1,maximum:50},
          return_intermediate_steps: {type:'boolean',title:'Return Intermediate Steps'},
          passthrough_binary_images: {type:'boolean',title:'Automatically Passthrough Binary Images'},
          passthrough_binary_pdfs: {type:'boolean',title:'Automatically Passthrough Binary PDFs'},
          tracing_metadata: {type:'string',title:'Tracing Metadata'},
          auto_save_highlighted_data: {type:'boolean',title:'Auto-save Highlighted Data'},
          enable_streaming: {type:'boolean',title:'Enable Streaming'},
          batch_processing: {type:'boolean',title:'Batch Processing'},
          force_tool_call_first: {type:'boolean',title:'Force Tool Call on First Iteration'},
        }
        if (!extras[key]) return null
        return <div key={key} className="rounded-xl border border-[#eee] p-3 dark:border-[#374151]">
          <button type="button" className="mb-2 text-[11px] text-red-500 hover:underline" onClick={() => onChange('__cliptora_ui_agent_options', (settings.__cliptora_ui_agent_options as string[]).filter(item => item !== key))}>Remove option</button>
          <DynamicField name={key} schema={extras[key]} value={settings[key]} onChange={value => onChange(key,value)}/>
          {key !== 'system_message' && <p className="mt-2 text-[11px] text-amber-600">This option requires Agent Runtime support before it affects execution.</p>}
        </div>
      })}
      {settings.enable_fallback_model === true && <DynamicField name="fallback_model" schema={properties.fallback_model} value={settings.fallback_model} onChange={value => onChange('fallback_model',value)}/>}
    </div>
    <p className="border-l-2 border-violet-200 dark:border-violet-900/70 bg-violet-50/50 dark:bg-violet-950/40 px-3 py-2 text-[11px] leading-5 text-[#777] dark:text-[#b8bec7]">Connected Memory and Tool nodes are supplied as bounded JSON context. Secrets should never be stored in workflow settings.</p>
  </div>
}

const node: WorkflowNodeUI = { type: 'ai.agent', Icon: Bot, Parameters }
export default node