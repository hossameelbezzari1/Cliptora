import type { WorkflowNodeUI } from '../nodeTypes'
import { Subtitles } from 'lucide-react'

/** UI extension for backend node `caption.generate`. Add Card or Parameters here when needed. */
const node: WorkflowNodeUI = {
  type: 'caption.generate',
  Icon: Subtitles,
}

export default node
