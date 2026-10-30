import type { WorkflowNodeUI } from '../nodeTypes'
import { GitMerge } from 'lucide-react'

/** UI extension for backend node `flow.merge`. Add Card or Parameters here when needed. */
const node: WorkflowNodeUI = {
  type: 'flow.merge',
  Icon: GitMerge,
}

export default node
