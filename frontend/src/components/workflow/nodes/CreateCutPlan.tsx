import type { WorkflowNodeUI } from '../nodeTypes'
import { Scissors } from 'lucide-react'

/** UI extension for backend node `timeline.cut_plan`. Add Card or Parameters here when needed. */
const node: WorkflowNodeUI = {
  type: 'timeline.cut_plan',
  Icon: Scissors,
}

export default node
