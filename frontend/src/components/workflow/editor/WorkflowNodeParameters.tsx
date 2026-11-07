import type { WorkflowStudioState } from '../useWorkflowStudio'
import { WorkflowSchemaParameters } from './WorkflowSchemaParameters'

type Props = {
  studio: WorkflowStudioState
  inputValue?: unknown
  onManageCredentials?: () => void
  isManualTrigger: boolean
  hasAgentModel: boolean
}

/** All node forms are rendered from the backend catalog schema. */
export function WorkflowNodeParameters({ studio, inputValue, onManageCredentials, hasAgentModel }: Props) {
  const { selected, selectedCatalog, updateSelectedSetting } = studio
  if (!selected) return null
  return <WorkflowSchemaParameters node={selected} catalog={selectedCatalog}
    studio={studio} inputValue={inputValue} onChange={updateSelectedSetting}
    hasAgentModel={hasAgentModel} onManageCredentials={onManageCredentials}/>
}
