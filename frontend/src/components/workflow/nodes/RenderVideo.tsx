import type { WorkflowNodeUI } from '../nodeTypes'
import { Clapperboard } from 'lucide-react'

/** UI extension for backend node `video.render`. Add Card or Parameters here when needed. */
const node: WorkflowNodeUI = {
  type: 'video.render',
  Icon: Clapperboard,
}

export default node
