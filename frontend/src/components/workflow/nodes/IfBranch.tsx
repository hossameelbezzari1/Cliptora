import { GitBranch } from 'lucide-react'
import type { WorkflowNodeParametersProps, WorkflowNodeUI } from '../nodeTypes'
import { WorkflowIfParameters } from '../WorkflowIfParameters'

function Parameters({ node, onChange }: WorkflowNodeParametersProps) {
  return <WorkflowIfParameters settings={node.settings} onChange={onChange} />
}

const node: WorkflowNodeUI = { type: 'flow.if', Icon: GitBranch, Parameters }
export default node
