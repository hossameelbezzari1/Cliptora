import type { WorkflowNodeParametersProps, WorkflowNodeUI } from '../nodeTypes'
import { WorkflowProviderParameters } from '../editor/WorkflowProviderParameters'

function Parameters(props: WorkflowNodeParametersProps) {
  return <WorkflowProviderParameters {...props} provider="OpenAI" />
}

const node: WorkflowNodeUI = { type: 'ai.openai', Parameters }
export default node
