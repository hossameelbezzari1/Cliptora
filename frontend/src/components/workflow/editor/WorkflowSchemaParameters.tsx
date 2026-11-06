import { useState } from 'react'
import { KeyRound, Plus } from 'lucide-react'
import type { WorkflowNodeParametersProps } from '../nodeTypes'
import { WorkflowToolIcon } from '../WorkflowToolIcon'
import { DynamicField, JsonField, SectionLabel, getObject, inputClass, isExcel, lightButton, titleize, type FieldSchema } from './WorkflowNodeFields'

const HIDDEN_FIELDS = new Set([
  'credential_id', 'credential', 'operation', 'action', 'resource', 'filters', 'source_id',
  '__cliptora_ui_source_handles', '__cliptora_ui_target_handles', '__cliptora_ui_notes',
  '__cliptora_ui_note_visible', '__cliptora_ui_label', '__cliptora_ui_pinned',
])

/** Safe generic fallback for backend catalog types without a registered Parameters component.
 * It only reads the backend schema and never infers a fake operation from a fixed value.
 */
export function WorkflowSchemaParameters({ node, catalog, onChange, onManageCredentials }: WorkflowNodeParametersProps) {
  const [filtersOpen, setFiltersOpen] = useState(false)
  const settings = node.settings
  const title = catalog?.label ?? node.type
  const excel = isExcel(`${title} ${node.type}`)
  const schema = getObject(catalog?.parameters_schema)
  const declared = getObject(schema.properties) as Record<string, FieldSchema>
  const excelFields: Record<string, FieldSchema> = excel ? {
    return_all: { type: 'boolean', title: 'Return All', default: false },
    limit: { type: 'integer', title: 'Limit', default: 100, minimum: 1 },
    fields: { type: 'string', title: 'Fields' },
  } : {}
  const fields = { ...excelFields, ...declared }
  const keys = [...new Set([...Object.keys(fields), ...Object.keys(settings)])]
    .filter(key => !HIDDEN_FIELDS.has(key) && !key.startsWith('__cliptora_ui_'))
  const actions = catalog?.actions ?? []
  const actionKey = Object.prototype.hasOwnProperty.call(settings, 'action') &&
    !Object.prototype.hasOwnProperty.call(settings, 'operation') ? 'action' : 'operation'
  const activeAction = String(settings[actionKey] ?? actions[0] ?? '')
  const app = /excel|gmail|google|telegram|outlook|onedrive|anthropic/i.test(`${title} ${node.type}`)
  const needsCredential = app || Boolean(catalog?.credentials?.length)
  const hasFilters = excel || Object.prototype.hasOwnProperty.call(settings, 'filters')

  return <div className="space-y-5" data-schema-generated-parameters>
    {needsCredential && <div className="space-y-2">
      <div className="flex items-center gap-2"><KeyRound size={16} className="text-violet-600 dark:text-violet-300"/><SectionLabel>Credential</SectionLabel></div>
      <button type="button" disabled={!onManageCredentials} onClick={onManageCredentials}
        className={`${lightButton} rounded-lg px-3`}
        title={onManageCredentials ? 'Manage credentials' : 'Credential management is not yet available'}>
        <WorkflowToolIcon type={node.type} label={title} size={17}/>
        {settings.credential_id ? `Credential ${String(settings.credential_id)}` : `Connect to ${title}`}
      </button>
      {!onManageCredentials && <p className="text-[11px] leading-5 text-[#888] dark:text-[#b8bec7]">Configure credentials securely in the backend. Do not store secrets in workflow settings.</p>}
    </div>}
    {excel && <p className="border-l-2 border-amber-400 bg-amber-50 dark:bg-amber-950/35 px-3 py-2 text-[12px] leading-5 text-amber-800 dark:text-amber-300">Microsoft Excel 365 uses workbooks on OneDrive or SharePoint, not local .xlsx files.</p>}
    {Object.prototype.hasOwnProperty.call(settings, 'resource') && <DynamicField name="resource" schema={fields.resource} value={settings.resource} onChange={value => onChange('resource', value)}/>}
    {actions.length > 1 && <label className="block"><SectionLabel>Operation</SectionLabel>
      <select className={inputClass} value={activeAction} onChange={event => onChange(actionKey, event.target.value)}>
        {actions.map(action => <option key={action} value={action}
          disabled={catalog?.action_capabilities?.[action]?.status === 'unavailable'}>
          {catalog?.action_capabilities?.[action]?.label ?? titleize(action)}
        </option>)}
      </select>
    </label>}
    {keys.map(key => <DynamicField key={`${node.id}:${key}`} name={key} schema={fields[key]}
      value={settings[key]} onChange={value => onChange(key, value)}/>)}
    {hasFilters && <div>
      <div className="flex items-center justify-between border-b border-[#ededed] dark:border-[#374151] pb-2">
        <SectionLabel>Filters</SectionLabel>
        <button type="button" title="Edit filters" aria-label="Edit filters" aria-expanded={filtersOpen}
          className="grid size-8 place-items-center rounded-md text-[#555] dark:text-[#b8bec7] hover:bg-[#f4f4f4] dark:hover:bg-[#1f2937]"
          onClick={() => setFiltersOpen(value => !value)}><Plus size={19}/></button>
      </div>
      {filtersOpen && <div className="pt-3"><JsonField label="Filter rules (JSON)" value={settings.filters ?? []} onChange={value => onChange('filters', value)} /></div>}
    </div>}
    {!keys.length && actions.length <= 1 && !needsCredential && !hasFilters &&
      <p className="text-[12px] text-[#888] dark:text-[#b8bec7]">This node has no configurable parameters.</p>}
  </div>
}
