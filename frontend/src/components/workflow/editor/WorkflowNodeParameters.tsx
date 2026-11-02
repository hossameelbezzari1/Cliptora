import { getNodeUI } from '../nodeRegistry'
import type { WorkflowStudioState } from '../useWorkflowStudio'
import { WorkflowSchemaParameters } from './WorkflowSchemaParameters'

type Props = {
  studio: WorkflowStudioState
  onManageCredentials?: () => void
  isManualTrigger: boolean
  hasAgentModel: boolean
}

/** Only dispatches node configuration; shared actions live in WorkflowNodeEditor header.
 * Node-specific fields live in nodes/<NodeName>.tsx, never in this editor.
 */
export function WorkflowNodeParameters({ studio, onManageCredentials, hasAgentModel }: Props) {
  const { selected, selectedCatalog, updateSelectedSetting } = studio
  if (!selected) return null
  const Parameters = getNodeUI(selected.type)?.Parameters

  return <div className="space-y-5" data-node-parameters-dispatcher>
    {Parameters
      ? <Parameters node={selected} catalog={selectedCatalog} onChange={updateSelectedSetting}
          studio={studio} onManageCredentials={onManageCredentials} hasAgentModel={hasAgentModel} />
      : <WorkflowSchemaParameters node={selected} catalog={selectedCatalog}
          onChange={updateSelectedSetting} onManageCredentials={onManageCredentials} />}
  </div>
}
