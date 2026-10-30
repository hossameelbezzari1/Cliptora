import type { WorkflowNodeUI } from '../nodeTypes'
import { GitBranch } from 'lucide-react'

/** UI extension for backend node `flow.if`. Add Card or Parameters here when needed. */
const node: WorkflowNodeUI = {
  type: 'flow.if',
  Icon: GitBranch,
}

export default node
