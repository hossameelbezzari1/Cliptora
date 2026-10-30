import type { WorkflowNodeUI } from '../nodeTypes'
import { Bot } from 'lucide-react'

/** UI extension for backend node `ai.chat_model`. Add Card or Parameters here when needed. */
const node: WorkflowNodeUI = {
  type: 'ai.chat_model',
  Icon: Bot,
}

export default node
