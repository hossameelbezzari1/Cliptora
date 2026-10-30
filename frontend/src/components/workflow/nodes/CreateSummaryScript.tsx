import type { WorkflowNodeUI } from '../nodeTypes'
import { FileText } from 'lucide-react'

/** UI extension for backend node `ai.summary`. Add Card or Parameters here when needed. */
const node: WorkflowNodeUI = {
  type: 'ai.summary',
  Icon: FileText,
}

export default node
