import type { WorkflowNodeUI } from '../nodeTypes'
import { Bot } from 'lucide-react'

/** UI extension for backend node `ai.agent`. Add Card or Parameters here when needed. */
const node: WorkflowNodeUI = {
  type: 'ai.agent',
  Icon: Bot,
}

export default node
