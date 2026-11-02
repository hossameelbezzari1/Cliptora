import { ArrowLeft } from 'lucide-react'
import { getNodeUI } from '../nodeRegistry'
import { SelectField, SwitchField, TextField } from '../../ui/Field'
import type { WorkflowStudioState } from '../useWorkflowStudio'
import type { WorkflowNode } from '../workflowTypes'
import { titleize } from './WorkflowNodeFields'

export function WorkflowNodeSettings({ studio }: { studio: WorkflowStudioState }) {
  const { selected, nodes, catalog, updateNode, updateSelectedSetting } = studio
  if (!selected) return null
  const NodeSettings = getNodeUI(selected.type)?.Settings
  if (NodeSettings) return <NodeSettings node={selected} catalog={catalog.find(item => item.type === selected.type)}
    onChange={updateSelectedSetting} studio={studio} />
  const settings = selected.settings
  const retryEnabled = (selected.retry_limit ?? 1) > 0
  return <div className="space-y-5" data-workflow-node-settings>
    <div className="space-y-4">
      <SwitchField label="Always Output Data" checked={false} onChange={() => {}} disabled description="Not supported by the current FastAPI executor"/>
      <SwitchField label="Execute Once" checked={false} onChange={() => {}} disabled description="Requires backend execution support"/>
      <SwitchField label="Retry On Fail" checked={retryEnabled}
        onChange={checked => updateNode(selected.id, { retry_limit: checked ? 1 : 0 })} />
      {retryEnabled && <label className="block text-[13px] text-[#333]">
        <span className="mb-2 block font-medium">Maximum retries</span>
        <input type="number" min={1} max={5} value={selected.retry_limit ?? 1}
          onChange={e => updateNode(selected.id, { retry_limit: Math.max(1, Math.min(5, Number(e.target.value) || 1)) })}
          className="w-full rounded-lg border border-[#dedede] bg-white px-3 py-2.5 outline-none focus:border-violet-500" />
      </label>}
      <SelectField appearance="light" label="On Error" value="stop" disabled title="The current executor stops on unhandled errors">
        <option value="stop">Stop Workflow</option>
      </SelectField>
      <TextField appearance="light" label="Notes" rows={5} placeholder="Add a note about this node..."
        value={String(settings.__cliptora_ui_notes ?? '')}
        onChange={event => updateSelectedSetting('__cliptora_ui_notes', event.target.value)} />
      <SwitchField label="Display Note in Flow?" checked={settings.__cliptora_ui_note_visible === true}
        onChange={checked => updateSelectedSetting('__cliptora_ui_note_visible', checked)} />
    </div>
    <div className="border-t border-[#ededed] pt-4">
      <p className="text-[12px] text-[#888]">CLIPTORA native workflow node</p>
    </div>
    <details className="group rounded-lg border border-[#e7e7e7] bg-[#fbfbfb] p-3">
      <summary className="cursor-pointer text-[12px] font-semibold text-[#444]">Advanced execution settings</summary>
      <div className="mt-4 space-y-4">
        <SelectField appearance="light" label="Execution condition" value={selected.when}
          onChange={e => updateNode(selected.id, { when: e.target.value as WorkflowNode['when'] })}>
          {(['always','has_video','has_transcript','ai_enabled','condition_true','condition_false',
            'route_0','route_1','route_2','route_3','route_4','route_fallback'] as const)
            .map(value => <option key={value} value={value}>{titleize(value)}</option>)}
        </SelectField>
        <SwitchField label="Cache result for retries" checked={selected.cache ?? true}
          onChange={checked => updateNode(selected.id, { cache: checked })} />
        <div className="space-y-2 text-[12px]">
          <div className="font-semibold text-[#444]">Connected inputs</div>
          {selected.depends_on.length ? selected.depends_on.map(id => {
            const upstream = nodes.find(item => item.id === id)
            const label = upstream && typeof upstream.settings.__cliptora_ui_label === 'string' && upstream.settings.__cliptora_ui_label.trim()
              ? upstream.settings.__cliptora_ui_label
              : catalog.find(item => item.type === upstream?.type)?.label ?? 'Previous node'
            return <div key={id} className="flex items-center gap-2 rounded-lg border border-[#eee] bg-white p-2 text-[#555]">
              <ArrowLeft size={13}/>{label}
            </div>
          }) : <p className="text-[#999]">No previous nodes connected.</p>}
        </div>
      </div>
    </details>
  </div>
}
