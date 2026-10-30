import type { WorkflowNodeUI } from '../nodeTypes'
import { WandSparkles } from 'lucide-react'

/** UI extension for backend node `animation.keyframes`. Add Card or Parameters here when needed. */
const node: WorkflowNodeUI = {
  type: 'animation.keyframes',
  Icon: WandSparkles,
}

export default node
