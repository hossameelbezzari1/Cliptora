import type { WorkflowNodeUI } from '../nodeTypes'
import { GitFork } from 'lucide-react'

/** UI extension for backend node `flow.switch`. Add Card or Parameters here when needed. */
const node: WorkflowNodeUI = {
  type: 'flow.switch',
  Icon: GitFork,
}

export default node
