import type { WorkflowNodeUI } from '../nodeTypes'
import { Film } from 'lucide-react'

/** UI extension for backend node `core.video_source`. Add Card or Parameters here when needed. */
const node: WorkflowNodeUI = {
  type: 'core.video_source',
  Icon: Film,
}

export default node
