import type { WorkflowNodeUI } from '../nodeTypes'
import { Sparkles } from 'lucide-react'

/** UI extension for backend node `ai.highlights`. Add Card or Parameters here when needed. */
const node: WorkflowNodeUI = {
  type: 'ai.highlights',
  Icon: Sparkles,
}

export default node
